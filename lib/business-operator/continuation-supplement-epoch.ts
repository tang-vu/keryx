import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.string().min(1);
/** A fixed transfer of the five unused epoch-2 holds, never another six-call grant. */
export const continuationSupplementEpochAuthorizationFields = {
  format: z.literal("keryx-original-continuation-authorization-v3"),
  historicalReservedMicroUsd: z.literal(263_920), maximumNewModelCalls: z.literal(5),
  maximumCombinedMicroUsd: z.literal(367_220), ownerMaximumCombinedMicroUsd: z.literal(400_000),
  parentAuthorizationFile: file, parentAuthorizationSha256: digest,
  parentProviderLedgerSha256: digest, parentLedgerHeadSha256: digest,
  parentAnchorIntentSha256: digest, parentAnchorActiveSha256: digest, parentAnchorFrontierSha256: digest,
  parentSufficiencyHoldSha256: digest, parentSufficiencyCheckpointSha256: digest, parentSufficiencyResultSha256: digest,
  parentSufficiencyDiagnosticSha256: digest, parentAttemptOutcomeSha256: digest,
  supplementaryInputFile: file, supplementaryInputSha256: digest, contextSha256: digest,
  contextProtocol: z.literal("full-selected-bodies-required-sufficiency-with-free-primary-supplement-v1"),
};
