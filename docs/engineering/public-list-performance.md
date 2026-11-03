# Public archive read performance

## Observed cause

On November 3, the installed VPS answered loopback `/pricing` in 11–18 ms but
`/answers` in about 8–9 seconds. A concurrent ordinary Answers read delayed pricing
by 9.37 seconds. This is server event-loop blocking, independent of client assets
or Cloudflare placement. The contained native profile materialized 505 run bodies
(297 scan candidates plus 208 publication rereads), totaling 179,205,151 JSON
characters. Parsing and validation/stringification consumed about 4.5 seconds.

## Implementation and boundaries

- `selectPublicRunRows` materializes only ordered/limited IDs before fetching
  large bodies. Public/unerased predicates, parent/ID filters and keysets stay in
  the same SQLite statement. No index, table, trigger or installer changes.
- The optional privacy `archivePage` returns at most 32 slim rows. It retains
  ineligible candidates as null cards so pagination still counts original rows.
  SQLite's ordinary and verified native ports compose this reader behind their
  existing guards; the native wrapper still checks authority before and after.
- The connection-local cache retains at most 4,000 cards, 8 MiB of accounted card
  text, and 64 KiB per card. It retains neither full originals nor trace graphs.
  Every lookup reads a currently public/unerased original, compares its actual
  byte digest and column identity, and clones returned cards. A changed original
  takes the existing full validation/language/confidence path. Oversized cards
  are valid but uncached; oversized/invalid originals still refuse.
- The archive retains question/language dedupe, citation/payment/newest ranking,
  ordering, the 2,500-run window and a fresh publication reread. Initial scan
  pages yield to other requests without holding a transaction. The final pass
  does not reuse the earlier publication decision. Failure returns no partial
  archive and never falls back to retained legacy text.
- Topic chips and source-library links/forms use `prefetch={false}` while keeping
  real GET URLs, client navigation, filtering and keyboard behavior. Header and
  shared navigation components remain with their existing owners.

The cited-source history path retains its fresh provenance projection. Full run
APIs, CLI/MCP, desktop, extension and bots retain their contracts and financial
authority. Their shared SQLite list benefits from metadata-first selection; the
slim cache is used only by public archive/feed/sitemap/topic/related-card reads.

## Acceptance

Focused coverage includes selection/language/order parity, keyset/parent/ID
filters, null window rows, mutable-caller isolation, same-ID changed originals,
uncacheable/invalid originals, memory eviction, revocation, tombstones, database
and schema refusal, irreversible native runtime refusal, publication rereads,
and serving another event-loop callback during an initial scan. The existing full
reader's failure suite also runs against slim cards.

Run the focused Vitest files `lib/answers-archive{,-cache}.test.ts`,
`lib/db/public-archive-page-sqlite.test.ts`,
`lib/db/enrolled-claims-privacy.test.ts`, and
`lib/run-privacy/public-lists.test.ts`, plus application/operational typechecks.
Full main CI and applicable native SQLite/Cloudflare compatibility checks remain
required. Hosted production/browser acceptance supplies the production build.

The actual selected native store was measured read-only in a transient unit with
384 MiB memory, zero swap, denied networking and a 120-second deadline. It used
the genuine read-only facade and unchanged guards, not copied or relabeled data.
All units exited and were collected; no serving process or database was changed.

| Same-process native operation | Elapsed | Maximum observed event-loop delay |
| --- | ---: | ---: |
| Full-reader control with the new SQL selection | 7.15 s | 7.14 s |
| Slim reader, cold card cache | 5.64 s | 1.47 s |
| Slim reader, first warm scan | 3.52 s | 1.44 s |
| Slim reader, second warm scan | 3.41 s | 1.44 s |

All four produced the same 208-card JSON digest, including order and every card
field. Cold validation fell from 505 to 297 originals; warm scans parsed and
validated no unchanged originals. These are contained native-reader measurements,
not a deployed end-to-end browser speed claim. Large originals are still freshly
read and hashed; cold startup, the remaining schema checks, cited history and
network/asset loading still cost time. A digest-UDF experiment did not improve
latency and was excluded.

Private source-qualified measurements and bundle/source manifests are retained
under canonical `.local/release-evidence/public-list-performance-20261103/`.
Production stays online on its existing installed source until the separately
authorized coordinated release; this change does not resume Cloudflare migration.
