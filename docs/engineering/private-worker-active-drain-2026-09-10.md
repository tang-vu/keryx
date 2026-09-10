# Private worker active-job shutdown and crash acceptance

This Linux process test executes the actual `scripts/private-research-worker.mts`
entrypoint, bootstrap, polling loop, private executor, SQLite adapter and encrypted
result spool. It uses fresh unfunded keys and synthetic incoming-payment confirmations.
It is not a live paid pilot, Circle acceptance or a production-service shutdown.

Both scenarios passed locally on Linux/WSL with Node 22.14.0 on September 10, 2026.
The production worker implementation was unchanged from runtime commit `9947585`.
Initial harness runs exposed missing fixture encryption configuration and overly strict
model-call/log assumptions; those runs were failures, not shutdown acceptance evidence.
The completed run checks the actual job/database lifecycle with network access blocked.

## Reproduction and boundaries

Run on Linux after installing dependencies:

```sh
node --import tsx scripts/test-private-worker-drain.mts
```

CI runs the same command on Node 24. Windows signal emulation is explicitly refused;
use a Linux checkout/dependencies or a configured WSL environment. Native esbuild must
match the installed package when using WSL with dependencies originally installed on
Windows. The test's observation deadlines are not a production shutdown timeout or SLA.

Each scenario creates its own temporary database with two signed private requests,
two synthetic incoming confirmations, original treasury reservations and no source
corpus. The child receives an explicit test-only environment, including ephemeral
content/spool encryption keys. It does not inherit operator wallets, provider secrets,
Supabase configuration or NODE_OPTIONS, and it loads no environment files.

A test-only preload intercepts Gateway balance and provider requests. It supplies a
synthetic balance and holds the first provider request until an IPC event resumes it.
Then a synthetic HTTP 503 exercises the real reasoning engine's local fallback. All
other fetches and socket/TLS connections are denied. The ordinary worker's execution
and signal handlers are not replaced. A separate observer acknowledges the delivered
SIGTERM after the worker's synchronous signal handler has run.

## Assertions

For cooperative shutdown, the parent waits until the first job has an execution claim
and is awaiting its provider response. After SIGTERM acknowledgement, the worker is
still alive and the result is still absent. Resuming that response lets the current
job finish and persist its result. The queued job has no execution claim, the process
exits zero, the worker lock is removed and no result backup remains. A fresh `--once`
process handles the queued job while the original claim and serialized result remain
identical. Reconciliation releases only the completed job's never-committed allocation.

For a crash, SIGKILL interrupts the first provider wait. The parent observes actual
process termination before inspecting the unchanged lock. The execution claim remains,
the result is missing and its creator capacity remains held. A new worker refuses the
retained lock without reaching the provider. Only after matching the dead test holder's
PID and unchanged lock does the harness remove that specific test lock. Restart then
handles the other queued job, without reclaiming the interrupted execution or releasing
its budget. No routine production crash-lock cleanup is authorized by this fixture.

The test uses database identities and immutable result comparisons to detect replay.
It permits multiple reasoning calls within a draining job. Synthetic provider fallback
warnings are expected; unexpected stderr or a forbidden network attempt fails the test.
Cleanup targets only children and directories created by this unfunded test, after the
children have terminated.

## Remaining operational work

The empty-corpus fixture signs no creator payment and does not test termination while
a real payment request is in flight, remote-provider deadlines, machine reboot, systemd
under load, filesystem/power-loss durability or PostgreSQL process recovery. The existing
production systemd drill covers the idle lifecycle separately.

A killed execution with no saved result or encrypted backup still needs an operator
resolution path. Refusing blind replay protects the buyer and treasury, but is not a
completed user recovery/refund experience. Retained capacity must not be treated as
profit or automatically reclaimed from elapsed time. M4/M5 and mainnet readiness remain
open until the remaining recovery and service acceptance requirements are met.
