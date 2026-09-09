# SQLite snapshot restore check — September 9, 2026

This is a limited local snapshot recovery check, not a production failover or a
complete disaster-recovery rehearsal. Production was left running. No application
worker, signer, reconciliation job or payment was started against the restored data.

## Observed backup state

The VPS had 48 compressed snapshots. The newest observed snapshot was created at
`2026-09-09T06:00:02.806Z`, with 19,556,216 compressed bytes. The backup process's
application environment did not configure `KERYX_BACKUP_REMOTE`. The script retains
local backups when that setting is absent. This check does not demonstrate scheduled
off-site recovery; manually downloading one snapshot is not an off-site backup service.

The selected archive was copied to an ignored private test directory on the operator's
machine. Its SHA-256 matched the value read independently from the VPS:
`6d21e9a1807c9780eaecaeb0c385cce3237d4f30e45608fccfae2fbd0c0736dc`.
The database and its contents are not committed, published or used as traction.

## Checks performed

- Gzip decompression produced a 124,858,368-byte database in a new test file.
- SQLite opened that file read-only and `PRAGMA integrity_check` returned `ok`.
- The source, payment, query, A2A order, session-grant and withdrawal tables were
  readable. Required payment authorization/expiry/status, grant-generation and A2A
  execution-boundary columns were present.
- The first schema expectation incorrectly looked for `withdrawals.id`; inspection
  of the current adapter confirmed `withdrawals.tx_hash` is its primary key. Correcting
  that test expectation and repeating the restore/check passed. No database repair
  or schema modification was performed.
- The corrected local decompression/write/read checks took 929 ms on this machine.
  Download time, provisioning, configuration, service startup and reconciliation are
  excluded. This is not a service RTO or evidence of an acceptable RPO.

Ignored local evidence is under `.artifacts/restore-drill-2026-09-09/`. The initial
schema-expectation result was retained separately from the corrected result. These
artifacts contain private application data and must not be attached to public updates.

## Remaining acceptance work

O1/M5 remain incomplete. Configure and verify encrypted off-site backup delivery,
retention/access controls and recovery credentials. Exercise an isolated application
startup against restored state, including paid-content decryption with the intended
key-recovery procedure, without replaying unsettled authorizations or jobs. Validate
the pending-payment/operator-review procedure and a timed service restore/rollback.
Agree recovery objectives and test them against measured snapshots, including the
changes lost since the chosen snapshot. Passing SQLite integrity alone does not
establish semantic ledger correctness, payment finality or complete recoverability.

During the same deployment window, three sequential public health GETs returned HTTP
200 and `operational` in 3512, 2982 and 898 ms. Those few observations are not a load
test or an uptime/latency SLO. Deployment still builds on the same small VPS that
serves traffic; capacity and deployment isolation need separate acceptance evidence.
