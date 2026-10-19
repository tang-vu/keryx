# Saved-report streaming

The dispatch page awaited the public archive solely to choose related links before
returning the saved report. With admitted privacy, this archive intentionally scans
public projected records and rechecks selected winners before publishing them. A
slow optional scan therefore held back an already-authorized answer.

The related-link lookup now runs in a small async Server Component under its own
Suspense boundary. The report can stream while that lookup waits. The existing
archive API, fresh publication checks, ranking, limits and refusal behavior remain
unchanged. Primary report visibility, reader identity, payment reads and other
enrichment retain their existing order. No cross-request cache was added.

On the original source, the new real React streaming regression produced four
failures and one pass: neither the public nor authorized private report emitted
its answer while the related archive was held. The final focused run passed all
43 cases across `dispatch-streaming.test.ts`, `read-dispatch.test.ts` and
`answers-archive-cache.test.ts`; scoped ESLint also passed. These checks cover late
fresh titles, revoked winners, hidden primary reports, discovery refusal without
legacy fallback, and existing public/private/unlisted/erasure filtering. They ran
offline with one worker and caching disabled. Required hosted CI remains pending.

This corrects a demonstrated blocking dependency. It does not establish which
operation caused the earlier browser navigation to exceed ten seconds, or promise
a measured production latency improvement. Database work and other pre-render
reads still have their own costs. The unrelated account-language fallback was not
changed.

The affected surface is the hosted `/dispatch/[id]` page, including report links
opened from web, API clients, CLI, MCP, Desktop, extension and bots. Their research,
payment, authentication and error contracts are unchanged. No package graph,
native application code, locale catalogue or distribution metadata changed; this
outcome allocates no version and performs no publication or deployment. ROOT owns
the next combined release and its applicable source and surface qualification.
