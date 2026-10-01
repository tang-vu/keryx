# Mainnet preparation evidence — October 1, 2026

**Mainnet activation remains unproven and unauthorized.** This records an
immutable deployed testnet baseline and the evidence needed for independent
review. It does not turn internal review, synthetic receipts or source installation
into mainnet acceptance. The [maintained gate map](../mainnet-delivery-plan.md)
remains authoritative.

## Immutable source and observed deployment

| Identifier | Verified value |
| --- | --- |
| Source | [`368b27895336da8fee37c360fec21ebf4866e1e5`](https://github.com/tang-vu/keryx/tree/368b27895336da8fee37c360fec21ebf4866e1e5) |
| Git tree | `71521da3033bf65cd605bc5e5e0a3f9887912434` |
| `package-lock.json` Git blob | `8b01faec101b8d19f297d78a7fa51d63247c370d`, 924,616 bytes |
| Canonical lockfile SHA-256 | `75e861dd3c4971407e23df336b0c8236c2d4f0ba4f41323b74d3471de166aadb` |
| Public health observation, October 1 at approximately 03:09 UTC | Commit `368b278`, operational, database OK, `arcTestnet`; A2A idle and not stale |

The digest above hashes canonical Git-blob bytes. Checkout line-ending conversion
can change a Windows file hash without changing the tracked lockfile. Match the
commit, tree and Git blob before comparing cross-platform reviewer results.
Subsequent documentation commits do not change this source snapshot; subsequent
financial code or configuration changes require a recorded delta review.

The standard production deployment completed TypeScript checking, the default
Next.js 16.3.6 build (65 pages), web/A2A replacement, private-worker restoration
and the seven-cron operations preflight. This establishes the observed testnet
deployment. It does not prove browser-journal activation, strict storage enrollment,
power-loss durability or mainnet configuration. The browser
[cutover runbook](browser-authorization-cutover.md) supplies procedures, not a dated
private activation receipt.

## Acceptance evidence and its limits

| Receipt | What passed | Scope limit |
| --- | --- | --- |
| [Application CI 36806703681](https://github.com/tang-vu/keryx/actions/runs/36806703681), exact source above | 2,341 tests passed / 3 skipped, 28 contract tests, TypeScript, default production build and synthetic browser/withdrawal/PostgreSQL checks | Internal automated evidence; independent wallet, creator and mainnet settlement journeys remain open. Lint is informational with nine warnings. The high-severity dependency audit passed while seven low and eighteen moderate findings remained. |
| [Linux capacity 36806703712](https://github.com/tang-vu/keryx/actions/runs/36806703712), exact source above | Synthetic large-store equivalence, actual native-memory OOM refusal and transient-unit cleanup | Does not inspect or enroll a private production store, establish legacy origin or validate service/payment restore. |
| [Monitor 36806703692](https://github.com/tang-vu/keryx/actions/runs/36806703692), exact source above | Isolated workerd classification, durable retry/suppression, authentication, redirects and disabled-by-default messaging | Does not newly prove live delivery, a real VPS outage or sustained operation. Earlier bounded live acceptance remains separately recorded. |
| [PostgreSQL four-leg CI 36805760319](https://github.com/tang-vu/keryx/actions/runs/36805760319), PR88 head `92d87fc29cb4075d23567b83d6557c53cd170f43` | Actual isolated PG17/PostgREST; four protected originals/barriers/caps; completed keyless restart; partial-original suppression; missing/disagreeing/reverted receipt handling; actual normal-role SQL ACL refusal through a forwarding proxy | The relevant funding algorithms, fixture SQL and harness are unchanged at the deployed source. Provider evidence is synthetic. This does not prove production RPC-role activation, external settlement or attributed Circle credit. |

The PR88 correction replaced a wrong fixture assumption about first-leg gas with
the conservative full-operation exposure retained at admission. Its first failed
run is historical partial evidence; the passing receipt above is the accepted head.
No production algorithm or SQL was relaxed to make the fixture pass.

## Source changes requiring external review

- **D279 public fallback:** initial or deferred funding uncertainty fences owned
  BUY/CACHE reads and creator rewards for that run, preserves planned reservations,
  and permits bounded public evidence and synthesis. AbortError cancellation still
  propagates. Planning history, final evidence and settlement remain separate.
  Creator spend totals do not prove zero wallet funding effects. PR87 counts positive
  planned creator rewards, excludes public citations and leaves malformed legacy
  reward evidence unknown; settled money still comes from payment records.
- **D280 dormant funding:** policy, journals, canonical signed originals, preflight,
  protected observations, four-leg execution/orchestration and keyless inspection
  are installed source. Existing application DB selection/adapters, RealGateway
  and buyer routing retain their deployed behavior. Restricted PostgreSQL funding
  SQL is quarantined under `scripts/test-fixtures/funding-postgres`, outside
  deployment migration discovery. The Operator composition refuses before reading
  caller binding, importing execution or loading keys. No activation issuer exists.
  Strict application-storage PR70/76 cutover remains separate.
- **Funding evidence:** managed RPC corroboration is not independent consensus.
  A successful original does not by itself prove token effects or attributed Circle
  credit. Already-admitted asynchronous work cannot be atomically revoked. Retain
  original facts, nonce barriers and full exposure after uncertainty; do not assert
  external exactly-once execution.
- **Keyless inspection:** explicit manifests select existing enrolled journal state;
  the bounded child has a minimal environment and reports
  `signingResumeAuthorized: false`. Availability is a current observation, not
  deposit attribution. Inspection cannot adopt legacy storage, authorize signing
  from a restore or establish global clone exclusivity.
- **D281 provenance:** the default 64 MiB physical-file profile retains bounded
  queries (20,000 rows, 512 schema objects, 128 columns), 16 KiB fields,
  8 MiB selected data and a 10-second child deadline; it does not demonstrate a hard
  native heap limit when SQLite memory accounting is disabled. The explicit
  512 MiB offline-snapshot profile requires verified Linux containment before
  target open: 256 MiB cgroup charged memory, zero swap, 32 tasks, private network,
  no-new-privileges and a service runtime limit. Unavailable containment or an
  unsupported platform refuses the larger mode. This is not an exact RSS ceiling
  or protection against hostile root. Offline declaration, file/header/sidecar
  checks and selected digests do not prove origin, full-store compare-and-swap,
  enrollment or signing authority. See [provenance inspection](../storage-provenance-inspection.md).

The [security scope](mainnet-security-review-scope.md) retains the full signer,
authorization, registry, delivery, encryption and operations review. Earlier
session-worker remediation and DB initialization changes remain part of that
source baseline. Initialization retry is not rollback or a cross-process lock.
No independent audit or remediation acceptance is claimed by this packet.

## Mainnet gates still requiring evidence

| Gate | Required next evidence |
| --- | --- |
| M1 | Intended mainnet contracts/registry, SDK/facilitator behavior and separately authorized end-to-end settlement. Earlier read-only supplier/proxy evidence is not settlement acceptance. |
| M2 | Trusted owner/key-history intake, complete signer namespace ownership, enrolled storage, isolated configuration/keys and paused/drained cutover with identity-aware restore/rollback. Default-closed source and synthetic enrollment do not satisfy these. |
| M3 | Independent review of the immutable release candidate, reachable findings and independently verified remediation; explicit residual decisions. |
| M4 | Unknown-UUID Circle response loss, independent browser/creator recovery, broader outage and release-wide settlement/delivery/reconciliation drills. |
| M5 | Durable clock synchronization, real outage/failover, service restore, rollback/rotation and sustained operation. A file-only integrity scan cannot close full service/payment recovery. |
| M6 | Independent buyer/creator/developer acceptance, rights, visible terms, privacy/retention and refund/support policy. |
| M7 | Independent repeat use, measured useful outcomes, invoice-backed costs and viable contribution. Partial models exclude unknown wallet funding/gas effects; testnet tokens are not revenue. |
| M8 | Owner reviews the concrete mainnet release, evidence, funded limits and residuals, then explicitly approves launch and spend. |

The [independent review handoff](../independent-security-review.md) is prepared
for selecting and briefing an external reviewer. No external contact, private
data sharing, new funded drill or mainnet permission is implied by this dossier.
