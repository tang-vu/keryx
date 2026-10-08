import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.string().min(1);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
/** Only the two unused repair holds transfer. The rejected prepared parent stays immutable. */
export const continuationPreparedEpochAuthorizationFields = {
  format: z.literal("keryx-original-continuation-authorization-v4"),
  historicalReservedMicroUsd: z.literal(325_900), maximumNewModelCalls: z.literal(2),
  maximumCombinedMicroUsd: z.literal(367_220), ownerMaximumCombinedMicroUsd: z.literal(400_000),
  parentAuthorizationFile: file, parentAuthorizationSha256: digest,
  parentProviderLedgerSha256: digest, parentLedgerHeadSha256: digest,
  parentAnchorIntentSha256: digest, parentAnchorActiveSha256: digest, parentAnchorFrontierSha256: digest,
  parentPreparedResultSha256: digest, parentRunSha256: digest,
  parentSufficiencyHoldSha256: digest, parentSufficiencyCheckpointSha256: digest,
  parentSufficiencyResultSha256: digest, parentSufficiencyPromptSha256: digest,
  supplementaryInputFile: file, supplementaryInputSha256: digest, contextSha256: digest,
  rootQualityRejectionFile: file, rootQualityRejectionSha256: digest,
  independentQualityRejectionFile: file, independentQualityRejectionSha256: digest,
  contextProtocol: z.literal("full-same-evidence-required-quality-refresh-v1"),
};
export const continuationPreparedRejectionSchema = z.object({
  format: z.literal("keryx-original-prepared-quality-rejection-v1"),
  role: z.enum(["root", "independent"]), verdict: z.literal("rejected"), rejectedAt: timestamp,
  executorCommit: z.string().regex(/^[a-f0-9]{40}$/), preparedResultSha256: digest, runSha256: digest,
  providerLedgerSha256: digest, contextSha256: digest, supplementaryInputSha256: digest,
  nativeClaimSha256: digest, packetSha256: digest, inputSemanticSha256: digest,
  requiredSupportedTargetIndexes: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  failureCategories: z.array(z.enum(["omitted-required-detail", "unsupported-assertion", "incorrect-scope", "incomplete-acceptance-checks"])).min(1).max(4)
    .refine(values => new Set(values).size === values.length),
  reviewSummary: z.string().trim().min(1).max(8_000),
}).strict();
