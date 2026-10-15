# Operational migration of the native metadata bundle

The existing six-field `keryx-redeploy-native-user-domains-migration-v1`
configuration still selects `scripts/private-profile-storage-migrate.mts`.
There is no new command, startup DDL or per-port migration.

The command admits the source-built historical full19 schema as a migration-only
input. After its ordinary no-replace backup has been flushed and its complete
typed snapshot verified, an exact historical schema digest selects the existing
metadata helper. That helper reacquires EXCLUSIVE, verifies identity, fences and
the complete source snapshot against the same backup, then installs only the
compiled source's fixed metadata additions and their three identity fences.
Legacy baseline and already-current sources retain the original private-profile
migration path. The runtime still admits exactly four profiles; historical19
does not become an operational application profile.

The reference plan is built in an isolated in-memory database by the actual
source installer. It admits topic-only full20, or the coherent topic plus
`chat263_links`/`chat263_tokens` full22 when those tables actually occur in
the accepted compiled source. SQL never comes from a target, caller or environment
value. Every historical schema object must survive unchanged; every new object
must belong to a fixed new table. Newly added metadata tables start empty. All old
typed rows, pending payments, ownership/consent records and the existing
deliverable-acceptance singleton remain exact. This migration creates no user,
watch, link, consent, authorization, payout or settlement.

Current #284 source is full20. The new stock-command controls are authored for
that actual target and both archive variants. A later accepted #263 composition
changes the target to full22 and requires refreshed combined-source migration
acceptance. `pending_job_owners` and other families refuse: #257 cannot be added
until the release owner admits its source and the fixed migration reference is
reviewed and qualified for that target. Table presence does not activate a port
or feature flag.

The operator must hold the deployment lease, stop every writer and bind the
protected manifest, identity, fresh backup and receipt using the existing
deployment order. Unknown/partial schemas, changed typed source/backup/manifest,
callback mutation or failed DDL refuse. A failure after COMMIT is acknowledgement
uncertainty: retain both store and backup, evidence and stopped writers; do not
automatically restore, start an old binary or resume signing.

This source proposal is not production migration evidence. The parent #284
outcome applies it, runs the actual stock-command and failure controls, then its
current-source types/build/canonical/required CI. Only the existing release owner
can execute the protected migration in a batch. Web, Desktop, MCP, API and bots
share that selected storage; no surface receives an independent initializer.
