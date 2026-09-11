# Withdrawal cycle supervision

Status: prepared and verified for syntax/lifecycle; not installed or enabled on the
production VPS. Funded testnet relay acceptance, incident alerts and backup/restore
drills remain required before opening new withdrawals.

The three `ops/keryx-withdrawal-cycle*` units target the existing `/root/keryx` host
with `/usr/bin/node` (Node 24). The oneshot service runs the explicit `--cycle` command.
The timer waits 30 seconds after activation or the previous cycle becomes inactive.
Systemd does not start another instance of an already active service; original journal
locks remain a second boundary for manually invoked commands. See the upstream
[timer documentation](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml).

Exit 2 is an expected pending/unavailable scan result, not failed payment or settlement.
It remains visible in private operator output and the timer may check the same originals
later. Unexpected process/startup failure invokes the pause unit to stop future timer
activations. Inspect retained originals and locks before resuming; never remove a lock
merely because a process or receipt is absent. Service status alone does not prove
worker progress, settlement, adequate gas backing or delivery of an operator alert.

## Configuration and activation

Provision and verify the existing canonical owner-only relay directory and original
application database under `/root/keryx/data`. No unit creates or migrates either.
Choose the dedicated testnet key, key inventory, journal lifetime limits, fee/gas
terms, backups and observed initial nonce before activation.

`provisionFreshWithdrawalJournal` is an explicit internal initialization helper for
a newly generated, never-used key with verified latest/pending nonce zero. It requires
an existing private canonical parent and creates a fresh child directory exclusively.
It validates the policy before writes, syncs files/directories and reopens the empty
SQLite journal for verification. An existing or partial child directory is never
reused, erased or repaired automatically. Missing history for a previously used key
must use recovery, not this helper. The function has no key, RPC or enablement capability;
empty local storage cannot establish key freshness, exclusive custody or gas backing.

Before initialization, `freshWithdrawalRelayForRpc` can inspect the public relay address
against an explicit lifetime gas ceiling in native wei (18 decimals, not ERC-20 USDC's
6 decimals). It checks chain identity, fresh consistent block metadata, latest/pending
nonce zero, empty account code and sampled balance. `underfunded` must not proceed;
lookup failures require inspection. Even `funded` is only a point-in-time RPC observation,
not proof that the key was never shared or used to sign off-chain. This helper does not
create the journal or enable the service, and later admission must recheck gas backing.

Run `node --import tsx scripts/withdrawal-provision.mts --help` for the operator command.
With only `--address`, `--rpc` and `--lifetime-gas-budget-wei`, it performs a read-only
preflight. Exit 0 means the sampled funding meets the selected ceiling; exit 2 means
underfunded and exit 1 means unavailable/invalid. These are not settlement outcomes.
To initialize, add `--initialize --directory ABSOLUTE_NEW_PATH --max-slots 1..1000
--fresh-key-custody-verified`. The custody flag asserts an independently completed
operator check; it is not an automated key audit. Initialization occurs only after
a funded preflight. Keep output private and inspect any partial directory on error.
The CLI does not load environment files or enable services, and never overwrites an
existing journal. Use recovery for a previously used key even if its current nonce is zero.

Provisioning verification (2026-09-11, implementation `4f92a6c`): the actual CLI passed
on native Linux using a private `/tmp` parent and a loopback synthetic RPC. Insufficient
balance left the target directory absent; sufficient synthetic backing initialized and
reopened the journal; a second funded preflight against fresh block metadata refused
the existing directory and left SQLite bytes unchanged. No key or live payment was
used. The same CLI cases are included in the Linux unit suite. This establishes the
initialization boundary, not funded relay operation or backup/restore acceptance.

The process explicitly loads `.env.local`, optional `.env.private-worker.local`
(for private treasury inventory), and `.env.withdrawal-relay.local`. Keep these files
owner-only. The relay file must contain the explicitly enabled isolated relay policy;
the unit does not set enable flags or enable HTTP creation itself. Do not copy secrets
into unit text or commit environment files.

The required systemd `EnvironmentFile`, `.env.withdrawal-cycle.local`, contains only
operator-selected CLI arguments, not signing keys:

- `KERYX_WITHDRAWAL_APPLICATION_DB`: canonical existing application database path.
- `KERYX_WITHDRAWAL_MINT_GAS`: integer gas limit.
- `KERYX_WITHDRAWAL_MINT_MAX_FEE_PER_GAS`: integer native wei per gas.
- `KERYX_WITHDRAWAL_MINT_PRIORITY_FEE_PER_GAS`: integer native wei per gas.
- `KERYX_WITHDRAWAL_MINT_GAS_BUDGET_WEI`: integer maximum native gas cost.

Use one systemd-compatible assignment per line and mode 0600. No default monetary
values are supplied. Gas terms must fit each original held ceiling; configuration
cannot change an already allocated nonce or saved signed transaction.

Before installing all three units, verify them together with `systemd-analyze verify`,
inspect the protected runtime, and run an owner-controlled bounded acceptance cycle.
Install unit files with mode 0644, reload systemd, and enable/start only the timer after
operational acceptance. This document is a deployment procedure, not evidence that
activation or funded acceptance has occurred.

## Shutdown and deployment

### Private journal snapshots

On Linux with Node 24, run `node --import tsx scripts/withdrawal-backup.mts --source
EXISTING_RELAY_DIRECTORY --destination NEW_PRIVATE_DIRECTORY`. The destination parent
must already be private and canonical. The command holds the relay/admission lock,
uses the [Node SQLite backup API](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options),
then reopens and checks the copied admissions, slots, signed originals and observations.
It verifies logical fingerprints and writes a synced database hash manifest. Backup
includes committed WAL contents; copying only the live main SQLite file is insufficient.
Existing destinations and pre-existing locks are never replaced or removed. On an
interruption, retain artifacts and inspect them even if a manifest exists: successful
return, file durability and external retention are separate facts.

These files contain private signed authorizations. Keep them owner-only and out of
Git, public storage and product updates. A verified snapshot is not permission to
roll back nonce history or activate another signer. Before any restore, stop admission
and signing everywhere, retain all newer originals, reconcile the application journal
and chain observations, and account for every signature issued after the snapshot.
Unknown later history must remain unresolved; it cannot be reset to an empty journal.
An off-host encrypted copy, integrity/restore drill and incident procedure remain open.

Native Linux verification covers a still-open WAL source, a saved synthetic signed
mint plus a second pending gas admission, exact copied raw bytes and unchanged target
on duplicate backup. Network access was disabled. This is not a live payment or a
funded restore/resume drill.

Retain `manifestSha256` from successful backup output in a separate trusted private
record. Before using a recovered copy, run `node --import tsx
scripts/withdrawal-backup-inspect.mts --directory PRIVATE_BACKUP_DIRECTORY
--manifest-sha256 TRUSTED_RETAINED_DIGEST`. The inspector checks that digest before
trusting the manifest, then validates protected files, database bytes, policy and
original journal records. It rechecks database hash and file identity after inspection.
The digest must not be obtained by simply hashing the untrusted recovered manifest:
that would establish only self-consistency, not agreement with the retained backup.
Older backup commands did not output this digest; independent provenance is still
required for those copies. Successful inspection returns `verified-backup-copy` and
`signingResumeAuthorized: false`; it does not prove freshness or restore eligibility.
No RPC, key, admission, restore or signing operation occurs. Tampered database bytes,
modified manifests and incorrect expected digests were rejected in native Linux checks.

### Drain before deployment

The service uses SIGTERM, control-group shutdown, infinite stop grace, no SIGKILL and
no process restart. It waits for awaited work to settle before closing its journal.
An unresponsive dependency requires inspection of the actual process/job; elapsed
time is not permission to delete a lock or create a replacement authorization.

`withdrawal-cycle-deploy.sh` pauses the timer before draining the service. Even an
inactive service receives a stop request to cancel queued activation. Only verified
inactive state and zero MainPID allow source/dependency changes. Unsafe kill settings,
failed/transitional states or failed stops stop deployment. After web health passes,
only a previously active timer is restarted; an absent/inactive timer stays so, and a
manual oneshot is not automatically repeated. The helper never installs/enables units.

A failed deploy leaves scheduling paused. A later deploy cannot infer the earlier
timer state: inspect checkout/build identity, pending systemd jobs and retained journal
before deliberately resuming. This is the same conservative recovery requirement as
the private research worker. Unit and journal output stays private; never publish
cursors, signed authorizations or scan counts as revenue.

Hermetic lifecycle tests cover timer-first ordering, queued activation cancellation,
manual preservation, restoration, unsafe kill settings and failed/incomplete drains.
Unit verification also passed on the actual VPS without installing or starting units.
Actual systemd shutdown during funded minting remains unverified.
