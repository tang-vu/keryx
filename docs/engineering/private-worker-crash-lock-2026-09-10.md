# Private worker crash-lock evidence — September 10, 2026

The local Windows drill runs the actual `withPrivateWorkerLock` implementation in
separate Node processes. Each child receives only essential OS environment values and
`NODE_ENV=test`; no wallet, provider or database credentials are supplied. The operation
under the lock only emits a fixed marker and waits. It does not run research or payments.

Observed sequence:

1. The first process exclusively creates the lock and enters the operation. Its PID
   matches the stored record.
2. A second process exits with the refusal code without entering its operation. The
   original lock bytes remain unchanged.
3. The test forcibly terminates the first process and awaits its close event. The
   original lock remains; a fresh process is still refused.
4. After verified process completion, the test removes only its own lock in its unique
   temporary directory. A fresh process enters, finishes and removes its owned lock.

Run `npm test -- --run lib/a2a/private-worker-lock-process.test.ts`. Child lifetimes
are bounded and the test waits for the holder to exit before cleaning its files.
The local drill, TypeScript check and focused lint passed.

This establishes cooperative exclusion across actual processes and the intended
fail-closed behavior after forced process termination on the tested local filesystem.
It does not test power loss, storage failure, distributed filesystems, hostile local
file replacement, a production supervisor or crashes during a paid research job.
Operator identity verification and manual cleanup remain required after an actual crash.
No payment nonce, execution claim or database row is removed by this drill. M4/M5
remain open pending the broader settlement and operational acceptance work.
