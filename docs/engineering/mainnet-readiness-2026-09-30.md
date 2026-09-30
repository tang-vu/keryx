# Mainnet preparation evidence — September 30, 2026

**Decision: not ready for mainnet activation.** This dossier advances preparation;
it does not authorize mainnet signing, funding or settlement.

## Latest bounded acceptance

The [funded withdrawal rehearsal](creator-funded-withdrawal-drill.md) passed using an
owner-operated EOA's existing Arc-testnet buyer balance through the creator engine:
one original 2,000-micro-USDC authorization, one Circle POST and one mint broadcast.
The application response was discarded after attestation storage, and the mint RPC
response after signed-byte storage. Two new keyless Linux processes matched the exact
original mint event/receipt and retained one cash-out row, zero payment rows and zero
POSTs/signatures/broadcasts. The selected Arc RPC reported inclusion/finality; this
does not independently verify validator signatures. The original lifetime gas hold
remained charged. Production withdrawal creation and its timer remain disabled.

The [outside-host monitor](../outside-host-ops-monitor.md) is deployed on Workers Free
with a dedicated SQLite Durable Object and five-minute Cron. Its real fixed-route
diagnostic completed a healthy control, three HTTPS 404 observations and two healthy
observations. Both Telegram drill notices were confirmed on their first attempts;
the owner confirmed both messages and accepted response ownership. The separate
production journal was healthy with no incident, and diagnostic notifications were
disabled afterward. Reviewed monitor head `b31eb56` passed Linux monitor and full CI.
An actual healthy production Cron sample was separately observed at approximately
`16:00:41Z`, with status checked at `16:00:43.993Z` and no manual POST after the
initial `15:53` probe. This verifies scheduled execution as well as configuration.
This accepts the bounded external detection/alert/responder path, rather than a real
VPS outage or failover.

An unsynchronized VPS clock initially denied fresh withdrawal provisioning. A one-time
54,834-ms forward adjustment, corroborated against independent TLS time observations,
restored the unchanged freshness gates. NTP had received no packets; durable clock
synchronization remains an operations item. Unknown-UUID Circle response recovery,
independent creator/browser acceptance, full outage/restore/security evidence and all
mainnet release gates remain open.

The original 2,000-micro-USDC source payment subsequently reached an exact matched
Circle `completed` record. Independent Arc RPC inspection verified a successful
receipt for the reported batch transaction, matching block hash and 13,978
confirmations at observation. Aggregated calldata was not independently decoded
to prove this individual nonce; earlier `received` observations below are historical.

## Earlier September 30 baseline

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
| M4 Payment recovery | Funded original withdrawal/receipt recovery and idempotent cash-out accounting passed the operator boundary above. Unknown-UUID Circle response loss, independent creator/browser recovery, broader Circle/RPC outage and release-wide recovery/security evidence remain required. No two-ledger gap or inferred terminal failure. |
| M5 Operations | Fixed-route outside-host detection, both delivered Telegram drill notices, owner response acceptance and one real healthy production Cron sample passed. Real VPS outage/failover, off-host restore/rollback/key rotation, sustained scheduled operation and durable NTP synchronization remain required. |
| M6 Customer journeys | Independent buyer/creator/developer acceptance, source rights, visible terms, privacy/retention and refund/support handling. |
| M7 Economics | Versioned provider pricing, invoice reconciliation and complete failed/retried-call costs; independent repeat paid use and useful research. |
| M8 Launch | Owner reviews the exact candidate, funded limits and gate evidence, then explicitly authorizes activation/spending. |

The [Telegram operations runbook](../telegram-ops-alerts.md) selects a private
Keryx ops group and separate bot configuration. The dedicated operations destination
is now configured: on September 30 an actual `sendAlert` probe received Telegram's
acknowledgement, and the owner confirmed receipt. Private credentials and destination
identifiers are omitted. This verifies that probe, not complete incident response.
The later outside-host fixed-route drill above adds both delivered incident notices
and the owner's response acceptance. Real outage/restoration and durable time
synchronization remain open; M5 is partial.

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
2. Preserve the durable authorization/cash-out recovery invariants and extend funded
   acceptance to independent browser/creator journeys, unknown-UUID Circle response
   recovery and broader outage/restore paths.
3. Complete candidate acceptance for versioned cost observation and configure/verify Telegram operations alerts.
4. Run the [independent research pilot](../research-pilot-program.md), alongside
   security review and operations drills.
5. Assemble exact-candidate M1–M8 evidence for the owner's launch decision.

Independent customers and sustainable profit remain unproven. No funded mainnet
test or external customer outreach is reported by this preparation update.
