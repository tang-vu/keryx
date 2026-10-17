# Dashboard progressive loading and final QA — October 17, 2026

The owner reported slow or failed public-question counts and recent questions,
and requested broad safe testing and one combined deployment before October 18,
10:30 Vietnam time. The public dashboard already used independent requests;
five initial reads and ten-second polling still competed for synchronous SQLite
work. A live count request exceeded 25 seconds, recent history took 8.4 seconds,
and a separate browser pass found intermittent origin delays on other routes.
These observations do not establish a typical latency or a client navigation bug.

Current questions and their complete population count start first. Financial
reads start independently as their sections approach the viewport. The creator
anchor also enables the metrics required by its leaderboard. The recent-question
card and description render while its rows are pending; failure is distinct from
a genuine empty page. Either question request can finish while the other waits.

Public question bodies retain their existing ten-second refresh so visibility
revocation continues to remove text and links on the same cadence. Other reads
refresh after sixty seconds, with no overlapping requests. Hidden tabs pause new
reads and resume with a fresh read. Errors retain the dated previous observation
and the existing manual retry behavior. No cached privacy or payment verdict is
introduced.

The shared header's settled-payment ticker uses the same bounded reader, keeping
its thirty-second cadence and settled-only display. Its previous fixed interval
could overlap slow requests and left network reads running after navigation.
The reader now waits for completion, times out at fifteen seconds, aborts on
unmount and pauses hidden tabs. A failed refresh still replaces the ticker with
its unavailable/retry state instead of presenting old payments as a fresh read.

The dashboard requests its displayed 25 recent questions. `/api/runs` accepts
one optional decimal `limit` from 1 through 50, defaulting to the existing 50.
Invalid or repeated values refuse before reading storage. Network/cohort/privacy
selection remains in storage before paging; current/archive default scans and
their incomplete-coverage labels stay intact. The complete public population
still comes from `/api/runs/summary`, never from a page length.

Validation includes the independent source review, hook behavior, invalid limits,
population/failure distinctions, existing real-route owner privacy revocation,
and the ledger/source browser harness. New browser cases cover both current
networks at 390 and 1440 pixels: delay count while showing questions, delay
questions while showing count, defer offscreen financial requests, and jump
directly to creators. Existing settled/pending/error/retry, source, archive,
account and guest distinctions remain in the same harness.

Baseline exact-main CI also covers core payment/SSE/auth, custody, native
desktop, CLI, remote/stdio MCP, bots and the extension. Direct public QA verified
walkthrough controls and stored receipt integrity, mobile navigation and report
layout, citation inspection, Escape handling and the decision log. Nine of a
bounded 15-route probe pass exceeded 15 seconds, so production latency remains
an explicit release verification item. No research, signing, funding or payment
was initiated by these probes.

Web and browser-hosted dashboard views gain this loading behavior. Other API,
CLI, MCP, native desktop, extension and bot callers retain their default history
limit and contracts. No new custody, spend, payment, privacy authority, schema,
schedule, package capability or installer behavior is introduced. The existing
release owner serializes merges and deploys the reviewed batch once, then checks
public identity, routes and timings. Source acceptance alone is not delivery.
