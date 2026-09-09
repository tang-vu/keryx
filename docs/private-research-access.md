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
