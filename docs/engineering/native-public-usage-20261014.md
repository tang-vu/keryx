# Selected native SQLite public usage repair — October 14, 2026

Source candidate only. Author execution is **UNRUN**. This repairs the selected
store's missing classified public-usage capability; it does not establish live
delivery or close the broader original epic.

The reviewed base is `9caaa76f71f9da6216d3499da59aa2e8543c20c6` (ROOT privacy/Core).
The scope trace is `native-public-usage-selected-store-gap-scope-20261014.json`,
SHA256 `7003ea4738b515129b9fa2b4c05f874a91708e7933032356da5c531ab6855994`.
That dependency was not main-admitted at assignment. ROOT must reconcile the
focused candidate with actual main after its dependencies merge.

The enrolled branch previously returned a frozen facade without `publicUsage`.
The ordinary SQLite usage factory correctly refuses enrollment, so it cannot be
a fallback. The new one-argument native factory accepts only the verified
application connection and exposes a frozen read port. The enrolled facade has
one nonenumerable attachment before freeze. No other facade constructor,
personal-history, claims, privacy, customer, financial, Core, method-inventory,
flag or connection-policy body changes.

The ordinary transaction and complete corpus/history/published-history bodies
remain unchanged, composed through a private helper. Both constructors reuse the
existing pure projector: exact integer micro-USDC, positive recorded settled
references/status, unknown legacy provenance/networks, unavailable acceptance and
latency metrics, duplicate/ambiguous-corpus refusal, and the 10000-run,
50000-payment and 8MiB metadata limits.

Native reads assert the existing full runtime, held-file, manifest, identity,
fence and source-profile guard before operations and after asynchronous returns.
Read snapshots use `BEGIN`/`COMMIT`/`ROLLBACK`, including readonly connections.
Native privacy read/list execute SQL synchronously before their first await;
that SQL snapshot commits before yielding so concurrent requests cannot overlap
transactions on the same connection. Every later await is followed by the full
guard. A failed cleanup or any uncertain SQL/guard/projection failure permanently
retires the port and closes its admitted connection. Only actual
`ERR_SQLITE_ERROR` with numeric `errcode` 5 or 6 preserves the port for a future
healthy guard. Refused requests provide no substitute figures.

Summary reads bounded metadata across every visibility, preserving private
financial accounting without questions or actor IDs in its output. A valid
source-known BEFORE schema can qualify for summary. Active history additionally
derives a genuine full19 privacy reader internally from the same connection,
including empty-window admission. There is no foreign/ordinary privacy input or
legacy fallback. Construction captures the same flag policy as the enrolled
facade and refuses drift during its awaited initialization. Later ENVfalse does
not turn an active port off; an OFF port refuses later activation.

History classifies the full bounded window before selecting a page. Active
history reopens a public visibility read after awaited selection and validates
identity, creation time and classification again. The private recheck reader uses
the genuine native privacy public-only list, followed by bounded metadata in a
fresh snapshot; the link reader's unlisted body path is never used. Published
history reuses the existing complete bounded public-population traversal and rechecks each visible
row before counting and sampling. Concurrent revocation can underfill a page or
count; these separate snapshots do not promise an atomic population snapshot or
refill revoked work. A private/unlisted/erased row never supplies a public
question through active reads.

The new `lib/db/enrolled-public-usage.test.ts` authors separate genuine disposable
native cases under existing deadlines. It exercises actual application selection,
frozen writable/readonly facades, usage/runs/purchase-outcomes API200, invalid
filters400, failed native API503 (`complete:false`, `figures:null`), all cohorts,
settlement exclusions and exact micros, legacy networks, public/private/unlisted/
erased selection, population beyond100, empty admission, real WAL revocation and
identity/cohort changes after awaits, concurrent requests, flag capture,
overflow, uncertain cleanup, and permanent schema/identity/fence/file/manifest/
internal failures. SQL spies delegate real calls; no facade or positive ownership
provenance is mocked. Fixtures compare full original schema/economic rows and
file bytes, and observe zero constructor/request DDL/DML. The BUSY case uses a
real exclusive selected-file lock; LOCKED uses a genuine numeric6 error from an
active cursor on a separate disposable native guard database. Neither is
executed by this author.

Reuse unchanged ordinary SQLite, pure projector, duplicate/partial-corpus and
route-contract tests when their source and inputs still match. ROOT owns actual
focused execution, types, application-role graph seam validation, independent
source review, coherent PR, exact-head required CI, serialized merge and one
combined deployment after final-main release gates. No test, module, compiler,
database, build, producer, Git writer, provider, target, ENV change, activation,
spend or DDL was executed in this source-author session.

Web `/usage`, `/api/usage`, classified `/api/runs`, `/purchase-outcomes` and its API
consume the restored shared port without route/UI edits. Selected readonly
Operator/CLI/API consumers inherit that capability within their existing role;
desktop, remote/stdio MCP, extensions and bots require ROOT's applicable combined
surface/role-graph gates before distribution or delivery claims. Supabase is
outside this SQLite repair. Existing funding, custody, private holds and App54
restrictions remain; no version, schedule or release authority is added.

Raw before/after pins, byte-preserved originals, minimal forward patch, complete
inverse patch and `source-handoff.md` are retained in this worktree's local
`output/native-public-usage-20261014/` directory for ROOT acceptance. These
untracked evidence files must stay outside the focused PR's four source paths.
