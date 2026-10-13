import { z } from "zod";
import { decisionReviewSchema, reviewNetworkSchema } from "../research/decision-review-types";
import { decimalMicros } from "./exact-units";

export const MAX_EVIDENCE_AUDIT_BYTES = 1_048_576;
export const auditDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const text = z.string().min(1).max(256).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const date = z.string().datetime().refine(value => new Date(value).toISOString() === value);
const index = z.number().int().min(0).max(999);
const micros = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const money = z.number().nonnegative().refine(value => decimalMicros(value) !== null);
const asset = z.object({ sourceId: text, itemId: text.optional(), contentVersion: text.optional() });
const evidence = asset.extend({ marker: text, quote: z.string().min(1).max(240),
  qualifiesForAnswer: z.boolean().optional(), qualifiesForReward: z.boolean(), support: z.number().min(0).max(1) }).passthrough();
const payment = asset.extend({ kind: z.enum(["fetch", "citation"]), payee: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountUsdc: money.refine(value => value > 0), network: reviewNetworkSchema,
  status: z.enum(["settled", "pending", "failed", "simulated"]), circleTransferId: text.optional(), createdAt: date }).passthrough();

/** Validate the fields this observer uses; the original full payload remains checksum-bound. */
export const auditReceiptPayload = z.object({
  schema: z.literal("urn:keryx:research-receipt:1"),
  dispatch: z.object({ id: z.string().uuid(), answer: z.string().min(1).max(500_000), answerSha256: auditDigest, createdAt: date }).passthrough(),
  claims: z.array(z.object({ claimIndex: index, claim: z.string().min(1).max(10_000), evidence: z.array(evidence).max(1000) }).passthrough()).max(1000),
  citations: z.array(asset.extend({ marker: text }).passthrough()).max(1000),
  settlement: z.object({ mode: z.enum(["real", "offline", "legacy"]),
    ledgerCompleteness: z.enum(["complete", "incomplete", "legacy", "not_applicable"]),
    expectedRecordedPaymentsAtFinish: z.number().int().nonnegative().max(2000).nullable(),
    creatorPayments: z.array(payment).max(1000),
    operatingPayments: z.array(payment.omit({ kind: true }).extend({ kind: z.literal("operating-fee"), funding: z.literal("keryx-sponsored") })).max(1000).optional(),
  }).passthrough(),
}).passthrough();

const cost = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(),
  z.object({ status: z.enum(["estimated", "invoice-reconciled"]), amountMicroUsd: micros, reference: text }).strict(),
]);
export const evidenceAuditInput = z.object({
  schema: z.literal("keryx-evidence-audit-input-v1"), network: reviewNetworkSchema,
  receipt: z.unknown(),
  review: z.object({ receiptDigest: auditDigest, answerSha256: auditDigest, reviewerRef: text, reviewedAt: date,
    claims: z.array(z.object({ claimIndex: index, verdict: z.enum(["supported", "unsupported", "unreviewed"]),
      evidence: z.array(asset.extend({ itemId: text, contentVersion: text, marker: text }).strict()).max(1000),
    }).strict()).max(1000),
  }).strict().nullable(),
  costs: z.object({ receiptDigest: auditDigest, llm: cost, search: cost, other: cost }).strict(),
  decisions: z.array(decisionReviewSchema).max(1000),
}).strict();

/** Trust material is supplied separately, never read from the audit input itself. */
export const evidenceAuditTrust = z.object({ expectedReceiptDigest: auditDigest.optional(),
  expectedDecisionDigests: z.array(z.object({ id: z.string().uuid(), digest: auditDigest }).strict()).max(1000).optional(),
}).strict();
export type EvidenceAuditInput = z.infer<typeof evidenceAuditInput>;
export type EvidenceAuditTrust = z.infer<typeof evidenceAuditTrust>;
export type AuditReceiptPayload = z.infer<typeof auditReceiptPayload>;
