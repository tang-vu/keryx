# Private worker operator integration

`privateWorkerBootstrap(db, resultSpool)` prepares the private worker but does not start a process,
run a tick, fund a wallet or enable checkout. It returns null when
`KERYX_PRIVATE_WORKER_ENABLED` is unset or `0`. Other values except `1` fail closed.
The operator command is available, but no production process or checkout-readiness
signal is activated by installing this release.

## Managed VPS service

The current VPS has a running managed worker with purchasing restricted to one configured
owner-operated testnet pilot account. The [first paid pilot](./engineering/private-paid-pilot-2026-09-10.md)
records completed execution, payment evidence, owner recovery and remaining limitations. The
[supervision and deploy drill](./engineering/private-worker-supervision-2026-09-10.md)
records actual startup, stop/resume, deployment ordering and the remaining acceptance limits.

`ops/keryx-private-worker.service` describes the existing `/root/keryx` VPS layout and
`/usr/bin/node`. Install it only after private policy, keys, backing and recovery storage have
been provisioned and checked. It explicitly loads `.env.local` and `.env.private-worker.local`;
service environment overrides enable worker/research only inside this process. It never enables
the purchase flag in the web application. Secrets stay in the environment files, not unit text.

The service uses SIGTERM, `TimeoutStopSec=infinity`, `SendSIGKILL=no` and `Restart=no`.
Stopping it waits for active execution without a routine forced kill. A crash or failed start
requires operator inspection of the process, retained lock, backup and original claims before
restart. There is no automatic lock removal. Systemd status is supervision, not alert delivery
or proof that a paid job can complete. Root ownership matches the current host; dedicated-user
isolation remains a separate hardening task. Read-only system/home protections leave the app's
data directory writable, and private temporary storage supports runtime tooling.

`scripts/redeploy-vps.sh` now drains an active private service **before** Git/dependency changes.
The stop helper checks inactive state and zero MainPID. Only after successful web health does
deployment start a previously active service again. It never installs or enables a unit, and
an absent/inactive service remains absent/inactive. A failed or transitional unit blocks deploy.
A failure after draining leaves the private worker stopped, even if web rollback succeeds:
inspect source/build identity, locks and recovery state before manually resuming. Do not blindly
retry deployment as a recovery operation. A drain may wait indefinitely; inspect the live service
job and process rather than interpreting elapsed time as permission to kill it.

After starting or resuming, run `private:inspect` with the same environment and `KERYX_COMMIT`
as the web release. Service-active status alone does not establish matching worker policy,
idle state, backing, provider quality or checkout availability.

```sh
npm run private-worker -- --help
node --env-file=.env.private-worker.local --import tsx --no-warnings scripts/private-research-worker.mts --once
```

Omit `--once` to poll every five seconds after each completed tick. The npm command
does not automatically load any environment file. With the enable flag absent or `0`,
it prints `disabled` and exits before loading configuration, signers or the database.
SIGINT/SIGTERM wake idle polling and prevent another job from starting; the process
waits for active execution to finish before closing SQLite. Configure any supervisor's
shutdown grace period to accommodate the complete job, not just the poll interval.
Do not use a short forced kill as normal shutdown. An external forced kill or crash
can still leave a permanent claim requiring operator recovery.

The [Linux active-job lifecycle test](./engineering/private-worker-active-drain-2026-09-10.md)
now exercises this actual entrypoint with synthetic prepaid jobs and blocked transports.
It covers cooperative drain, queued-job preservation, crash-lock refusal and no replay
after verified-stop cleanup. It does not prove recovery of a crashed job with no saved
result, or interruption of live creator settlement.

Output is JSON status/counters only. Errors and unpersisted results make the eventual
exit code nonzero; the daemon continues polling until stopped. `--once` is a single
work tick, not a readiness check: if enabled and funded, it can execute paid creator
operations for eligible jobs. No command generates keys or funds a wallet.

Tick summaries also distinguish observed reasoning from persistence success:
`providerServedJobs`, `providerFailedJobs`, `fallbackJobs` and `reasoningUnknownJobs`.
The first three count job-level flags from the returned run's attempt trace: tier-zero
served, tier-zero failed/circuit-open, and a served fallback tier respectively. Mixed
jobs can increment multiple counters. A returned run without attempts is unknown.
Stored-result reads and already-claimed jobs do not claim fresh provider activity;
execution errors may have no returned trace and remain in the errors counter.
No engine identifiers or raw provider errors appear in summaries. Allowed local
fallback can produce a completed saved job, so these observations do not independently
change completion state or the loop's exit code. Zero failures, an empty queue or an
idle worker must not be advertised as proof of provider health or answer quality.

Enabled workers also require `KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY` (an absolute,
operator-controlled directory with an existing parent) and
`KERYX_PRIVATE_RESULT_SPOOL_KEY` (a dedicated 32-byte encryption key, encoded as 64 hex
characters without `0x`). Keep the key in the ignored operator environment file.
The command opens the spool before the database; enabled bootstrap rejects a missing
spool. Back up this key separately from the encrypted files.

To restore one saved result, stop the worker and use the random backup filename
without its `.json` extension:

```sh
node --env-file=.env.private-worker.local --import tsx --no-warnings scripts/private-research-worker.mts --restore <backup-token>
```

Restore works with the worker disabled and does not require wallet or provider keys.
It cannot be combined with `--once`. It authenticates the local file before opening
the database, then revalidates the original owner and permanent claim through result
admission. Run from the same application directory with the same database environment
as the worker (SQLite otherwise defaults to `data/keryx.sqlite` under the current
directory). Success prints only `{"status":"restored"}`. Failures omit private details
and require inspecting both the database and backup; do not rerun the research job.
See [backup limits](./engineering/private-result-spool.md).

The enabled operator loop automatically scans backups before executing more research.
Each iteration examines at most 25 directory entries, counting unrelated entries too,
and retains its position until the sweep ends. Failed backups remain available and
do not prevent later entries from being examined. New jobs wait for an entire sweep
without scan or restore errors. Recovery logs only visited/restored/error counters and
`ready`; this field permits the next local work tick, not public checkout readiness.
An interrupted restore drains before the directory iterator closes.

`--once` performs one recovery batch and executes a work tick only if that batch ends
a clean sweep. A backlog may therefore require daemon operation or explicit token
restoration. Do not repeatedly restart once mode to traverse past a persistent bad
file. Run one worker per spool and stop it before manual recovery. A scan is not a
filesystem snapshot or cross-process coordination mechanism. New backups written
after a sweep are discovered by a subsequent sweep.

Both the enabled worker and manual restore command exclusively create
`private-worker.lock` in the spool directory before opening the database. A second
command refuses to run. The owner holds this lock until active work drains and the
database closes, and verifies its own random instance record before deleting it.
An operation error still releases an intact owned lock; a partial initial write,
forced kill, or replaced lock leaves a reservation requiring inspection.

There is deliberately no automatic stale-lock takeover. Before manually removing
an abandoned lock, stop the supervisor and verify every worker/restore process using
that directory has terminated; a stale timestamp or reused PID is insufficient.
Inspect retained backups and original database claims. Remove only the abandoned
filesystem lock, never payment authorizations, submission attempts or execution claims.
The lock is cooperative exclusion on a controlled local filesystem, not distributed
fencing or protection against a local actor who can replace its files. Direct library
callers and different spool directories are outside its scope.

When explicitly enabled, both `KERYX_PRIVATE_WORKER_ENABLED=1` and
`KERYX_PRIVATE_RESEARCH_ENABLED=1` are required, together with the existing private
runtime policy: dedicated merchant and treasury addresses, capacity, service fee,
reserved private payees, exact model/provider/base URL, provider credentials and the
approved endpoint list. `KERYX_PRIVATE_TREASURY_PRIVATE_KEY` is read only from the
environment. Keep it in an ignored environment file; do not put it in command arguments.

The bootstrap derives its signer from that key and checks its address against the
configured private treasury. It rejects reuse of the configured public funder, public
seller or reserved merchant identities. The operator must still inventory other public
or legacy signing wallets; this comparison does not discover every wallet in use.
The configured reserved-payee list must agree with the public seller's cached guard.
Only Arc testnet (`eip155:5042002`, Gateway domain 26) is accepted.
The [Circle supported-chain reference](https://developers.circle.com/gateway/references/supported-blockchains),
rechecked September 10, 2026, lists Arc as testnet-only with domain 26.

The actual Circle `BatchEvmScheme` wraps the private EOA. Balance checks call the
existing Gateway reader for that same address and preserve integer micro-USDC. Unknown
balances throw; zero is never interpreted as permission to deposit. Startup performs
no balance read and does not prove that the configured lifetime capacity is backed.
The executor checks live availability before claiming each job.

The enabled command also atomically replaces `private-worker-status.json` in its
spool directory at lifecycle boundaries. Records contain an instance UUID, PID,
optional build commit, configuration digest, phase and timestamp; no job ID, question, wallet key or provider
credential is included. Phases are starting, recovering, working, idle, degraded and
stopped. A failed pre-work status write prevents that iteration from starting work.
No timer cancels an active execution to update telemetry.

The internal `readPrivateWorkerStatus` reader bounds the file to 4 KiB and treats
future timestamps or observations older than 30 seconds as stale. Long active jobs
can become stale: this is not proof of a dead process. The reader explicitly keeps
`checkoutReady: false` even for a fresh idle record. The file is advisory and assumes
one worker per operator-controlled spool; it supplies neither process fencing nor a
funding/configuration lease. Status replacement fsyncs the file but does not promise
directory-entry crash durability. Old observations must never enable payment admission.
Public health/readiness integration remains pending. An operator diagnostic command
is available:

```sh
npm run private:inspect -- --help
node --env-file=.env.private-worker.local --import tsx --no-warnings scripts/private-operations-inspect.mts
```

With private research disabled or unset, it prints disabled without loading keys or
the database. Otherwise it requires the validated private runtime policy, an absolute
existing spool-directory path and `KERYX_COMMIT` matching the worker build. It derives
signer addresses from explicit environment keys but never signs, funds or starts work.
The normal database adapter is initialized, which may perform its usual schema setup;
inspection does not write payment records or create a spool. Run from the same app
directory/database environment as the worker.

Reports combine configuration/phase matching with Gateway backing observations, without
wallet identities, process IDs, provider endpoints, questions or job IDs. Worker state
is read before and after the backing request; changed instance/configuration/phase is
reported as changed. Exit zero for enabled inspection means a matching idle observation,
backed treasury and nonzero unallocated capacity. Disabled inspection also exits zero.
Neither is checkout readiness: `checkoutReady` remains false. The command does not
verify the provider, all signer inventory, a durable admission lease or production
recovery. It uses the same advisory freshness limits described above.

Status schema v2 includes `configurationId`, computed by bootstrap from its validated
network, merchant addresses, treasury signer/capacity, service fee and full reasoning
disclosure. Canonical ordering and lowercase addresses avoid accidental differences.
API credentials and signing/encryption keys are excluded; changing a provider key does
not change the digest and still requires a separate operational check. The bootstrap
returns the digest alongside its worker so the command observes that same snapshot.
`inspectPrivateWorkerConfiguration` compares it and the build commit exactly with
server-selected expectations and reports matched/mismatch/stale/unavailable. A matched
record remains `checkoutReady: false`. Old v1 status files are rejected rather than
silently accepted without identity. This is not authentication of an untrusted file,
proof of live funding or a replacement for full signer inventory.

The private purchase HTTP handler awaits a server-owned asynchronous
bootstrap through `readyPrivatePurchaseService`. Its read-only checks receive an
AbortSignal and have a five-second deadline; errors, timeout and request cancellation
return unavailable. A late result cannot invoke submission. The handler also checks
request cancellation immediately before calling the purchase service. The timeout
does not forcibly stop a callback that ignores cancellation, so bootstrap must never
sign, reserve funds, settle or start jobs. Actual matching worker/configuration and
backing checks are composed in `privatePurchaseBootstrap`, mounted at POST
`/api/agent/private-ask`. Mounting the route does not enable purchasing: production flags
default to disabled, and an active owner session and explicit pilot configuration are required.

The restricted bootstrap additionally requires `KERYX_PRIVATE_PURCHASE_ENABLED=1` and
`KERYX_PRIVATE_PURCHASE_PAYERS`, a comma-separated list of one to sixteen explicit pilot
wallet addresses. Invalid, missing or wildcard lists are refused. It snapshots server policy,
requires a matching idle worker, backed treasury and nonzero unallocated capacity, then restricts
submission to authenticated payers in that snapshot. It makes no provider, signing or settlement
call during bootstrap. The existing service still reserves capacity atomically and consumes a
durable incoming attempt before settlement. Run bootstrap through the bounded readiness helper
on each request; do not cache its service or derive the allowed payer from submitted JSON.

These observations are best-effort pilot availability checks, not a durable worker/funding lease.
A worker may stop after inspection; a later reservation may consume remaining capacity. No
readiness observation supersedes database payment admission. Production private purchasing
is restricted to the configured owner pilot; general availability is not enabled. Supervisor
operation and one paid pilot have been exercised, while paid-job crash/drain acceptance
remains outstanding. The quote route now uses the same account-aware bootstrap and its
policy snapshot to advertise `purchasingAvailable`; otherwise it can return a preview marked
false. Quote and purchase calls have separate per-wallet limits of ten calls per minute.
Both revalidate the original session after readiness. The purchase route reads its bounded
body before readiness, then repeats readiness for each submission independently of any quote.

The purchase handler revalidates the original active owner session after
readiness and body reads, immediately before payment admission. A real SQLite
revocation test first reproduced acceptance after revocation and now receives 401
without calling submit. Session errors also prevent submission. This does not cancel
previously issued payment signatures or atomically synchronize logout with a payment
already admitted to the service.

Tests use ephemeral unfunded keys, verify an SDK-created signature locally and inject
balance responses. They cover disabled configuration, address binding, wrong domain,
public-funder reuse and unknown-versus-zero balance. No live signature, funding,
provider request or payment is sent by these tests.

Enabled worker iterations now reconcile one treasury-reserved job after encrypted result recovery
and before executing eligible work. Selection includes pending incoming payments and already
executed jobs. Incoming and creator searches use the existing exact evidence matchers and never
sign or resubmit payments. After the creator pages finish, the coordinator separately
[releases only never-committed budget from sealed jobs](./engineering/private-treasury-release-2026-09-10.md).
Creator processing observations continue to be checked
and can advance only for the same transfer and admitted submission.

Each iteration visits at most 25 creator legs for that job; private in-memory cursors continue the
next page before moving to another job. Empty job selection restarts the sweep. Restarting the
process resets cursors and safely re-reads evidence. A 30-second cooperative search signal bounds
network work; database waits and a callback ignoring cancellation can take longer. Shutdown drains
the active reconciliation call and starts no new execution. `--once` is one iteration, not a complete
reconciliation sweep. The normal pause occurs after execution, so this is not a fixed-time SLA.

Reports include only aggregate reconciliation counts. Errors, mismatches and failed observations
keep the iteration degraded even if other eligible research succeeds and set the command's eventual
exit code to one. Pending/processing evidence remains pending/processing. All lifetime reservations,
including completed jobs, remain in this bounded sweep; large histories need further scheduling work.
Supabase deployments require migrations through 60; SQLite initializes the release ledger locally.
The managed production testnet worker and first owner-operated pilot are documented above;
independent paid acceptance and the remaining operational gates are still open.

Remaining activation work includes production process configuration, verified dedicated
funding and signer inventory, health/readiness shared with checkout,
claimed-but-unpersisted result recovery, and an owner-operated testnet acceptance run.
Do not treat constructing a worker or setting these flags as completion of those gates.
