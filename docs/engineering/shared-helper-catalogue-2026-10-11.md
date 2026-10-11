# Fixed English helper catalogue — 2026-10-11

This narrow original #272 candidate extracts 66 English messages from the report
Markdown generator, evidence matrix, paper-workspace validation/storage helpers,
library labels, publisher-control labels and recorded serving-tier summaries into
`locales/en/shared-helpers.ts`. It resumes the preserved helper candidate based on
`fd33305e13c6e75b3f352604ef4a2e3974dbfce4`; root folds its checkpoint into the existing
combined PR. There is no separate helper release or locale activation.

Reuse the existing `registrationStatus`, `sourceLibrary`, `sourceRegistry` and
`evidenceMatrix.notRecorded` keys. Helpers use the existing message engine and
relative imports. Whole report/serving messages have named parameters; the
serving-engine remainder supplies one/other arms with identical current English.
Fixed exported evidence statuses, screening labels, library keys and phase keys
retain their literal types and existing values. CSV headers, machine enum values,
storage keys, schema, matching, control/receipt authority, escaping, newlines,
filenames, generated editable research drafts and financial classification remain
unchanged. The existing English/Vietnamese output-limit selector and all guidance
in `lib/llm/output-limit-diagnostic.ts` remain unchanged.

No helper path has an allowance in the current JSX copy-guard baseline, so this
candidate retires zero allowances and does not alter that baseline. Public
publisher metadata in `lib/public-references/explore-catalog.ts` remains data.

The pending creator candidate `d52e879f52e1bfe0b42d44257c659bcbf8ca520c` already
provides six identical preview messages. This helper checkpoint leaves
`lib/sources/preview-depth.ts` byte-for-byte at its base and removes the six
uncommitted duplicate `sourcePreviewDepth` messages. After root accepts the creator
candidate, the existing `PREVIEW_DEPTH_LABELS` export can use these same keys:

| Level | Label key | Hint key |
| --- | --- | --- |
| `full` | `creatorPreview.fullLabel` | `creatorPreview.fullHint` |
| `excerpt` | `creatorPreview.excerptLabel` | `creatorPreview.excerptHint` |
| `locked` | `creatorPreview.lockedLabel` | `creatorPreview.lockedHint` |

Preserve source-owned preview enums/truncation and the creator presentation
projection `lib/i18n/creator-preview.ts`; do not add another set of messages.
Independent creator review and root's exact combined-source reconciliation remain
gates. This checkpoint does not change creator-owned files.

Root subsequently integrated the independently accepted creator and helper
checkpoints. The compatibility `PREVIEW_DEPTH_LABELS` export now reads those six
existing keys directly from the dependency-free English creator catalogue.
Preview enums, normalization, truncation and the creator presentation projection
remain unchanged; no runtime message-engine or browser/server dependency is added
to the source helper. This is part of the combined candidate, with final checks
and delivery still pending. The earlier helper-only checkpoint and study source
hashes remain historical evidence for their original inputs.

Local acceptance on Node 24.21.0 and npm 11.19.0 uses the existing junction at
`.shared/dependencies-main09-20261010/node_modules`. The nine inspected dependency
versions match this worktree's lockfile. No install or junction change occurred.
The worktree and installed package-lock hashes are recorded separately, rather
than claiming they are the same lockfile or the requested QA junction.

- Ten existing focused test files pass all 95 tests; full `tsc --noEmit
  --incremental false`, scoped ESLint and `git diff --check` pass.
- A retained harness records 111 exact before/after comparisons and one catalogue
  validation result against the expected empty missing/invalid lists, with identical
  dependencies: Markdown/bibliography, CSV/status/header/escaping, screening,
  validation/comparison errors, names, publisher authority labels, serving variants,
  and unchanged English/Vietnamese limits. Hostile braces, markup, multiline text,
  formula prefixes and conflicting/pending/simulated settlement records are data.
- Browser storage uses synthetic storage/Web Locks and a snapshot-hook adapter
  for exact refusal, recovery, save, readback and clear bytes. This is not a fresh
  real-browser or production-build claim. Existing report/source-area browser
  evidence qualifies unchanged consumers; changed combined inputs require root
  acceptance. One retained harness setup attempt failed on an esbuild filter flag;
  removing that unsupported flag produced the passing comparison.

The web consumes these shared helpers. Remote/stdio MCP use the serving summaries;
the direct CLI uses the unchanged output-limit guide. The shared API result
projection still exposes the same recorded structure. Buyer MCP has a type-only
reference. Native desktop, extensions and bots have no direct runtime imports of
these helper paths; root still owns final distribution/input-graph qualification.

Scoped local evidence is retained under `output/helper-catalogue272-20261011/` and
is excluded from the source checkpoint. Independent source review, creator-preview
reconciliation, exact combined-source production/CI and applicable platform gates,
versions, deployment/health readback, original issue closure and archive/cleanup
remain root-owned. Original #272 is not closed by this candidate.

The final root reconciliation also reuses seven existing Wanted catalogue entries
in `wantedOfferStatus` and adds five English authorization labels to the helper
catalogue. These shared exports import only immutable English leaf data; they do
not introduce a React boundary or select a locale. Attempt formatting, six-decimal
reward formatting and the reserved/exposed/signed/submitted/pending distinctions
remain byte-compatible. Settlement, authorization, payee and retry decisions are
unchanged. The final combined study provenance, package graphs and release gates
must account for these additional source inputs.
