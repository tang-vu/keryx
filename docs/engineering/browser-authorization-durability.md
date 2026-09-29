# Durable browser x402 authorizations: M3/M4 design proposal

**Status:** design for review, 2026-09-29. No code, migration, network switch, or funded
operation is authorized by this document. The deployed TypeScript testnet path remains
authoritative. This proposal addresses the unindexed signed-authorization gap recorded in
[D-261](../../DECISIONS.md) and the [M3/M4 release gates](../mainnet-delivery-plan.md#mainnet-release-gates).
It does not mark either gate complete; see the [dated readiness evidence](./mainnet-readiness-2026-09-29.md).

## Current boundary and failure

`BrowserCoSignGateway` obtains a 402 challenge, calls `reserveSpend`, then emits an SSE
`sign-request`. The browser generates the EIP-3009 nonce in `lib/x402-client-sign.ts` and
posts the bearer header to `/api/ask/sign`. The gateway may submit the header before
`run-agent` calls `recordPayment`. That later write is caught as an alert so the answer
can continue. A crash or failed write in this interval leaves held grant capacity and
possibly settled funds without a durable nonce-indexed payment for reconciliation.
The Supabase adapter now propagates returned payment-insert errors, but that detects
the failure; it cannot reconstruct a nonce lost before insertion.

The server currently checks challenge network, asset and Gateway contract in
`lib/payments/x402-payment-evidence.ts`. That is not an independent browser guard:
`PaymentRequirementsInput` in `lib/x402-client-sign.ts` omits `scheme` and `asset`, accepts any
parseable `eip155` chain ID, and copies the challenge's EIP-712 name, version and
verifying contract into the signature; it also uses the challenge's authorization
timeout without an independent browser bound. `lib/hooks/use-ask-stream.ts` checks cap,
payee and offer context but does not pin those chain/domain fields or compare the
active wallet account with the intended session signer before signing. Adding
those browser checks is **new implementation work** in this proposal.

The existing `payment_events` pending row and Circle reconciler are the intended recovery
authority. Circle's search has no nonce filter, so the reconciler scans bounded pages and
matches the nonce plus payer, payee, network, token and exact amount. It releases browser
capacity only on an exact terminal Circle failure against the original grant epoch.
An absent transfer, local authorization expiry, server withholding submission, HTTP
failure or client disconnect is not terminal evidence. These rules remain in force.

## Proposed invariant and state machine

For every browser sign request that can reach a signer, a durable row keyed by a unique
nonce and the matching cap reservation must already exist. No paid HTTP retry may start
unless that row remains readable and bound to the exact challenge, signer and grant epoch.
The server never persists the bearer header or session private key. All monetary fields
are stored in integer micro-USDC; display conversion happens outside admission.

Use `payment_events` as the nonce-indexed recovery row, with a separate
`authorization_phase` for the signing/submission lifecycle. Its settlement status is
`pending` until independent proof promotes it to `settled` or `failed`. The phase prevents
a prepared but unconfirmed signature from being described to the user as signed.

| Phase | Durable meaning | Permitted next step | Cap release |
| --- | --- | --- | --- |
| Absent | No row and no reservation | Atomic admission | None needed |
| `prepared` | Exact nonce, challenge and cap committed; SSE exposure has not begun | Atomically mark `exposed`, or cancel before any exposure | Only one atomic compare-and-set cancellation while still `prepared` |
| `exposed` | Marked durably **before** SSE send is attempted; browser may sign even if delivery/ack is lost | Validate and record a matching signed header, or retain for reconciliation | No timeout/abort release |
| `signed` | Exact EIP-712 signer/header checked and signed `validBefore` stored; header itself is not stored | Mark `submission_attempted` before paid retry, or withhold and retain | No local release |
| `submission_attempted` | A paid retry may have reached the seller/Circle | Receipt or independent Circle reconciliation | No local release |
| `settled` | Valid Circle settlement evidence bound to the original economic tuple | Report settled; retain row | Reservation counts as spent |
| `failed` | Exact Circle terminal failure bound to the tuple | Release only against the captured grant epoch | Atomic terminal transition releases once |
| `cancelled_unexposed` | CAS from `prepared` proves SSE exposure never began | Audit only | Atomic cancellation releases once |

`prepared -> exposed` is a durable transition before invoking the SSE send callback.
If the process dies between that transition and actual delivery, the row may remain
conservatively held. Treat that as a visible recovery case, not permission to infer
that no browser signature exists. Every transition is idempotent and conditional on
the row's prior phase/status and immutable identity. Neither retry nor recovery
allocates another nonce for the same admitted purchase. The query/answer may continue
with a skipped source while its payment remains pending.

## Admission, signing and submission

1. Check the source-owned payee and exact 402 requirements before admission. Generate a
   cryptographically random 32-byte nonce on the server. Bind `reqId`, session ID,
   captured grant epoch and signer, chain/network, token, Gateway signing contract,
   source/offer identity, kind, payee and exact amount to the row. Use a stable
   `x402:<nonce>` payment ID and enforce nonce uniqueness. Do not store a fabricated
   `validBefore`: it is unknown until the browser actually signs.
2. In **one database transaction**, verify the live matching grant and cap, increment
   its reserved/spent amount, and insert the `prepared` pending row. Any refusal or
   database error rolls back both effects and prevents SSE emission. Read-back or
   transaction completion must establish admission before signing can be requested.
3. Durably mark `exposed`, then emit the SSE sign request carrying the server nonce
   and immutable challenge context, including `asset`. Arm the scoped in-process
   response slot before SSE send so a fast callback cannot race slot creation.
   Before signing, extend the browser request type and checks to require `scheme`
   and `asset`, and compare the challenge with **browser-held expected values independent of
   this SSE payload**: scheme `exact`, the exact active Arc `eip155` network/chain
   ID, the USDC token address, the bounded authorization lifetime, EIP-712 name
   `GatewayWalletBatched`, version `1`, and the intended environment's
   GatewayWallet verifying-contract address. Obtain these expectations from a
   reviewed browser build/configuration, and the intended signer from the browser's
   local grant/session snapshot created at grant registration or recovery, never
   from the sign-request being checked. The current deployment remains pinned to
   Arc testnet; mainnet values require separate M1/M2
   approval and build/configuration. Reject missing, malformed or merely parseable
   alternatives rather than deriving the expected domain from the challenge.
   Compare `walletClient.account.address` with both the locally held intended
   session signer and the captured grant signer before invoking the signer. Retain
   independent price/offer, source-owned payee and cap checks; require the source
   identity and authority rather than falling back to cap-only signing during a
   rolling deploy. Validate the nonce's exact bytes32 format and sign that nonce;
   never silently generate a replacement. The server must reject a returned
   nonce or economic-tuple mismatch as a separate defense.
4. `/api/ask/sign` loads the original row by `sessionId + reqId`, checks the bounded
   header shape and exact persisted challenge, and recovers the EIP-712 signer against
   the pinned domain. A valid header is not settlement evidence. Persist the exact
   signed expiry and `signed` phase before acknowledging or resolving the live
   in-process promise. A duplicate identical callback is idempotent; a conflicting
   callback is rejected and alerted. If the grant was revoked or replaced, record
   a valid old-epoch signature for recovery but withhold submission. The sign route
   must not create a new grant or select a treasury signer.
5. Before passing the header to paid `fetch`, durably mark `submission_attempted`.
   A failed state write blocks submission; the existing row remains pending. An
   in-process promise is only a delivery mechanism, never payment authority. A
   callback reaching another instance may update the durable signed phase but must
   not initiate an unsupervised retry when the original SSE worker is gone.
6. A seller response with valid Circle settlement proof, including paid-but-undelivered
   HTTP errors, promotes the same row by compare-and-set. A lost response, invalid
   receipt or local exception leaves it pending. `run-agent` must stop inserting a
   second browser payment row; it reads/updates the admitted row for display and
   origin attribution. Promotion write failure leaves the preexisting pending row
   reconcilable and raises an operator alert.

The final grant check before submission is advisory after exposure: revocation can
race with HTTP send and cannot revoke an already signed bearer authorization. The
database row and held cap survive either ordering. The browser should show the
original authorization as uncertain until a receipt or reconciliation resolves it.

## Database contract and migration

Add one adapter operation such as `admitBrowserAuthorization` that returns the
durable row or a typed cap/grant refusal; it must never report success with only
one side of the reservation/row pair committed. Add conditional phase and terminal
transitions keyed by row ID, nonce, grant epoch and immutable economic tuple. Use
unique constraints for `id`, `(network, token, payer, authorization_id)` and the
scoped request identity. Reject a duplicate nonce even when `recordPaymentOnce`
would otherwise ignore it; duplicate-ignore is not a proof of matching admission.

- **SQLite:** use `BEGIN IMMEDIATE` around epoch/signer/expiry/cap checks, exact
  micro-USDC reservation and pending-row insert; commit or roll back together.
  Validate the configured WAL/synchronous durability policy and reopen the file
  after process termination in tests. A process-kill test does not prove power-loss
  persistence. Conditional signed/phase/terminal updates and grant release must
  also be transactional.
- **Supabase/PostgreSQL:** use a service-role-only SQL function for the same atomic
  admission. Lock the matching grant row, validate cap and expiry, insert the unique
  intent and update reserved spend in one transaction; any conflict or exception
  aborts it. Revoke public/anon/authenticated execution. Return a typed outcome,
  and propagate both transport failures and returned `{error}` values. Implement
  conditional terminal/release transitions inside one transaction, with the same
  epoch and signer fence as D-261.
- **Money representation:** migrate new grant-cap, reservation and payment amounts
  to integer micro-USDC (or exact PostgreSQL `numeric` constrained to integral
  micro-units) and compare those units in the transaction. Validate conversion of
  existing decimal rows without silently rounding a live cap or held amount;
  retain a separately audited legacy path until conversion is proven.
- **Migration:** add phase and binding columns/indexes without relabelling legacy
  pending rows. Backfill old records as `legacy_unknown` with their existing exact
  expiry when present; never infer a missing expiry or signature. Deploy the
  database schema/RPC before routing any browser request to the new writer. During
  a rolling deploy, disable new browser signing or route consistently to one
  compatible version; an old browser generating its own nonce must not be accepted
  by the new admission path. Keep old rows reconcilable. Test rollback against
  already admitted rows; do not roll back to a writer that cannot preserve them.

## Cancellation, reconciliation and operator recovery

The only automatic local release is `prepared -> cancelled_unexposed`, performed
atomically before exposure begins. Once the row is `exposed`, a sign timeout,
disconnect, missing `/api/ask/sign` callback, malformed callback, revoked grant,
local expiry or no Circle search match retains both row and cap. A malformed header
does not prove that the browser never produced another valid one. Exact Circle
terminal `failed` evidence may close the row and release capacity once, only while
the original grant epoch and signer still match. Circle `received`/`batched`/
`confirmed`/`completed` or a valid seller receipt promotes the row to settled.
Never turn a pending row into failed on elapsed time alone.

Reconciliation must include `exposed` rows with no known signature: they have a
known nonce and economic tuple and may have been signed despite lost callback.
Continue bounded cursor traversal and exact tuple matching. Alert separately on
old `exposed` rows, old `signed`/`submission_attempted` rows, search exhaustion,
and write/alert failures. Preserve an operator-visible list with nonce, age,
grant epoch, amount and last evidence; redact the header and private research
content. If Circle supplies no definitive result, mark the case unresolved for
human support. A user-initiated new session must not silently erase old exposure
or count the held amount as available; require distinct signer/balance treatment
or an explicit cumulative-cap policy across epochs. A safe, finite recovery policy
for indefinitely unresolved exposed authorizations remains a separate M4 decision.

## Acceptance and open risks

Focused release-candidate checks must cover:

1. SQLite and PostgreSQL concurrent admission at the last micro-USDC of cap,
   duplicate nonce/request, grant replacement, insert failure and transaction
   rollback; no sign request is emitted after failed admission.
2. Browser rejects missing/wrong `scheme` or `asset`, alternate or noncanonical
   Arc network strings (including parseable suffixes), wrong chain ID, EIP-712
   name/version, GatewayWallet verifying contract, out-of-policy authorization
   timeout, or a wallet account different from the intended session signer/grant.
   Each rejection must occur before `signTypedData`
   and before posting a header. Its expected values must come from a browser-held
   configuration/grant snapshot, not the SSE challenge being checked. Also reject
   wrong payee, price, offer, source authority or nonce. Server independently
   rejects a mismatched or invalid EIP-712 header before acknowledgement or paid
   fetch, even if the browser checks passed.
3. Kill/restart at each boundary: before admission commit, after commit but before
   exposure, after exposure before sign callback, after valid signature before
   its metadata write, before paid retry and after paid retry before response.
   Every possibly signed case retains a nonce-indexed row and held capacity.
4. Disconnect, timeout, stale callback, replacement/revocation and multiple server
   instances leave one original row, no treasury fallback, no duplicate retry and
   no unsafe release. Verify `prepared` cancellation releases exactly once.
5. Exact Circle success/failure, mismatched tuple, no result, incomplete pagination,
   Circle outage and paid-but-undelivered response drive correct terminal/pending
   states and epoch-bound release. Restore a database snapshot and reconcile
   without creating a new authorization; exercise alert delivery to the operator.
6. Browser and operator UI distinguish reserved/possibly unsigned, signed pending,
   submitted pending, settled and failed states. A completed answer is retained
   when one payment or ledger transition fails. Testnet funded drills and
   independent security review are required before M3/M4 acceptance.

The principal residual is conservative capacity lock: a request marked exposed
may never have been signed, while the server cannot prove that from a missing
callback or Circle search absence. Keeping the cap held is the safe current
choice, but it can block use indefinitely. A compromised browser/session key,
same-user replacement of a funded signer, compromised server, database loss
outside backed-up recovery, or Circle evidence outside the bounded search window
also needs the broader M2/M3/M4 threat review. This document makes the unindexed
window closable in code; it supplies neither that implementation nor mainnet
authorization.

Independent browser pins defend against a malicious or malformed SSE challenge
under an honest loaded browser build. They do not protect against a server that
also serves compromised JavaScript or against XSS controlling the session worker;
those remain signer-custody and deployment-integrity risks for M3 review.
