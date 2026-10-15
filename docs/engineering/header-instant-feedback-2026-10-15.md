# Header feedback before prefetch completes

The owner reported that a Header click could leave the previous page visible for
around ten seconds with no acknowledgement. The existing route-level loading
shells cover prefetched transitions; their acceptance deliberately waited for a
completed prefetch. They do not cover a click while the destination is still cold.

All shared Header links now use `NavigationLink`. It retains Next's automatic
prefetching and uses `useLinkStatus` for the interval before navigation commits.
A fixed progress strip and accessible “Loading page…” status appear without
waiting for a route response. A body portal keeps the status visible when the
mobile menu closes and outside the sticky Header's backdrop-filter containing
block. It does not change Header geometry or block further navigation. Next owns
completion and supersession; there are no guessed timeouts or click interceptors.
Reduced-motion users receive the same feedback without animation. Existing
route-level skeletons continue to cover pending data after the route commits.

The built Chromium/WebKit regression aborts prefetch and withholds actual RSC
responses for Sources, Pricing and creator registration on 390px and 1366px
viewports. It requires visible feedback within one second, while the URL is still
the previous page, and checks mobile menu closure, replacement navigation,
completion, browser history and reduced motion. CI runs it alongside the existing
warm-prefetch navigation test. No research, account, signing or payment calls run.

Local acceptance: all 12 cold-navigation cases passed, with the next feedback
frame measured 11–112ms after input. TypeScript, focused ESLint, the UI copy guard
and the production Turbopack build passed. The local build only supplied an
absolute Turbopack filesystem root to resolve the verified read-only dependency
junction; the checked-in configuration is unchanged. Exact-source hosted CI
remains required. A webpack diagnostic was not acceptance: the shared install
lacks an optional connector package that the supported Turbopack build excludes.

Read-only production observations from this PC on October 15 found first-response
times of 4.10s for `/`, 9.57s for Pricing, 9.56s for About, 9.85s for Activity and
9.51s for registration; Sources exceeded a 20s request limit in that sample.
A separate Pricing request spent 0.46s establishing TLS but 8.62s to first byte.
VPS loopback reads also varied: Pricing 4.41s and About 1.38s. These small samples
show that origin delay contributes; they do not establish a typical latency or a
specific server bottleneck. This patch closes the silent-wait gap and does not
claim faster database results or faster initial hydration.

Surface scope: web Header navigation, including web destinations opened by other
clients. Desktop native UI, CLI, API, remote/stdio MCP, extension and bot contracts
are unchanged. Their existing roles and release versions remain with the sole
release coordinator. This outcome joins the next deployment batch after review
and required PR CI; it does not start an individual deploy.
