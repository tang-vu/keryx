export const completedEvidenceDraftSelectionCopy = {
  label: "Select an owned completed result",
  guidance: "Enter an existing private job ID. Read its saved metadata, then explicitly import its retained excerpts. No new research or purchase is started.",
  privacy: "Saved metadata and imported excerpts stay in this tab. They are not saved to the literature workspace or uploaded elsewhere.",
  jobId: "Existing private job ID",
  read: "Read saved metadata",
  reading: "Reading saved metadata…",
  ready: "Saved metadata checked. Import is now available for this exact saved result and current Include papers.",
  signIn: "Sign in to read an owned completed result. Your draft edits are preserved.",
  changed: "The owner, selection, or Include papers changed. Read saved metadata again. Your draft edits are preserved.",
  invalid: "Enter a complete existing private job ID and mark at least one paper Include.",
  unavailable: "This completed result or its exact saved URL and version identities are unavailable. Your draft edits are preserved.",
  storage: "The current backend cannot provide this retained completed result. Your draft edits are preserved; retry is an explicit action.",
  timedOut: "The saved metadata read timed out. Your draft edits are preserved; retry is an explicit action.",
  imported: "Completed report and reading observations imported; draft edits are preserved.",
} as const;

export const completedEvidenceDraftImportCopy = {
  "empty": "This completed result has no usable exact retained excerpts. Reading observations imported; unavailable and unknown remain separate. Existing draft edits are preserved.",
  "imported": "Retained report appended. Existing draft edits are preserved. Semantic support is unjudged; downloaded or edited reports have caller-supplied origin.",
  "unavailable": "Completed private result unavailable or changed. Your draft is preserved.",
  "timedOut": "Private read timed out. Your draft is preserved; retry is an explicit action.",
  "label": "Import an owned completed private result",
  "guidance": "Import retained excerpts from the selected completed private result. This action reads your saved result and starts no new research or purchase.",
  "privacy": "The result stays in this tab. Exact saved-ledger provenance is separate from semantic support and creator payment authority. An editable or downloaded report cannot authenticate itself when reimported.",
  "reading": "Reading saved result…",
  "import": "Import selected completed result"
} as const;
