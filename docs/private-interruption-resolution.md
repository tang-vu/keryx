# Private interrupted-job resolution

Version 0.22.50 adds an operator flow for a prepaid private job whose original execution
was claimed but has no saved answer. It does not rerun research, sign payments or refund
the buyer. The owner sees an explicit interrupted outcome and retains payment evidence.

## Operator procedure

Use the worker host, application directory, database environment, actual result spool
and its existing encryption key. Stop the managed worker and verify quiescence first.
The command takes the same exclusive lock as the worker. It never stops processes or
deletes a crash lock; a retained lock requires separate verified-stop investigation
under the [worker recovery procedure](./private-worker.md). Age or a missing local PID
alone does not authorize removing a lock. Do not point at a fresh empty spool to bypass
backup inspection. Check known off-site copies separately.

Keep a private, absolute-path JSON locator containing only the original `id` and `payer`.
Do not put locators, keys or private questions in Git, public logs or product updates.
Load the existing worker environment explicitly; the npm shortcut does not load secrets.

```sh
node --env-file=.env.local --env-file=.env.private-worker.local --import tsx scripts/private-interruption.mts --locator /absolute/private-locator.json
```

The default is preview. `backup-available` means a matching authenticated original result
can be restored. `interruption-proposed` means no matching result was found during the
complete bounded scan. Repeat the same command with `--apply` to restore that backup or
record interruption. `already-interrupted` is an idempotent preview; apply can finish a
previously interrupted capacity-release write. `result-available` makes no job mutation.
Preview may initialize normal database schema and acquire/release the cooperative lock.

Corrupt backups, unknown files, directories, mismatched execution authority, unavailable
storage and scans exceeding 10,000 entries refuse closing. A backup for the selected job
is restored before considering interruption. Restore does not require declaring all other
jobs' backups absent. The command emits status only, without job or worker identifiers.

After resolving storage errors, repeat preview/apply against the same job. A lost database
response does not authorize payment retry. Once finished, resume the managed worker and
use the normal operations inspector. Never remove an execution claim or payment nonce.

## Payment and result semantics

The immutable interruption fence serializes with creator admission. Once recorded, no new
creator payment can be admitted to that job. Capacity release is original creator budget
minus **all admitted authorizations**, including pending, expired and failed-observed legs.
It is internal allocation reuse, not a transfer, refund, revenue or increased capital ceiling.
Existing creator confirmations can still arrive and update their original evidence.

The original result may later be restored from a recovered backup. It must pass existing
owner, worker and request binding. The owner then sees the completed result; the permanent
interruption fence still prevents new payments. An interrupted outcome never manufactures
an answer or reports a refund. The browser advises retaining the recovery file and not paying
again to recover this job. Older CLI clients that reject the added `interrupted` status need
an update; validation failure is not permission to re-sign or repay.

SQLite initializes the new ledger locally. Supabase deployments require migration 0061,
including the service-only interruption RPC and updated admission/release functions.
Normal users cannot invoke this operator action through the website.

## Evidence and remaining scope

SQLite tests cover owner/worker isolation, simultaneous records, immutable identity,
uncertain-spend retention, late confirmation/result restore, corrupt backups and retained
locks. PostgreSQL 17 checks cover admission/interruption contention, allocation conservation,
client/direct-service write denial and later original-result restoration. The browser check
covers interrupted display followed by restored results without payment requests.
Supabase client-transport checks also simulate a committed RPC with a lost response:
retry reads the original record, while missing or foreign-worker readback is rejected.

Reproduce the focused checks with:

```sh
npx vitest run lib/db/private-research-interruptions.test.ts lib/db/private-treasury-release.test.ts
node --import tsx scripts/test-private-treasury-postgres.mts
node --import tsx scripts/test-private-worker-drain.mts
npm run test:browser-private-history
npm run typecheck
```

The PostgreSQL harness needs Docker; the signal drill needs Linux. These checks use
isolated synthetic data and must not load production secrets or point at live storage.

Release validation for `3d186b5`: local TypeScript and focused ESLint passed; the full
Windows unit suite passed 1,347 tests across 205 files. PostgreSQL 17 checks and the
extended local Linux process drill passed. [CI run 34552699703](https://github.com/tang-vu/keryx/actions/runs/34552699703)
completed successfully, including the Linux worker/operator drill, browser checks,
contract checks and Next.js production build. This is release verification, not
independent customer acceptance or evidence of mainnet settlement.

Production deployment completed on 2026-09-11. `/api/health` reported `operational`
with commit `3d186b5`; the private operations inspector reported a matching idle worker
and backed treasury. A protected read-only digest comparison confirmed the original
owner-operated pilot's intents, payment attempts, execution, result, creator submissions
and confirmations were unchanged. No live interruption was recorded. Existing reserved
capacity and the prior release were unchanged. The operator apply path was exercised only
with isolated synthetic jobs; this deployment does not establish a live paid crash drill.

The actual Linux worker/CLI drill terminates a synthetic prepaid job with SIGKILL, verifies
the retained claim and lock behavior, then previews/applies interruption in separate
processes. It passed locally with network guards and unfunded fixture keys. No production
job, live creator payment or refund was used. Live paid crash acceptance, full support/refund
terms, off-site recovery and independent user acceptance remain open mainnet requirements.
