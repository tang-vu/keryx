# Selected-native decision review source partition

Source candidate against reviewed Core477
`f2fa7d3ff82203e32e560adac73d6206910c1e48`, October 14, 2026.
The first parent native run completed with **27 passed / 13 failed**; its focused
type check exited **2**. The correction below has no new executed acceptance.
Its independent review, reruns, checkpoint, PR, required CI and delivery remain
**UNRUN**. This document does not establish production readiness or enable
review-first execution.

`createEnrolledSqliteDecisionReviews(db)` returns the existing optional
`DecisionReviewsStore` on the same verified selected native SQLite connection.
It accepts exactly one genuine handle, requires mainnet identity, validates
runtime manifest/file/identity/fences and the entire supported source profile,
and requires the full19 WeakMap policy with fixed FK-on/busy-timeout-5000 metadata.
Full19 without or with the public-reference archive uses source profiles 1 or 3;
exact original BEFORE without or with the archive uses 0 or 2 and returns
`undefined`. Partial, unknown, unfenced or unprofiled full19 handles refuse.
There is no target DDL or ordinary fallback. Domain shape comparison is pure
source data; supported whole-store reference profiles remain the existing cached
profiles prepared by trusted native opening.

The ordinary constructor retains its original ordinary-authority assertions,
auto-DDL and transaction handling. Only a private same-file journal composition
is factored. Its projector, SQL, owner predicates, captured economic terms,
60-second one-time activation, exact verdict keys, state checks, consume CAS,
cancel/expire/observe rules and aggregate calculation stay shared unchanged.
Native writes additionally check actual read-only metadata before parsing or SQL.

`ready`, `list`, `read` and `metrics` use read transactions. `capture`, `begin`,
`verdict`, `consume`, `cancel`, `expire` and `observe` use immediate write
transactions. Expected conflict/not-found/expired refusals retain authority only
after successful rollback, no remaining transaction and intact guards. Only
trusted native `Error` with exact `code="ERR_SQLITE_ERROR"` and numeric
`errcode=5` or `6` is treated as request contention before COMMIT. Failed guarded
BEGIN has no journal-owned transaction; the existing verified connection cleans
its own guard snapshot. Acquired transactions require verified cleanup. Other
SQL/projection/guard failures close and permanently revoke the borrowed connection
before cleanup can see restored inputs. Any COMMIT or post-COMMIT failure also
revokes and withholds ACK, including genuine busy errors. A persisted record after
lost ACK is not evidence that its caller received success. Restoring inputs never
revives an old port.

## Selected-store facade attachment and dependencies

ROOT explicitly assigned the own-worktree facade attachment and exact graph
edge in this source-only completion. `enrolled-sqlite-adapter.ts` adds only the
actual factory import and its truthy optional attachment before facade freeze.
All existing optional ports, Core method inventory, financial wrappers and
native constructor/journal bodies remain unchanged. ROOT retains full19
installation/migration, `enrolled-sqlite-schema-profile.ts`,
`storage-identity-connection.ts` MAX4/fixed policy, storage fences, claims/privacy
and combined-source acceptance. The existing Core477 source supplies the full19
schema/table family, four whole-store profiles and positive native policy;
this completion creates no alternative installer or policy.

The existing mainnet optional-port assembly now attaches the same connection's
returned capability before freezing the facade:

```ts
const reviews = createEnrolledSqliteDecisionReviews(db);
if (reviews) Object.defineProperty(facade, "decisionReviews", { value: reviews });
```

Both writable and actual read-only factories use this assembly. The journal
enforces the method split. The returned port is frozen and its property is
nonenumerable, nonwritable and nonconfigurable. `decisionReviews` adds no
`SqliteAdapter.prototype` method or top-level access-inventory entry. Invalid
full19 failures propagate without publishing a facade; exact BEFORE and testnet
facades retain absence. The finite graph permit adds only the existing
`lib/db/decision-reviews-sqlite.ts` to
`lib/db/enrolled-sqlite-schema-profile.ts` edge. Funding executors, enrollment,
ordinary selectors and executable negative controls retain their existing rules.

Disposable controls call the actual facade factories with
canonical selected manifests and existing schema installers. Both archive
variants cover BEFORE absence and hidden frozen full19 ports, default-OFF
capture/read/observe metadata, owner isolation and original users/query bodies
written through Core APIs. Every read-only journal writer must refuse before
SQL while ready/read/list/metrics, Core readers and the existing history reader
survive. Partial full19 refuses without repair. Invalid manifest, changed valid
provenance digest, schema and fence drift must permanently refuse both old
facades after restoration. One actual held-file rename attempt must either
produce Windows EBUSY with unchanged file identity, bytes, schema, financial and
decision metadata and healthy original readers, or, when replacement succeeds,
permanently refuse both old facades before and after exact restoration. Fresh
verified opening remains a separate capability. Existing financial-row, SQL,
deadline, state, lock and model-authority assertions are retained. No captured
recommendation, provider call, human verdict or payment action is introduced by
this facade completion.

The existing web owner GET/live broker, metrics route, ask readiness and UI
already consume `KeryxDB.decisionReviews`. Authenticated browser owner/session,
live continuation, fresh grant/terms, budget and normal gateway authority remain
their existing checks. GET can expire stale holds and therefore needs writable
session storage; a read-only store directly supports list/read/metrics only.
Native storage support does not activate the review-first gate or authorize
funding/signing/refunds/retries. CLI, remote/stdio MCP, desktop integrations,
extensions and bots retain their existing role and unsupported interactive-mode
refusals; ROOT owns the final supported-surface audit and release.

## Observed failures and bounded correction

The retained first run selected 40 native cases, exited 1 and took 843.484 seconds
wall time. Twelve cases failed their unchanged 20-second deadline, with recorded
durations about 23–125 seconds. The old nonfacade file-drift case failed on an
actual Windows `EBUSY` rename. These results establish no protocol/guard failure
cause. The focused type capture identifies five TS2722 calls at original lines
150/202/243/274/452: the optional method is `personalHistory.receipts`, while the
current `KeryxDB.init()` contract is required. Each call now positively asserts
that actual function and invokes the same receiver with the same two arguments
using a non-null assertion. No initializer or substitute capability is added.

Only the native hot `check()` changes runtime behavior: it retains the revoked
latch, checks genuine zero-SQL full19 metadata and runs one full verified
connection guard. Constructor `schema()` and exact BEFORE/partial/unknown/fence
admission remain intact. Immutable `storage-identity-connection.ts` captures the
actual full19 source profile at trusted opening, then its `assert()` compares
against `[nativeUserDomainProfile]`, rather than either supported family. That
exact opening pin also remains on every wrapped SQL primitive. The hot check
therefore delegates to that existing complete guard without an added cache,
caller flag, raw proof or weakened per-primitive guard. Static call reduction is
not a latency measurement or proof that the deadline failures are resolved.
Ordinary construction, contention classification, transaction/cleanup guards,
COMMIT uncertainty, private SQL observer and the shared journal/port body remain
byte-identical to the first-run source outside the hot-check delta.

The old observed file case now makes one actual rename while its native handle
and target descriptor remain held. Only an actual win32 `EBUSY` enters prevention
checks: no moved file, unchanged dev/inode/birth identity, whole bytes, schema,
record/verdict counts and original financial rows, plus healthy original decision
and history readers and provenance. Successful rename still substitutes a real
copied file, requires old-port/provenance refusal before restoration, restores in
`finally`, then requires continued refusal and a separate fresh opening. This
uses the R112/R115 accepted facade branch pattern without another attempt,
proactive close, skip, delay or deadline increase.

One new **UNRUN** control removes the genuine public-reference archive and its
fences from a disposable full19 archive store, leaving no new objects outside
the old opening's exclusion set. A fresh actual read-only opening must accept
that other supported family and read the unchanged record, while the old
opening refuses. After exact schema restoration, both previously observed
openings must refuse permanently; another fresh opening reads the original
record. No production schema or shared Core source is changed.

First captures remain untouched under
`output/resume-distribution63-audit-20261012/native-decision-first-genuine-controls-20261014/`:
`actual-result.json`, `report.json`, `types-result.json`, both raw native streams
and the raw type stdout. Their original 27 passes remain bound to the captured
source/inputs, not blanket acceptance of this changed candidate. All prior
13 failures stay unaccepted; corrected/new controls and refreshed types are
**UNRUN**. R97 and R115 receipt
`9c893602c48483eab01c1f14e07a0a52c6e682fd6f19ec9e83b9c3373b3da6d3`
remain reusable only outside this delta. Full raw before/after files, forward and
whole inverse patches and exact pins are retained in ROOT's R118
`worker-completeDecisionNativeHotGuardAndObservedFixtures` output. No speed or
native-policy acceptance claim follows from source inspection.

## Parent completion recipe

Run in an authorized parent validation slot, with its isolated disposable output
and unchanged pinned dependencies/runtime. No command below was run here.

1. A different bounded peer reviews only this delta, reusing R97/R115 outside it.
   Parent then selectively reruns the prior 13 failed cases and the new alternate
   supported-family negative at the existing deadlines, preserving all first
   captures and reusable unchanged-source evidence. The observed drift title now
   includes `prevents held-file replacement or`; map the old failed file case to
   that corrected case rather than losing it from the selection. The file contains
   genuine verified file/manifest/fence/full19 fixtures for both
   archive variants, owner isolation, captures, activation, exact terms,
   opinions and key retries, concurrent native ports, single consume,
   decline/cancel/expiry/last-mile refusal, metrics, actual read-only zero-SQL
   denial, real reserved/exclusive/COMMIT locks, observed drift/restoration,
   internal mutation guard failure, unclassified errors and actual committed
   lost ACK, plus the actual writable/read-only facade controls above. Every
   fixture compares retained rows from thirteen original financial tables,
   including nonempty synthetic original order/payment rows. Facade metadata
   controls also compare unchanged original user and complete query-run rows.
2. Ordinary and caller regression:
   `npm test -- lib/db/decision-reviews-sqlite.test.ts lib/db/decision-reviews-supabase.test.ts lib/research/decision-review-live.test.ts lib/research/decision-review-routes.test.ts lib/research/decision-review-authority.test.ts lib/research/decision-review-metrics-route.test.ts lib/ask-review-admission.test.ts`.
   Reuse valid unchanged-source/input results; refresh shared native
   connection/facade/canonical checks only when ROOT changes their inputs.
   Run the changed finite graph control with
   `npm test -- lib/operator/gateway-funding-composition.test.ts`; its existing
   funding/enrollment and ordinary-selector negative cases remain required.
3. Both existing type graphs:
   `node node_modules/typescript/bin/tsc --noEmit --incremental false`, then
   `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.ops-scripts.json`.
   ROOT retains proportionate lint/build/browser/domain checks, independent
   exact-source review, focused PR and actual required aggregate/domain CI.

Real numeric-6 lock reachability, acceptance of the 13 failed native cases and
new controls, refreshed types and complete combined-source/surface gates remain
parent work. Authored fixtures and read-only inspection establish no new passing
runtime result. Parent owns current-main reconciliation, one coherent focused PR,
actual required aggregate/domain CI and submission to the sole coordinator for
serialized merge and batch release. Current app65 and its frozen release are
unaffected by this correction.
The original parent broad #301 criteria, production migration and any activation
remain **OPEN**; default-OFF source availability enables no human-review pilot.

## Parent changed-control result

The R118 correction received an independent scoped source review (`eca9cdbd`).
The parent then selected exactly the 13 previously failed cases and the new
supported-family drift case: **14 passed, zero failed**, natural exit 0 with
separate stdout/stderr EOF, in 123.234 seconds. Focused TypeScript checking also
passed in 19.244 seconds. The original 27 passing cases remain retained only for
their unchanged source/input scope; they were not replayed or counted as new runs.
The old failures remain archived. Current-main composition, the actual changed
storage-graph check, required PR CI and coordinator-owned delivery are still
pending. These results do not activate review-first execution or close #301.
