# Mainnet preparation evidence — September 30, 2026

**Decision: not ready for mainnet activation.** This dossier advances preparation;
it does not authorize mainnet signing, funding or settlement.

## Observed baseline

Production remains Arc testnet. Read-only health inspection reported operational,
database OK and commit `5bf9aea` (PR #43). D-268 provides atomic grant reservation
and a nonce-indexed prepared authorization in SQLite/PostgreSQL. It has no live
signing caller. `payment_events` remains the deployed recovery authority.

SQLite concurrency/rollback evidence exists. This update adds a real PostgreSQL 17
acceptance harness to application CI. Its result must be taken from the exact PR
and release CI runs; merely adding the script does not establish a passing drill.
Docker is unavailable on the development host, so local PostgreSQL execution is
not claimed.

The first hosted PostgreSQL run for PR #44 failed on the admission insert:
`created_at` was JSON text rather than `timestamptz`. Additive migration `0068`
corrects the cast without rewriting `0067`; the harness also checks exact timestamp
persistence and malformed-timestamp reservation rollback. Acceptance remains open
until the corrected candidate passes hosted CI.

## Release gates

| Gate | Remaining evidence required |
| --- | --- |
| M1 Network and services | Mainnet contract identity, SDK/facilitator compatibility, registry authority and a separately authorized end-to-end settlement drill. |
| M2 Environment isolation | Separate mainnet keys, configuration, database and signing domains; no cross-network nonce or authorization reuse. |
| M3 Security | Independent review of payment, authorization, encrypted delivery and registry paths; remediate findings. |
| M4 Payment recovery | Atomic intent-to-payment bridge, durable phases, retention after grant expiry/replacement, restart/replay/response-loss drills and withdrawal acceptance. No two-ledger gap. |
| M5 Operations | Off-host restore, rollback and key-rotation drills; delivered alert evidence; named responder and incident runbook. Telegram bot is the selected channel; concrete destination, delivery and responder acceptance remain unconfirmed. |
| M6 Customer journeys | Independent buyer/creator/developer acceptance, source rights, visible terms, privacy/retention and refund/support handling. |
| M7 Economics | Versioned provider pricing, invoice reconciliation and complete failed/retried-call costs; independent repeat paid use and useful research. |
| M8 Launch | Owner reviews the exact candidate, funded limits and gate evidence, then explicitly authorizes activation/spending. |

Keep [the maintained gate map](../mainnet-delivery-plan.md) authoritative. Close
individual gates with evidence, rather than treating this snapshot as completion.

## Supplier revalidation

[Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc)
publish mainnet chain `5042`; [contract addresses](https://docs.arc.io/arc/references/contract-addresses)
publish mainnet Gateway wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`.
[Circle Gateway](https://developers.circle.com/gateway/references/supported-blockchains)
lists domain `26`, mainnet `arc` and testnet `arcTestnet`. Published availability
does not prove Keryx mainnet acceptance. Deployed testnet constants remain unchanged.

[DeepSeek's current pricing](https://api-docs.deepseek.com/quick_start/pricing/)
lists Flash cache-hit/cache-miss/output USD per million tokens as
`0.003 / 0.15 / 0.60` off-peak and `0.006 / 0.30 / 1.20` peak.
Peak windows are Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese
public holidays. The old `deepseek-v4-flash` request name now routes to V4.1 Flash.
The observer's August 29 policy still uses historical rates. Its margin estimate
must not establish current profit. Next implementation must preserve historical
policy identity, capture effective pricing/model identity per call and leave
unresolvable billing windows unknown; do not silently reprice old usage. Actual
invoice reconciliation remains necessary. [Cache hits are best-effort](https://api-docs.deepseek.com/guides/kv_cache/).

## Delivery order

1. Verify PostgreSQL admission against actual migrations in hosted CI.
2. Design and implement the atomic live-journal bridge and durable recovery phases;
   prove fault handling before exposing signing from the new journal.
3. Correct versioned cost observation and prepare/configure Telegram operations alerts.
4. Run the [independent research pilot](../research-pilot-program.md), alongside
   security review and operations drills.
5. Assemble exact-candidate M1–M8 evidence for the owner's launch decision.

Independent customers and sustainable profit remain unproven. No funded mainnet
test or external customer outreach is reported by this preparation update.
