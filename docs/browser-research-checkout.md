# Browser research checkout design

Status: design history with implementation updates, September 9, 2026. The original
proposal used baseline `35736f8`; later releases added checkout, funding and recovery.
Full acceptance belongs to B1/B2 in
[the delivery plan](./mainnet-delivery-plan.md).

Implementation progress, v0.22.17: receipt envelope/canonicalization now has a pure
shared core; Node retains synchronous hashing and the browser uses Web Crypto.
The existing decision panel checks digest/header and displayed job/answer binding.
The bounded JSON decoder is portable. This does not yet port buyer authorization,
deterministic order IDs, package fingerprints or original-request receipt verification.

Subsequent internal portability work now supplies shared request/challenge policy,
EIP-712 typed data, deterministic order identity and package definitions. Browser
adapters generate nonces with Web Crypto and verify journal/result/original-request
binding without importing Node configuration or filesystem code. Node synchronous
exports and old journal formats remain supported. Golden v2 IDs and Quick/Deep
fingerprints, 79 focused tests and a Chromium check against an archived pilot journal
passed. The subsequent v0.22.19 engine adds transactional browser persistence,
one-shot EOA submission and GET-only recovery. Wallet/deposit controls and the
checkout UI were still required at that release. The v0.22.21 workspace now exposes
review/signing for an already funded Gateway EOA and local history/import/export with
verified GET recovery. v0.22.22 added deposits, followed by a fresh owner-operated
browser funding/purchase/recovery pilot. v0.22.26 preserves acknowledgements across
browser/CLI recovery exports. Full B1/B2 acceptance, independent wallet/mobile use,
lost funding storage and authenticated server history remain unfinished.
See [UI evidence](./engineering/browser-checkout-ui-2026-09-09.md).
See [browser purchase engine evidence](./engineering/browser-buyer-engine-2026-09-09.md).

## Current implementation evidence

- `lib/buyer/client.ts` quotes without payment, creates an immutable local intent,
  signs once, persists the submission boundary, then submits once. Recovery uses
  GET only. It imports Node filesystem APIs and cannot be a client component dependency.
- `lib/buyer/policy.ts` pins the origin, resource, network, asset, Gateway domain,
  payee and amount cap. It depends on Node crypto and Buffer. `buyerJobId` imports
  `lib/a2a/order.ts`, whose SHA-256 input must remain byte-for-byte compatible.
- `lib/buyer/verify-result.ts` checks package, price, receipt digest and request/answer
  binding. Its receipt/package dependencies use Node crypto. Moving only the purchase
  function into the browser would lose verification or drag server dependencies in.
- `app/api/agent/ask/route.ts` keys durable orders by authorization and checks the
  original economic/request tuple on replay. This is a server recovery defense;
  the browser must not use it as permission to retry a bearer payment automatically.
- `use-session-grant.ts` and its signer worker support source-authorized playground
  purchases. That worker's registry authority is not a general treasury-payee allowance.

## Intended buyer journey and authority

The buyer enters an English question, selects Quick/Deep, reviews total price and
creator cap, connects their own wallet, and explicitly approves one package purchase.
Show the fixed-price/non-refundable terms and best-effort quality before signing.
An insufficient Gateway balance leads to an explicit deposit flow and a fresh balance
check; a native wallet balance alone is not proof of spendable Gateway funds.

Use the connected wallet's EIP-712 authorization for each purchase. No private key
is requested, exported, derived or passed to Keryx. This does not use the playground
session worker, extend its allowlist, or spend the server funder for the inbound fee.
The funded Gateway balance is the economic exposure; the displayed maximum is a
per-job limit, not a global allowance. Contract-wallet support must be separately
verified rather than assumed from an EOA signature path.

The deployed application supplies the trusted Keryx payee separately from the 402
challenge, displays it, and compares it to the challenge. The buyer trusts the
application deployment for this pin; it is not independent verification of the
merchant. Restrict production transport to the pinned HTTPS origin and reject
redirects. Local test origins need explicit test-only injection, never a query-string
override available to production users.

Recheck account, chain, request, total and payee immediately before signing. Verify
the returned signature matches the intended EOA before submission. A changed account
or rejected prompt must not advance to payment. Validate a fresh challenge against
the exact displayed accepted total, not merely any amount below a generous cap.
If it changed, show a new review step. Keep the CLI's existing policy compatible.

## Browser journal and failure containment

Use an IndexedDB transaction to create a unique intent containing normalized request,
checked requirement, authorization tuple and deterministic job ID before requesting
a signature. The persisted record must never contain a signature or private key.
Wait for transaction completion and read back validated state before proceeding.
Reject purchase when storage is unavailable or validation fails.

Use a compare-and-set transition in a read/write transaction for the submission
boundary. Only the tab that wins the transition may send the signed POST. A button
disabled in React or a BroadcastChannel alone is not a cross-tab lock. Do not allow
an imported journal to authorize a new submission. Signature bytes stay in memory
and are discarded after the one submission attempt.

| State | Authority and allowed next action |
| --- | --- |
| prepared | Local intent exists; no signature has been sent. A cancelled prompt is recorded. A fresh explicit purchase may create a new intent only before the submission boundary. |
| submission_possible | Committed before the signed POST. The signature may have reached the seller. Reload/timeout/tab crash permits GET recovery only. |
| acknowledged | Persist a validated seller-relayed payment acknowledgement if available, separately from job status. It is not independent Circle verification. |
| queued / processing | Seller job state; bounded GET polling can continue without a wallet. |
| completed | Verify the returned package, economics, answer and receipt locally before displaying a verified receipt claim. Research quality is a separate assessment. |
| not_found_uncertain / review_required / failed | Retain original intent and any payment evidence. Missing order, expiry or execution failure does not prove no debit or create a refund. |

The submission state is deliberately conservative: a crash after its commit but
before POST can leave an unpaid job uncertain. Do not trade this safety for automatic
double-purchase recovery. A timed-out receipt fetch is retryable by GET; payment is not.
Polling must stop at a bounded duration and allow an explicit resume of the same job.

Browser storage is not a permanent archive. Eviction, device loss and user clearing
site data can remove it. Offer a private recovery-file export and validate imports
against the same schema and deterministic ID. Explain the limitation before purchase
and provide a recovery export immediately after creating the intent. Imported files
are for lookup only. Local removal never cancels work, revokes an authorization or
deletes server data; present those meanings distinctly.

## Portability work before enabling checkout

1. Extract shared pure schema/domain/amount policy from Node nonce generation and
   header adapters. Keep existing CLI exports working and preserve its refusals.
2. Extract canonical JSON and deterministic order-ID input construction. Supply Node
   and Web Crypto SHA-256 implementations with parity fixtures for UTF-8, ordering,
   wallet casing and nonce identity. Do not change receipt canonicalization/version.
3. Split job/request verification from runtime hashing; provide equivalent browser
   receipt verification and bounded streaming JSON decoding without Buffer.
4. Implement journal storage and one-shot orchestration against injected signer,
   storage and transport interfaces. Exercise concurrency and crashes before wiring UI.
5. Add wallet/balance/deposit controls and the reviewed quote/sign/recover UI. Reuse
   existing deposit primitives only after tracing their signer/amount assumptions.

All shared client modules must exclude `lib/config`, Node filesystem/crypto and
server payment clients. A production build and browser network/runtime inspection
must prove the boundary, not just a passing TypeScript check.

## Privacy and remaining trust

Do not put job IDs, questions, receipts or journal data in page URLs, analytics,
public examples or Canteen. Current job/receipt retrieval uses possession of a job ID;
an opaque identifier is not wallet ownership authentication. Browser-local history
does not finish B2's server access-control requirement. Review that separate boundary
before representing the service as account-private or suitable for sensitive research.

Same-origin script can read local journals and request wallet prompts. IndexedDB
alone does not protect against XSS. The connected wallet still authorizes payment;
the website/merchant remains trusted for content and its ledger assertions. Receipt
integrity detects changed bytes and request mismatch, not independent settlement.

## Acceptance evidence required

- CLI regression suite stays green; browser/Node policy, order ID and digest parity.
- Wrong network/token/domain/payee, changed quote, malformed header, cap overflow,
  wallet mismatch/rejection and insufficient balance all prevent signed submission.
- Storage open/write/commit failure and two tabs racing one intent cannot produce
  two signed submissions. Reload/import never generates a new authorization.
- Simulated response loss before/after acknowledgement recovers through GET only;
  unknown order and pending payment remain uncertain. Receipt tampering fails closed.
- English UI tested on desktop/mobile with a fresh wallet, an existing job, interrupted
  job, recovery import/export and deliberate local deletion. No IDs leak into URLs.
- One explicitly labeled owner-operated Arc-testnet runtime purchase from the buyer's
  own Gateway funds, followed by reload and receipt recovery. This is engineering
  evidence, not an independent customer or mainnet launch.

Before signing/deposit implementation, revalidate the installed Circle SDK and official
network/service documentation. No mainnet support is inferred by this design.
