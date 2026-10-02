# Research Monthly

The user confirmed one bounded Monthly plan on 2026-10-02: four research requests
per month, priced 10% below four equivalent separate purchases. The pilot uses
four Deep v1.0.0 requests in a 30-day term from the confirmed purchase, with manual
renewal and no autonomous schedule. Its initial release used Arc testnet. The
owner subsequently directed full public mainnet Keryx; that includes Monthly under
the same manual-renewal terms. Card recurring billing remains outside this product.

The current default creator cap and Deep service fee determine the quote. The
entire discount comes from the service allocation. Creator caps, source tolls and
citation rewards are unchanged. The four-request total is rounded upward to the
next four micro-USDC so every request has the same exact allocation. The quote
discloses rounding. Invalid economics, nonpositive service allocation, unsupported
package, or totals above one testnet USDC refuse admission. Cost coverage and profit
remain unproven; a discount is not evidence of sustainable margins.

Purchase snapshots fix the cap, package, fee allocation, payee and expiration.
Confirmed Circle evidence activates a plan. A missing acknowledgement is uncertain,
never an entitlement and never permission to repeat the debit. Status lookup requires
a short-lived payer signature bound to plan, action, host and network. Redemption
additionally binds a request ID and question digest. One atomic transaction inserts
both the slot and the queued research order. Validation refusals consume no slot;
exact request replay returns the original job, including after expiry. Changed
questions under the same ID refuse. Four admitted requests exhaust the plan.

Research is best effort and non-refundable. Failed and pending executions retain
their slots, and unused requests expire. Never promise four successful reports.
Recover the original request ID and question after a disconnect. Completed jobs
use the existing job and receipt recovery. Jobs and receipts label their economics
as a prepaid Monthly allocation, not another incoming payment. Creator payments
continue to occur per job with existing receipt and settlement authority.

All public x402 resources share durable debit admission before settlement. The
selector is Arc network, Arc USDC, payer and nonce; recipient, amount, purpose and
request/resource hash are immutable bound data. A request cannot reuse one debit
for Monthly and a standalone job or a paid source/citation. Historical recorded
nonces without sufficient resource binding fail closed. Ambiguous settlement
retains the claim; it does not release it or activate a plan.

## Selected-network release candidate

Checkout and proof domains use the trusted deployment profile, never a received
quote or recovery file. The historical one-USDC Monthly ceiling remains testnet
only; mainnet quotes retain exact integer allocation and the ordinary reviewed
creator/job limits. Mainnet browser recovery keys include network, Keryx HTTPS
origin and payer. Existing testnet keys stay unchanged and are never relabelled.
Mainnet request files require the versioned network envelope; legacy plain request
files remain recoverable on testnet. An unresolved debit survives reload and blocks
another purchase until the original plan is recovered. Status and recovery do not
submit another payment.

The candidate UI has actual React/Chromium/IndexedDB evidence on both profiles,
including a 1.8-USDC mainnet quote rendered by the real funding component, exact
synthetic EOA signing, foreign-file refusal and lost-acknowledgement recovery.
Intercepted HTTP and synthetic signatures do not prove mainnet settlement.
Mainnet API and page admission remain closed until the backend's fresh sealed
SQLite Monthly domain and exact dedicated custody readiness have native acceptance.
Legacy migration 0078 is an ordinary testnet path; copying its rows into a fresh
mainnet store is not migration. Optional Supabase mainnet remains staged separately.

## Surfaces and boundaries

- Web `/research`: purchase, status, manual redemption and recovery files.
- API `/api/research/monthly`: unpaid GET quote, POST x402 purchase, signed GET
  status, signed PATCH manual redemption. Standard job/receipt APIs recover output.
- CLI `npm run monthly`: `quote --payee`, `status --id`, and `redeem --request`
  use the same API and caller wallet. Purchase uses the reviewed web handoff;
  redemption/recovery use a previously saved exact request file. No treasury signing.
- Remote and stdio MCP: explicit read-only Monthly discovery and web/API handoff.
  Existing research tools remain independent per-job products; no caller entitlement
  is inferred from a server-held wallet.
- Desktop Operator, browser extension and bots: use the web handoff for Monthly.
  Their existing task, recovery and research roles remain; no local scheduler or
  duplicate entitlement writer is introduced. No installer format changes.
- Private research: separate merchant/policy and privacy contract. Monthly applies
  only to existing public research; it does not silently change private pricing.

## Release and rollback gates

Monthly checkout first issues a cryptographically random server nonce and persists
its exact payer, merchant, quote, economics and authorization validity before exposing
it. A paid request must match that issued contract before Circle is called. This
excludes historical external seller debits that were never recorded locally.
The ten-minute challenge admission window is separate from Circle's configured
multi-day signature validity. First submission is marked durably before the external
call; uncertainty survives the challenge expiry, and recovery never replaces a debit.

The original testnet release uses ordinary TypeScript SQLite/Supabase authority.
Fresh sealed mainnet SQLite now has separately admitted identity/profile-bound
Monthly v2 contracts. Legacy unlabelled purchases and old enrolled testnet writers
are refused on mainnet. Mainnet purchases require the exact submitted issued claim,
selected USDC/Gateway identity and actual facilitator network receipt. Immutable
native slot/order admission binds the original payer, version, request and network.
The legacy 0078 PostgreSQL migration does not enroll a mainnet database; optional
Supabase mainnet support remains staged/fail-closed and is not a SQLite launch gate.

Before quote/checkout, the actual native writer and reviewed dedicated public key's
address, historical role, query/lifetime caps and current selected Gateway capacity
must pass. This checks the **one-run creator cap**, not the total prepaid price.
It does **not reserve or escrow all four future runs**, guarantee future operator
prefunding or promise four successful reports. New redemptions refuse without
consuming a slot if current execution capacity is unavailable. Once an original
job is admitted, exact replay returns it despite later disabled admission; terminal
failed/uncertain jobs retain their slots and use ordinary original job recovery.

Production mainnet requires a fresh sealed SQLite deployment, preserved testnet
originals, drained old writers, reviewed custody/policy/funding inputs and final
composed native/SDK/API acceptance. All receipts and metrics must distinguish
synthetic tests, seller-reported evidence and actual real confirmed settlement.

Disable `KERYX_MONTHLY_ENABLED` to stop new purchases/redemptions while retaining
signed status and job/receipt recovery. Do not delete plans, consumed slots or
claims. Rollback must retain the claim-aware public seller version: an older seller
that bypasses admission is not a safe rollback while any admitted nonce exists.
Desktop and extension installers retain their web handoff; no installer format changes.
The initial product release uses stdio MCP 0.3.1. The subsequent isolated-storage
release alignment uses 0.3.2 and requires its separate tested, verified publication.
Immutable earlier release artifacts retain their original source and checksums.

The initial Monthly stdio package candidate was 0.3.1; the coordinated mainnet
client candidate is 0.4.0. Neither source version proves publication. Verify the
actual npm/immutable release artifact and installed consumer before reporting
synchronized delivery.
