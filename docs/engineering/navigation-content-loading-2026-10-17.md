# Show navigation loading in the content area

The owner found the corner loading notice confusing: clicking another page left
the previous page on screen for the whole server wait. Replace that notice with
an opaque content loading screen immediately below the header. Center its status
and use the same skeleton for existing route loading boundaries, so the visual
transition stays consistent before and after the router receives its response.

The header remains usable to choose another destination. Covered main/footer
content becomes inert and document scrolling pauses until navigation completes
or is superseded. Cleanup restores the prior values. Next's `useLinkStatus` still
owns pending state; ordinary links, automatic prefetch, cancellation and history
retain their behavior. The URL commits when Next accepts the destination response.
This changes the visible transition without claiming a faster server response.

Read-only public observations on October 17 measured first response at 9.95s for
Pricing and 13.71s for Sources from the owner's PC. These individual samples
confirm a separate response-delay issue; they do not identify an origin bottleneck
or establish typical performance. Further origin diagnosis remains open; these
observations are included in the handoff to the existing release owner.

Keep the existing route-scoped boundaries. A root loading boundary previously
changed missing-document HTTP status to 200; this outcome does not add one.
The loading fallback retains its simple wordmark without starting temporary
wallet connections. Reduced-motion users receive a stationary loading icon.

The existing built browser regression now withholds cold responses for Sources,
Answers, Pricing and registration on mobile and desktop in Chromium and WebKit.
It checks feedback before a response, opaque viewport coverage, centered status,
inert stale content, usable header, replacement navigation, restored scrolling
and interactivity, completion and history. Existing warm-navigation/404 and
private-document checks remain in the required production CI lane.

Local acceptance: all 16 cold Chromium/WebKit cases passed, with feedback measured
19–98ms after input. The warm Chromium regression passed all eight route cases,
interruption, completion, history and six missing-document HTTP 404 checks. Keep
`aria-busy` on the fallback main landmark as well as the reusable content shell.
Production build, TypeScript, focused ESLint and UI copy checks passed. Desktop
and phone screenshots were inspected. The local build supplied only an absolute
Turbopack root for the identical read-only dependency junction; repository build
configuration remains unchanged. Required hosted PR CI still gates merge.

Surface scope: web navigation, including web destinations opened by desktop,
extensions, CLI, MCP and bots. Native UI and API/payment/account contracts stay
within their existing roles. The sole release coordinator includes the accepted
main change in the next combined deployment; this task starts no separate deploy.
