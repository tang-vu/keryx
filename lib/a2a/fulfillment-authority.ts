/** Pure native authority tuples, independent of supplier and evidence readers. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { MAX_RESEARCH_TARGETS } from "../llm/research-target-limits";
import { matchesA2aOriginalBinding, a2aOriginalClaimSchema } from "./original-claim";
import type { A2aOrder } from "./order";
import type { QueryRun } from "../types";
import { ORIGINAL_FULFILLMENT_LIMITS } from "./fulfillment-limits";
import { fulfillmentSupplierWindowSchema, fulfillmentTimestampSchema, matchesFulfillmentSupplierWindow } from "./fulfillment-window";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
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

/** This native tuple grants no supplier authority by itself. The private controller must
 * also prove its protected source-bound authorization and opaque execution capability. */
const fulfillmentAuthorityV1Schema = z.object({
  format: z.literal("keryx-a2a-failed-original-fulfillment-authority-v1"),
  original: a2aOriginalClaimSchema,
  question: z.string().min(1).max(10000),
  input: fulfillmentInputSchema,
  authorizationSha256: digest, policySha256: digest, failedClosureSha256: digest,
  originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  expiresAt: z.literal(ORIGINAL_FULFILLMENT_LIMITS.expiresAt),
}).strict();
const fulfillmentAuthorityV2Schema = fulfillmentAuthorityV1Schema.extend({
  format: z.literal("keryx-a2a-failed-original-fulfillment-authority-v2"),
  expiresAt: fulfillmentTimestampSchema,
  supplierWindow: fulfillmentSupplierWindowSchema,
});
export const fulfillmentAuthoritySchema = z.discriminatedUnion("format", [fulfillmentAuthorityV1Schema, fulfillmentAuthorityV2Schema])
  .refine(value => fulfillmentSha256(value.question) === value.input.questionSha256, "Original question changed")
  .refine(value => value.format === "keryx-a2a-failed-original-fulfillment-authority-v1" ||
    matchesFulfillmentSupplierWindow(value), "Supplier window expiry changed");
export type FulfillmentAuthority = z.infer<typeof fulfillmentAuthoritySchema>;
export const fulfillmentClaimInputSchema = z.object({
  authority: fulfillmentAuthoritySchema, claimId: digest, claimedAt: timestamp,
}).strict().refine(value => value.authority.format === "keryx-a2a-failed-original-fulfillment-authority-v1" ||
  Date.parse(value.claimedAt) >= Date.parse(value.authority.supplierWindow.approvalReceivedAt) &&
  Date.parse(value.claimedAt) < Date.parse(value.authority.expiresAt), "Claim outside explicit supplier window");
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

