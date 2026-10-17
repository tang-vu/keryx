# Cumulative public article library

Public feed refreshes now add articles to a separate retained library. A feed's
current preview is not the limit on a publisher's retained history. There is no
ten-article lifetime cap and an article disappearing from RSS does not delete it.
Repeated imports use canonical article identities; changed bodies retain distinct
immutable versions. An extracted original-page body cannot be replaced by a later
short feed preview.

Browse the article section of `/sources`, search literal words, select a publisher,
and page through recent or older publication dates. Undated articles keep an
unknown publication date. Collection time never makes an older article recent.
The reading library shows the matching article count and links to the publisher's
original page. Research links open an editable question; they do not dispatch or
authorize payment automatically.

The agent retrieves historical articles separately for research targets and can
propose different articles from the same publisher. Each admitted article keeps
its exact link, content version and body. Relevance matches are discovery, not
verified findings. Existing reading decisions, attention limits, evidence gates,
recency requirements and money authority still apply to each run.

## Recovering earlier articles

The explicit operator helper follows publisher-provided feed archive/pagination
links, robots-advertised sitemaps and article/archive links on the original site.
It keeps a resumable checkpoint and deduplicates URLs across runs. A finite run
does not impose a limit on how many articles the library may accumulate.

For a reviewed, selected SQLite profile with the archive installed:

```powershell
node --import tsx scripts/backfill-public-references.mts `
  --reference public:martin-fowler `
  --checkpoint D:/keryx-evidence/backfill/martin-fowler.json `
  --dry-run --max-pages 20 --duration-ms 60000

node --import tsx scripts/backfill-public-references.mts `
  --reference public:martin-fowler `
  --checkpoint D:/keryx-evidence/backfill/martin-fowler.json `
  --apply --max-pages 20 --max-documents 25 --duration-ms 60000
```

Load the operator environment explicitly. Preview fetches discovery resources and
retains article candidates without writing articles to the selected database.
Apply continues that same queue and archives the fetched material. Repeat finite
batches to continue; cancellation, failed reads and incomplete queues retain their
progress. Checkpoints bind the source and selected storage profile. A checkpoint
for another source or database is refused.

`--database` is restricted to an existing ordinary offline testnet staging database.
It cannot select or override an enrolled/mainnet production target. Production
backfill belongs to the existing release/operation owner after backup, archive
migration and the applicable storage gates. The command installs no scheduler and
creates no new funding or spending authority.

Public HTTPS transport, robots rules, publisher pacing, response-size bounds,
inert HTML extraction and bounded PDF extraction apply. Redirecting crawler
resources, inaccessible/challenged pages and off-origin links are refused.
Feed excerpts, abstracts, metadata and original-page extracts retain their scope;
finding an article URL does not mean its text has been recovered. Unknown archive
coverage stays incomplete. Deleted or inaccessible originals cannot be promised
back merely because an older feed once listed them.

## API and supported surfaces

`GET /api/public-references?query=&referenceId=&sort=&limit=&cursor=` searches the
retained article library. `GET /api/public-references/{id}/items` selects one public
publisher. Sort is `recent`, `oldest` or `relevance`; page size is 1–100, default20.
Responses contain article metadata, summary excerpts up to600 characters, the
matching total and an optional query-bound cursor. Whole retained bodies, wallets,
creator ownership and payment authority are excluded. Invalid queries/cursors
return400; unavailable archive storage returns503.

Hosted web/API, remote MCP and bot research use the shared agent discovery path.
CLI/stdio MCP, desktop and extensions retain their established hosted research
handoff and custody roles; server archive reads improve that research without a
client-supplied crawl or storage authority. Local research databases require their
own explicit onboarding/backfill. Supabase's public catalog/archive remains
unsupported until its own schema and adapter acceptance exists.

Enrolled SQLite runtime performs no archive DDL. Its predecessor profile remains
supported and archive writes/queries require the explicit archive migration.
The existing coordinator owns combined-source CI, migration admission, deployment
and any applicable package/installer gates. A ready candidate or a local backfill
does not establish production delivery.

## Enrolled storage migration

The existing operation owner first establishes stopped writers and the reviewed
backup/drain gates. Inspect the selected deployment manifest without modifying
storage, then use its exact manifest and identity digests for admission:

```powershell
node --import tsx scripts/source-archive-storage-migrate.mts inspect `
  --manifest D:/keryx-operator/storage-manifest.json

node --import tsx scripts/source-archive-storage-migrate.mts migrate `
  --manifest D:/keryx-operator/storage-manifest.json `
  --expected-manifest "INSPECTION_MANIFEST_SHA256" `
  --expected-identity "INSPECTION_IDENTITY_SHA256" `
  --backup D:/keryx-evidence/source-archive/new-backup.sqlite `
  --receipt D:/keryx-evidence/source-archive/new-migration.jsonl `
  --writers-stopped
```

The paths above are examples; the operator uses its admitted manifest and fresh
absolute backup/receipt paths. The helper refuses overwritten backup/receipt
files, changed identities/manifests, unexpected schema profiles, mismatched
backup contents and lost original rows. It adds the archive and exact fences in
one transaction and seeds retained legacy feed snapshots. A successful receipt
does not authorize signing or writer resumption; those require the existing
post-migration operational gates. A refused or incompletely acknowledged attempt
keeps writers stopped and preserves its originals and evidence.

Mainnet accepts exact source-built base and full native25 profiles, each before
or after archive activation. Partial native definitions, missing immutable
guards and unknown tables remain refused. Original fulfillment, native rows,
identity and existing fences remain part of the exact preservation checks.

For a combined migration and release, the existing protected redeploy config
accepts `keryx-redeploy-public-reference-archive-migration-v1`. It selects only
this fixed CLI and retains the six existing fields: `format`, `manifest`,
`expectedManifestDigest`, `expectedIdentityDigest`, `backup` and `receipt`.
The reviewed redeploy path verifies stopped public roles, uses the accepted
candidate's migration source, then starts the new cohort. The operator must
also stop every private or scheduled writer; `--writers-stopped` records that
evidence and does not stop processes. Failure after migration is attempted
keeps writers stopped and all builds retained, without an automatic rollback.

Migration snapshots retain limits of 64 MiB database allocation, 100,000 rows,
2 MiB per field, 128 MiB raw fields and 64 MiB framed row data. The allocation
limit is checked again after archive tables and legacy items are added, before
COMMIT. Enrollment's separate 32 MiB encoded snapshot limit is unchanged.
These operation bounds are separate from article retention. A larger store or
archive expansion needs a separately reviewed scalable migration rather than
weaker original-preservation checks.
