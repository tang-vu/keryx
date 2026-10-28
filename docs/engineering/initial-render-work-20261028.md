# Initial font requests and idle cursor rendering

The root layout previously preloaded all eleven Latin font files on every route.
Next's `preload` option applies to every source in a local-font call, so even an
unused italic face started downloading before CSS selected the faces on the page.
The full-screen cursor canvas also cleared itself and scheduled another frame
continuously, including before the first pointer stroke and after all ink dried.

The Bodoni and Spectral families now use CSS font discovery. The single variable
Spline Mono file remains preloaded for shared labels and controls. All families,
weights, styles, CSS variables, `font-display: swap` and Next-generated fallback
metrics remain intact. This trades early discovery of used serif faces for avoiding
compulsory downloads of all their unused faces. It does not establish an improvement
to first contentful paint or layout shift on every page/network; those need real
page measurements after the coordinated release.

The cursor schedules its first frame only after actual ink is added. It clears
the last old pixels before sleeping, resumes on a new stroke, and keeps at most
one pending frame when visibility changes. Hidden pages do not accept pointer
strokes. Its time-based drying, display-rate independence, touch/reduced-motion
policy and cleanup remain in place.

## Focused evidence

A bounded Chromium fixture used the installed Next local-font loader and the
checked-in font bytes, with an 80 ms delayed stylesheet and representative normal
heading, body, medium text and mono control. It allowed no external traffic.

| Fixture observation | Before | After |
| --- | ---: | ---: |
| Initial font requests | 11 | 4 |
| Initial font bytes | 297,896 | 127,268 |
| Compulsory preloads | 11 | 1 |
| Compulsory preload bytes | 297,896 | 36,476 |

The generated face rules and fallback metrics were identical. After fonts loaded,
the fixture screenshots had identical SHA-256 hashes. Revealing all styles/weights
subsequently loaded all eleven files in both versions. These measurements establish
less unused fixture traffic; they are not production timings or a whole-page SLO.
The script and receipts are retained under canonical `.local/` task evidence.

Nine actual React/canvas scheduler regressions cover initial idle, final clearing
and restart at 60/144 Hz, rapid input, repeated visibility events, hidden initial
mount/resume, coarse pointers, reduced motion and unmount with frame ID zero.
Six cases fail against the original component; all nine pass with this change.
The idle case advances 120 frames and requires zero animation requests and canvas
clears. Browser request timings, GPU time and production first paint are separate
acceptance items. Required hosted typecheck/build/browser and applicable domain
checks remain merge gates.

## Surfaces and delivery

This changes shared web rendering, including browser views opened from other
clients. Native desktop assets and CLI, API, remote/stdio MCP, extension and bot
contracts retain their current roles. Payment, wallet, source and storage authority
are unchanged. The existing ROOT/Circle owner retains version allocation,
publication and one qualified batched runtime deployment; this source change does
not redeploy installed93.

References: [Next font options](https://nextjs.org/docs/app/api-reference/components/font#preload),
[font discovery and rendering](https://web.dev/articles/optimize-webfont-loading),
[one-shot animation frames](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
