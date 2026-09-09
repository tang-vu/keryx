# Private research access and payer history

September 9, 2026. Account history is implemented in v0.22.30; private-result mode is
not implemented or advertised as available. This work advances B2/M6 without replacing
the full acceptance map in `mainnet-delivery-plan.md`.

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
