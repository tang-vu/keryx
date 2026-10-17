# Dashboard fragment navigation and browser history

Public QA after app 0.27.76 found that navigating from a dashboard fragment to a
saved report and pressing Back could restore the dashboard URL while retaining
the report body. Reload restored the dashboard. The three local section links
used native anchors. Native fragment entries can have null history state, which
the pinned Next App Router ignores on popstate.

The three section links now use the existing Next Link component, preserving
their labels, fragment URLs and scrolling. Next owns the history entries as it
does for the adjacent archive link. No custom history handler is introduced.

The existing compiled Next navigation harness now tests each of the three
fragments separately at 390 and 1366 pixels, with Chromium and WebKit. It checks
that the requested section enters the viewport, navigates to the real archive
page, then checks Back, Forward and Back again against both the exact URL and
distinct page headings. The old URL-only assertion could miss the stale body.
Other completed navigations also assert the restored page body. Existing delayed
response, immediate loading boundary, cancellation and HTTP-status checks remain.

The regression failed before the link change: Chromium at 390 pixels restored
the first fragment URL but timed out waiting for the dashboard heading after
Back. The three preceding navigation cases passed. Browser and server cleanup
completed naturally with no held requests. Tests use the existing GET-only,
offline disposable fixture and do not access production or payment providers.

After the fix, the rebuilt application passed all twelve cases on each engine,
including every fragment at both widths and the existing delayed-navigation and
HTTP-status contracts. Both runs exited successfully after browser/server cleanup
with no held requests. Independent source review found no concrete issue.

Local builds use the pinned Turbopack compiler. Its documented root is temporarily
normalized to include the read-only sibling dependency junction, then the config
is restored byte-for-byte. CI uses its normal installation and config.

The existing release owner reviews, serializes the focused merge after required
CI and includes it in the next deployment batch. No independent deployment or
version change belongs to this outcome.
