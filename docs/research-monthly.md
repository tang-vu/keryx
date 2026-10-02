# Research Monthly pilot

The user confirmed one bounded Monthly plan on 2026-10-02: four research requests
per month, priced 10% below four equivalent separate purchases. The pilot uses
four Deep v1.0.0 requests in a 30-day term from the confirmed purchase, with manual
renewal and no autonomous schedule. This is Arc testnet; it is not a mainnet or
card recurring-billing launch.

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

Monthly and the shared debit-admission writer remain ordinary TypeScript
SQLite/Supabase authority. Both enrolled backend inventories explicitly refuse
these methods, including read-only factories and internally assembled cores.
The ordinary SQLite installer composes Monthly separately from the reviewed
enrolled schema/profile; runtime never upgrades an enrolled store. Migration
0078 refuses an already enrolled PostgreSQL owner, and its RPCs recheck that
boundary. An enrolled/native Monthly domain needs reviewed identity-scoped
contracts, fences, schema fingerprints and independent acceptance before cutover.

Production currently selects SQLite. Initialization installs the additive tables,
immutable debit claims and historical nonce backfill. Verify the actual schema,
claims and atomic admission on that database before activation. For Supabase,
install migration 0078 and verify service-role-only tables/functions and the
real multi-session PostgreSQL CI evaluator; local PGlite execution verifies SQL
and parity but does not prove concurrent PostgreSQL sessions. Stop/drain old
web and worker generations that lack shared admission before setting
`KERYX_MONTHLY_ENABLED=1`. Deploy claim-aware code to all public settlement writers.
Require focused nonce-replay/concurrency/economic/authorization tests, existing
source/citation/A2A regressions, type checking, lint and production build, independent
payment review, required CI and deployed commit health evidence.

Disable `KERYX_MONTHLY_ENABLED` to stop new purchases/redemptions while retaining
signed status and job/receipt recovery. Do not delete plans, consumed slots or
claims. Rollback must retain the claim-aware public seller version: an older seller
that bypasses admission is not a safe rollback while any admitted nonce exists.
Desktop and extension installers retain their web handoff; no installer format changes.
The stdio MCP package changes to 0.3.1 and requires its separate tested, verified publication.
