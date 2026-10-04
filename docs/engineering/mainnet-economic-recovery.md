# Mainnet economic recovery — October 4, 2026

The owner authorized fixes for the five findings against deployed commit
`349a43b7ae1b0b6ff6a074f693eb989b264c495a`. This document describes the repair
candidate; verification and deployment are separate gates below.

## Recovery and accounting

- **Interrupted withdrawal before signature publication:** the worker can fence its
  original local record and authenticate an abort of signing. An already saved burn
  signature, submission attempt, mint or completion prevents this path. Atomic local
  storage excludes concurrent old/new writers; the original barrier remains until
  the server acknowledges the same abort. Server evidence of any signed request or
  possible transfer prevents abort, even with a valid holder signature. Original
  exposure, preparation and abort evidence remain retained. There is no new burn,
  mint, refund, grant renewal or treasury funding.
- **Terminal-failed payment:** complete original nonce, signer, owner, grant epoch,
  request, amount, payee, network, requirements digest and item context must match.
  Failed means an exact terminal outcome in the authenticated server/Circle journal,
  not a timeout or a failed HTTP request. Local capacity is returned once while the
  nonce remains unusable. Cashout does not count that failed original as a liability.
  Historical question allocations remain conservative; recovered capacity can serve
  a new question. Settled debits remain lifetime spending.
- **Server lifetime Session accounting:** native SQLite iterates all original authorization evidence
  with bounded row memory and indexed orphan checks. It no longer refuses the 10,001st
  record. Missing/corrupt later records and unsafe aggregate arithmetic still refuse.
  This removes the server accounting ceiling. Protected headless custody retains
  its separate 10,000-original and 16 MiB admission bounds; this release does not
  enlarge that local custody format's storage limits.
- **A2A async budgets:** a quoted amount such as 0.0157 USDC remains exactly 15,700
  micro-USDC. The worker uses the same safe integer roundtrip as pricing, rather than
  requiring a floating-point multiplication itself to be an integer. Genuinely
  fractional or unsafe values remain invalid. Existing purchase identity, request
  hash, service fee, creator budget and settlement evidence are unchanged.

Signing abort assumes the already documented trusted application origin, browser and
session-key holder. The holder signature is not a third-party proof of absence of a
burn signature. Current Gateway contracts also have separate batch debit machinery;
expiry and an unused direct transfer hash alone cannot establish general no-debit
evidence. This repair consequently uses the local publication boundary and original
server journal, not expiry-based release. See Circle's
[GatewayWallet](https://github.com/circlefin/evm-gateway-contracts/blob/master/src/GatewayWallet.sol)
and [batch path](https://github.com/circlefin/evm-gateway-contracts/blob/master/src/modules/wallet/Batches.sol).

## Sponsored admission

All windows are 60 seconds and counters are durable across processes/restarts:

| Scope | Limit | Applies to |
| --- | --- | --- |
| Anonymous IP | 5 | Sponsored web, chat and remote MCP together |
| Verified wallet | 10 | All its API keys and authenticated sponsored web use |
| Direct caller IP | 10 | Keyed and anonymous direct requests together |
| Verified bot user | 5 | Each provider/user identity, after provider authentication |
| Shared sponsored dispatch | 60 by default | Web, chat, remote MCP and all three bots together |
| Key creation | 10/wallet, 10/IP, 60/global | Separate namespace; never creates research credit |

`KERYX_SPONSORED_DISPATCHES_PER_MINUTE` changes only the global research throughput
limit. Invalid configuration or unavailable durable counters returns 503 before
work. Direct HTTP throttling returns 429 with `Retry-After`; authenticated bot
webhooks acknowledge their provider with an ephemeral/unavailable reply and start
no research. Later refusals/failures do not refund
earlier admission points. Shared NAT users share the direct-IP limit. Ingress IP
authenticity remains the existing trusted-proxy assumption. These are throughput
limits, not claims of fixed AI cost or profitability; treasury USDC remains bounded
by its reviewed query/lifetime policy and actual funding.

## Surface and release boundaries

| Surface | Coordinated behavior |
| --- | --- |
| Web Session | Publication abort, failed-liability recovery, original custody/nonces retained |
| Web sponsored research, OpenAI chat API | Shared sponsored wallet/IP/global admission |
| Remote MCP | Same shared sponsored allowance; read-only tools consume no research point |
| Discord, Slack, Telegram | Authenticated provider-user and shared global admission before deferred work |
| Browser extension | Thin chat API adapter inherits server admission; no local payment authority |
| Buyer CLI and stdio MCP | Paid A2A inherits corrected async validation; not charged sponsored quota |
| Delegated headless Session | Same original signing-abort/failure semantics; explicit protected state migration |
| Desktop Operator | Shared selected-network client/runtime and original recovery; refreshed distribution |
| A2A/private/Monthly | Existing buyer payment and entitlement authority; no new automatic refunds or retries |
| Optional Supabase/Rust finance | Existing staged role boundaries; no new mainnet backend cutover |

The sealed production SQLite schema must migrate from its exact retained profile
with all writers stopped and verified backup/recovery artifacts. The explicit
migration retains the same storage identity/enrollment, manifest and public/private
policy bindings; it changes no signer, cap, funding or original journal. The new
runtime accepts the new source-derived schema; an old runtime refuses it. Do not
silently reinterpret an enrollment or resume an old writer against the new profile.

## Verification gates

Targeted regression checks cover key rotation, global concurrency/restart/outage,
fractional quotes, more than 10,000 valid retained originals, failure-capacity CAS,
and publication-abort races/replay. Integrated typechecking, production build,
independent review, CI, migration rehearsal, actual deployment and distribution
readback remain required before synchronized delivery is claimed.

A read-only aggregate production inspection during implementation found zero
`invalid_order_data` failed A2A orders, zero exposed withdrawals without a signed
request, and zero terminal-failed browser payments. This observation is not proof
of general security, future absence of failure, independent demand or traction.
