# #257 fixed native25 stock migration

This source completion extends the existing protected private-profile/metadata
command to the compiled 25-table native user-domain bundle. The parent applied
the independently reviewed source and passed the affected synthetic controls
and changed TypeScript checks. It performs no
production DDL, activation, ownership backfill, funding, deployment or publication.

The migration-only predecessors are exact source-built full19, full20, chat22 and
pre-pending24, each with and without the public-reference archive. Runtime storage
admission still has four exact profiles. A count of 25 tables alone grants nothing:
unknown names, partial definitions, missing immutable triggers/indexes, missing
identity fences and future families remain refused.

For old24, the only new domain is `pending_job_owners`: its source-defined table,
wallet index, two immutable triggers, implicit indexes and identity fences. All six
existing owner269 occupancy guards and every old schema object remain unchanged.
Older predecessors also receive the already-reviewed missing topic/chat/owner
objects. The trusted isolated source installer supplies the DDL; no target metadata,
caller table list, environment value or file supplies executable SQL.

New pending ownership starts empty for every old-family migration. No historical
order, query, payer, account or private original is inferred to be an admitted
pending owner. An already-current25 store retains any existing pending cells
exactly. The idempotency fixture uses expired, schema-valid synthetic retention
rows linked to a synthetic failed A2A order; it does not claim authenticated
admission, current session authority or successful payment.

`pendingJobOwnersMigrationProfiles()` from `lib/db/topic-watches-storage-migration.ts`
contributes only the two old24/current25 pairs to the existing command's inspection
and historical dispatch. The same-named export and separate executor in
`lib/db/pending-job-owners-storage-migration.ts` remain unchanged; this command
uses the stock metadata executor. Its grammar,
manifest/identity bindings, exclusive stopped-writer migration and no-replace
verified backup remain unchanged. Per-family process-local caches retain deeply
frozen pure source profiles/DDL only; they cache no target state or authority.

The existing EXCLUSIVE identity/fence checks, read-only backup admission,
complete typed snapshots, rollback, post-COMMIT acknowledgement checks and cleanup
remain intact. Raw text/JSON, integer/bigint, real/blob/null cells, rowids, financial
statuses and original amounts remain part of the before/backup/after comparison.
Acknowledgement uncertainty preserves the backup and writer stop; it cannot
restore an old backup over committed source or authorize signing/replay.

The two existing migration test files retain old19/20/chat22 controls and add both
archive variants of a populated old24-to25 migration. They require an empty new
pending table, all old typed cells/schema/guards and the verified backup to remain
exact. Additional controls cover already-current retained pending cells, malformed
count-equivalent25/partial pending definitions with identity fences, new-pending
fence rollback and old24 post-COMMIT uncertainty. Synthetic predecessor setup
drops pending ownership using the fixed existing storage-capability helper before
identity fences are installed; no application factory or runtime guard is bypassed.

Parent validation passed all 37 stock-CLI cases and 11 helper cases, including both
archive variants, preserved old24 guards and typed originals, empty new pending
ownership, retained current25 pending cells, refusals, rollback and uncertain
acknowledgement. The inherited 18 mounted assignment cases also passed on the
current25 facade after correcting only their obsolete beforeEach table count.
The five changed TypeScript roots passed. All processes closed naturally with
exit 0 and both output streams at EOF; source and dependency controls were unchanged.

The separate native publication fixture passed its named current25 case. The
compiled consent selection passed 17 cases on build `uMOXtCGhE1wUtct0AppbT`;
the other 37 compiled cases were not run by that selection. These migration-only
changes do not alter that application closure or the 459-source study inputs.
The same focused #257 PR still requires exact-head CI and serialized merge.
Sole ROOT retains target migration and combined batch delivery; no production
migration or ownership backfill has been performed here.
