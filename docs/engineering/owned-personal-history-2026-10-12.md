# Owned personal history (#268)

## Exact-session reads and repository CLI

The v2 HTTP handler retains the current account-session hash and checks that same
session again after every list, export, report, receipt or reference read. Revocation,
expiry and session-storage failure discard private output. Another session for the
same wallet is not a renewal of the pending request. Bearer requests still revalidate
only their exact key, owner and explicit history scope, with no cookie fallback.
Session hashes stay private and never become owner selectors or output fields.

The repository CLI now exposes the existing v2 API contract directly:

    node --import tsx scripts/history.mts list --surface api --limit 25
    node --import tsx scripts/history.mts export --format json
    node --import tsx scripts/history.mts export --format csv

It reads only the explicit history-scoped KERYX_API_KEY and HTTPS KERYX_BASE_URL
(default https://keryx.cc), with no environment-file loading, wallet selector,
database fallback, signer, research, payment or retry. Filters and cursor semantics
are identical to web/API/MCP. JSON preserves machine fields and original text;
CSV uses the same pure serializer as HTTP. A successful command can still return
truncated metadata, an empty continuing scan or wallet-only coverage. Inspect the
completion, truncation, continuation and capability fields.

Commands and the existing ownedHistory namespace retain their English baseline.
No interface label, question heuristic or requested language establishes recorded
answer language; original questions, answers, references and receipts are unchanged.
The strict history input still rejects research presentation-language parameters.
No preference is saved or reported as saved by this history adapter.

Desktop's admitted native workspace/task history remains distinct from authenticated
account history. The authenticated browser route is the account-history consumer;
this delta adds no native account-history pane, automatic web handoff or account
cookie/key storage. Dedicated native account-history integration is not proved.
Extension and bot readers likewise retain their existing verified attribution and
claim requirements. Account-wide coverage still needs the held #267 stored membership
producer. Actual packaged stdio/Desktop/Windows, PostgreSQL, stock routing/browser and
aggregate CI plus coordinated delivery remain required before original #268 closure.

The explicitly selected owned-history `/me/asks` pane, `GET /api/me/asks?contract=owned`, remote MCP `history_owned_read` and the packaged stdio tool use the same v2 owner-private reader. The web starts on the prior session ledger; explicit v2 still refuses absent privacy admission. When privacy is active, the API defaults to v2. `history_export` and `/api/me/asks/export?format=json|csv` attempt a bounded whole-history metadata export. The previous attributed reader `/api/me/history`/`history_read`, explicit SIWE `view=recent` ledger, claimant pane and explicit testnet archive remain distinct qualified views.

Authentication uses an active stored session or an explicitly `history:read` scoped key. Bearer presence excludes cookie fallback; existing/default keys retain ask/export only. Owner addresses are never query selectors. HTTP rechecks bearer validity before releasing a long response. Private headers are retained at both handler and Next routing layers. Read keys cannot mutate privacy. Row visibility/delete use existing revision, idempotent request ID, same-origin, owner-precondition and active interactive-session checks. A member-wallet row requires that wallet's session to mutate; the consumer does not invent delegated write authority.

Recorded `asker` is established by the existing verified session/API-key/payer ingress, regardless of the run's surface. Anonymous claims use the existing immutable original-digest/network/origin proof. Sender strings, payout addresses, profile metadata and public URLs do not create ownership. The ordinary SQLite and Supabase adapters retain their existing ownership/list and privacy/owner predicates. No raw/public/archive fallback is used. Owner detail/reference output is authorized before retrieving financial metadata. Erased originals disappear while existing financial retention remains unchanged.

`KeryxDB.historyMembership` is a **consumer-only optional read port** for #267: `resolve(verifiedWallet)` returns null or a current stored `{accountId, revision, wallets}` proof (unique lowercase wallets, including the authenticated wallet, at most 8). Its provider must bind verification to current stored membership, fail closed on unavailable storage, invalidate unlink/revision changes immediately and grant no balances, caps, grants, payer identity or signing authority. There is no provider in this base source. Without it the response explicitly says `wallet-owned-current-store` and `membershipAvailable:false`; no multiwallet backend, login migration or activation is claimed. Changes during a read discard private output; changed membership invalidates old cursors. Root must coordinate the #267 provider before admitting account-wide history. Verified linked-chat runs qualify only if an existing producer persisted owned attribution/claim; this code does not infer chat ownership or create a new linking architecture.

Pagination orders descending `(createdAt,id)` with a first-page upper anchor and an owner/membership/origin/network/filter binding. Basic surface/date/literal case-sensitive question search execute through the existing SQLite/Supabase ownership port; privacy, recorded receipt network and settled payer cohorts filter the owner-authorized projection. Each request retrieves at most 51 candidates per admitted wallet, scans at most 50 and returns at most 50 rows / 1.5 MB of row JSON. An empty filtered page can have `nextCursor` and `scanLimited:true`. Clients continue rather than treating it as end-of-history. This is not a snapshot: backdated insertion or a later claim can affect later pages. Cursors do not grant authority even if modified.

Receipt projections select only bounded financial fields after owner proof (201 rows to detect the 200-row display bound). They exclude journal rationale, nonces, grant/session bindings and prepared/cancelled-unexposed originals. `networks` comes from recorded receipt network fields; no-receipt/unsupported values are unknown, and `storeNetwork` only labels the deployment. `paid`, `sponsored` and `mixed` describe recorded **settled receipt payer** cohorts: current member payer versus other verified-address payer, never budgets, allocations, pending authorization, service affordability or free service. Offline runs cannot claim settled spend. Missing, malformed or truncated receipt evidence yields unavailable amounts/unknown funding rather than fabricated zero. Own and other-payer amounts use exact safe integer micro-USDC sums, never rounding. `paidCreators` intersects cited source IDs with settled citation receipts and preserves their references. Inbound price, creator payment, allocation and pending states are not conflated.

Row actions read the unchanged stored report through `/api/me/asks/{id}`, bounded receipts through `?format=receipts`, and BibTeX/RIS/CSL through the existing reference serializer. Questions, answers, quoted evidence, canonical stored receipts and financial originals are never rewritten. CSV alone neutralizes formula-leading text and quotes cells. Whole-history exports walk at most 20 pages / 1,000 rows / 2 MiB of row JSON, with `complete`, `truncated`, `nextCursor`, bounds and qualifications. Completeness is within admitted current-store metadata, not absent claims/membership, all archives, full reports or unlimited receipts. CSV includes a metadata row even if no runs match. Resume JSON export with the returned cursor and identical filters.

Source admission still requires ordinary privacy/claim schemas, enabled and admitted capabilities, and a reviewed #267 membership provider for account-wide coverage. Existing production privacy and claim flags are unchanged; this source performs no DDL, backfill or activation. No payment, provider, model, scheduler or custody authority changes. Root owns independent review, aggregate/domain/package/browser validation, main merge, combined release/distribution and original issue closure.

Focused tests cover real isolated SQLite ownership/claim/privacy/key revocation and mocked Supabase RPC/financial projections, multiwallet consumer semantics, exclusion, stable pagination, filters, empty scan continuations, CSV and exact original preservation. Mocked Supabase is not live PostgreSQL evidence. Native test-worker/build constraints and exact actual check results belong in the delivery receipt; source acceptance alone is not production completion.

Merge coordination: additive `KeryxDB.historyMembership`, optional `PersonalHistoryStore.receipts`, small MCP registration changes and private Next header patterns need to compose with other workers. New English copy is in the independent `ownedHistory` namespace (`locales/en/owned-history.ts`); it activates no new locale. Public `/u` profile publishing and replay/run-agent/report decision code are untouched.

## Read-race corrections

Remote owned-history handlers require a request-local current key/wallet/history-scope verifier
after their awaited read/export. The credential remains in the authenticated HTTP closure;
missing or changed authority refuses private output without cookie fallback or extra usage.
Pages recheck retained rows' current owner, erased state, privacy revision, visibility and
original question after receipt IO. Bounded exports also fence all accumulated rows and the
initial membership revision before returning. Observed changes refuse the cached output;
this does not turn the current-store export into a transaction snapshot.

The web starts on the existing ledger. Owned history is an explicit opt-in, so privacy OFF
keeps its old default while explicit v2 still fails closed without admitted capability.
The optional membership consumer remains unbacked by a real #267 producer; these corrections
add no activation, schema, financial mutation or account-wide ownership claim.

## Current-main convergence and hosted acceptance wiring

The normal merge of accepted main `9cc54ec6` into reviewed history `e89f8ffe`
preserves both parents. Only remote and stdio MCP files join contributions:
generated research-presentation labels coexist with the unchanged strict owned
history schemas, request-local current-key fence and fixed key-only HTTPS bridge.
Presentation language is not a history filter, ownership grant or stored answer
language. Privacy/claim feature flags remain OFF; the prior session ledger stays
the default and explicit v2 still refuses absent admitted capabilities.

The existing hosted built-stdio history check now covers v2 read/export,
revocation refusal, forbidden owner/language selectors and credential/custody
exclusion alongside all v1 assertions. It uses the real built package with fixed
synthetic HTTPS responses, not an actual backend or publication receipt.
The existing isolated network-none PostgreSQL privacy check now composes the
actual ordinary Supabase ownership/privacy/receipt adapters with the shared v2
reader/export. It checks claimed and recorded owners, foreign exclusion, exact
micro-USDC, receipt-I/O erasure, financial retention and enrolled-store refusal.
All DDL and claims in that check belong to its already owned synthetic container;
no production schema authority or membership producer is added.

Hosted Chromium checks the actual history components with production CSS after
a successful stock BUILD_ID: legacy default, unavailable versus empty, paging,
safe original text, exact recorded amount, report/export, synthetic revision
mutations, wallet-switch stale response isolation, signout and phone width.
The fixture uses synthetic auth/transport with every unexpected request blocked;
it does not establish actual Next routing, backend admission or customer delivery.
Local stock build is not retried to work around the retained QA junction.

These are source-wired gates, not passed hosted acceptance. Root owns the final
canonical source epoch, exact-head aggregate/build/domain/package/browser CI,
independent combined review and delivery. Current-source local check results and
native signal/EOF qualifications belong in the convergence handoff. Original
#268 remains open: recorded all-surface attribution and a real stored multiwallet
provider remain capability gaps; synthetic membership fixtures are not that
producer. The original criteria and actual deployment/distribution acceptance
remain separate from source convergence, with no new paid or human trial gate.

## Portable Unicode validation for Desktop

The Desktop compiler declares ES2022 libraries. Owned-history bounded text now
uses the existing pure `isWellFormedUtf16` helper, already used by personal
history v1, instead of requiring the ES2024 String method. UTF-16 length bounds,
NUL rejection, malformed/lone-surrogate refusal, closed schemas and original
text/receipt/micro amounts are unchanged; no normalization or compiler-lib
waiver is added. Differential boundary tests use native validation only as the
pinned Node24 test oracle. Fresh exact-head Desktop/aggregate CI remains required;
this correction grants no privacy activation, membership, delivery or closure.

## Recovery of the observed PR427 CI failures

The ordinary recovery checkpoint retains all nine session-fence/CLI/CSV files,
then composes accepted main `ec5f39c9` without changing its version, OpenAPI or
whole study inputs. Remote and stdio discovery expectations retain both owned
history tools and incoming evidence procurement. Missing surface provenance uses
the existing English unavailable label; it does not invent a known surface.

Vite's asset `BASE_URL` is `/`, and Vitest copies that value to `process.env`.
The isolated history and sponsored-admission fixtures now pin canonical server
origins, allowing their scope and credential-race checks to reach private IO.
The runtime origin schema and authorization fences remain unchanged. The
synthetic browser fixture replaces both optional public registry environment
references, matching the existing browser fixtures; its original missing
substitutions were reproduced as `process is not defined` before first render.
Render failures now expose the captured fixture errors before the timeout.

Focused local checks cover the affected history/auth/MCP cases and genuine CLI
help startup. A render-only diagnostic proves that startup correction, without
production CSS or route/backend acceptance. Fresh combined-source required CI,
PostgreSQL, built browser, stdio package and Desktop acceptance remain gates.
Root retains merge/release ownership, and original #268 remains open.
