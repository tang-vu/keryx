# ORIGINAL268 completed private-job history source — 2026-10-14

NEXTcohort, source only, **all fixtures UNRUN**. Base and unchanged HEAD:
`ae298ff41c239b292a043b3442df33f1701a4b99` (frozen64ae298).
Worktree: `D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-owned-private-history268-completion-20261014`.
The existing ROOT coordination record assigns this outcome and exactly these five
new paths. No coordination record, Git ref/index, existing source, caller, database,
ENV, credential, build output or production state was written by this session.
Parent owns real checks, different security review, focused PR and required CI.
This addition does not close #268 or delay/change ROOT64 delivery.

## Actual gap and implemented source

[`owned-history-reader.ts`](../../lib/history/owned-history-reader.ts) does not
consume `listPrivateResearchHistory`. The separate
[`privateHistoryPage`](../../lib/a2a/private-history.ts) projects signed intents,
including pending jobs; its `private-intent` record is not execution or payment.
This addition supplies a separate completed-private-job contract, real bounded
reader, known-result projection, metadata export and unmounted route factory.
It does not put private runs into `OwnedHistoryRow` or public `query_runs`.

The only storage dependencies are the existing exact-payer reads:
`listPrivateResearchHistory`, `getPrivateResearchIntent`,
`getPrivatePaymentState`, `getPrivateResearchExecution`, and
`getPrivateResearchResult`. Their SQLite SQL, Supabase RPC/SQL, schemas and
enrolled adapter bodies remain unchanged. Missing/accessor/nonfunction ports,
undefined results, errors and malformed data refuse; unsupported storage is not
reported as a successful empty page. A valid exhausted supported port may report
an empty page, and a bounded scan of pending jobs may be empty with continuation.

The existing adapters cryptographically validate stored intents and enforce the
original payer/payment/execution/result relationships. The new reader additionally
copies portable data without getters, parses existing request/requirement schemas,
checks commitment and deterministic private ID, checks the exact authenticated
payer, validates settled incoming evidence with `privatePaymentState`, and parses
the finalized saved snapshot. Request question/budget/mode, result ID and any
recorded `asker` must match. Claim targets and evidence claim indices must match.
Malformed/orphan/foreign visited records fail the entire response before rows leave.

There is no worker stamp in existing `PrivateResearchResult` storage. The existing
write port admits the saved result only through its permanent exact worker claim.
The reader retains that claim and exact immutable intent/result/payment fingerprints
and rereads them before release. Worker replacement, result replacement, signature
replacement or removal during IO refuses. It does not fabricate or require #469
metadata, and it cannot independently prove a historical worker signature that the
existing storage contract never recorded. Real adapter acceptance must retain the
existing immutable worker insertion/result-save authority; an arbitrary replacement
port returning self-consistent fabricated records is not an authorized adapter.

The detail projection follows the existing `privateResultView` allowlist with text,
array, portable traversal and byte bounds. It strips trace, internal metadata,
ciphertext, worker identifiers/secrets, signed authorizations/signatures, transport
receipts, provider telemetry and recovery packets. Original questions, answers,
citations and saved bytes are never rewritten. Missing/malformed historical
provenance stays null/unknown; origin and client labels do not backfill it.
Historical missing evidence/coverage stays null. Saved snapshots are completion
evidence; intent, pending payment and worker claim alone are not completed rows.

Incoming payment confirmation is labelled separately with its recorded source,
amount, network, reference and `chainFinalityVerified:false`. Neither an intent
price nor snapshot totals establish own settled research spend or creator rewards.
`ownSettledSpendMicros`, `creatorRewardsMicros` and `paidCreators` remain null
because the five authorized ports provide no creator ledger. A citation's
`recordedRewardUsdc` remains historical attribution, not a settlement assertion.

## Contract and fences

`private-job-history-v1` is explicitly `exact-payer-private-current-store`.
Capabilities declare completed jobs supported and multiwallet, creator receipts,
privacy mutation and public report links unsupported. The reader never calls
`historyMembership`, privacy sidecars, public reports, producers, providers,
search, signers or payment/DB mutators. No ID is routed to a public dispatch,
public receipt or ownership sidecar.

The list retrieves at most 26 intents, validates their strict decreasing order,
unique IDs and bounds, scans at most 25, and returns at most 25 completed rows.
The cursor binds exact payer/scope and the normalized query, including limit,
literal case-sensitive search, date, recorded surface and network. It retains
the first upper anchor and exact last scanned `(createdAt,id)` with PostgreSQL
microseconds and original UTC spelling. A row at/above `before`, above `upper`,
duplicate or out of order refuses. Owner/query/limit substitution and inverted
cursor bounds refuse before list IO. Cursors are selectors, not credentials or
cryptographically authenticated snapshot receipts. Backdated inserts and jobs
finishing between pages can affect a later page; no transaction snapshot is claimed.

Date selection/order uses the durable intent-list timestamp. `intentCreatedAt`
retains that timestamp on list/export rows; `createdAt` retains the original
finalized run timestamp. Detail has `intentCreatedAt:null`: the existing detail
read ports do not expose that list timestamp, so the helper does not invent it.
Surface comes only from parsed stored provenance, with absent metadata matching
`unknown`. Network comes from bound incoming confirmation. Unsupported selectors
(wallets, account membership, funding, visibility, whole-history mode) are rejected.
These filters operate after bounded enumeration, on both existing adapter ports;
no query pushdown, new port or schema change is claimed.

Bounds: 8 KiB request body, 5-second body read, 4 MiB saved-record input,
1,500,000-byte page/detail response, 15-second list/detail deadline,
and 25-second export deadline. Portable copies additionally refuse cycles,
accessors, malformed Unicode, excessive nesting/counts and non-JSON objects.
Pending reads race abort/deadline; checks after IO and serialization suppress stale
responses even when a storage callback ignores cancellation. No retry is started.

Explicit metadata export walks at most 20 pages / 500 rows / 2 MiB and returns
`complete`, `truncated`, `nextCursor`, bounds and qualification. Empty filtered
continuing pages remain continuing. Byte overflow retains the previous continuation
so resumption revisits the omitted page, and all accumulated rows are rechecked.
JSON preserves the original strings; CSV quotes cells, protects formula-leading
text without changing originals, and includes metadata even with no matched rows.
This is a bounded attempt over the admitted current store, not unlimited whole
history, reports, archived originals or an export of payment authorizations.

`createPrivateJobHistoryRoute(deps, "list" | "detail" | "export")` is POST-only
and exported without a production mount. List/export accept their strict filter
object and optional format (`json`, or `csv` for export); detail accepts `{id}`
and optional `format:"report"`. Private IDs and cursors stay in bodies; URL query
selectors and other report/receipt/reference formats are refused.

Credential handling follows `createOwnedHistoryRoute`: bearer presence excludes
cookie fallback, the exact verified key must have explicit `history:read`, and
that same raw key/owner/scope is revalidated after private IO. Historical null/default
keys retain ask/export only. Browser reads use the provided established verified-JWT
and durable-session callback, retaining and rechecking the exact 64-hex current
session ID and wallet. Another same-wallet session cannot renew a pending read.
Expected-wallet validation and 400/401/403/409 refusals retain current semantics.
Missing/foreign/noncompleted detail returns a private 404, corruption/capability/
deadline/abort failures a generic private 503. Every response uses the unchanged
`privateRunResponse` no-store, no-referrer, noindex/nofollow and credential Vary headers.
The callbacks remain trusted existing dependencies, not new authentication decisions.

## UNRUN fixtures and remaining acceptance

[`private-job-history.test.ts`](../../lib/history/private-job-history.test.ts)
authors positive HTTP/list/known-report/JSON/CSV/export cases and failures for
wrong/no identity, foreign payer, revoked/scope-changed/reassigned exact key after
IO, replaced/revoked/session-owner change, wrong expected wallet, intent-only and
claimed-only jobs, malformed results, orphan claims, worker substitution, erasure,
bad commitment/request identity, duplicate/order/bound errors, query/owner/limit
substitution, exact microsecond paging with head inserts, empty continuing scans,
page/count/byte export truncation and resumption, accessor/cyclic/oversized data,
chunked request overflow, invalid UTF-8, aborted late responses, hung storage and
hung post-read credential verification. Forbidden side-effect ports have spies.

These are synthetic established-read-port fixtures. They calculate commitments
without signing, do not mock a verifier into success, and do not create/execute a
funded run or claim real adapter signature/payment acceptance. No test, app/module,
compiler, DB, build, producer, model, vendor or target was executed here. Only
instruction/source reads, read-only Git inspection and raw hashing were performed.
The retained original #268 body was read from ROOT's notes; the attempted `gh`
read found no executable, and no native denial/retry or alternate GH execution was used.

Before mounting, parent must review the exact existing caller partition. The current
private workspace consumes `private-history-v1` intents and its existing result
contract; replacing that route with this completed-only contract would break it.
The current owned v2 list must remain separate. Wire the supplied verified callback
and current caller-origin policy deliberately, then validate real SQLite/Supabase
port behavior, credential failure paths, stock routing/browser and applicable
TypeScript/build/aggregate/domain/platform CI. Source, different review and real
checks are pending; no extra coordination or admission framework is introduced.

Web/API get an unmounted factory only. Existing Desktop, CLI, remote/stdio MCP,
extension, bots and A2A enumeration/contracts remain byte-exact and gain no new
private enumeration. Their corresponding caller adapters/distribution acceptance
remain parent gates. No public/private original, session caps/nonces/payTo,
Arc registry, finance, ENV, custody or private holds changed. Retained paid-original
vendor/user proofs remain separate actual acceptance; synthetic fixtures do not
replace them. ROOT28/private261 unchanged evidence is reusable only for equal
source/input/scope, not acceptance of this new private reader.

## Actual ORIGINAL268 criteria map

Source: retained `refill-successor-prep/refill-round26-20261013/original268.json`,
1596 bytes, SHA-256 `8386ceef02251e9e96bb7664e5e047e3f223e777d4d2d3d2bbc9572b52496801`.
It agrees with retained `history268-currentmain-completion-04/original268.md`.
The original issue is [#268](https://github.com/tang-vu/keryx/issues/268).

| Original criterion | This source delta | Remaining real gate |
| --- | --- | --- |
| Runs from every surface appear for their owner and for no one else | Reads completed private jobs for independently authenticated exact payer; stored provenance or unknown | Caller partition/mount and all-surface actual acceptance; no invented chat or multiwallet ownership |
| Pagination stable and bounded; search and filters work in both adapters | Existing 26-intent ports, exact cursor/upper/query/payer binding, bounded scans and literal/date/recorded surface/network filters | Real adapter acceptance; funding/visibility selectors unsupported here |
| Dedicated own-history key scope without widening existing keys | Reuses unchanged explicit `history:read` and exact post-read key validation | Verify real auth callbacks/caller mounting; defaults unchanged |
| MCP and API expose the same history contract as web | Exported separate private contract and HTTP factory | Web/API/MCP/CLI/Desktop adapters and distribution not implemented in these five paths |
| Tests cover several wallets, revoked key and claimed run | Exact payer separation and revoked-key fixtures authored; no linked-wallet or ordinary claim authority introduced | Parent runs fixtures; original #267 membership and ordinary claim acceptance remain separate |

Proposal items for receipts/paid creators, own-vs-sponsored creator spend,
visibility/delete, full account/multiwallet integration and unlimited whole history
are not claimed complete. Private report bodies and qualified JSON/CSV metadata
export are implemented as source; public report/reference links are intentionally
unavailable. The whole original proposal and its five criteria remain OPEN.

## Minimal patch, whole inverse and raw pins

The patch is exactly five file additions below, zero existing-file modifications,
zero Git writers. The first four contain 921 added lines (274/121/140/386).
Read-only `git diff --no-index --numstat -- NUL <path>` produced those counts;
Git's line-ending warning is not runtime evidence. Raw byte pins bind the actual
LF working files, independently of future Git CRLF normalization.

The whole inverse is precisely restoring absence of these same five new paths,
with no changes to any existing path. It is recorded, **not executed**. The source
files themselves are the complete forward payload; there are no generated patch
artifacts or hidden source overlays. Parent can reconstruct each forward addition
with `git --no-optional-locks diff --no-index -- NUL <path>` and its inverse with
the operands reversed. The documentation's self pin is emitted in the final
read-back receipt rather than placed recursively inside its own bytes.

| New path | Raw bytes | SHA-256 |
| --- | ---: | --- |
| `lib/history/private-job-history.ts` | 19920 | `04e540ec4b0b0a447524ebece7d799426138d29b5a76c863dedce76176fcd747` |
| `lib/history/private-job-history-contract.ts` | 8991 | `6187dfb23f34cfd0dced0640a7ab5b57687b78afbc6c11be5aea84f37b08e1a7` |
| `lib/history/private-job-history-route.ts` | 8599 | `73d0776006f395f37cff64e46a3b0937cf56b8557a672e251cd908578d65521d` |
| `lib/history/private-job-history.test.ts` | 31785 | `9cb0bb8809ff0e1345e7df6c0e8cc945704219cd31cd19ebcebdf066044bb89a` |
| `docs/engineering/private-job-history268-completion-2026-10-14.md` | Final read-back receipt | Final read-back receipt |

Read-only `git diff --name-only HEAD` was empty; status showed only the new helper
files before this document was added. Current `origin/main` coordination and
development documents compared equal to the files read in this frozen worktree.
Canonical/local AGENTS/override, pilot common-rules, Keryx planning/review and
relevant references were present and read. Existing ROOT owns the outcome board;
no separate worker claim/merge/deploy owner was created.

Selected unchanged raw input pins, retained for equal-scope evidence reuse:

| Existing input | SHA-256 |
| --- | --- |
| `lib/history/owned-history-reader.ts` | `0ba5078d273adfc128cfd30764b58f3abdbdbb8e09289b3589ecda248862f37b` |
| `lib/history/owned-history-route.ts` | `78f4cec3e362ae8b13e38d00a219f3753886b9485c85688f585e678e8a8c2836` |
| `lib/a2a/private-history.ts` | `c4a17848e6b45db677e6a1876a685e2178e8d6ca3879e8755eca9fc81e4b23c0` |
| `lib/a2a/private-result-view.ts` | `17bd2ddaa90f3ade9b35c72cc12701fdd31ef20e00d1b9c1cfbd225911547d86` |
| `lib/a2a/private-payment-state.ts` | `a17fd6f5e42d012d5dd8815831b48fe5433e7fa7ddce4fd0334256297b943163` |
| `lib/db/keryx-db.ts` | `8575d4f486e8bf8b56aec244d5871855ba40948cc4519c4ab784fdb00bb05144` |
| `lib/db/private-research-intents.ts` | `e2a908b8d02d4231f9784888e62815cfae80b122f7f19be26147c44538fb2664` |
| `lib/db/private-research-results.ts` | `37b2d8d8301f6ed1fadd9fb2aabcd031fedaf3d9625728275bc57b0d17c50d0b` |
| `lib/db/private-research-executions.ts` | `53ac65f5b4f863635bf220b9b11927f6e33026c39a8b649ce14dc56badbc1d91` |
| `lib/db/sqlite-adapter.ts` | `7c155dde7a0eca874e0fe7b2b58dac73c7aea38982f5a1b32850beabfbeee212` |
| `lib/db/supabase-adapter.ts` | `9ea20c4234667c84af00a8b1cf210f823a5a55db8aa79918fd59f78aa90772fe` |
| `lib/research/bounded-portable-json.ts` | `cee5f2633df9e14d86e6b53fcf99e85e0530699e477f721374f042a7a3c970b0` |
| `lib/research/run-provenance.ts` | `eddee5ed8176270dd18797985507f40da0c24f186fea5693093d4da2cf015099` |
| `lib/buyer/private-request-commitment.ts` | `9960690f546f3c455c8808951d4b7af141774650f4e17978cbf1737fe8ea0b2c` |
| `lib/api-key-scopes.ts` | `9aacd0bbd661af97e3dfe580f6f1e8fe73b76dfeb1fd17850d6869220a24504c` |
| `lib/run-claims/private-response.ts` | `aa35d04fc90440cd4a61f1a8ea6f427f4d6700b180d594c7ab66f550b6652e21` |
| `lib/run-claims/private-headers.cjs` | `4ed7db820b2e503bd86d803a0e2614da9c842fef6f59a17a7b0c52549a0973b6` |

Next action: parent reviews this exact five-path payload, executes the authorized
focused failure fixtures and real adapter/auth checks, then owns focused next-PR
and CI. No mount, merge, version, deploy, issue closure, schedules, spend, custody,
producer or paid-original execution is authorized or performed in this handoff.

## R72 additive API mount — 2026-10-14 (all fixtures UNRUN)

This appendix records the next authorized source increment. Everything above it
is the byte-preserved R68 handoff, including its historical unmounted status.
R70 independently accepted those original four code files within the existing
trusted authentication/read-port boundary: [actual source review](D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-70/worker-reviewPrivateJobHistory268/source-review.md).
That review did not run fixtures or accept this new mount. HEAD and origin/main
remain `ae298ff41c239b292a043b3442df33f1701a4b99`; frozen64, runtime recovery and
ROOT operations are untouched. The existing ROOT allocation's R72 transfer grants
only the five new paths below and this additive documentation append. No board,
resource, Git ref/index or other source path is written.

### Actual mounted caller and retained authority

[`private-job-history-mounted.ts`](../../lib/history/private-job-history-mounted.ts)
supplies the real existing `accountSessionContext`, `verifyApiKey` and `getDb`
callbacks to the unchanged `createPrivateJobHistoryRoute`. Three thin Node,
force-dynamic route modules select its fixed actions:

| Fixed endpoint | Action | Private POST body |
| --- | --- | --- |
| `/api/me/private-jobs` | list | Existing strict filters/limit/cursor, optional `format:"json"` |
| `/api/me/private-jobs/detail` | detail | `{id}`, optional `format:"report"` |
| `/api/me/private-jobs/export` | export | Existing strict filters/limit/cursor, optional `format:"json"` or `"csv"` |

IDs and cursors never enter path segments or query selectors. All query parameters
remain invalid. Explicit GET/HEAD/OPTIONS/PUT/PATCH/DELETE exports invoke the same
factory's 405 refusal with `Allow: POST` and private response headers; they add no
read action. The existing `/history`, `/result` and `/quote` bodies are untouched,
so the private workspace keeps its existing intent/result contracts. Ordinary
owned history, public queries, paid originals and all original IDs/bytes stay
separate and unchanged.

The only mounted fence uses the fixed trusted `new URL(config.baseUrl).origin`,
captured when the route is constructed. Browser POST without Authorization must
supply that exact Origin before the session callback can run. A present Origin
must match even for a bearer. No-Origin API-key calls proceed to the existing
factory; malformed or empty Authorization still cannot fall back to cookies.
Host, forwarded headers, request URL, IDs and body wallets select no authority.
Missing/invalid HTTP(S) server origin configuration returns a private 503 before
authentication/storage. The helper does not use the old caller-Host comparison.

No new authentication or membership decision is introduced. The browser callback
still verifies JWT and the exact active durable session, and the factory retains
and rechecks that session's 64-hex currentId and normalized wallet after private IO
and serialization. The API callback still verifies the same raw key; the factory
requires explicit `history:read`, repeats revocation/scope/owner verification and
never invokes cookie authentication on the bearer branch. Expected-wallet 400/409
semantics are retained. The helper adds no DB preflight: cookie DB access stays
inside the established authenticated-session callback, key credential lookup stays
inside `verifyApiKey`, and the existing factory calls `getDb` only after successful
key verification/scope checking. Errors and missing/private-port refusals retain
503; no substitute backend, successful-empty fallback, schema or adapter is added.

All request/read/export bounds, immutable record fences, exact payer separation,
saved-result allowlists, abort/deadline handling and qualified incoming evidence
are provided by the byte-unchanged R68 factory/reader. The mounted helper creates
no public copy, producer, model, vendor/search/network call, payment operation,
storage mutation or financial grant. It does not accept synthetic signatures as
stored-signature evidence. The existing admitted adapter and verified callbacks
remain the explicit trust boundary; their real acceptance belongs to parent.

### Authored mounted acceptance and exact remaining gates

[`private-job-history-mounted.test.ts`](../../lib/history/private-job-history-mounted.test.ts)
calls the actual three route modules with the factory and reader unmocked. Only
the established session/key/DB boundaries and trusted config are substituted.
Five existing read ports return bounded synthetic admitted-output shapes. No
verifier is replaced and no key, session, signature, funded job or DB is created.
The fixtures are **UNRUN**, covering:

- All three mounted paths rejecting missing/foreign browser Origin and supplied
  foreign bearer Origin before any auth/DB/read call; configured origin rather
  than inbound Host; private method/query and strict body-selector refusals.
- Explicit key scope, malformed/revoked keys without cookie fallback, failed
  credential lookup, expected-owner/invalid-owner refusal before private reads,
  and key-before-data-DB ordering.
- Exactly known completed owner list/detail/CSV, excluding foreign, pending and
  merely claimed jobs; unknown provenance/null creator financial metrics, saved
  original preservation, sensitive-field stripping and formula-safe CSV.
- Private-body cursor continuation, foreign-owner cursor refusal before list IO,
  same raw key with post-read revocation/scope/owner changes, and exact session
  replacement/revocation/wallet changes after private IO.
- Missing private ports, unavailable backend, malformed session identity,
  pre-aborted and late-result aborted requests, generic refusal bodies and the
  unchanged private response headers on successful and failed handler responses.

Parent must run these new fixtures plus the existing R68 focused fixtures and
real auth/admitted SQLite/Supabase checks. Neither R70 source review nor these
synthetic records proves real storage signature/payment admission. Applicable
stock Next routing/headers, TypeScript/production build and required aggregate/
domain/platform CI remain unrun parent gates. The Next instruction guide is not
installed under either this worktree's or the canonical checkout's
`node_modules/next/dist/docs`; no dependency installation or guide fabrication
was attempted. Parent's actual Next toolchain must supply that instruction/check
context. No app/module/test/compiler/build/DB/DDL/target execution occurred here;
only authorized instruction/source reads, read-only Git inspection and raw hashing
were performed. No Git writer, ENV/credential access, native denial retry,
activation, merge, version, deployment or closure occurred.

One concrete framework acceptance concern is retained: the unchanged global
`appSecurityHeaders()` sets `Referrer-Policy: strict-origin-when-cross-origin`
([source](../../lib/security-headers.ts:78)), and the existing Next headers rules
have no `/api/me/private-jobs` exception
([configuration](../../next.config.ts:33)). That file itself warns that matching
Next configuration can override handler headers. The handler/factory fixtures
assert no-store/no-referrer/noindex/nofollow and credential Vary, but cannot establish
the final hosted header. Parent must verify that ordinary Next response and make
any necessary matching-header correction in its separately granted config scope
before release. This session cannot change `next.config.ts`; no runtime/private
header delivery is claimed from source alone.

API caller source is now mounted; the private web workspace still uses its old
contract, and web UI/desktop/CLI/remote and stdio MCP/extension/bot caller adapters,
same-contract integration and package/distribution acceptance remain unimplemented
here. Global/linked-wallet membership, creator receipts, privacy mutations and
other original proposal items remain as recorded in the preserved R68 criteria
map. Real-store acceptance, rollout and delivered acceptance remain open. Parent
owns new independent review, focused source acceptance and the next focused PR/
required CI; no ROOT production change belongs to this handoff. **ORIGINAL268
remains OPEN**, with no stage or original-issue closure claimed.

### Minimal delta, full byte inverse and pins

This increment adds exactly these five files and appends only this section to the
existing document. The physical source files are the entire forward payload;
there is no generated patch, hidden overlay, framework or change to existing
auth/DB/private-original/public-query bodies. Read-only tracked diff is empty.

| R72 new path | Raw bytes | SHA-256 |
| --- | ---: | --- |
| `lib/history/private-job-history-mounted.ts` | 1761 | `a8f57f347f9135d267da206018dd7789f14cd3b98033b9364c5bea1494135018` |
| `lib/history/private-job-history-mounted.test.ts` | 19732 | `aa006b7646256892718a4c091532a8d2ccf46acffb073f19eff9146b0b9aa7d5` |
| `app/api/me/private-jobs/route.ts` | 441 | `6ee15b3224294837f8563b40e3f9a662bbc87f3f9fd4eb09509e75a17564ebb9` |
| `app/api/me/private-jobs/detail/route.ts` | 443 | `bf568bbbedd7bf9452add2e2c4864512d52a73429bdb3a19c6e937cb87319a93` |
| `app/api/me/private-jobs/export/route.ts` | 443 | `66403f170dc5c589ca1005ce067fd8dc27c726be92d9a45e5f7f0b98652136f6` |
| Appended document | Final read-back receipt | Final read-back receipt |

The exact whole inverse, recorded but not executed, restores absence of only those
five R72 additions and restores this document to its first **17899 raw bytes**.
Those bytes are the complete original R68 document, SHA-256
`3aa4766975b9fdca8b7b2d7d07d6373e9296e79140d5f2511864e9c7a6dbbb49`.
The four original code files remain present byte-exact at R70's pins
(`04e540ec…`, `6187dfb2…`, `73d07760…`, `9cb0bb88…`); their full raw pins are in
the preserved table above. All existing tracked source remains unchanged. An
inverse must not remove the R68 files, rewrite their bodies or normalize line
endings. No inverse, cleanup or Git mutation was executed.

Additional unchanged caller/auth input pins (all original R68 input pins above
are also rechecked unchanged):

| Existing input | Raw bytes | SHA-256 |
| --- | ---: | --- |
| `lib/account-sessions.ts` | 1279 | `08e456c6bf4f9452ed38a18968f9a1022af61e8f605a480b72fa9dd18ff8412e` |
| `lib/api-keys.ts` | 2976 | `219ac385cc9e8710fbfaeb028c517abb2af2c107cc86c9bcf049bfb24c966fd4` |
| `lib/db/index.ts` | 1755 | `2b3f62346ba90c8172451267c2c152ee87e9e652192c9a05226b1193ab12d3bd` |
| `lib/config.ts` | 22167 | `a9e7d6bff229781d8e4f7ea30de15a2db6f42979cc2304d1dc84df466ef0ff0d` |
| `app/api/me/private-jobs/history/route.ts` | 963 | `5da6ddf8945e29c8277a99618fbf0ea40e1fc86206004a2bc0ed229f9887425e` |
| `app/api/me/private-jobs/result/route.ts` | 1114 | `9434581f286a8124090df272daba8f0d67ea77b00b1aecf4d3a26938eec30122` |
| `app/api/me/private-jobs/quote/route.ts` | 2065 | `eeea2ac12bfdd346b3e553f1b0f99194cc6fab9443a80771cb2683eda9c1e1e6` |
| `app/api/me/history/route.ts` | 474 | `d60d9eea23f63a8b0cf9108d0da441d54afbd7ecb5d4b304ef3572f6cbc05997` |

Canonical/local AGENTS and overrides, current origin-main coordination/development
workflows, pilot common rules, canonical/local planning/review skills and relevant
source were read. The project skills are present in this session catalog and in
the worktree; no discovery gap or new coordination layer is inferred. The final
read-back receipt binds the complete appended document, its original prefix, the
five physical additions and the unchanged protected source.

## R75 bounded corrections to the two R74 P2 findings — 2026-10-14

This source-only correction implements exactly the two findings in the
[R74 review](D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-74/worker-reviewPrivate268MountedCaller/source-review.md).
The existing ROOT transfer permits only `next.config.ts`, the mounted fixture and
this append. The prior 29,491 document bytes remain exact; historical R68/R72
status and requirements above are preserved as history. Delivered64, main,
production and financial authority are unchanged. No review acceptance or
runtime delivery is claimed.

[`next.config.ts`](../../next.config.ts:67) adds only
`"/api/me/private-jobs/:path*"` to the existing `runClaimPrivateHeaders` map after
the global rule. Next's zero-or-more path pattern includes the root list,
detail, export and existing private-jobs subpaths. The existing shared headers
supply no-store, no-referrer and noindex/nofollow regardless of handler success
or refusal. Global headers and every prior private exception remain exact.
Neither CSP nor Vary is changed: the global CSP remains in place and the unchanged
handler supplies its credential Vary through the existing response mechanism.

Installed Next's headers guide and response code were read strictly as DATA:
`resolve-routes.js` collects later matching headers, `router-server.js` applies
them before rendering, the dynamic `app-route.js` template calls `sendResponse`,
and `send-response.js` skips already-present non-multivalue handler headers.
Referrer-Policy is not in its multivalue list; Vary is. The narrow config rule
resolves the source conflict without changing authentication or global policy.
Ordinary Next HTTP verification remains a parent gate; direct handler calls
cannot establish final HTTP header delivery. The earlier missing-guide statement
describes the R72 session, not this installed toolchain.

[`private-job-history-mounted.test.ts`](../../lib/history/private-job-history-mounted.test.ts:112)
retains the existing hoisted boundary/mock setup with a mutable trusted config
object initialized to the exact prior valid HTTPS value. Three new UNRUN cases
use malformed `not a URL`, parsed FTP and opaque data URLs. Each resets module
state and imports the actual list/detail/export mounts anew so their captured
configuration is invalid. Each mount receives a matching-Origin browser request,
an explicit bearer without Origin and an explicit bearer with matching Origin:
27 refusal requests across three cases. Every request requires the exact generic
`history_unavailable` body, private 503 and the existing no-store/no-referrer/
noindex/nofollow/credential-Vary assertions, with zero session, key, getDb and all
five private-read-port calls. A finally block restores the valid config and
clears the module cache even on failure. The prior valid fixtures, auth mocks,
Origin/session/key tests and their assertions are byte-preserved; the factory,
helper, three mounts, old four modules, DB and auth source are frozen.

### Minimal forward, complete correction inverse and raw pins

The forward correction is one namespace string insertion in config; a hoisted
config object and config mock replacement plus one three-case test block in the
mounted fixture; and this additive document suffix. No other source is written.
The physical files are the forward payload, with no generated framework/overlay.

| Correction path | Before raw bytes / SHA-256 | After raw bytes / SHA-256 |
| --- | --- | --- |
| `next.config.ts` | 6975 / `7d20b196ab973d28b54ce9c0836c687ba80e5880109a7c4dba3e06dc0e91641f` | 7006 / `9097d6be4c622a06542968133dc7e00163b407cb7c252c3e6ae9eab6ed215399` |
| `lib/history/private-job-history-mounted.test.ts` | 19732 / `aa006b7646256892718a4c091532a8d2ccf46acffb073f19eff9146b0b9aa7d5` | 21156 / `220a668c475aad55b0e2b626128e34ed9412799f78a5f5adcb4f0283a6c7abc1` |
| Whole document | 29491 / `2330288d41ef431d16ae6127e8b58dd172083b3e4b968e98ee338d4610ff9e41` | Whole-file final read-back receipt (self-pin kept outside its own bytes) |

The complete correction inverse is recorded only: remove the one added
`"/api/me/private-jobs/:path*", ` string from the existing config map; remove
only the new three-case test block; restore the prior single-line hoisted
session/key/db boundary and prior inline valid config mock; and restore this
document to exactly its first 29,491 raw bytes and the before pin above. Preserve
every preexisting R68/R72 addition and all other paths. Both source inverses are
hashed in memory against their whole before pins; no inverse is executed.
The R68 17,899-byte prefix also remains exact at
`3aa4766975b9fdca8b7b2d7d07d6373e9296e79140d5f2511864e9c7a6dbbb49`.
All 29 protected raw pins in the preserved tables and R74 review were checked
and match, including all four accepted reader/factory files, auth, adapters,
private headers and prior routes. The mounted helper and three R72 route modules
also retain their complete R72 pins above.

### Evidence qualification and remaining parent gates

The existing parent
[old-reader result](D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/private268-accepted-reader-parent-20261014/actual-result.json)
was read as DATA: 46 passed, zero failed/skipped, observed exit/close code 0,
null signal, no timeout/overflow/errors and full stdout/stderr EOF with observed
bytes equal retained bytes. Its four source pins still match. This accepts only
the earlier synthetic admitted-read-port fixture scope; it proves no real native/
storage/signature/payment acceptance and no mounted fixture, type or Next HTTP
execution. No old46 rerun occurred. The current owner instruction explicitly
supersedes the historical R72 request to repeat those unchanged fixtures.

Parent next action: obtain focused peer acceptance of these changed source paths,
run the new mounted fixtures and focused types, verify ordinary Next HTTP for
list/detail/export success and private refusal with no-store/no-referrer and
existing CSP/cache/Vary behavior, then carry the focused PR through actual required
aggregate/domain/platform CI. Real auth/admitted-store and all original
API/Web/Desktop/CLI/remote and stdio MCP/extension/bot adapter, same-contract,
rollout, distribution and delivery criteria stay open as mapped above.
**ORIGINAL268 remains OPEN.**

Canonical/local AGENTS and overrides, current origin-main workflows, pilot
common rules, canonical/local planning/review skills and gateway-spend/
demo-critical/verified-invariants references were read. These skills are present
and readable; no discovery gap applies. Only instruction/source/DATA reads,
read-only Git, raw hashing and these three authorized source writes occurred.
No test/compiler/app/module/build/DB/DDL/provider/target/ENV/key/model/search/
payment/Git writer/native-denial retry/activation/schedule/merge/version/deploy/
closure occurred; no new credentials, authority or policy change was introduced.
