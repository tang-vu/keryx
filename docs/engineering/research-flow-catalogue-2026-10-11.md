# Research flow English catalogue migration

Issue [272](https://github.com/tang-vu/keryx/issues/272) remains open. This area
moves conversation, decision-log, creator-payment presentation, compact embed,
paid-job lookup and local/account recovery copy into 286 typed English keys in
`locales/en/research-flow.ts`, registered by `lib/i18n/messages.ts`.

The 22 owned presentation files include the non-JSX `phase-style.ts` helper,
SVG payment stamp, settlement reference titles, source-selection diagnostics,
follow-up form and onboarding tour. Accessibility names, placeholders, metadata,
fallback errors, status notices and clipboard feedback are included. The existing
research composer, session-grant and decision-review catalogues keep their roles.
Funding/checkout, evidence browsing, requests, report/export and creator-source
surfaces still have separate remaining work.

English remains the selected interface. Questions, answers, quotes, source names,
wallets, references, API/protocol examples and machine status records remain data.
Named interpolation uses the same amount/date formatters and escaped React nodes
for the embed source emphasis and retry link. Diagnostic statistics are parallel
count labels, with independent plural arms; no sentence is assembled from prose
fragments. Original counters such as `1 steps` and `1 candidates` retain their
original English wording in both arms. Future grammar can differ without revising
the shipped English in this extraction.

Payment, polling, authentication, storage, export bytes, budget arithmetic,
callbacks, state conditions, links and CSS classes keep their existing contracts.
Pending, simulated, unverified and failed states retain their distinct notices;
receipt integrity and seller-reported settlement remain separate claims. Moving
financial/privacy prose verbatim supplies no human glossary, consent or translation
approval. Locale flags, routing, dependencies and versions are unchanged.

Only 235 actually migrated guard allowances are retired. Baseline provenance,
parser behavior and all other area allowances are preserved. Six scoped retained
findings are data: the Keryx mark, the commented executable API request sample,
its origin, the MCP command, the API-reference path and the `a2a_…` ID example.
The area regression explicitly verifies these exceptions and zero other detected
copy, including labels in `phase-style.ts` outside the normal JSX inventory.

Local qualification has 113 exact before/after static HTML states, including
payment qualifications, diagnostic outcomes, phases/actions, research turns and
job-detail branches. The same generated reference CSS is reused because this
migration changes no classes or layout. Styled 320px/1366px renders have no
horizontal overflow; their screenshots were inspected. Ten additional Chromium
action/accessibility cases cover follow-up keyboard navigation, all tour steps
and focus return, invalid/failed/cleared job lookup, explicit decision retry,
embed source emphasis and its rate-limit link. Existing hermetic source-selection
download, expired/paused payer and reading/evidence/log-following checks pass.
Focused catalogue/escaping tests and the copy-guard regressions pass. The fixture
setup failures (browser cache selection, signed-out auth boundary, invalid test
job ID and a closed details panel) are retained separately from successful checks;
they did not require product behavior changes.

## Remaining inventory and delivery

After this scoped retirement, the baseline has 2,210 allowances in 136 files;
the source guard detects 2,207 current occurrences. These syntactic allowances
include data and older stale entries, so they are neither a count of actual
English messages nor evidence that remaining helper copy has been audited.
The narrow baseline partition is:

| Remaining inventory | Allowances | Files |
| --- | ---: | ---: |
| Sources, creators, registration, withdrawals | 1,036 | 53 |
| Funding, checkout, research package | 270 | 10 |
| Reports, receipts, exports, paper workspace | 478 | 35 |
| Research request and evidence browser | 49 | 2 |
| Landing, navigation, integrations and retained earlier data | 252 | 32 |
| Migrated research protocol data described above | 6 | 3 |
| Desktop renderer, outside this worker's file ownership | 119 | 1 |

These counts are a work queue, not issue closure. Remaining non-JSX helpers need
context review as their areas migrate. Web and the desktop hosted web view inherit
this catalogue after root's coordinated release. CLI, API, remote/stdio MCP,
extension and bots retain their current protocol/data roles; this presentation
change grants no new language, research or payment authority. Native desktop copy
is still a separately owned gate. Main aggregate and applicable hosted checks,
independent source review, exact merged/deployed identities and the combined
runtime release remain required. Root serializes merges/deployment and owns the
version/distribution decisions and finished-worktree cleanup; this worker does
not merge during the release freeze or perform production lifecycle operations.
