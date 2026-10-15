# Dashboard #513 source leaderboard width

The owner reported a 390px production viewport with a 916px document and a
899.7px source leaderboard card ending at 915.7px. Other cards fitted their 350px
content area. These are supplied production observations, not measurements from
this worktree.

The populated leaderboard is a direct item of the dashboard's grid. Below `lg`,
that grid has an implicit `auto` column; the card's automatic minimum width takes
its contents' intrinsic width. The source link already uses `truncate`, but its
single-line text still contributes to this intrinsic sizing. Empty/legacy metrics
in the existing browser fixture did not mount `SourceLeaderboard` at all.

Add `min-w-0` to the leaderboard card so the grid item can shrink to the available
width. Inherit the existing `[overflow-wrap:anywhere]` pattern for long metadata
tokens. Source titles keep their existing ellipsis, full DOM text and links;
financial labels, values and search behavior are unchanged. No dashboard
container edit or page-level overflow suppression is needed.

The existing `scripts/test-browser-ledger-sources.mts` harness now supplies three
real leaderboard rows through the intercepted metrics response: long spaced
creator/paper titles, an unbroken publisher title, long source identifiers and a
wallet. At 390px and 1440px in both network profiles, it checks document/card/row
bounds, readable source links and search width, retained full labels and row IDs,
title/identifier/wallet search, no-match/reset behavior and actual link navigation.
JSON geometry and screenshots are saved before bounds assertions. Requests retain
the harness's GET-only, fixture-origin-only interception; no provider, wallet,
payment or database is contacted.

All prior cases and their 320/768/1440 widths remain. Default invocation includes
the new regression. Existing CI reaches it through `test:browser-research-ux` →
`scripts/test-browser-research-ux.mts` → this harness, with no selection argument.
For a bounded local run, use:

```text
node --max-old-space-size=2048 --import tsx scripts/test-browser-ledger-sources.mts --source-leaderboard-only
```

Local browser acceptance is **UNKNOWN/0**. After the entire donor lock matched
(excluding only the app version) and ten installed tool versions matched, the
helper138 launch under a guarded LIGHT reservation threw synchronous
`spawn EPERM` before any browser case ran. The reservation was released. There
was no denied-context retry, policy/ACL change or claimed before/after geometry.
Syntax and source-preservation checks are recorded separately under
`output/dashboard513-focused-source`; they do not establish browser acceptance.

ROOT remains the sole different-source reviewer and owns ordinary before/after
390px and desktop execution after worker closure, required type/build/PR CI,
merge queue and the next deployment batch. Before/after source snapshots, a
unified diff, input hashes and the refusal receipt are retained in the assigned
output. Web and desktop-hosted dashboard presentation are affected; CLI, API,
remote/stdio MCP, extension and bot contracts have no changes. No version,
publication, deployment or production acceptance is claimed. #266 closure and
the delivered app0.27.68 remain separate.

## Parent actual focused acceptance

The source-author UNKNOWN/0 above remains the original refused launch. The first
ordinary parent run then exposed an esbuild `__name` capture in the new geometry
callback. An anonymous array-bound helper preserves the same geometry body and
all assertions without that external helper; this fixture correction is separate
from the card's two CSS classes.

The original card reproduced a 2590px document at 390px. The
corrected card produced a 390px document and 358px
card at 390px. All four populated checks passed: 390px and 1440px on both existing
network profiles, including search and link navigation. The corrected component
was restored after the before observation, and final source is exact after-image.
Phone and desktop screenshots were inspected: content fits, source titles retain
the established ellipsis and full accessible text, and fee metadata remains
readable. These are synthetic component/CSS acceptance results; production and
required PR CI remain separate. No full-dashboard scenario or app build was
repeated for this class-only change.
