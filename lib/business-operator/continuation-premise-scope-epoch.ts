import { z } from "zod";
import { continuationFailedQualityEpochAuthorizationFields } from "./continuation-failed-quality-epoch";

/** Source repair consumes only the unused portion of the original six-call
 * receipt. It cannot renew that receipt, its clock, or any predecessor hold. */
export const CONTINUATION_PREMISE_SCOPE_LIMITS = Object.freeze({ historicalReservedMicroUsd: 408_540,
  maximumNewModelCalls: 4, maximumCombinedMicroUsd: 491_180, reserveMicroUsd: 20_660 });
export const continuationPremiseScopeEpochAuthorizationFields = {
  ...continuationFailedQualityEpochAuthorizationFields,
  format: z.literal("keryx-original-continuation-authorization-v6"),
  historicalReservedMicroUsd: z.literal(408_540), maximumNewModelCalls: z.literal(4),
  contextProtocol: z.literal("full-same-evidence-premise-scope-repair-v1"),
};
