# Source library archive outcome —2026-10-12

## Acceptance and source ownership

The source-library outcome owns cumulative public article retention, target-aware
historical discovery, searchable paginated public browsing and explicit resumable
historical backfill. Existing approved publisher catalogs and their pending
production import remain owned by the source-volume session. The existing release
coordinator owns merge order and production operations.

Implementation acceptance requires retention across refresh/restart, idempotent
canonical deduplication, exact immutable versions, atomic invalid-batch rollback,
indexed historical matching, stable query-bound pagination, deactivation and
read-only/unsupported storage refusal. Crawler acceptance requires safe URLs and
redirect refusal, robots/pacing, malformed resource refusal, no fabricated body,
checkpoint binding, interrupted resume and progress across finite batches.

Review SSE/free-evidence/creator authority end to end. Check TypeScript, scoped
lint, representative browser rendering and production build/required hosted
aggregate/domain gates. Record real public recovery separately from fixture
tests. No payment or model call is needed for recovery acceptance.

## Surface audit

| Surface | Outcome and acceptance |
| --- | --- |
| Web | Article library search/publisher filter/date order/query-bound pages, retained totals, original links, draft research actions; browser/layout checks required |
| Public API | Additive read-only article-preview endpoints; bounded request parsing and explicit unavailable results |
| Hosted remote MCP | Shared runAgent historical discovery; no new financial or client crawl authority |
| CLI/stdio MCP | Hosted research inherits server discovery; explicit local operator backfill and storage migration helpers are separate roles |
| Desktop | Established hosted research handoff inherits archive retrieval; no local unapproved crawler or payment change |
| Extensions | Established source/question handoff; article research links remain drafts; no background crawl added |
| Bots | Hosted shared discovery; no bot-triggered import, crawl or storage mutation |
| SQLite | Additive indexed archive; ordinary local install and explicit enrolled migration; exact predecessor still supported |
| Supabase | Public catalog/archive still unsupported; no fallback database or fabricated empty acceptance |

`lib/openapi-spec.ts` is currently owned by the language276 completion session.
The additive path definitions in `lib/public-references/archive-openapi.ts` are
composed with that existing specification in the unclaimed public HTTP document
route. The public OpenAPI response includes both archive endpoints while this
task leaves the other session's specification module untouched. Its contract
test checks the new operations and the preserved ask route.

## Recorded implementation evidence

Local acceptance covers 422 distinct focused tests across archive storage,
migration, feed/parser/backfill, API, agent evidence, recency and payout behavior.
The initial combined run passed 421/422: its remaining OpenAPI fixture incorrectly
named the internal `/api/ask` route instead of the preserved public
`/api/agent/ask` route. The corrected API file passed 4/4; the other 418 passing
tests retain unchanged source. The failed original run remains retained evidence.
Application and operations-script TypeScript, scoped ESLint and engineering-feed
integrity passed. The isolated browser fixture passed search, publisher/date
filtering, pagination, draft links, unavailable storage and 320/1440px layouts.
It does not replace hosted production-build or deployed-route acceptance.

Real public recovery used only isolated offline testnet staging, with no model
or payment calls. Fowler's actual RSS supplied 30 entries. Django's ten-entry feed
was supplemented by five original articles outside that feed, reached through
its declared editorial links. Final-schema staging retained 45 articles across
two publishers and replayed 65 hash-validated captured versions. Literal search
found the older Django fundraiser article with its 2,971-character original-page
excerpt. These are staging counts, not production or complete-history claims;
one unavailable resource and resumable pending candidates remain explicit.

Independent review passed with source-set SHA-256
`25cf4be0a2fb7eca3b7332af062bde353cc116c7b065df0b73abd937a27c4b62`
over 39 runtime/config/test files. The common outcome record binds the final
commit, review report, local evidence and actual hosted checks. No local full
production build was attempted while another owner held the host-heavy slot;
required hosted production-build and aggregate/domain checks remain merge gates.

## Delivery and remaining operational work

At source freeze, record the exact PR/head, independent review and checks in the
common coordination outcome record. Offer the reviewed candidate to the existing
coordinator's next batch; do not independently deploy or allocate a version.

Production requires accepted combined source, verified backup/drain, explicit
archive migration/fence profile acceptance and the existing source-volume import
handoff. Historical recovery then resumes finite publisher batches and reads back
actual retained counts. Keep production counts separate from local staging.

Completed source work remains in its worktree until merge/delivery ownership is
accepted and local dependencies are closed; cleanup retains verified evidence and
never deletes an active or unmerged candidate.

The owner confirmed that article retention must be cumulative and historical
recovery should proceed when original publisher resources remain available.
Batch/pacing/context limits bound individual work; they are not publisher lifetime
retention limits. Stage the following changelog note for the existing coordinator
after its current `docs/project-changelog.md` owner releases that path:
"Sources now retains articles across feed refreshes, searches and pages through
publisher history, and supports explicitly resumed recovery from original
publisher archives. Production history is populated after the reviewed storage
migration and finite backfill batches."
