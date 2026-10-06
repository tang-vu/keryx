import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { MAX_RESEARCH_TARGETS } from "../llm/research-target-limits";
import { matchesA2aOriginalBinding, a2aOriginalClaimSchema } from "./original-claim";
import type { A2aOrder } from "./order";
import type { QueryRun } from "../types";
import { renderFulfilledOriginalAnswer, type FulfillmentEvidenceGap } from "./original-fulfillment-answer";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
export const ORIGINAL_FULFILLMENT_LIMITS = Object.freeze({
  expiresAt: "2026-10-07T00:00:00.000Z", maximumNewModelCalls: 10,
  modelReserveMicroUsd: 20660, originalReservedMicroUsd: 36660,
  maximumCombinedMicroUsd: 243260, maximumInputBytes: 32000, maximumOutputTokens: 8192,
  attentionLimit: 2,
} as const);

/** Frozen reconstructed scope. It is not a recovered decomposition or a new order. */
export const fulfillmentInputSchema = z.object({
  format: z.literal("keryx-canary-original-fulfillment-input-v1"),
  questionSha256: digest,
  scopeBasis: z.literal("reviewed-original-question-reconstruction"),
  targets: z.array(z.string().trim().min(1).max(2000)).min(1).max(MAX_RESEARCH_TARGETS),
  constraints: z.array(z.string().trim().min(1).max(2000)).max(16),
  sourceManifestSha256: digest,
  selectedDocumentIds: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).min(1).max(ORIGINAL_FULFILLMENT_LIMITS.attentionLimit),
}).strict().refine(value => new Set(value.targets).size === value.targets.length &&
  new Set(value.selectedDocumentIds).size === value.selectedDocumentIds.length, "Duplicate fulfillment scope");
export type FulfillmentInput = z.infer<typeof fulfillmentInputSchema>;

export const fulfillmentEvidenceGapsSchema = z.array(z.object({
  claimIndex: z.number().int().min(0).max(MAX_RESEARCH_TARGETS - 1),
  missingRequestedParts: z.array(z.string().trim().min(1).max(500)
    .refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Gap control characters refused"))
    .min(1).max(8),
}).strict()).max(MAX_RESEARCH_TARGETS).refine(value => value.every((item, index) =>
  (index === 0 || value[index - 1].claimIndex < item.claimIndex) &&
  new Set(item.missingRequestedParts).size === item.missingRequestedParts.length), "Duplicate or unordered evidence gaps");

/** This native tuple grants no supplier authority by itself. The private controller must
 * also prove its protected source-bound authorization and opaque execution capability. */
export const fulfillmentAuthoritySchema = z.object({
  format: z.literal("keryx-a2a-failed-original-fulfillment-authority-v1"),
  original: a2aOriginalClaimSchema,
  question: z.string().min(1).max(10000),
  input: fulfillmentInputSchema,
  authorizationSha256: digest, policySha256: digest, failedClosureSha256: digest,
  originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  expiresAt: z.literal(ORIGINAL_FULFILLMENT_LIMITS.expiresAt),
}).strict().refine(value => fulfillmentSha256(value.question) === value.input.questionSha256, "Original question changed");
export type FulfillmentAuthority = z.infer<typeof fulfillmentAuthoritySchema>;
export const fulfillmentClaimInputSchema = z.object({
  authority: fulfillmentAuthoritySchema, claimId: digest, claimedAt: timestamp,
}).strict();
export type FulfillmentClaimInput = z.infer<typeof fulfillmentClaimInputSchema>;
export interface A2aFulfillmentClaim extends FulfillmentClaimInput { failedOrder: A2aOrder }
export const fulfillmentCompletionInputSchema = z.object({
  claimId: digest, originalId: z.string().regex(/^a2a_[a-f0-9]{64}$/),
  runSha256: digest, providerLedgerSha256: digest, completedAt: timestamp,
}).strict();
export type FulfillmentCompletionInput = z.infer<typeof fulfillmentCompletionInputSchema>;
export interface A2aFulfillmentCompletion extends FulfillmentCompletionInput { run: QueryRun }
export interface A2aFulfillmentRecord { claim: A2aFulfillmentClaim; completion: FulfillmentCompletionInput | null }

export function fulfillmentSha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function fulfillmentObjectSha256(value: unknown): string { return fulfillmentSha256(canonicalJson(value)); }
/** Same digest committed by the metadata-only failed closure. */
export function failedOriginalEvidenceSha256(order: A2aOrder): string {
  return fulfillmentObjectSha256({ order, nativeExactOriginalSettled: true, queryRunFound: false, creatorAttempts: 0 });
}
export function matchesFailedFulfillmentOriginal(order: A2aOrder, authority: FulfillmentAuthority): boolean {
  return matchesA2aOriginalBinding(order, authority.original) && order.request?.origin === "a2a" &&
    order.request.question === authority.question && order.status === "failed" && order.errorCode === "research_failed" &&
    order.executionJournalVersion === 1 && typeof order.startedAt === "string" && timestamp.safeParse(order.startedAt).success &&
    timestamp.safeParse(order.createdAt).success && timestamp.safeParse(order.updatedAt).success &&
    Date.parse(order.createdAt) <= Date.parse(order.startedAt) && Date.parse(order.startedAt) <= Date.parse(order.updatedAt) &&
    typeof order.workerId === "string" && !!order.workerId.trim() && order.workerId.length <= 200 &&
    order.paymentStartedAt === null && order.resultSavingAt === null && order.response === null && order.resolution === null &&
    failedOriginalEvidenceSha256(order) === authority.originalEvidenceSha256;
}

/** Private provenance stored with the new result. Historical failed execution/cost stays explicit. */
export interface FulfilledOriginalRunMetadata {
  format: "keryx-a2a-original-fulfillment-result-v1";
  claimId: string; authoritySha256: string; inputSha256: string;
  originalFailureSha256: string; providerLedgerSha256: string;
  originalProviderBilling: "unknown"; noNewInboundPayment: true;
  statements: import("../agent/cited-statements").CitedStatement[];
  evidenceGaps: FulfillmentEvidenceGap[];
}
export function validateFulfilledQueryRun(run: QueryRun, claim: A2aFulfillmentClaim,
  completion: FulfillmentCompletionInput): void {
  const metadata = run.originalFulfillment;
  if (completion.originalId !== claim.authority.original.id || completion.claimId !== claim.claimId ||
    run.id !== claim.authority.original.queryId || run.question !== claim.authority.question ||
    run.budget !== 0.01 || run.engine !== "llm:deepseek:deepseek-v4-flash" ||
    run.researchMode !== "quick" || run.origin !== "a2a" || run.paymentMode !== "real" ||
    run.totalSpent !== 0 || run.totalToCreators !== 0 || run.pendingSpendUsdc !== 0 ||
    run.paymentAttempts !== 0 || run.settledPayments !== 0 || run.pendingPayments !== 0 ||
    run.parentId !== undefined || run.retryOf !== undefined || !run.answer?.trim() ||
    !Array.isArray(run.subClaims) || canonicalJson(run.subClaims) !== canonicalJson(claim.authority.input.targets) ||
    !metadata || metadata.format !== "keryx-a2a-original-fulfillment-result-v1" || metadata.claimId !== claim.claimId ||
    metadata.authoritySha256 !== fulfillmentObjectSha256(claim.authority) ||
    metadata.inputSha256 !== fulfillmentObjectSha256(claim.authority.input) ||
    metadata.originalFailureSha256 !== claim.authority.originalEvidenceSha256 ||
    metadata.providerLedgerSha256 !== completion.providerLedgerSha256 || metadata.originalProviderBilling !== "unknown" ||
    metadata.noNewInboundPayment !== true || !Array.isArray(metadata.statements) || metadata.statements.length === 0 ||
    !timestamp.safeParse(run.createdAt).success || Date.parse(run.createdAt) < Date.parse(claim.claimedAt) ||
    run.durationMs !== undefined && run.durationMs !== Date.parse(run.createdAt) - Date.parse(claim.failedOrder.startedAt!) ||
    Date.parse(completion.completedAt) < Date.parse(run.createdAt) || fulfillmentObjectSha256(run) !== completion.runSha256)
    throw new Error("Failed original fulfillment result refused");
  const citations = run.citations, evidence = run.evidence, coverage = run.claimCoverage;
  const gaps = fulfillmentEvidenceGapsSchema.safeParse(metadata.evidenceGaps);
  if (!gaps.success || canonicalJson(gaps.data) !== canonicalJson(metadata.evidenceGaps) ||
    gaps.data.some(gap => gap.claimIndex >= run.subClaims.length)) throw new Error("Failed original fulfillment gaps refused");
  const selected = new Set(claim.authority.input.selectedDocumentIds.map(id => `public:fulfillment:${id}`));
  if (!Array.isArray(citations) || citations.length < 1 || citations.length > ORIGINAL_FULFILLMENT_LIMITS.attentionLimit ||
    new Set(citations.map(item => item.marker)).size !== citations.length ||
    new Set(citations.map(item => item.sourceId)).size !== citations.length ||
    citations.some(item => item.sourceKind !== "public-reference" || item.reward !== 0 || !selected.has(item.sourceId) ||
      !/^S[1-2]$/.test(item.marker) || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1) ||
    !Array.isArray(evidence) || !evidence.some(item => item.qualifiesForAnswer === true) ||
    evidence.some(item => item.sourceKind !== "public-reference" || item.qualifiesForReward !== false ||
      !Number.isInteger(item.claimIndex) || item.claimIndex < 0 || item.claimIndex >= run.subClaims.length ||
      item.claim !== run.subClaims[item.claimIndex] || typeof item.quote !== "string" || !item.quote.trim() ||
      !Number.isFinite(item.support) || item.support < 0 || item.support > 1 ||
      !selected.has(item.sourceId) || item.marker !== `S${claim.authority.input.selectedDocumentIds.indexOf(item.sourceId.slice("public:fulfillment:".length)) + 1}` ||
      item.qualifiesForAnswer === true && !citations.some(citation => citation.marker === item.marker && citation.sourceId === item.sourceId && citation.sourceName === item.sourceName)) ||
    citations.some(citation => !evidence.some(item => item.qualifiesForAnswer === true && item.marker === citation.marker)) ||
    !Array.isArray(coverage) || coverage.length !== run.subClaims.length || coverage.some((item, index) =>
      item.claimIndex !== index || item.claim !== run.subClaims[index] || !Number.isFinite(item.coverage) ||
      item.coverage < 0 || item.coverage > 1 || !Array.isArray(item.coveredBy) ||
      new Set(item.coveredBy).size !== item.coveredBy.length || item.coveredBy.some(marker =>
        !evidence.some(e => e.claimIndex === index && e.marker === marker && e.qualifiesForAnswer === true)) ||
      item.coverage > Math.max(0, ...evidence.filter(e => e.claimIndex === index && e.qualifiesForAnswer === true).map(e => e.support))))
    throw new Error("Failed original fulfillment evidence refused");
  for (const statement of metadata.statements) {
    if (!Number.isInteger(statement.claimIndex) || statement.claimIndex < 0 || statement.claimIndex >= run.subClaims.length ||
      typeof statement.text !== "string" || !statement.text.trim() ||
      !evidence.some(item => item.qualifiesForAnswer === true && item.claimIndex === statement.claimIndex &&
        item.marker === statement.marker && item.quote === statement.quote))
      throw new Error("Failed original fulfillment statement refused");
  }
  // Reuse the real delivered renderer: technical Markdown/citation literals may
  // be escaped, and every unsupported frozen target must remain a visible gap.
  if (run.answer !== renderFulfilledOriginalAnswer({ question: run.question, answer: "", statements: metadata.statements,
    evidenceGaps: metadata.evidenceGaps,
    ledger: { evidence, claimCoverage: coverage, acceptedMarkers: new Set(citations.map(item => item.marker)),
      droppedEvidence: 0, droppedCitations: [] } })) throw new Error("Failed original fulfillment delivery refused");
}
