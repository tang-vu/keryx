# Personal history read source candidate

Issue #268 remains open. This first slice retrieves runs already attributed to one
authenticated wallet in the ordinary current store. It does not create account
membership, bot identity, payer identity or run ownership from client metadata.

`GET /api/me/history` accepts active SIWE or a verified API key with explicit
`history:read`. Historical/default keys retain only `ask,export`; profile scopes do
not imply history. Malformed, invalid or revoked bearers never fall back to cookies.
A comparison-only `X-Keryx-Expected-Wallet` protects a stale browser view and cannot
select another wallet. Key verification retains existing last-used bookkeeping;
history reads never rewrite run rows.

The strict shared contract has 1–50 rows (25 default), literal case-sensitive question
search up to 200 characters, recorded provenance surface, inclusive UTC `from`/`to`
timestamps with milliseconds and exact browser-funding record versus other/unknown.
Unknown/duplicate fields, owner/network selectors and oversized inputs refuse.
`%` and `_` are literal search characters. Missing/malformed provenance remains
unknown; `origin` and client names establish neither surface nor ownership.

Descending `(createdAt,id)` keysets handle equal timestamps. Cursors bind owner,
store network and normalized filters; a first-page upper anchor excludes newer and
equal-time higher-id insertions. This is not a transaction snapshot: backdated
inserts, row changes/deletions and refreshed first pages can change results. The
network labels the deployment, not independently established per-run payment
network. Cursors are bounded encodings, not access tokens; authentication and
owner-scoped queries establish authority independently on every request.

Only allowlisted summaries are selected: safe id, question (8192 characters maximum),
timestamp, closed provenance, funding record, recorded spend/creator allocation,
payment mode and follow-up flag. Answers, raw run JSON, private fulfillment and
private job tables are excluded. Amounts are neither settlement proof nor the price
a payer paid for research. Report/receipt links use existing public dispatch
endpoints; receipt contents, public visibility and immutable bytes stay unchanged.
No whole-history total is fabricated from a page.

## Surfaces and storage

| Surface | Source outcome |
| --- | --- |
| Web | Current **Browse attributed history** mode: filters, newer/older pages, report/receipt links. Recent creator ledger remains available. Owner change unmounts and aborts browse requests. |
| API | Shared owner-only summaries, no-store. SIWE-only `/api/me/asks` remains unchanged. |
| Remote MCP | `history_read` uses the verified key and explicit scope. History-only keys cannot perform mixed-batch research or consume sponsored usage. |
| Stdio MCP / CLI clients | Same tool via fixed HTTPS key-only API; bounded response/deadline, no cookies/redirects/retries/signer/payment journal/custody. |
| SQLite | Optional ordinary port guarded per read; bounded owner-scoped SQL projection. No schema change or enrolled method. |
| Supabase | Source-only service-role RPC `personal_history_read_v1`; no REST fallback. `0084_personal_history_read.sql` is distinct from other descriptive 0084 filenames; #265 reserves 0085 profile identities. |
| Sealed/enrolled/native/archive | Port absent/refused. No inventory/digest refresh, production migration, enrollment, runtime original or archive adoption. Existing SIWE testnet archive stays separate. |
| Desktop, extension, bots, script ask | Retrieves already attributed ordinary runs. No account linking or new attribution; ownerless runs and desktop private workspaces are excluded. |

English browse copy has semantic keys in `locales/en/personal-history.ts`. The shared
developer label is allocated through the root ignored note with inactive PR335's
locale owner; no unmerged locale code is imported. App/MCP/client publication needs
one coordinated accepted release. Unchanged source versions do not claim publication.

## Acceptance and remaining gates

Focused tests cover synthetic SQLite projections, tied timestamps/insertion bounds,
filters and cursor binding, key scopes/revoked-bearer refusal, sealed refusal,
RPC-only projection checks, remote batch isolation and bounded stdio clients.
CI adds real synthetic PostgreSQL ACL/filter/keyset/immutability/enrolled refusal,
the exact built stdio fixture and browser isolation acceptance. The browser fixture
uses actual authored standalone PostCSS at 412/1280 widths, not built Next assets;
it checks text safety, filters/pages, owner switch, late responses and sign-out. App/operations
TypeScript and default hosted production build are required. Local cache evidence
is scoped to its exact resolved lock and installed app/package inputs, never a
fresh install or contract acceptance. Local Docker failure is not SQL acceptance;
actual CI must resolve that gate.

Production is not adopted. The fixed-main freeze and independent SQL migration,
enrollment and release gates remain. This draft has no merge/deploy admission.
Keep #268 open for multiwallet membership, verified linked chats, claimed anonymous
runs, visibility/deletion, whole-history JSON/CSV, private/archive access and
independently verified own-versus-sponsored service spending.
