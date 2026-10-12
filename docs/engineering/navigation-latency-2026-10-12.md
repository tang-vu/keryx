# Responsive navigation on dynamic pages

The owner reported a 4–5 second pause after clicking header and other page links.
Read-only production observations on October 12 found initial document response
times of 2.74 seconds for Sources and 2.34 seconds for Activity, versus 0.29 seconds
for Pricing. These are individual observations, not typical latency estimates.

Dynamic routes without a loading boundary wait for server rendering before the
router can replace the current page. Add the existing lightweight `PageLoading`
boundary to Research, Proof, Usage, Purchase outcomes and Testnet history. Next
can prefetch that shell and show it while the requested data is still loading.
Sources, Activity and Market already have their own boundaries on the base source.
Convert the Usage links from Proof and Purchase outcomes to `next/link`, so they
prefetch and transition within the application.

Keep the boundaries scoped to those routes. A root-level boundary was rejected
after a compiled regression showed that an absent dispatch returned HTTP 200
instead of 404. Article, creator, wanted and archive lookup routes keep their
existing status and visibility decisions. The loading shell has no wallet control
that could start a connection whose intent would be lost when the shell disappears.

`scripts/test-browser-navigation-latency.mts` runs the actual production router in
Chromium and WebKit on mobile and desktop. It withholds final route responses,
requires the loading shell's next animation frame within one second of input, then
checks interruption, completed content, browser history and missing-route status.
The disposable offline fixture forwards only GETs and blocks API and vendor calls.
The production CI lane runs both engines. A prefetched shell improves time to
visible navigation; it does not establish faster database queries, completed page
data, or responsiveness before hydration/prefetch has finished.

Local acceptance on October 13: production build and TypeScript passed. Across
the 16 delayed-response cases, fallback frame timing was 36–509 ms after input.
Six absent-route checks retained HTTP 404. The existing built private-web test
also passed its initial-document nonce, RSC/prefetch refusal, one-shot handoff,
hydration, opener and unavailable-completion assertions. Those use synthetic
transport and do not qualify a funded private production domain.

This change affects web navigation and browser links into the web application.
Native desktop, CLI, API, remote/stdio MCP, extension and bot contracts and package
versions are unchanged. The existing coordinator owns combined-source acceptance,
version allocation and the next batch deployment; this candidate is not a separate
deployment. Further archive changes must be coordinated with the current metadata
outcome owner. Required PR aggregate/domain checks remain admission gates until the
approved hosted CI batching mechanism is implemented and verified.
