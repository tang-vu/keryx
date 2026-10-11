/** English catalogue for the bounded ordinary READ checkpoint report. */
export const actualReadCopy = {
  title: "Read checkpoints",
  boundary: "Verify checks the recorded post-portfolio admission predicates offline. Source facts are assertions; source authenticity and payment anchoring are unproven.",
  modelBoundary: "Model proposals and selected plan actions are recorded when available. Model generation is not replayed or expected to reproduce; verification checks only deterministic checkpoints.",
  policy: "Recorded checkpoint policy",
  digest: "SHA-256 retained by this report",
  digestHelp: "Keep this digest separately from the downloaded sidecar. The offline audit command uses it as the expected digest.",
  unavailable: "Read checkpoint evidence is unavailable for this report. Historical, private and unsupported native runs are not reconstructed.",
  amounts: "Micro-USDC is shown only where the existing exact converter accepts the amount. Other monetary assertions are unavailable; numeric predicate replay preserves the recorded comparison.",
  download: "Download checkpoint sidecar",
  choose: "Choose a checkpoint sidecar to verify against this report",
  verify: "Verify offline",
  busy: "Checking locally…",
  passed: "Verified: the sidecar matches this report’s separately retained digest and its deterministic checkpoints. This does not prove a read or payment.",
  refused: "Verification refused. The sidecar is unavailable, unsupported, oversized, changed or inconsistent with this report.",
} as const;
