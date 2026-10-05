# Independent frozen-corpus evidence assertions

Checked October 6, 2026 (Asia/Saigon; source lookup October 5 UTC). This is a
development evaluation improvement following the [eight-project OSS survey](oss-ai-adoption-2026-10-05.md).
It changes neither the production evidence gate nor creator-payment authority.

## Current OSS patterns and adoption choice

| Primary source | Refreshed repository identity | Pattern applied |
| --- | --- | --- |
| [Google ADK evaluation guide](https://adk.dev/evaluate/) | [`google/adk-python` at `8a43244db72815d593f5803e5c275f645b0500e3`](https://github.com/google/adk-python/tree/8a43244db72815d593f5803e5c275f645b0500e3), Apache-2.0 | Assess final response and tool trajectory separately. Existing Keryx decision/read/payment metrics are retained; final evidence needs its own assertions. |
| [Promptfoo assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | [`promptfoo/promptfoo` at `fa605a9119fdf5ee94b1e7da847e287e197e66d4`](https://github.com/promptfoo/promptfoo/tree/fa605a9119fdf5ee94b1e7da847e287e197e66d4), MIT | Keep deterministic assertions separate from model-assisted grades; a critical assertion can fail a case regardless of weighted score. |

These are checked commits, not release or quality certifications. No upstream code
or skills were copied, installed or executed. A native TypeScript audit fits the
existing frozen corpus, QueryRun and CI report. Adding an evaluation framework
would require another adapter, dependency lifecycle and migration while leaving
the same Keryx-specific provenance assertions to implement. A model judge cannot
replace literal membership, identity, simulation or budget assertions. Semantic
evaluation remains a separate gate with no new provider allowance in this work.

## Observed gap and bounded correction

Against main `16cac6578f1b9d10f35fe352f87a1ecb59905f0b`, four synthetic mutations
of an otherwise valid observation all passed the old grader:

- A quote absent from the frozen source body, with full reported coverage.
- A different source's genuine quote under the allowed source's citation marker.
- Coverage referring to a nonexistent evidence marker.
- Two coverage rows for the same claim, inflating the grounded rate above one.

The production ledger already validates literal quotes. The defect was that the
evaluation grader trusted retained coverage and reward flags without independently
checking them, so it could miss a regression in that production gate. This is an
eval false positive, not evidence that these corrupted observations reached users.

`lib/evals/frozen-grounding.ts` independently checks retained quote membership in
the frozen body, claim index/text identity, source/item identity, answer/citation
markers and bounded support. Text equivalence permits NFKC, case and whitespace
normalization; excerpts retain the 8-240 normalized-character contract and the
240-character raw upper bound. A present item ID must match. Legacy evidence with
no item ID can match one body belonging to that source, never concatenated items.
A citation's explicit item identity also constrains that lookup. These checks do
not independently certify a purchased content version.

Independent review also reproduced acceptance of an unread paid source with zero
payments: the quote was in the corpus, but the agent had not read it. Each eval
starts with fresh storage, so paid evidence now requires a fetch record belonging
to this run and that source/item. A citation payment, foreign query, another item
or unidentified source-only fetch cannot supply that proof. This is a simulated
read observation, never real settlement or an entitlement for a production caller.

Coverage must identify one claim once, use verified witnesses for that same claim,
and stay within their strongest reported support rounded to six decimal places.
Only distinct valid claim indexes count. Evidence yield counts independently
verified reward evidence among recorded fetch sources, keeping its ratio bounded.
Malformed provenance is a hard failure even when other metrics are perfect.
Diagnostic evidence not eligible for an answer contributes no grounding or yield.
The audit imports no production evidence validator: a defect there cannot also
silently alter these assertions.

Literal membership establishes provenance and report consistency. Support and
final assessment still come from the reasoning engine; this audit does not establish
semantic entailment, factual truth, completeness of all answer prose, live model
usefulness or actual settlement. Read metrics still use fetch records in the fresh
paid frozen corpus; they are not a complete free/cache/live tool-trajectory audit.

## Acceptance and surfaces

The four counterexamples fail before and pass after the correction. Adjacent checks
cover normalized/legacy quotes, same-source wrong items, contradictory citation
item identity, invalid numeric coverage, cross-claim markers, legitimate six-place
rounding and paid read provenance. The actual orchestrator's six-case offline report
retains 98.33/100, zero hard failures and corpus fingerprint
`dcfe855ccb18a7efcba1de6919539356d0dc75bf9603812d3dba50993bde6769`.
Neither corpus nor baseline is regenerated to absorb the change. TypeScript,
lint, current-head CI and independent review are required before merge.

| Supported surface | Applicability and release boundary |
| --- | --- |
| Development eval CLI and CI | `scripts/eval-agent.mts` calls the runner/grader; this is the affected execution path, including explicitly requested future model evaluations. Default acceptance remains deterministic/offline. |
| Web/SSE, hosted API, A2A and private research workers | No runtime imports of the eval modules; their evidence/payment contracts stay authoritative. |
| Direct ask/buyer/demo CLI, remote and stdio MCP | No new runtime imports or protocol/package changes. |
| Desktop/Operator, browser extension, Telegram, Discord and Slack | No new runtime imports or adapter/installer changes. |
| Repository Agent Skills | The existing OSS adoption workflow supplies the research/validation method; no runtime skill loader or scheduler. |

Consumer search identifies the eval CLI and eval tests only. This development-only
change needs a Git/CI release and no app identity bump, production deployment,
client republishing or Canteen product post. The separate active production release
owner retains rollout ownership for the earlier runtime changes, including PR177.
Any later deployment must refresh its exact combined-main operations binding;
this eval record is not deployed-commit or published-package evidence. Reverting
the helper and grader call restores the old evaluation behavior without changing
stored queries, payment records, runtime configuration or custody.
