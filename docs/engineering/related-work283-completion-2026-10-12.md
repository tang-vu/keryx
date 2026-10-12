# Related-work draft controls for issue 283

This candidate extends the existing saved-review draft workflow on base
`ec5f39c9750dfc9e80e66edd41348ca6034c01c3`. Full issue acceptance remains open.
It uses the existing version-1 draft and citation/export contracts, without adding
a model, search, payment, storage or execution framework.

## Observable behavior

- **Assemble retained contributions** appends literal quotations for Include
  records not already organised in a theme. Original research targets supply
  topic labels. Bibliographic titles, screening notes and matching words cannot
  supply findings, agreement, disagreement or gaps. One retained excerpt per
  newly organised exact record seeds an editable contribution; the user can
  select additional excerpts and use the existing statement roles for comparisons.
- **Regenerate this theme from selected excerpts** replaces only that theme's
  sentences. Its title, synthesis notes, selected excerpts, every other theme's
  statements/edits, original passage and claim assessments remain intact. It
  requires 1–24 selected valid excerpts. Unknown themes, changed versions,
  oversize packets or exhausted theme capacity refuse without changing the editor.
- Every generated contribution quotes retained text and cites its exact paper,
  with a link to the version-bound retained excerpt. Existing contribution,
  agreement, disagreement and gap statements keep their structural excerpt gates.
  These gates do not authenticate caller-imported reports or establish semantic
  support for edited wording. Author notes and uncited author gaps stay unverified.
- Optional `readingStatuses` records explicit caller observations for exact
  Include URLs lacking usable retained excerpts: `unread` or `unavailable`, plus
  an optional reason represented by an empty string when omitted in the editor.
  Duplicate, foreign/excluded and retained-evidence-conflicting observations refuse.
  Unknown reading status remains a third retention-gap list. No missing quote is
  converted into a claim that the publisher is down or the paper was never read.
- Markdown and LaTeX list observed unread and unavailable records separately.
  Neither list creates a characterization, citation, BibTeX entry or RIS record.
  Stable citation keys and the existing four-format correspondence check are reused.
- **Prepare reading request in a new tab** opens the existing editable Deep
  research form with one exact Include URL and the saved review question. It
  omits screening notes and metadata claims, preserves the existing question
  limit and carries no automatic-run selector. The user reviews the question
  and budget before submitting. That run retains ordinary budget, BUY/SKIP/CACHE,
  reading, payment and creator-reward authority. This task performed no such run.
- The drafting-aid notice and tab-memory privacy boundary remain visible.

## Shared inputs and surfaces

The existing authenticated API and remote/stdio `evidence_draft` tools accept
optional `assembly: {mode: "append"}` or
`assembly: {mode: "regenerate", themeId: "…"}`. These operations are pure and
bounded by the existing 64 KiB packet, 16-theme and per-theme limits. For an
assembly response, `draft.editableRequest` returns validated editable inputs with
the operation removed. Clients can edit and resubmit those inputs without
re-running assembly over the edits. Authentication still precedes private body
reading; fixed failures and private/no-store responses remain unchanged.

The browser invokes the same helper locally, then keeps editable inputs in tab
memory. The legacy v1 `draft.unread` field remains the combined no-excerpt list for
compatibility; `draft.reading.unread`, `.unavailable` and `.unknown` are the honest
original-status distinctions. Imported reports and access observations remain
caller assertions; they supply neither authenticated read provenance nor settlement
authority. Reason/title/quote text is escaped in exports and cannot insert citation
keys, markup or LaTeX commands.

| Surface | Candidate behavior and remaining delivery gate |
| --- | --- |
| Web/API | Local editor controls and additive shared packet fields; built routing/responsive browser acceptance remains required. |
| CLI/stdio MCP | Existing offline local `evidence_draft` handler shares assembly and exports; no new CLI runner, fetch or signer. Packaged consumer/provenance acceptance remains required. |
| Remote MCP | Existing stateless authenticated hosting and pure tool handler; exact-source hosted acceptance/distribution remains required. |
| Desktop | Existing hosted literature workflow; no native bridge or signer changes. Root owns supported-surface delivery. |
| Extension | Existing deliberate hosted workspace handoff; no private-draft ingestion or automatic submission. |
| Bots/OpenAI/A2A | Existing research/report-link roles; no draft ingestion, new paid job or delivery claim. |

## Evidence, dependencies and acceptance

Issue 282 retains draft-claim verification and its private read integration.
Issue 285 retains reference-manager adapters. Shared paper exporters and parity
formatters are reused unchanged. Engine/run-agent, language, privacy and
profiles/history paths were not edited. The coordination board requests the root's
narrow integration of an existing private completed-read snapshot with exact
source/item/URL/version/excerpts and exact-record failures, retaining normal
budgets, visible decisions, rewards and private retention. That request is not
approval to edit another owner's path.

Focused regression tests exercise Include filtering, literal extraction, exact
version refusal, regeneration/edit preservation, capacity, four-format stable-key
correspondence, API/MCP results, fixed private errors and disposition failures.
Browser regressions cover in-place edits, targeted regeneration, separate status
lists, deliberate read links and no automatic requests. The existing built Next
harness now closes its isolated server gracefully without process-kill commands;
its run remains pending a successful build. An isolated real-component browser
probe passed assembly, regeneration, other-edit/passage preservation, status lists,
all four downloads plus editable JSON, deliberate read links and memory resets,
with zero backend or external calls. This probe excludes Next routing, providers
and layout. All these checks use synthetic fixtures for behavior testing; they
establish no expert measurement or researcher usefulness.

No actual expert-written reference sections or reviewer judgments have been
supplied. The existing offline scorer is not a source of expert approval. Do not
report coverage or an unsupported-statement rate as expert evidence from this
candidate's fictional fixtures. Actual reference-section artifacts, origin and
named judgments remain required before the fixed-review criterion can be accepted.
Model-assisted comparison prose and integrated original reading remain open until
the root accepts the existing-engine partition and its source/runtime evidence.

Retained evidence and exact command results live in `.artifacts/issue283/` and the
root handoff, outside Git. The donor installation was reserved read-only after all
1,710 installed package versions/integrities and root dependencies matched the own
lock graph; cache, configLoader runner, scratch and compiler outputs are isolated.
The initial full application TypeScript check at 2 GiB exhausted its heap. After
the previous host-slot owner released it, both full application/operations graphs
passed with a 6 GiB ceiling; focused TypeScript, scoped lint and 68 focused tests
also passed. The isolated Next Webpack compile failed in the unchanged wallet
dependency graph because `@coinbase/cdp-sdk` imports the unavailable optional peer
`@x402/svm/exact/client`. No wallet/dependency path was altered. The default hosted
build and built Next routing/responsive browser checks remain open; a component
probe cannot replace them. Independent root review, actual required PR aggregate/
domain CI and combined-source delivery remain separate gates. Frozen ec5/app
0.27.63 delivery precedes this next-batch candidate.
The root alone owns PR publication, merge, version, deployment and issue closure.
No source-only mock closes issue 283 or authorizes a deploy.
