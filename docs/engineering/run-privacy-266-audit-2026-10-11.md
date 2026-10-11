# Per-run privacy: original issue audit

Issue [#266](https://github.com/tang-vu/keryx/issues/266) remains open. This is a
source audit of accepted main
`e9a97de92f03d5571d0d304927b7691eef26e110` (tree
`a0caa4e4d02fb0418e8e15d3b80b5a0c418544d9`), not a visibility implementation or
delivery receipt. Ordinary questions and reports remain public. Protected claim
handoffs, private profiles, private drafts and private research jobs do not make
ordinary research private.

## Original criteria and current evidence

| Original acceptance criterion | Source qualification | Remaining work |
| --- | --- | --- |
| Private and unlisted runs appear in no public list, feed, archive or sitemap | Not implemented. `QueryRun` has no persisted visibility contract. Public history and the archive use ordinary run readers. | Authoritative three-level visibility; filter before paging, deduplication and topic derivation; revocation of previously cached text. |
| Both data adapters enforce visibility | Not implemented. SQLite and Supabase detail, recent, streaming and follow-up readers select ordinary run data without viewer or visibility authority. | Reviewed adapter contracts for public lists, link reads and authenticated owner reads, including every ordinary and enrolled reader. |
| Creator rewards and public settlement totals are unaffected | Current payment authority is separate from run presentation; no financial code changes in this audit. This is not evidence of invariance under a future visibility/deletion operation. | Before/after equality of canonical payment, settlement, reward and aggregate records for all visibility levels and erasure. |
| Signed-in owner export and deletion work and are recorded | Bounded personal/claimant history and owner detail reads exist. A recorded owner export/deletion contract does not. Profile deletion deletes a profile, not run text. | Reuse authenticated recorded/claimed ownership; owner-only export and erasure, durable operation records, stale-session and cross-owner refusal. |
| Existing and unowned policy is recorded in `DECISIONS.md` | No issue-specific owner decision found. The original issue has no comments and explicitly preserves existing behavior until a decision. | Obtain the owner's choice and record it without calling historical behavior an approved future policy. |
| Each level is tested on every public run route | Existing tests cover public history, private continuation removal, receipt integrity and owner-history authorization. They do not exercise authoritative private/unlisted/public run state. | Adapter and route behavior fixtures, including cached-public-to-private/deleted transitions and duplicate archive IDs. |

The proposal also requires an owner-selected default for new runs, later visibility
changes, owner-only private pages with the same outsider response as an unknown ID,
and publicly verifiable settlement without question disclosure. None is established
by the current claim-history or profile capability.

## Reader and disclosure map

The references below point to existing source; the audit revision above fixes which
implementation was inspected.

| Boundary | Current reader or projection | Required privacy coverage |
| --- | --- | --- |
| Ordinary storage | [SQLite run readers](../../lib/db/sqlite-adapter.ts), [Supabase run readers](../../lib/db/supabase-adapter.ts), [streaming Supabase reader](../../lib/db/recent-query-stream.ts), [database interface](../../lib/db/keryx-db.ts) | Detail, recent lists, streaming scans, follow-ups and own-wallet reads need distinct authority. Filtering only React or an API response is insufficient. |
| Classified public history | [SQLite public usage](../../lib/db/public-usage-sqlite.ts), [Supabase public usage](../../lib/db/public-usage-supabase.ts), [runs API](../../app/api/runs/route.ts) | Usage cohort classification is not visibility. Preserve settlement summaries while applying visibility before the text-bearing page. |
| Historical archive | [Fixed testnet archive](../../lib/history/testnet-archive.ts), [public history merge](../../lib/history/public-history.ts), [dispatch resolution](../../lib/history/read-dispatch.ts), [testnet page](../../app/history/testnet/page.tsx), [testnet API](../../app/api/history/testnet/route.ts) | Respect the owner decision and preserve fixed historical network/provenance. A current hidden/tombstoned ID must not fall through to a public archive duplicate. No archive write authority is inferred. |
| Archive, search and discovery | [Archive cache](../../lib/answers-archive-cache.ts), [archive builder](../../lib/answers-archive.ts), [archive index](../../app/answers/page.tsx), [older pages](../../app/answers/page/[n]/page.tsx), [topics](../../app/answers/topic/[slug]/page.tsx), [Atom feed](../../app/answers/feed.xml/route.ts), [sitemap](../../app/sitemap.ts) | Exclude private/unlisted records before search, topics, canonical question selection, related links and structured data. Revoke existing cache entries as well as future reads. |
| Permalink and metadata | [Dispatch API](../../app/api/dispatch/[id]/route.ts), [report page and metadata](../../app/dispatch/[id]/page.tsx), [social image](../../app/dispatch/[id]/opengraph-image.tsx), [freshness API](../../app/api/dispatch/[id]/freshness/route.ts), [purchase outcome reader](../../lib/research/purchase-outcomes-server.ts), [thread loader](../../lib/history/read-dispatch.ts) | Private reads require the actual owner; outsider responses must match unknown IDs. Unlisted link access does not authorize public enumeration or indexing. Parent/child and related-result enrichment must not reintroduce hidden text. |
| Public creator activity | [Activity API](../../app/api/activity/route.ts), [creator API](../../app/api/creator/[id]/route.ts), [cited-source history](../../lib/sources/cited-source-history.ts), [source performance](../../lib/creator/source-performance-cache.ts) | Payment visibility does not authorize a research question. Redact question enrichment and sensitive explanations while retaining canonical creator earnings. |
| Creator exports | [Public earnings export](../../app/api/creator/[id]/export/route.ts), [authenticated portfolio export](../../app/api/creator/export/route.ts) | A creator's ownership of the payee source does not confer ownership of the payer's question. Keep payout rows/totals and apply question authorization independently. |
| Demand and follow-up | [Wanted board](../../lib/wanted-board.ts), [demand intent](../../lib/demand-intent.ts), [Ask parent lookup](../../app/api/ask/route.ts) | Hidden questions/claims must not enter public demand, matches or follow-up context for an unauthorized viewer. Do not privatize only the final report. |
| Owner account reads | [Personal history](../../lib/history/personal-history-route.ts), [claim HTTP](../../lib/run-claims/http.ts), [claimant history](../../lib/run-claims/history.ts), [SQLite ownership](../../lib/db/run-ownership-history-sqlite.ts), [Supabase ownership](../../lib/db/run-ownership-history-supabase.ts) | Reuse verified session/key, explicit scope, configured origin, owner comparison and recorded/claimed association. No body/URL wallet, source owner or funding amount establishes run ownership. Existing detail reads are not recorded export or erasure operations. |
| Portable receipts | [Receipt route](../../app/api/dispatch/[id]/receipt/route.ts), [receipt builder](../../lib/research-receipt.ts), [receipt types](../../lib/research-receipt-types.ts), [integrity core](../../lib/receipt-integrity-core.ts) | The current public research receipt includes question, answer, claims, excerpts and decision/citation rationales. Preserve its existing integrity contract; design an independently qualified question-free settlement projection rather than silently modifying a saved receipt and retaining its old digest. |

### Source findings that constrain implementation

1. SQLite `getQueryRun`/`listRecentQueries` at lines 1592/1597 and Supabase equivalents
   at lines 994/999 return stored run data without visibility predicates. The shared
   `resolveDispatch` at line 24 has no viewer argument and tries the archive on a
   missing current record. `publicQueryRun` removes private recovery authority, not
   the ordinary question or answer.
2. The archive cache at lines 25–62 holds text for ten minutes and serves its old
   entries on a rebuild error. The report has hourly revalidation, the feed has
   a public ten-minute shared cache and stale-while-revalidate, and the sitemap
   revalidates hourly. Adding write-time visibility without revoking these copies
   would not establish private-after-public behavior. Previously downloaded or
   third-party cached public copies cannot be recalled by a server mutation.
3. The receipt builder at lines 145–170 places the question and answer in
   `payload.dispatch`, claim text in `payload.claims`, and reasoning in agency and
   citation records. Removing only the question would leave other disclosure
   paths. Receipt self-integrity is distinct from independently verified settlement.
4. Activity and creator APIs attach questions by public `getQueryRun` lookups.
   Both creator export paths do the same. Authorization to view source earnings
   cannot be reused as authorization to view another wallet's private research.
5. Claimed ownership in SQLite is bound to `original_sha256` through
   `keryx_claim_history_sha(q.data)` at lines 19–25. The Supabase claim migration
   likewise binds the original. Existing tests deliberately revoke claimant reads
   on a changed original. Rewriting the original JSON to set visibility or delete
   text would therefore invalidate this ownership proof. Coordinate any erasure
   contract with the owner association without rewriting payment/payer attribution
   or weakening original-bound claim checks.

These are reachable current-source gaps against the requested feature. The current
public behavior is disclosed and expressly retained by the original issue until
the owner decision; this audit does not recast it as a newly introduced regression.

## Supported surfaces and authority boundaries

Web and hosted API require all list, detail, metadata, feed, receipt and export
paths above. Remote MCP currently reads ordinary history/dispatch data through
shared contracts; stdio MCP and CLI consumers use the hosted service or retain
their own local exports. They need consistent owner authentication and visibility
semantics when that contract is implemented. Hosted OpenAI-compatible/A2A and bot
ingress also need a server-authorized default and truthful public-link behavior;
an anonymous claim ticket is not a visibility credential.

Desktop private workspaces and private research originals keep their separate
storage and local deletion roles. The extension retains device report metadata,
opens hosted links and offers local reference downloads; clearing its device list
is not server erasure. Telegram/Discord/Slack private delivery controls protect
the message channel, not the public report it links. Already delivered bot
messages, downloads, notifications and browser history need an explicit retention
boundary, not an unsupported promise of recall. Inspect question-bearing query
memory, gap intents, notification payloads and recovery originals when defining
the erasure scope.

Public profile #264, complete cross-surface history #268, claim ownership #262,
export parity #283 and local private draft #282 remain separately owned. The
privacy outcome must use their existing authority and canonical contracts rather
than infer their completion. Enrolled/native methods and immutable historical
archives need explicit reviewed capability admission; ordinary tests or flags do
not grant it. No production DDL, backfill, activation, spending, payment,
custody, Operator or schedule change follows from this document.

## Validation and resumption

The exact audited main passed actual hosted CI
[38151439448](https://github.com/tang-vu/keryx/actions/runs/38151439448), including
`build-and-test`, production, checks, browser-source, integration and all three
unit shards. Its exact-source push workflows for Windows payment fixtures,
SQLite provenance capacity, existing treasury custody, native read-only artifacts,
Rust and Operator desktop also report success. That evidence qualifies the
unchanged implementation, not the absent visibility feature, owner erasure,
current public deployment or a new PR head. Existing focused tests include
`run-ownership-history-sqlite.test.ts`, `run-ownership-history-supabase.test.ts`,
`run-claims/http.test.ts`, `history/history-routes.test.ts`,
`api/research-receipt-route.test.ts` and `api/fulfilled-dispatch-privacy.test.ts`.
Their current passing behavior must not be labeled three-level privacy acceptance.

This prose-only audit needs source/link inspection, a clean diff and its own
applicable CI/aggregate acceptance. It does not warrant replaying the unchanged
runtime suite or a local production build. Future runtime work needs a meaningful
offline reproduction, both adapter behavior/authorization cases, full application
TypeScript, and actual production build/route/cache acceptance for Next changes.
The known local dependency-junction build limit is not a successful build.

Resume after the owner policy choice: record the decision; freeze a coherent
visibility/owner-export/erasure contract around these boundaries; obtain root's
independent source review before publishing substantive privacy changes; complete
focused and exact-source hosted gates in the same PR. Root owns main integration,
coordinated distribution, deployment and final original-criteria closure. Keep
#266 open until all six criteria and the proposal's privacy boundaries are accepted.
