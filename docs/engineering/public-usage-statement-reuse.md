# Reuse publication SQL within a native usage snapshot

The active native public-usage reader first classifies the complete bounded
metadata window, selects freshly public candidates, then revalidates their full
originals in one synchronous read transaction after its last await. The public
question-count route requests a one-row sample but still counts that complete
population. A small sample is never a substitute for the count.

The final transaction processes at most 100 candidate identifiers per execution.
It now lazily prepares that fixed publication statement once inside its own
snapshot callback. An empty population prepares no publication body statement.
Every new request creates its own statement. No statement, cursor, transaction,
privacy verdict or successful grant is cached across calls.

Every execution still traverses the verified native statement's fresh guards.
The SQL public/non-erased filter, full original validation, identity and creation
time bindings, privacy revision and recorded usage comparisons remain. All
candidate batches are checked before a response is returned. The final native
guard and transaction cleanup remain, including permanent refusal after uncertain
cleanup or identity/schema drift and the existing privately branded contention
rules. No await is added inside the final snapshot.

The 10,000-run, 50,000-payment and 8 MiB metadata limits, cohort/network rules,
complete count, mixed-identifier sample ordering and exact financial summary are
unchanged. Ordinary SQLite, Supabase and explicit privacy-OFF implementations are
unchanged. This adds no public API, schema, migration, writer or funding authority.

Genuine readonly fixtures check the 105-row population in two executions of one
statement in the same final transaction. Other controls cover no empty prepare,
a new statement for the next request and actual manifest drift during the second
execution. Restoring that manifest cannot revive the refused port. Existing
privacy mutation, corrupted original, row/byte bounds, readonly bytes, concurrent
snapshot, API refusal and economic controls remain required. A Windows inode skip
does not count as a pass; actual Linux native-policy cases remain a CI gate.

Eight completed cold Linux cost trials use baseline/candidate/candidate/baseline
for each empty and 1,000-public-row shape. They call the genuine readonly enrolled
facade's `publishedHistory(window, "default", 1)` on synthetic unknown-cohort,
non-paid records with about 17 KB of prose per original. All same-shape complete
count/sample hashes match, database bytes are unchanged and outbound, payment and
profile actions are zero. The container has one CPU, 768 MiB, 64 PIDs, no network,
a readonly root, no capabilities and no new privileges. These limits were read
back; native pressure enforcement was not stress-tested.

| 1,000-row whole-call measure | Baseline | Candidate |
| --- | ---: | ---: |
| Publication statement preparations | 10 | 1 |
| All native preparations, including guards | 1,583 | 1,502 |
| Schema reads | 1,365 | 1,302 |
| Median instrumented CPU, milliseconds | 4,763.268 | 4,476.954 |

There are two samples per variant and shape. The observed CPU reduction is about
6%; it is descriptive, not a production latency, capacity or incident-cause
claim. Empty preparation/schema counts are identical. Empty CPU samples vary,
so their lower candidate median is not evidence of less empty-path work.

Two earlier initialization starts were rejected by the actual mainnet startup
guards before any cost result: first an offline/mainnet conflict, then missing
matched registry import metadata. Their originals remain retained. The qualified
helper now configures matching Arc labels, offline bypass disabled, synthetic
matched registry metadata and one ephemeral content key before module imports,
following the existing native fixture. An actual configuration probe passes.
Those registry values are import metadata, not attested payout authority. Both
bundles bind the same corrected helper and dependencies; only the actual usage
runtime file differs. The baseline was rebuilt from its exact original Git bytes
and the owned candidate restored with hash verification. No guard, assertion or
deadline was weakened. All three owned containers are removed.

Application/operational types, source-bound study reproduction and full selected
PR/main checks remain separate acceptance gates. Cost comparisons use synthetic
fixtures. Production changes, deployment and release retain the existing owner's
explicit-command gate.
