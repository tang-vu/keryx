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
against the fixed archive-specific bounds: 500,000 rows, 256 MiB allocated
pages, 192 MiB raw fields, 192 MiB typed framing and 2 MiB per field, with the same
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

The original import-performance source batch allocated app `0.27.74`, stdio MCP/Registry `0.4.29`
and Windows desktop `0.4.27`, because their packaged storage code changes. Hosted
MCP keeps its existing role/version; web/API, extension and bots use the updated
hosted archive without new request or payment contracts. Extension `0.1.4.3`
delivery is tracked separately in
[PR #551](https://github.com/tang-vu/keryx/pull/551). These are source allocations,
not observations of deployed, published or installed versions. The coordinator
owns exact-main CI/publication, one combined server deployment and one finite
catalog import; no further schema migration is needed for this change.

## Follow-up: cumulative guarded work

The single app `0.27.75` import ended naturally with exit code 1 after three
successful publishers and a `write-deadline` result for Lilian Weng; 55 publishers
were not attempted. The nine new publishers were still absent. The native archive
inspection accepted the unchanged schema and 148,089 typed rows after the run.
This is a partial import, not completion of Catalog 59.

An isolated source-built native-plus-archive fixture reproduced the same deadline
with all runtime manifest, target identity, fences and profile guards active. Its
698 schema objects and 94 tables included about 143,000 retained term rows. The
current public Lilian feed contained 52 items. Replaying the ten-item preview and
incoming items consumed about 9.94 seconds; a separate whole-store capacity pass
took about 11.67 seconds. Their cumulative cost exceeded the unchanged 15-second
publisher window. These are offline fixture measurements, not production phase
timings.

The follow-up reuses prepared statements only within one `writeItems` call. Each
execution still crosses the original verified statement wrapper and revalidates
the runtime manifest, target, identity, fences and schema profile. No guard result
or cross-operation statement is cached. Column metadata is read in one guarded
query, bounded to the existing table limit plus one and each table's column limit
plus one. The same per-table quantity checks, remaining row budget, hidden rowids,
field framing and writer snapshot remain in force. The 15-second deadline, all
capacity limits and publisher rollback behavior are unchanged.


The preparation-only statement reuse candidate completed the cached 52-item
new-publisher case in 14.94 seconds, with little margin. A subsequent single
full-catalog offline qualification used the real enrolled adapter and bounded
current feeds. Its first four publishers succeeded; Vicki Boykis had a feed
transport failure, and the 138-entry OpenAI Developers feed reached the writer
deadline. The remaining 53 publishers were not attempted. Neither observation
qualified completion of Catalog 59 or caused another production import.

The larger-feed correction writes chunks of at most 32 inputs with an 8 MiB
canonical snapshot payload budget; identity and article metadata remain separately
bounded by the public schemas and whole-store capacity checks. It fetches prior rows once per chunk and
simulates preference and revision transitions in input order, including duplicate
canonical IDs. Each original immutable revision is inserted with its exact TEXT
bytes. Final article states and selected index replacements use parameterized
set statements. Terms are inserted across items in batches of at most 256 tuples
and 128 KiB of encoded data. Every statement execution still crosses the native
runtime/identity/path/fence/profile guard; each row still crosses its SQL fences.
The publisher SAVEPOINT, 15-second budget, 32 MiB input budget and all archive
capacity checks remain unchanged. Malformed stored current-version metadata is
refused rather than converted or repaired.

Native SQLite MIN/MAX retain the first and last observation dates against the
unchanged observation timestamp. Stored TEXT bytes are not replaced by decoding
and re-encoding them in JavaScript; the separate sort-date selection keeps the
original behavior. Regression cases cover invalid UTF-8 after low-byte prefixes,
repeated refreshes and chunk boundaries.

The exact saved OpenAI RSS contained 138 entries and produced 128 usable unique
items through the unchanged feed snapshot logic. On a separate copy of the
retained synthetic native-plus-archive fixture, the larger-feed correction wrote
all 128 in 9.01 seconds with 229 full guard calls. All four public tables matched
the original sequential writer's ordinary isolated semantic oracle; reference,
article and immutable-version rowids also matched. Regenerated search-index
rowids are allocation details, while its full public columns and weights match.
The fixture passed integrity checks, and its baseline and RSS remained unchanged.
These are offline source measurements, not production phase timings. A second
full-catalog qualification of the bulk writer completed 31 publishers without a
write deadline, including a 435-item feed. Chip Huyen's feed transport timed out;
Distill then hit the unchanged capacity check at publisher 33 and rolled back,
leaving 249,548 typed rows and 26 publishers unattempted. Integrity and the native
archive inspection passed. The baseline's 143,385 terms included 140,676 terms for
an unrelated synthetic publisher, plus 2,709 Lilian Weng terms. Its capacity result
does not establish the production archive's overlap or needed capacity. Complete
Catalog 59 remains unqualified. No new production import,
deadline relaxation, capacity increase or automatic retry was implied by that synthetic run alone.

## Archive capacity from captured public inputs

A separate finite observation retained 58 approved public feed bodies: 32 cached
responses from the earlier qualification and 26 new successful responses. Django
had a generic fetch failure and remains unqualified; none of those observations
establishes completion of the 59-publisher import. Replaying the retained XML only,
without a database or network call, compared 2,516 usable inputs with the recorded
production metadata. It found 1,471 existing item identities, 1,467 exact current
revisions, 1,045 new article identities and 1,049 new immutable versions. The exact
selected index increment was 155,178 terms with no ambiguous length preference.
The public-only row projection is 303,774 from a recorded 146,482-row baseline.
These real incoming inputs, rather than unrelated synthetic filler, demonstrate
pressure on the former 250,000-row archive bound.

The fixed archive-only allowance is therefore 500,000 whole-store rows and
192 MiB each for raw fields and typed framing. Conservative new or rewritten
payload estimates for the 58 feeds are 29,204,492 raw bytes and 40,824,721 framed
bytes. Adding those to the previously accepted 128 MiB bounds fits below 192 MiB.
This arithmetic sizes an allowance; the historical whole-store count and missing
full-store byte baseline do not become fresh capacity acceptance. Old preview
transitions and SQLite page/index allocation are not completely forecast.

The writer and exact archive inspection/backup reader use the same fixed profile.
The reader now checks raw bytes against its selected operation bound; generic
callers still select the original 128 MiB raw limit. The 256 MiB allocated-file
limit, 2 MiB field limit, 15-second deadline, 512-table and 128-column limits remain
unchanged. Enrollment, generic backup/provenance and other migrations retain all
original limits. No source schema, identity, fence, custody or payment authority
changes, no reenrollment and no additional storage DDL are required.

Focused native fixtures cover inspection and writing above the former row/raw/
framing limits, refusal above each new boundary, publisher rollback and unchanged
generic refusals. An actual elected import must still pass its same-transaction
whole-store checks before each publisher commits. This correction does not retry
an import, truncate feeds or add a recurring job.
