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
persistence and malformed-timestamp reservation rollback. Corrected PR #44 candidate
`abc9847` passed [hosted CI run 36668252786](https://github.com/tang-vu/keryx/actions/runs/36668252786),
including the real PostgreSQL acceptance harness, application tests and production
build. This establishes the narrow D-268 admission acceptance; the live signing
bridge and overall mainnet gates remain open.

## Release gates

| Gate | Remaining evidence required |
| --- | --- |
| M1 Network and services | Mainnet contract identity, SDK/facilitator compatibility, registry authority and a separately authorized end-to-end settlement drill. |
| M2 Environment isolation | Separate mainnet keys, configuration, database and signing domains; no cross-network nonce or authorization reuse. |
| M3 Security | Independent review of payment, authorization, encrypted delivery and registry paths; remediate findings. |
| M4 Payment recovery | Atomic intent-to-payment bridge, durable phases, retention after grant expiry/replacement, restart/replay/response-loss drills and withdrawal acceptance. No two-ledger gap. |
| M5 Operations | Off-host restore, rollback and key-rotation drills; outside-host outage detection and alert acceptance; named responder and incident runbook. Dedicated Telegram probe delivery is observed; responder acceptance and incident drills remain open. |
| M6 Customer journeys | Independent buyer/creator/developer acceptance, source rights, visible terms, privacy/retention and refund/support handling. |
| M7 Economics | Versioned provider pricing, invoice reconciliation and complete failed/retried-call costs; independent repeat paid use and useful research. |
| M8 Launch | Owner reviews the exact candidate, funded limits and gate evidence, then explicitly authorizes activation/spending. |

The [Telegram operations runbook](../telegram-ops-alerts.md) selects a private
Keryx ops group and separate bot configuration. The dedicated operations destination
is now configured: on September 30 an actual `sendAlert` probe received Telegram's
acknowledgement, and the owner confirmed receipt. Private credentials and destination
identifiers are omitted. This verifies that probe, not complete incident response.
Responder acceptance/drills, outside-host outage detection and its delivered alert
drill remain required; M5 is partial.

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
At the inspected production baseline `5bf9aea`, the observer uses the August 29
historical rate policy. D-269, implemented in the [PR #46 candidate](https://github.com/tang-vu/keryx/pull/46),
adds per-call policy/model capture and private observer/report v2. It preserves
saved v1 artifacts, leaves untagged history and uncertain cache splits unpriced,
and estimates Flash cost as an off-peak–peak interval without guessing billing
windows or holidays. Local validation passed 98 focused tests; four Linux-only
checks await hosted CI, and final-candidate hosted acceptance remains pending.
This is candidate evidence, not a verified deployment or invoice audit. Bounds
cover priced runs only; whole-period LLM cost and realized profit remain unknown.
Invoice reconciliation and the broader economics gate remain open. See the
[observer contract](../testnet-economics.md). [Cache hits are best-effort](https://api-docs.deepseek.com/guides/kv_cache/).

## Delivery order

1. Preserve the passing PostgreSQL admission gate against actual migrations in CI.
2. Design and implement the atomic live-journal bridge and durable recovery phases;
   prove fault handling before exposing signing from the new journal.
3. Complete candidate acceptance for versioned cost observation and configure/verify Telegram operations alerts.
4. Run the [independent research pilot](../research-pilot-program.md), alongside
   security review and operations drills.
5. Assemble exact-candidate M1–M8 evidence for the owner's launch decision.

Independent customers and sustainable profit remain unproven. No funded mainnet
test or external customer outreach is reported by this preparation update.
