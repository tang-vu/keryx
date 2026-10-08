import { z } from "zod";
import { fulfillmentSha256 } from "../a2a/fulfillment-authority";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.string().min(1);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

/** A new finite repair episode never replenishes the exhausted predecessor. */
export const CONTINUATION_FAILED_QUALITY_LIMITS = Object.freeze({ historicalReservedMicroUsd: 367_220,
  maximumNewModelCalls: 6, maximumCombinedMicroUsd: 491_180, reserveMicroUsd: 20_660, maximumDurationMs: 86_400_000 });
export const continuationFailedQualityEpochAuthorizationFields = {
  format: z.literal("keryx-original-continuation-authorization-v5"),
  historicalReservedMicroUsd: z.literal(367_220), maximumNewModelCalls: z.literal(6),
  maximumCombinedMicroUsd: z.literal(491_180), ownerMaximumCombinedMicroUsd: z.literal(491_180),
  ownerAuthorizationFile: file,
  parentAuthorizationFile: file, parentAuthorizationSha256: digest,
  parentProviderLedgerSha256: digest, parentLedgerHeadSha256: digest,
  parentAnchorIntentSha256: digest, parentAnchorActiveSha256: digest, parentAnchorFrontierSha256: digest,
  parentCarriedSufficiencySha256: digest,
  parentGenerationHoldSha256: digest, parentGenerationCheckpointSha256: digest, parentGenerationOutcomeSha256: digest,
  parentReviewHoldSha256: digest, parentReviewCheckpointSha256: digest, parentReviewOutcomeSha256: digest,
  parentAttemptOutcomeSha256: digest, parentQualityDiagnosticSha256: digest,
  parentFailureClosureFile: file, parentFailureClosureSha256: digest,
  supplementaryInputFile: file, supplementaryInputSha256: digest, contextSha256: digest,
  contextProtocol: z.literal("full-same-evidence-required-quality-recovery-v1"),
};

/** The private record contains the exact owner instruction; repository fixtures
 * use synthetic text. recordedAt is receipt creation time, never a guessed chat
 * timestamp. These finite limits are explicitly attributed to the agent. */
export const continuationOwnerRepairReceiptSchema = z.object({
  format: z.literal("keryx-original-continuation-owner-repair-receipt-v1"),
  provenance: z.literal("retained-current-session-owner-instruction"),
  instruction: z.string().min(1).max(8_000).refine(value => value === value.trim()), instructionSha256: digest,
  instructionTimestamp: z.literal("not-recorded"), recordedAt: timestamp,
  authorizationScope: z.literal("repair-same-paid-original-until-delivered"),
  limitsChosenBy: z.literal("agent-within-explicit-owner-repair-authority"),
  originalAuthorizationSha256: digest, nativeClaimSha256: digest, packetSha256: digest,
  inputSemanticSha256: digest, contextSha256: digest, parentAuthorizationSha256: digest,
  historicalReservedMicroUsd: z.literal(367_220), maximumNewModelCalls: z.literal(6),
  maximumCombinedMicroUsd: z.literal(491_180), reserveMicroUsd: z.literal(20_660),
  maximumDurationMs: z.literal(86_400_000), expiresAt: timestamp,
  searches: z.literal("forbidden"), creatorPayments: z.literal("forbidden"), newInboundPayment: z.literal("forbidden"),
}).strict().refine(value => fulfillmentSha256(value.instruction) === value.instructionSha256 &&
  Date.parse(value.expiresAt) > Date.parse(value.recordedAt) &&
  Date.parse(value.expiresAt) - Date.parse(value.recordedAt) <= value.maximumDurationMs,
"Repair receipt instruction digest or finite window changed");
export type ContinuationOwnerRepairReceipt = z.infer<typeof continuationOwnerRepairReceiptSchema>;
