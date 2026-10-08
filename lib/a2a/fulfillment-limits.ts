/** Immutable limits shared by fulfillment protocol and private authority readers.
 * Keep this dependency-free so their circular native-validation imports do not
 * access partially initialized protocol exports. */
export const ORIGINAL_FULFILLMENT_LIMITS = Object.freeze({
  expiresAt: "2026-10-07T00:00:00.000Z", maximumNewModelCalls: 10,
  modelReserveMicroUsd: 20660, originalReservedMicroUsd: 36660,
  maximumCombinedMicroUsd: 243260, maximumInputBytes: 32000, maximumOutputTokens: 8192,
  attentionLimit: 2,
} as const);
