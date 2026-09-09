# Private research access and payer history

September 9, 2026. Account history is implemented in v0.22.30; private-result mode is
not implemented or advertised as available. This work advances B2/M6 without replacing
the full acceptance map in `mainnet-delivery-plan.md`.

Protocol foundation added after v0.22.30: `lib/buyer/private-request-commitment.ts`
provides shared canonicalization, secure fresh salt generation and nonce verification.
It has no route or signing/submission integration. The reserved private resource is
not a supported endpoint. Existing requests, nonces and journals are unchanged.

The [ERC-3009 specification](https://eips.ethereum.org/EIPS/eip-3009) includes the
32-byte nonce in the signed authorization. [Circle's SDK reference](https://developers.circle.com/gateway/nanopayments/references/sdk)
describes its EIP-3009 payment payload. The installed batching SDK 2.1.0 client defines
that nonce as bytes32 and normally generates it randomly. Using a salted request hash
is Keryx's proposed application binding, not a Circle-defined privacy feature or a
claim of live facilitator acceptance.

The commitment covers the private policy, exact normalized question, package contract,
model choice, resource, network/token/Gateway domain and transfer terms. Unknown fields
are rejected. Question edge whitespace follows the existing question parser; Unicode
content otherwise remains exact. A fresh 32-byte salt keeps repeated requests distinct.
Salt and request must remain private: hashing is not encryption or an access-control
mechanism. Never recompute a fresh nonce when recovering an existing paid intent.

Offline tests use an ephemeral in-memory signer to show that changing the request and
recomputing its nonce invalidates the original typed signature. A fixed vector agrees
across Node crypto, Web Crypto and actual Chromium; mutation checks cover the bound
fields. No live authorization was submitted. Server admission before payment, durable
first-writer/replay rules across old and new endpoints, private storage and recovery,
facilitator verification, public-output filtering and independent review remain open.

### Local signature verification and merchant policy (not routed)

`lib/a2a/private-request-verification.ts` now verifies the complete committed request
and its EOA signature against an independently supplied server quote and merchant
policy. Its strict submission shape does not accept client `accepted`, `requirement`,
resource or payer overrides. The payer is derived from the verified authorization.
Errors return null without logging private request or payment data. Verification is
offline and preserves original signature evidence after expiry; it is not a check
of current validity, Gateway balance, nonce use, settlement or account access.

Fresh buyer authorization creation now requires trusted private and public research
merchant addresses and rejects equality (case-insensitive), missing/invalid addresses
and a quote paying another merchant. No merchant has been created or configured yet.
The canonical nonce vector and all legacy journals remain unchanged. Real ephemeral
EOA tests cover request changes with recomputed nonces, substituted payer/signature,
wrong signing domain/chain, authoritative quote mismatches and malformed policies.
Chromium also verifies rejection of colliding merchants before authorization creation.

In v0.22.31 the shared public seller guard rejects configured reserved recipients on
research, source/article and citation paths before facilitator verification or
settlement. The unused legacy seller wrapper also applies the guard. It checks the
quoted payee and signed authorization `to`; changing/stripping unsigned resource or
discovery metadata cannot bypass it. With reservations active, malformed or missing
authorization recipients are rejected before reaching the external verifier.

The server-only `KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES` setting is a comma-separated
list of up to 32 current/retired merchant addresses. Addresses are normalized; invalid
configuration, an absent valid public merchant, or collision with `SELLER_ADDRESS`
fails public admission with 503. Reserved payees return 403 without a payment challenge
or receipt. Ordinary public payees retain their existing behavior. No private merchant
has been provisioned: the empty default preserves public-only operation and is **not**
permission to enable private quotes. Future private admission must require a nonempty
validated reservation set containing its merchant. Keep the set through rotation and
backup recovery; never repurpose a reserved merchant as a public creator.

Offline signed adversarial tests cover full SDK and inner browser payloads, unsigned
metadata replacement, current/retired and case-variant payees, malformed recipients,
invalid/colliding configuration and the legacy wrapper. They assert zero facilitator,
producer and payment-record calls on denial and preserve public payment behavior.
Changing the signed recipient invalidates the original EOA signature. These tests do
not establish private execution, storage confidentiality end to end or live settlement.

Integration must derive first-admission pricing from server policy and persist the
accepted quote and access policy atomically before work or external side effects.
Retries must use those immutable original terms, not today's fee configuration.
Authenticated result recovery still needs a live payer session; possession of a signed
submission is not a login credential. The facilitator remains the authority for payment
verification/settlement, and ambiguous outcomes must remain recoverable. Funding the
private merchant and creator-spend execution also require an explicit bounded design.

### Durable private intent storage (not routed)

Both adapters now support a separate `private_research_intents` table. Reservation
preparation verifies the EOA signature and commitment before deriving a `prv_` ID from
the network/payer/payee/nonce tuple under a private-specific identity domain. It copies
trusted quote/policy inputs before awaiting cryptographic work. The durable document
holds the normalized request, original salt, payment authorization/signature, quote
and merchant snapshot. These are sensitive records; hashing the ID does not encrypt
their contents. Existing backup and service-role/operator trust boundaries apply.

Insert-on-conflict-do-nothing plus validated readback retains the first writer.
Conflicting policy snapshots are refused, and neither changed questions nor corrupt
identity/owner data can pass revalidation. Lookup requires an explicit payer predicate;
the future route must derive it from a live authenticated session rather than a URL or
submitted wallet. No raw intent lookup is exposed over HTTP. Signature evidence remains
available after expiration without implying that a new payment would be valid.

SQLite creates the isolated table/index and rejects updates with a trigger. PostgreSQL
migration `0046_private_research_intents.sql` enables RLS, revokes client table access,
and gives `service_role` only insert/select. Application deletion/retention is deliberately
not implemented by this migration. Neither adapter writes reservations into public
`query_runs`, `a2a_orders` or `payment_events`. This is a reservation only, never a paid
order, receipt, runnable job or metric of successful payment. No production caller uses
these methods, and the migration has only been exercised in disposable local databases.

Validation: actual SQLite tests use two connections, duplicate/conflicting reservations,
owner isolation, corruption, public-table absence and reopening the database. Supabase
SDK tests inspect bound owner/ID queries and ignore-duplicate writes and reject outage
or missing/corrupt readback. `scripts/check-private-research-intents.sql` was executed
against disposable PostgreSQL 17 after migration 0046: first-writer retention, scoped
selection and actual public-read/application-update/delete privilege denial passed.
It contains synthetic SQL data, not a live signature or facilitator payment proof.

Execution remains a separate integration step. `runAgent` currently sends the question
to citation notification dispatchers before saving the final run. It also calls
`saveMemory`, which persists question-derived topic tokens, source scores and the query
ID into shared `query_memories`; subsequent research consumes those shared records.
Private jobs must not feed public/shared learning or outbound question-bearing
notifications without an explicit policy. Filtering the final saved answer alone is
insufficient, even when private intent storage itself is isolated.

### Private payment submission journal (not routed)

`private_research_payment_attempts` is separate from the immutable intent and public
payment ledger. A validated owner-bound intent must exist before a single insert can
claim the submission boundary. The winning caller receives `claimed: true` only after
readback confirms pending state. Lost readback throws; another caller, a restarted
process, or an already-confirmed readback cannot authorize another submission. A marker
can precede actual network I/O, so pending means **possibly submitted**, not proof that
Circle received anything. Elapsed signature validity does not change this state.

The internal confirmation envelope identifies the original network, payer, payee,
integer amount and nonce plus a facilitator reference. It is not Circle's wire format
and its `source` label is not evidence by itself. Future backend transport may construct
it only from an actual trusted successful facilitator call associated with the exact
original request. It must never be taken from an HTTP client body. No code invokes
Circle through this new journal yet, and no real private settlement has been recorded.

Confirmation updates only an existing unconfirmed attempt. Validated readback is
required to report journal success. Exact retries preserve the first timestamp and
reference; competing references fail without replacement. The state getter also checks
the intent's signed ownership and validates persisted confirmation fields. A reference
is a facilitator settlement acknowledgement, not invented on-chain finality. Transport
must retain any observed actual receipt even if a database write/read subsequently
fails; this database API alone is not a paid-response handler.

PostgreSQL migration `0047_private_research_payments.sql` permits application reads and
restricted owner-scoped transition RPCs only. The functions use a fixed empty search
path, qualified tables, and compare confirmation terms with the original intent.
Anonymous/authenticated clients cannot read or invoke the RPCs. SQLite uses a unique
intent key and insert/update compare-and-set operations. Neither path creates public
payments, queues work, refunds, clears reservations, or infers failure on expiry.
Private reconciliation, exact terminal failure handling, network submission, merchant
provisioning/admission validation, worker execution and authenticated result delivery remain open.

Validation uses synthetic data, not live payments: SQLite covers two-connection claims,
restart/expiry persistence, missing pre-submission boundaries, owner/tuple mismatch,
idempotent confirmation and conflicting references. Supabase SDK checks require
readback even after RPC success and deny submission if readback has already settled.
The disposable PostgreSQL 17 check `scripts/check-private-research-payments.sql`
verifies actual transition semantics and privilege denial after migrations 0046/0047.
Backup/restore procedures must preserve both private tables and reconcile potentially
lost submission state before reopening private payment traffic; do not clear these
records with login-session cleanup. That full operational drill remains unperformed.

### Agent effects boundary (internal integration work)

The core orchestrator now resolves one complete server-owned `ResearchEffects`
strategy before reasoning or funding. It routes payment recording, cache access,
external discovery, decision memory, memory saving, citation notifications, operator
alerts and activation through that strategy. `collectRun` uses the same strategy for
the final result write after its durable save checkpoint. Source/catalog/offer reads
retain their existing authority. Normal callers select the historical public behavior.

An explicit strategy must provide every handler. Missing handlers never fall back to
public storage or notification code. A job scope must match the current query ID;
reserved `prv_` IDs reject both omitted strategies and explicit public strategies.
These checks happen before the model or gateway is called. Scope is a consistency
check, **not** authentication or a proof that arbitrary supplied handlers are safe.
Strategies are backend code dependencies, not JSON request fields. No private effects
factory or production private execution path has been enabled.

Synthetic orchestrator tests exercise a full collected answer with one cached source,
one paid source and bounded citation rewards. All shared DB write/cache/memory/notify
methods are poisoned, while the explicitly scoped test sink captures effects and the
result. Missing handlers, mismatched scope and accidental public defaults are denied
before reasoning/funding. A selected ledger failure still retains confirmed synthetic
payment evidence in the completed answer. Public collection and checkpoint ordering
remain tested. These are hermetic control-flow checks, not live payments or an end-to-end
privacy acceptance claim.

The next private factory must bind authenticated payer/settled intent/worker claim to
isolated durable result and creator-payment stores, safe cache/memory rules and safe
notification/alert observers. A complete effects object alone does not provide these
guarantees. Gateway/provider SDK behavior and logging remain separate review surfaces.
The existing public SSE route also has its own public persistence/response contract;
do not turn it into a private route merely by injecting these effects. Full private
creator accounting, authenticated recovery and public-projection tests remain required.

## Implemented private execution admission boundary

`claimPrivateResearchExecution` returns a new backend worker claim only once for a
validated owner intent whose separate payment journal is settled. SQLite uses atomic
insert-select plus primary-key exclusion; Supabase uses a restricted service-role RPC.
The adapter verifies the signed intent and complete stored confirmation tuple before
claiming and again during successful readback. The RPC alone is not cryptographic
verification, and stored confirmation still requires trusted facilitator provenance.

Repeated claims return null. Another payer, absent/pending/corrupt payment, failed RPC,
lost readback or mismatched worker identity cannot authorize execution. A read-only
`getPrivateResearchExecution` supports backend diagnosis; reading an existing claim
never authorizes a replacement worker. This is not an expiring lease. Never clear these
records on restart, authorization expiry or database restore, because prior creator
payments may have happened. Lost-response cases deliberately require later evidence-
based recovery; automatic recovery and actual private execution remain unimplemented.

Validation includes two SQLite connections, database reopen with a far-future clock,
wrong payer, pending/corrupt payment, corrupt worker state, synthetic Supabase transport
failures, and real disposable PostgreSQL migration/role/claim checks using
`scripts/check-private-research-payments.sql` after migrations 0046?0048. These fixtures
are synthetic, unfunded and separate from public result/payment tables. They establish
claim behavior, not live settlement or end-to-end privacy. Worker IDs must stay out of
public and account projections. A future effects factory must bind its stores to the
fresh claim and preserve per-leg evidence before enabling any private paid flow.

## Implemented isolated result snapshots

`savePrivateResearchResult` accepts a backend `QueryRun` plus the intent ID, payer and
worker identity. It snapshots before asynchronous validation, checks the signed
question/budget/mode and ID, requires the stored settled-payment and worker claim,
and inserts into `private_research_results` without replacing an existing snapshot.
Repeated saves acknowledge only the exact first JSON serialization. A conflicting
serialization or missing/unavailable readback fails; it never authorizes rerunning the
agent. The application retains its in-memory result when deciding how to recover a
failed save. Automatic result-save recovery is not wired yet.

`getPrivateResearchResult` rechecks owner/admission and returns an opaque backend
`query-run-v1` snapshot and save timestamp, without a worker ID. Its caller must obtain
the payer through independent authentication. The stored text is bounded to 4,194,304
JavaScript string units at admission. Identity validation is deliberately distinct
from validating every optional result field, evidence quality or ledger totals: future
buyer projections and receipts must perform those checks. Neither a stored answer nor
its claimed totals are independent proof of settled creator payments.

The first-result policy does not add data to public runs, orders, payments, caches,
notifications or derived research gaps. It provides storage separation and database
privileges, not encryption from operators; approved backend and backup access still
sees the contents. No HTTP read/write endpoint is enabled by this storage change.

Tests cover wrong owner/worker, missing claim, request mismatch, concurrent duplicate
saves, conflicting overwrite, mutation during async verification, restart recovery,
corrupt stored identity and synthetic Supabase missing/conflicting/unavailable
readback. Disposable PostgreSQL checks after migrations 0046?0049 verify insertion
binding, first-result retention and denied client/direct service-role mutations.
The complete private effects factory, creator ledger, safe result projection,
authenticated browser/CLI recovery and end-to-end leakage tests remain outstanding.

## Creator submission transport hook (not connected)

The server x402 transport now accepts a backend-only `beforeSubmit` callback after
constructing the signed header and before sending it. With the callback present,
signer from/to/value must match the expected payment. The callback receives a frozen
non-bearer tuple (nonce, expiry, payer, payee, integer amount, network and asset), never
the header, signature, URL, question or rationale. The transport awaits admission;
a failed or lost storage acknowledgement cannot cause signed HTTP I/O or an automatic
retry. After I/O, normal receipt handling still distinguishes settled and pending.

Synthetic transport tests block admission to verify ordering, reject journal failures
and mismatched signed tuples, and retain pending evidence after a lost paid response.
This hook is not a journal implementation or a payment proof. It is currently unused
by production gateways. The private factory must provide atomic durable per-leg
admission bound to its verified job/worker and creator spend cap, then persist trusted
settlement evidence without erasing a receipt on storage failure. Reconciliation,
creator earnings projections and safe recovery remain required before private use.

## Implemented private creator admission storage

`admitPrivateCreatorSubmission` validates the authenticated-owner lookup and permanent
worker, then snapshots a strict non-bearer payment tuple plus source/article/kind.
Only a new durable insertion and exact readback return true. False or exceptions never
authorize signed HTTP. Same source/article/kind/payee is one economic leg within the
job; a different nonce cannot bypass that identity. Authorization nonces are also
unique across the private ledger. These are backend methods, not HTTP inputs.

The original signed creator budget caps the sum of all admitted integer micro-USDC.
Pending, expired and eventually settled amounts all consume this cap; this admission
slice has no release, retry or settlement transition. SQLite inserts conditionally in
one statement. Supabase locks the worker row before checking the sum; result saving
uses the same lock and admissions after a saved result are denied. The caller must
still validate the source's payout authority and the actual treasury signer. The buyer
and creator-payment signer are deliberately separate identities.

`listPrivateCreatorSubmissions` is owner-scoped backend recovery data, with worker IDs
and source attribution, not a creator/public response. It revalidates admission and
stored tuple/amount/leg identity. No public payment/feed/earnings rows are written.
The Supabase table permits service-role reads and only the restricted admission RPC;
clients cannot read or write it and direct application updates/deletes are denied.

Tests cover SQLite concurrent cap contention, economic-leg and cross-job nonce reuse,
restart/expiry, wrong worker/payer, malformed or bearer-bearing input, post-result
admission and Supabase missing/corrupt/unavailable readback. A synthetic actual transport
call waits for this SQLite admission and a fresh-nonce retry cannot resubmit a pending
leg. PostgreSQL migration/role checks live in `scripts/check-private-research-payments.sql`
after migrations 0046?0050. A disposable two-session PostgreSQL contention check admitted
only one of two 20,000-micro requests under a 30,000-micro budget. All fixtures are
synthetic and unfunded; none establishes real settlement or full private readiness.

No production factory connects this store to the gateway yet. Next work must persist
trusted settlement observations without erasing receipts on DB failure, expose safe
creator earnings, reconcile uncertainty and complete the isolated research effects
factory plus authenticated result recovery. A submitted tuple is never settled revenue.

## Implemented creator confirmation storage and journal adapter

`confirmPrivateCreatorSubmission` matches a backend trusted observation to the exact
admitted tuple and permanent worker under the intent owner. A separate first-writer
confirmation row retains the transaction reference and save timestamp. Exact retries
acknowledge it; conflicting references, missing admission, foreign owner/worker and
mismatched tuple fields cannot confirm. `getPrivateCreatorConfirmation` revalidates
owner/admission and stored tuple before returning backend data. These methods do not
accept public receipt envelopes, release creator capacity or reopen a worker.

`privateCreatorJournal` combines the admission callback with outcome persistence. It
admits at most one signed request, retains the observed attempt across DB failures and
reports `confirmation-unpersisted` without changing a settled debit into a failure or
losing a paid-but-undelivered receipt. The retained outcome can retry persistence only;
no signing or HTTP is performed by that retry. A pending observation remains pending,
and mismatched nonce/amount/expiry is returned for recovery without promoting storage.
Only trusted server transport results may enter this adapter; a source label and tuple
are not independent settlement evidence. Source payout authority is still the caller's
responsibility.

Synthetic integration exercises the actual server transport with a paid HTTP 500,
SQLite admission, a failed confirmation write and subsequent successful persistence,
proving one signing call and exactly one paid HTTP request. Other tests cover exact
retry/conflict, late confirmation after saved result, wrong owner/worker, corrupt data,
restart reads, pending/mismatched observations and Supabase write/readback outages.
PostgreSQL migration/RPC checks after 0046?0051 verify tuple binding, retained references,
unreleased budget and denied client/direct service-role mutation.

This is an internal adapter, not a production private research route. Recovery of a
receipt retained in memory differs from recovery after a process crash: the latter
still needs exact Circle reconciliation from the durable admission tuple. Historical
result snapshots remain immutable; future owner projections must combine them with
current ledger evidence rather than treating stale result counters as final settlement.
Creator earnings views, reconciliation and the complete effects/gateway factory remain
unfinished. No synthetic confirmation is included in public settlement or traction data.

## Implemented private creator search reconciliation

`reconcilePrivateCreatorSubmissions` is an owner-scoped backend operation over durable
admissions. It uses the existing complete paginated Circle search and exact economic
tuple matcher. Search inputs omit private job/source identity; requests contain no
payment signature. Existing confirmations are skipped. Newly matched evidence is
stored through the same owner/worker-bound first-writer confirmation method, with
`source: circle-transfer-search`, the Circle transfer ID and `transferStatus`.

Circle's [transfer documentation](https://developers.circle.com/api-reference/gateway/all/get-x402transfer-by-id)
distinguishes accepted/processing from on-chain confirmation and completion. Recorded
`received` or `batched` is not proof of on-chain finality. `transferStatus` is the first
observed stage, not a live status tracker. Existing confirmations are immutable; future
finality-aware user/creator projections must preserve that distinction. The
[search documentation](https://developers.circle.com/api-reference/gateway/all/search-x402transfers)
lists address/network/token/date/cursor filters. A September 9 read-only probe against
the deployed testnet `/v1/x402/transfers` endpoint returned HTTP 200 and a sample with
nonce and the required economic fields. Only field names/status were inspected in
output; no identifiers, signatures or new payment were published.

No match, duplicate/mismatched tuples, unknown status and search/storage failure leave
an attempt unresolved. An exact failed transfer is counted as `failedObserved` only;
this helper does not persist terminal failure, release capacity or initiate another
payment. Expiry is never failure evidence. Confirmation persistence failure can safely
retry the read-only search later. A limit of 1?100 records and a backend-only leg cursor
allow complete traversal; callers must follow `nextCursor` until `remaining` is zero,
then start a fresh scan on a later reconciliation cycle. Abort returns partial counts
and the continuation position. Never expose this backend cursor/summary as a public
research response without an explicit authenticated projection.

Tests include SQLite reopen recovery from a second Circle result page, source/job
metadata omission, accepted-stage retention, unchanged existing confirmations,
no-match/failed/mismatched/duplicate/unknown evidence, storage outages and bounded
continuation. PostgreSQL checks after migrations 0046?0052 reject absent/failed search
stages and retain search provenance under the restricted confirmation RPC. All
confirmation fixtures are synthetic. The helper is not scheduled in production and
private execution remains disabled; terminal failure handling and finality tracking,
creator earnings projections, the private effects factory and authenticated recovery
still require integration.

## Implemented private server gateway

The shared `ServerPaymentGateway` contains creator fetch/citation operations and their
existing source/article price, identity and receipt handling. Public `RealGateway`
retains its own legacy wallet and automatic-funding behavior. Private construction
uses `PrivateServerGateway`, which accepts an explicit signer/address, the private DB
journal methods, a job owner/worker context and a read-only balance callback. It does
not load/create a legacy spend wallet or send deposit/transfer transactions. Keys must
be provisioned through the environment-owned signer factory, which is not wired yet.

The gateway rejects another job before unsigned HTTP, checks prefunded balance in
integer micro-USDC and attaches `privateCreatorJournal` to both access tolls and
citation legs. Admission is awaited before signed HTTP. Receipt persistence is attempted
before returning delivery/payment results. A paid-but-undelivered or ambiguous result
keeps its payment evidence; a confirmation DB outage is explicitly marked for recovery.
A mismatched receipt cannot make paid content eligible. No question/rationale or job ID
is added to the outgoing payment request URL.

Tests instantiate this gateway without legacy wallets, exercise read-only prefunding
checks, wrong-job denial, actual server-transport fetch/citation journal ordering,
rejected admission and pending/paid-500 outcomes with confirmation outages. Existing
public treasury transport tests exercise the inherited operations without constructing
or funding a real wallet. All payment fixtures are synthetic and unfunded.

This is an internal gateway, not complete private execution. Its caller must validate
and freshly claim the job, provide the correct trusted signer/balance adapter, preserve
source/registry payout authority and install a complete private effects strategy.
A balance check is not a fleet-wide treasury reservation. Private merchant provisioning,
whole-job funding policy, safe creator/result projections, authenticated client recovery
and end-to-end leakage tests remain prerequisites for enabling private purchases.

## Implemented private research executor and effects

`runPrivateResearch` is a backend library operation. Its caller must authenticate the
payer independently and supply a trusted signer, address, balance reader and engine
factory. The executor derives the question, creator budget, depth, model and package
limits from verified stored intent; it never accepts replacement unsigned research
input. It requires settled incoming payment, returns an existing stored result or
already-claimed status, checks prefunding and acquires one durable worker claim. Only
the winner invokes the orchestrator with an explicit private gateway/effects strategy.

`privateResearchEffects` checks owner/worker consistency and keeps paid content in a
cache scoped to that strategy instance. Cache is cleared after successful result save.
Private jobs do not use shared query memory, reputation scoring, external marketplace
discovery, public activation counters or outbound citation/alert observers. Registered
verified sources remain discoverable through the normal source catalog. Suppressed
notifications/alerts are counted locally without retaining or transmitting payloads.
Payment observations are checked against private durable admission; settled observations
require matching saved confirmation. This observer never creates public payment rows
or promotes a caller-supplied settled flag. Confirmation outages remain visible through
the private run's trace and retained payment evidence. Completed runs go only to the
owner/worker-scoped private snapshot store.

A synthetic integration test uses signed immutable intent and real SQLite adapters,
two competing workers, the actual orchestrator/private gateway/HTTP transport, two
synthetic creator legs and saved-result replay. It verifies one reasoning execution,
one toll plus citation reward, both durable confirmations and no public cache, payment,
result, memory or notification method calls on either connection. Wrong worker,
unpaid/underfunded jobs, isolated cache instances and unbacked settled observations
are also tested. These are unfunded hermetic tests, not live customer settlement.

The library does not expose HTTP routes or create the production signer/model factory.
It is not proof that external model providers, their telemetry or other public routes
satisfy the complete private contract. Exceptions after a claim retain that claim for
recovery; they do not automatically rerun reasoning or release financial authority.
Creator earnings and live result/receipt projections must merge current private ledger
evidence with immutable snapshots. Private quote/payment admission, global treasury
funding policy, authenticated polling/history, browser/CLI journals, failure operations
and end-to-end public-projection tests remain required before private purchases open.

## Private spend read model (backend only)

`privateSpendView` returns a versioned owner projection from the verified intent and
current private incoming/creator ledgers. It does not parse research snapshots or use
their historical spend totals. Incoming price is distinguished from not-submitted,
pending and confirmed incoming payment. Creator amounts are integer micro-USDC strings:
committed = unresolved + processing + confirmed; uncommitted = budget - committed.
Processing means first-observed Circle `received` or `batched`; confirmed includes
facilitator success or first-observed Circle `confirmed`/`completed`. Per-leg evidence
source, stage and reference are retained, and chain finality is explicitly unverified.

These sequential reads may lag concurrent admissions/confirmations and cannot authorize
spending, refunds or account profit. Expiry never releases committed money. Uncommitted
budget is not a promised refund. Storage errors fail the read, rather than returning a
misleading zero. The explicit output allowlist excludes questions, answers, signed
payment headers, salts, authorization nonces, worker IDs and the private job identifier.
Source IDs and recipient addresses are owner-only data, not a public analytics feed.

SQLite integration verifies late confirmation after immutable result save, all supported
Circle stages, exact fractional-USDC sums, unchanged commitments after expiry, storage
outages and wrong-owner denial before ledger access. The caller still authenticates the
payer. No HTTP route or browser integration is enabled by this backend read model.

## Implemented account enumeration

`GET /api/me/jobs` requires a valid, unrevoked SIWE account session. The server derives
the payer from that session; query-string wallets, API-key identities, client labels
and cursor contents cannot choose the account. SQLite and the service-role-only
Supabase RPC compare normalized payer addresses and return a 25-row page plus a sentinel.
Ordering uses creation time then ID, both descending, so equal timestamps do not skip
rows and new head insertions do not shift an older-page cursor.

Only job ID, question if retained, status, timestamps, mode and package price appear.
Authorization nonces, worker IDs, raw request objects and result/receipt blobs do not.
Responses are no-store. An unavailable database returns 503 rather than empty history;
revoked identity returns 401. The UI clears another wallet's view on account changes
and ignores delayed responses after unmount. Selected job IDs stay in component state.

This list can recover the identity of an accepted job when its browser journal is
missing. Result inspection remains GET-only and follows the existing result contract.
It does not rebuild a pre-payment intent, authorize a retry, or prove that a server
receipt matches the originally signed purchase. Recovery files retain that role.
Sponsored playground runs and purchases paid by a separate agent wallet are distinct.

Validation: real JWT/SQLite route checks cover owner isolation, forged cursors, tied
timestamps, inserts between pages, missing saved results, revocation and outages.
PostgreSQL migration/RPC checks cover the same selection boundaries and public privilege
denial. Chromium covers authentication, outage/empty states, older pages, GET result
inspection, wallet switches with delayed responses, logout and mobile layout.

## Required private-result contract (not shipped)

New private paid research should be an explicit versioned contract with privacy
reviewed before payment. The verified payer owns access; another wallet, creator,
operator dashboard client or holder of a public job identifier must not gain result
authority. Do not quietly reinterpret historical public jobs or break recovery of
already accepted purchases. Legacy publication and receipt identities remain historical.

Before enabling a private quote, implement all of these together:

1. Bind visibility and owner authority into immutable request/order identity and
   persist access policy before any creator payment or external notification. Preserve
   authorization-keyed idempotency, exact spending caps and receipt/request binding.
2. Carry policy through admission, queued workers, recovery, saved runs and receipts.
   Missing or inconsistent private policy must deny public access, including the time
   before a QueryRun has been saved. Do not turn a secret-looking public ID into a
   substitute for authorization.
3. Give browser and CLI buyers authenticated recovery and account enumeration under
   the same verified payer. Version client journals and exports deliberately. Lost
   response, lost local state, revoked sessions and separate agent wallets must remain
   recoverable without resubmitting payment.
4. Filter every public projection and cache, including payment metadata and derived
   research gaps. Creator earnings remain available to the entitled creator, while a
   citation payment alone must not reveal the buyer's question or answer.
5. Apply policy before email/webhook transmission and provider/operator exports. Define
   retention, backup restoration, deliberate publication and deletion limitations.
   Never imply that previously public copies can be recalled.

## Observed implementation surfaces requiring coverage

- Dispatch pages, metadata, Open Graph images, direct JSON, receipts and freshness.
- Archive cache, topics, sitemap, feeds, related answers, parent/follow-up context.
- Recent runs, activity, raw payment feed and creator/portfolio exports.
- Creator performance cache, wanted board and automatically derived gap requests.
- Citation emails and webhooks: both currently include the question and dispatch URL.
- A2A polling/replay, worker and operator saved-run recovery; browser/CLI journals.
- SSE, copied evidence quotes, analytics/economics, logging and support/backup tooling.

The current public archive intentionally reads recent runs, and the payment feed
returns payment rows directly. Hiding navigation or adding a sign-in page would leave
those paths unchanged. Changing public access also requires cache invalidation and
review of previously generated/static content, not just authorization on fresh reads.

Acceptance requires unique synthetic private text and separate wallet identities tested
against every public route, cache, preview, export and outbound notification, alongside
successful entitled-owner reading and payment recovery. Static source searches and
account-history tests alone do not establish private-result readiness.
