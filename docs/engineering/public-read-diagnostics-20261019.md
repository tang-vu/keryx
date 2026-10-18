# Public read diagnostics and honest report counts

The app80 SQL report `e94bb951-f284-4c07-94b4-7af3489b6758` selected two original public pages with the internal `CACHE` action. One page was read; SQLite's official WAL page returned the generic `transport-unavailable` result. The report nevertheless displayed “2 cached”. Selection neither proves a successful read nor means the body came from cache.

The original transport cause remains unknown. A separate later bounded fetch of the official page succeeded (42,143 bytes in 2,372 ms). That observation does not change the saved report or establish why its earlier read failed.

## Resulting behavior

- The guarded fetch retains only a fixed reason, elapsed milliseconds and, for an HTTP refusal, numeric status. Article reading carries these facts into the existing research trace event. Raw exceptions, hosts, headers, response bodies and URL query strings are excluded from the new diagnostic record.
- Fresh public reads, actual cache hits and unavailable reads have distinct report counts. Historical selections without recorded outcomes remain labelled selections, with outcomes unknown. Neither citations nor the `CACHE` decision alone establish a successful read.
- Existing exception identity/messages, DNS address-set checks, pinned connections, redirects, HTTPS/TLS verification, byte limits, deadlines and cancellation stay intact. No retry, search, model call, evidence admission, payment or reward behavior changes.

## Verification

The transport regression first produced 11 failures; the real AnswerCard regressions first produced two failures against the old label. Retained captures are under the isolated worktree's `output/public-read-diagnostics-20261019/`.

- 51 transport/article tests pass, including existing SSRF/pinned lookup and document-reader checks.
- Nine new outcome tests pass, including real AnswerCard rendering, actual `runAgent` with injected effects, public-report serialization, missing cache bodies and diagnostic isolation between sources.
- 410 existing agent/i18n cases pass. All focused runs finished with exit 0 and complete stdout/stderr; scoped ESLint passes for all 11 changed TypeScript files.
- The frozen 48-trial offline study is refreshed for actual changed inputs, with trial behavior and outbound-call bounds checked separately from source hashes.

No live research, provider/search call, payment or saved-report mutation was used for these checks. Required hosted CI and independent review remain the PR admission checks.

## Applicable surfaces

The hosted research reader, saved/live report trace and AnswerCard change. Account ownership, visibility, browser signing, API authorization and database schemas do not change. MCP and desktop do not gain a new research execution path, but their retained closed input lists include `locales/en/reports.ts`; its new English labels are a real package input change. The release owner must qualify the final component artifacts and versions rather than claiming unchanged distribution bytes. No version, publication, native installation or production acceptance is asserted here.
