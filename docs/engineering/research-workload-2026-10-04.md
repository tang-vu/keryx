# Internal workload execution, October 4, 2026

All 24 task IDs were exercised. This is not 24 accepted customer workflows:
R01-R18 used live reasoning over retained original-document/fictional inputs;
R19-R24 used isolated synthetic registration, payment, recovery and adapter scenarios.
The strongest observed product gap is that qualified excerpts often do not deliver
the requested decision, comparison, checklist or recovery guidance.

## Scope and retained evidence

The runtime baseline is origin/main `3c81ee981d9b06c315f0602fb874bd16cfc0ca88`.
The source-reading and research algorithm were not changed to improve scores.
Inputs are internally authored, not customer requests. The input author performed
the editorial usefulness review; it is not independent participant acceptance.
Raw source snapshots, run JSON, receipts, Markdown, CSV, BibTeX, RIS, capture
manifests and failed-attempt summaries remain in ignored local release evidence.
No private source text, provider credentials or operational custody belongs here.

The owner approved one batch with at most USD 1 of model API allowance and zero
mainnet source USDC. The fixed official DeepSeek Flash endpoint served 93 attempted
calls including three diagnostic reruns. Conservative nonrefunded reservations
totaled USD 0.487281 against the rechecked Flash peak tariff (USD 0.30/M input,
USD 1.20/M output). This reserve is **not an observed invoice charge**. The official
[pricing page](https://api-docs.deepseek.com/quick_start/pricing/) was checked on
the execution date; the dated runner refuses later dates until reviewed again.
No Tavily request, external marketplace, wallet, signature or real payment ran.

The first live attempt completed 15/18 pipelines; R04, R14 and R16 failed without
a detailed retained diagnostic. One subsequent attempt for each completed, within
the same retained allowance. Preserve that first-attempt failure rate: rerunning
does not establish that the defect was diagnosed or repaired. The earlier heuristic
baseline completed 16/18; R01 and R18 failed. Neither baseline is 18 passes.

The final retained completed run for each task has zero payment attempts/rows and
valid receipt integrity. Runs use the real production orchestration and reader,
but discovery is an injected supplied-candidate list and reads replay captured
bytes. Trace “web search” counts are calls to that injected provider, **not live
search queries**. Export “offline” mode describes payment, not whether a model was
used. Capture manifests carry the original observation time and read failure.

## Original-document reading

The 34 source occurrences contain 22 distinct public original URLs, ten fictional
fixture inputs and one repository excerpt; NASA appears in two tasks. The actual
bounded reader succeeded for 13/22 distinct public URLs and failed for nine:

| Failure | Observed pages |
| --- | --- |
| Article byte limit (3) | Stripe webhooks, pgvector repository page, Vercel middleware-bypass postmortem |
| HTML extraction unavailable (4) | Auth0 3.5.0 release, Chrome tabs API, arXiv 2607.13716v1, Supabase pricing |
| Transport unavailable (2) | NASA GPM water cycle, Neon pricing |

No successful public capture reported truncation. That is not proof of complete
paper coverage, correct semantic interpretation or current price applicability.
R09 retained one exact v1 paper; the other requested paper failed extraction.
The fictional text PDF was parsed by the actual isolated PDF worker; the image-only
PDF was rejected. Its hidden visual content was not supplied as evidence.

## Research usefulness review

“Partial” means usable fragments, not acceptance of the requested finished artifact.
R10 is narrowly usable for a fictional abstract-only task; this establishes no
external research demand. D-300 remains in force; no arbitrary prose was relabeled
as verified synthesis to make this table look better.

| Task | Observed result | Missing acceptance |
| --- | --- | --- |
| R01 | Partial WAL/backup excerpts | Conditional choice, restore checklist, power-loss/version analysis |
| R02 | No evidence: Stripe read failed | Webhook state/failure table |
| R03 | Partial SQS visibility excerpts | PostgreSQL comparison, recovery design; selected visibility wording lacks duplicate-delivery caveat |
| R04 | First attempt failed; rerun completed with no citations | Exact-version migration note and tests |
| R05 | Partial GitHub limit/backoff excerpts | Shared/per-caller quota, deadline and side-effect policy |
| R06 | No evidence: pgvector read failed | Recall/latency comparison and measurement plan |
| R07 | Advisory-specific patch excerpt | Affectedness matrix and application verification checklist |
| R08 | contextMenus permission excerpt | Complete feature/permission map; tabs unavailable, activeTab not read |
| R09 | One paper, introductory excerpts | Exact two-paper mechanism comparison; issue #128 remains open |
| R10 | Narrowly usable fictional abstract note | Real-paper/user acceptance not tested |
| R11 | Both conflicting periods/revisions retained | Explicit authority-clarification action |
| R12 | Aster-to-Beacon duplication visible | Cedar was not read; complete origin map unfinished |
| R13 | Text PDF excerpt; scanned PDF remains unread | Report-level failure explanation and targeted recovery |
| R14 | Partial after rerun: revision-specific 100/50 record limits and v2 truncation retained | Implications/recovery guidance absent; actual persisted historical answer preservation not exercised |
| R15 | No evidence: NASA read failed | Three science-supported ideas and production outline |
| R16 | First attempt failed; rerun had no evidence | Claim table and supported corrections |
| R17 | Streaming/terminal-field excerpts | Prioritized excerpt-specific integration-gap checklist |
| R18 | Both pricing reads failed | Observed commercial terms and procurement comparison |

## Synthetic commerce and surface scenarios

All six invariant scenarios passed, with exact per-criterion records. Each retains
`taskAcceptance: partial-synthetic-only`; none claims live vendor acceptance.

| Task | Executed evidence | Remaining gate |
| --- | --- | --- |
| R19 | Fixture registration/payout; foreign verification-token owner refused | Legitimate publisher-owned staging feed and custody |
| R20 | Changed registry payout invalidates old signing admission; original stays unchanged | Live testnet registry/Circle integration |
| R21 | New Node process reopens pending original; empty/mismatch remains held; exact terminal evidence promotes once | Live Circle outcome observation |
| R22 | Paid access with failed content retains simulated debit; failed source earns no evidence/reward; other source survives | Live paid-delivery integration |
| R23 | Interrupted/replayed Monthly job keeps one slot/order; no new debit/refund | Real purchase/vendor and user acceptance |
| R24 | SQLite-backed receipt API, API/remote MCP projections, CLI/stdio recovery, desktop export, extension renderer and bot adapters | Installed clients/GUI and independent user workflow |

## Shipped changes and release boundaries

App 0.26.6 removes stale “Arc testnet” labels from Telegram and Discord results.
Telegram help no longer promises every citation is an actual on-chain payment.
Both surfaces distinguish planned/recorded amounts from settlement evidence and
retain the dispatch link. Historical runs cannot safely derive their network from
the current server profile, so the labels are network-neutral.

The new reusable harnesses retain concrete inputs and execution artifacts, reject
damaged capture snapshots before reasoning, preserve capture time, deny all source
payments and isolate global effects. Live model execution has one exclusive lock,
stable pre-request reservations, no retries/fallback providers and auth/quota stops.
An interrupted or malformed allowance is retained for inspection, never reset.

Web, public/private APIs, remote MCP, Slack and shared research behavior keep their
existing contract. Buyer/Operator CLI, stdio MCP, desktop and extension keep their
existing distribution and handoff roles; adapter checks do not prove installation
acceptance or justify claiming a newly synchronized package/installer. No schema,
registry, signing, custody, mainnet cap or scheduler changes are introduced.

## Repeatable commands

From an isolated checkout with installed dependencies, without a live environment:

```text
npm run eval:workload:research -- --capture --fixtures
npm run eval:workload:research -- --replay --fixtures
npm run eval:workload:commerce
```

The first command generates reproducible fictional PDFs and captures six local
fixture/repository tasks. CI runs these with the existing regression checks.
For the complete pack, `--capture` permits at most 40 original HTTPS read attempts;
`--replay` defaults to heuristic reasoning and no network. Live reasoning additionally
requires `--replay --live` and an explicitly authorized key, optionally supplied
through `--key-file`; only `DEEPSEEK_API_KEY` is read from that file. Never load the
production environment wholesale. `--case R04,R14,R16` selects diagnostic tasks.
Artifacts and each attempt's summary stay under `.artifacts/workload-research`.
The fixed `live-budget.json` is cumulative; deleting it to regain allowance is not
authorized. Do not remove its lock until original process exit and retained state
are established. The USD 1 authorization is for this batch, not recurring work.

## Next work, ordered by observed user impact

1. B06: reproduce the nine original-read failures with bounded, exact-identity
   alternatives; do not simply remove parser resource limits or substitute snippets.
2. B07: make partial results explain the actual failed read and a targeted recovery
   step (R13), preserving unknowns and not authorizing blind paid retries.
3. B04/B05: review an assertion-complete useful-answer design against these artifacts,
   including omitted caveats (R03), creative proposals (R15) and contradictions (R11).
   Quote fidelity, lexical overlap and a second model score alone are insufficient.
4. Preserve first-attempt failure diagnostics and reproduce the R04/R14/R16 errors;
   the successful retry is not a demonstrated reliability repair.
5. B09/B10: separately provision testnet publisher/payment integration and retain
   original-bound evidence before any specifically authorized mainnet canary.
6. B12: recruit consenting independent users under an explicit outreach instruction;
   observe accepted deliverables and return use. Internal task execution is not traction.

PR review, required CI, the actual deployed commit and the post-deploy product update
are release evidence, recorded separately from this task/usefulness assessment.
