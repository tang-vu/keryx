# Finite public catalog imports

The October 17 production observation retained a 118,980,608-byte store with
145,819 typed rows, including 1,510 public articles, 1,526 immutable versions and
141,141 search-term rows. The manual 59-publisher import was stopped after about
32 minutes; the nine newly approved publishers were absent. Archive schema
activation and complete catalog ingestion are separate outcomes. These counts do
not establish exactly where that interrupted import stopped.

The writer previously ran one guarded INSERT per distinct article term. Each
execution revalidated the runtime manifest, target identity, fences and native
schema profile, even inside its publisher SAVEPOINT. Preparing the statement once
did not remove those checks. The importer printed results only after all feeds
returned. This is a source-confirmed scaling and observability defect; no new
production timing result is claimed here.

Term insertion now uses fixed parameterized `json_each` batches of at most 256
rows and 128 KiB. Normalization, title/summary/body weights, revision selection,
immutable originals, canonical identities and idempotency are unchanged. Every
batch still crosses the guarded connection and every inserted row still crosses
the existing storage fences. There is no raw writer, guard cache or schema change.

Before a publisher SAVEPOINT is released, aggregate SQL checks the whole store
against the existing archive-specific bounds: 250,000 rows, 256 MiB allocated
pages, 128 MiB raw fields, 128 MiB typed framing and 2 MiB per field, with the same
512-table/128-column bounds. Hidden rowids and exact TEXT/BLOB byte lengths are
included. Only counts and byte quantities leave SQLite. A private fixed metadata
reader measures allocated pages inside the same transaction; it keeps the full
runtime/path/identity/fence/profile checks and leaves application PRAGMA access
denied. Closed or revoked verified connections cannot fall back to ordinary SQL.
The generic enrollment, backup and provenance limits are unchanged.

One publisher's synchronous write and capacity checks have a cooperative 15-second
deadline checked between items, term batches and table aggregates. A refusal rolls
back that publisher's preview, revisions, article pointers and terms together.
Previously completed publishers remain committed. This deadline does not preempt
one synchronous SQLite statement or its existing 5-second busy timeout.

The existing `npm run import:public-references -- --apply` command still selects
the full approved list, without subset flags or automatic retries. It prints each
publisher's start and result immediately, with closed public failure codes instead
of upstream error bodies. A fixed 15-minute catalog window and SIGINT/SIGTERM stop
future publishers; cancellation also reaches the current bounded feed fetch.
Capacity or write-deadline refusal stops the batch. Partial completion is reported
with a nonzero exit and an explicit remaining-not-attempted count. The selected
SQLite capability is closed on exit. No recurring journal, schedule, model,
payment, registry, custody or funding authority is added.

Focused regression coverage includes exact multi-batch term weights, no repeated
indexing of identical revisions, typed framing against the existing encoder,
actual row/field overflow and deadline rollback, injected file/raw/framed refusal
rollback, cancellation/progress and the existing collision/deactivation behavior.
Native connection tests cover uncommitted allocation, permanent verified dispatch,
guard drift/refusal and PRAGMA denial restoration after a fixed metadata failure.
The inode replacement test runs on platforms that permit renaming an open SQLite
file. Required tests and review must pass before merge; a separately elected
production import must verify actual completion and the nine catalog entries.

The coordinated source batch advances app `0.27.74`, stdio MCP/Registry `0.4.29`
and Windows desktop `0.4.27`, because their packaged storage code changes. Hosted
MCP keeps its existing role/version; web/API, extension and bots use the updated
hosted archive without new request or payment contracts. Extension `0.1.4.3`
delivery is tracked separately in
[PR #551](https://github.com/tang-vu/keryx/pull/551). These are source allocations,
not observations of deployed, published or installed versions. The coordinator
owns exact-main CI/publication, one combined server deployment and one finite
catalog import; no further schema migration is needed for this change.
