import { z } from "zod";
import { privateHistoryCursorSchema } from "../a2a/private-research-identifiers";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "../research/run-provenance";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

export const PRIVATE_JOB_HISTORY_BOUNDS = Object.freeze({
  candidates: 26, scan: 25, rows: 25, pageBytes: 1_500_000,
  recordBytes: 4 * 1024 * 1024, detailBytes: 1_500_000,
  exportPages: 20, exportRows: 500, exportBytes: 2 * 1024 * 1024,
  requestBytes: 8192, readMs: 15_000, exportMs: 25_000,
});
const text = (max: number) => z.string().max(max).refine(v => isWellFormedUtf16(v) && !v.includes("\0"));
const wallet = z.string().regex(/^0x[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Retain PostgreSQL microseconds and its +00:00 spelling; do not round a DB cursor.
export const privateJobDateSchema = z.string().datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/);
export const privateJobPositionSchema = privateHistoryCursorSchema.extend({ createdAt: privateJobDateSchema });
export type PrivateJobPosition = z.infer<typeof privateJobPositionSchema>;
export function privateJobTime(value: string): bigint {
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value.replace(/\.\d+/, ""))) * BigInt(1000) + BigInt(fraction.padEnd(6, "0"));
}
export function comparePrivateJobPosition(a: PrivateJobPosition, b: PrivateJobPosition): number {
  const at = privateJobTime(a.createdAt), bt = privateJobTime(b.createdAt);
  return at < bt ? -1 : at > bt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export const privateJobHistoryInputSchema = z.object({
  limit: z.number().int().min(1).max(25).default(25),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2000}$/).optional(),
  search: text(200).optional(), surface: z.enum(RUN_SURFACES).optional(),
  network: z.enum(["eip155:5042", "eip155:5042002"]).optional(),
  from: privateJobDateSchema.optional(), to: privateJobDateSchema.optional(),
}).strict().refine(v => !v.from || !v.to || privateJobTime(v.from) <= privateJobTime(v.to), "Reversed dates");
export type PrivateJobHistoryInput = z.input<typeof privateJobHistoryInputSchema>;
export const privateJobHistoryCursorSchema = z.object({
  format: z.literal("private-job-history-cursor-v1"), owner: digest, query: digest,
  upper: privateJobPositionSchema, before: privateJobPositionSchema,
}).strict().refine(v => comparePrivateJobPosition(v.before, v.upper) <= 0, "Cursor above upper bound");
const provenance = z.object({ version: z.literal(1), surface: z.enum(RUN_SURFACES),
  ownershipMethod: z.enum(RUN_OWNERSHIP_METHODS) }).strict();
const incoming = z.object({
  status: z.literal("settled"), amountMicros: z.string().regex(/^[1-9]\d{0,6}$/),
  network: z.enum(["eip155:5042", "eip155:5042002"]), reference: text(256), settledAt: privateJobDateSchema,
  evidenceSource: z.enum(["circle-facilitator-success", "circle-transfer-search"]), chainFinalityVerified: z.literal(false),
}).strict();
export const privateJobHistoryRowSchema = z.object({
  id: privateJobPositionSchema.shape.id, ownerWallet: wallet, createdAt: privateJobDateSchema,
  intentCreatedAt: privateJobDateSchema.nullable(),
  savedAt: privateJobDateSchema, question: text(8192), researchMode: z.enum(["quick", "deep"]),
  model: text(64).nullable(), packageVersion: z.literal("1.0.0"),
  record: z.literal("finalized-private-result"), provenance: provenance.nullable(), incomingSettlement: incoming,
  // None of these can be recovered from a signed price or aggregate snapshot totals.
  ownSettledSpendMicros: z.null(), creatorRewardsMicros: z.null(), paidCreators: z.null(),
}).strict();
export type PrivateJobHistoryRow = z.infer<typeof privateJobHistoryRowSchema>;
export const privateJobHistoryCapabilities = Object.freeze({
  completedPrivateJobs: true, exactPayerOnly: true, multiwallet: false,
  creatorReceipts: false, privacyMutation: false, publicReportLinks: false,
});
const qualification = "Exact-payer current-store completed private jobs only; bounded intent scan, not a transaction snapshot or all archives. No linked-wallet inheritance, creator ledger, privacy mutation or public report links.";
const pageFields = {
  format: z.literal("private-job-history-v1"), wallet, scope: z.literal("exact-payer-private-current-store"),
  capabilities: z.object({ completedPrivateJobs: z.literal(true), exactPayerOnly: z.literal(true),
    multiwallet: z.literal(false), creatorReceipts: z.literal(false), privacyMutation: z.literal(false), publicReportLinks: z.literal(false) }).strict(),
  qualification: z.literal(qualification),
};
export const PRIVATE_JOB_HISTORY_QUALIFICATION = qualification;
export const privateJobHistoryPageSchema = z.object({ ...pageFields,
  rows: z.array(privateJobHistoryRowSchema).max(25), nextCursor: z.string().max(2000).nullable(),
  scanLimited: z.boolean(), scannedIntents: z.number().int().min(0).max(25),
}).strict().refine(v => v.rows.every(row => row.ownerWallet === v.wallet));
export type PrivateJobHistoryPage = z.infer<typeof privateJobHistoryPageSchema>;
export const privateJobHistoryExportSchema = z.object({ ...pageFields,
  rows: z.array(privateJobHistoryRowSchema).max(500), nextCursor: z.string().max(2000).nullable(),
  complete: z.boolean(), truncated: z.boolean(), pages: z.number().int().min(1).max(20),
  bounds: z.object({ maxPages: z.literal(20), maxRows: z.literal(500), maxBytes: z.literal(2 * 1024 * 1024) }).strict(),
}).strict().refine(v => v.rows.every(row => row.ownerWallet === v.wallet)
  && v.complete === !v.truncated && v.complete === (v.nextCursor === null));
export type PrivateJobHistoryExport = z.infer<typeof privateJobHistoryExportSchema>;

const unit = z.number().finite().min(0).max(1), index = z.number().int().min(0).max(127);
const item = { itemId: text(256).optional(), itemTitle: text(4096).optional(), contentVersion: text(256).optional() };
// Same owner-result allowlist as privateResultView, with explicit portable/count/text bounds.
// Unknown run fields (trace, receipt transports, ciphertext, telemetry, recovery packets) are stripped.
export const privateJobFinalizedRunSchema = z.object({
  id: privateJobPositionSchema.shape.id, question: text(8192), budget: unit,
  researchMode: z.enum(["quick", "deep"]), paymentMode: z.literal("real"),
  fundingOwner: z.literal("treasury"), origin: z.literal("a2a"), asker: wallet.optional(),
  answer: text(512 * 1024), engine: text(256), createdAt: privateJobDateSchema,
  subClaims: z.array(text(8192)).max(128),
  decisions: z.array(z.object({ sourceId: text(256), sourceName: text(512), ...item,
    action: z.enum(["BUY", "SKIP", "CACHE"]), rationale: text(8192), price: z.number().finite().nonnegative(),
    expectedValue: unit, confidence: unit, targets: z.array(index).max(128) })).max(256),
  citations: z.array(z.object({ marker: text(256), sourceId: text(256), sourceName: text(512), ...item,
    weight: unit, reward: unit, rationale: text(8192) })).max(256),
  evidence: z.array(z.object({ claimIndex: index, claim: text(8192), marker: text(256),
    sourceId: text(256), sourceName: text(512), ...item, quote: text(32768), support: unit,
    qualifiesForReward: z.boolean() })).max(512).optional(),
  claimCoverage: z.array(z.object({ claimIndex: index, claim: text(8192), coverage: unit,
    coveredBy: z.array(text(256)).max(256) })).max(128).optional(),
});
export type PrivateJobFinalizedRun = z.infer<typeof privateJobFinalizedRunSchema>;
export const privateJobHistoryDetailSchema = z.object({ ...pageFields,
  row: privateJobHistoryRowSchema,
  result: z.object({ answer: text(512 * 1024), engine: text(256), createdAt: privateJobDateSchema, savedAt: privateJobDateSchema,
    subClaims: privateJobFinalizedRunSchema.shape.subClaims,
    decisions: z.array(privateJobFinalizedRunSchema.shape.decisions.element.strict()).max(256),
    citations: z.array(privateJobFinalizedRunSchema.shape.citations.element.omit({ reward: true })
      .extend({ recordedRewardUsdc: unit }).strict()).max(256),
    evidence: z.array(privateJobFinalizedRunSchema.shape.evidence.unwrap().element.strict()).max(512).nullable(),
    claimCoverage: z.array(privateJobFinalizedRunSchema.shape.claimCoverage.unwrap().element.strict()).max(128).nullable(),
    paymentEvidence: z.literal("incoming-only-no-creator-ledger"),
  }).strict(),
}).strict().refine(v => v.wallet === v.row.ownerWallet && v.row.createdAt === v.result.createdAt && v.row.savedAt === v.result.savedAt);
export type PrivateJobHistoryDetail = z.infer<typeof privateJobHistoryDetailSchema>;
export const privateJobHistoryDetailInputSchema = z.object({ id: privateJobPositionSchema.shape.id }).strict();
export function parsePrivateJobHistoryInput(raw: unknown) {
  return privateJobHistoryInputSchema.parse(boundedPortableCopy(raw, PRIVATE_JOB_HISTORY_BOUNDS.requestBytes));
}
