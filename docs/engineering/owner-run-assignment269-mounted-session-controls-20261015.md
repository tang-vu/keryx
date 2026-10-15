# Mounted owner269 session controls: actual 18-case acceptance

Updated 2026-10-15. The applied lib/api/owner-run-assignments-route.test.ts imports
the ordinary mounted route and real accountSessionContext, JWT parser, durable session
lookup and enrolled SQLite facade. It complements the existing injected http.test.ts
controls; it is not a replacement JWT suite or production-session acceptance.

## Fixture and authority scope

Each case creates a disposable keryx-mounted-owner269-* directory with synthetic.sqlite,
deployment.json and https://assignment.invalid. A fixed synthetic account, member and
credential generations, signed interactive session, original and network-evidence rows
precede storage identity/fences. The mainnet-shaped marker is explicitly synthetic. Later
revocation/generation changes use a second genuinely verified/fenced connection and the
same manifest guard. No owner association/event, detached owner capability, provider call,
real account or financial settlement is manufactured.

Only request-cookie delivery, the existing DB singleton bound to the frozen genuine facade,
and synthetic config are substituted. Real runtime manifest parsing, storage opening,
source-profile/native provenance, actor checks, journal and final synchronous reply remain.
Fixture selectors/cache state are restored; production ENV files are not loaded.

## Observed execution

The original combined focused run retained 90 passes, **18 mounted setup failures** and
10 genuine-owner skips on Windows, exit 1/null signal/both EOFs. The failures reported
malformed_marker before the intended mounted assertions. Only synthetic fixture identity
construction was corrected using validateStorageIdentity before canonical marker
serialization. Native marker validation, facade guards and production policy were not relaxed.

After that correction, all **18 mounted cases passed in disjoint 1 + 9 + 8 selections**.
Each invocation ended 0/null signal with actual exit/close and both EOFs. This is grouped
acceptance of the 18 cases, not an invented single full passing capture. Focused corrected-
fixture TypeScript passed in **27.715s**. Retained evidence directories under
output/resume-distribution63-audit-20261012 are:

- owner269-first-combined-controls-and-types-root-20261015 (original failure retained).
- owner269-mounted-marker-selected-first-root-20261015 (1 pass; corrected types).
- owner269-mounted-marker-nine-refusals-root-20261015 (9 passes).
- owner269-mounted-marker-eight-lineage-owner-races-root-20261015 (8 passes).

The actual-result.json and actual-types-result.json receipts bind their individual scopes;
skips caused by the disjoint name selections are not missing-case passes.

The accepted cases cover real caller/context recipient GET without journal writes; mounted
consent with one recipient/credential-bound event and no owner association; private headers
and no credential reflection; missing/invalid/expired/unrecorded/revoked cookies and native
sessions; Bearer/foreign-Origin/cross-site refusal; wrong wallet, stale recipient and changed
member/credential lineage; recipient rejection of owner apply/undo/cleanup even under a
signed dev-role cookie; and durable revocation while the bounded consent body is awaited.

Each completed case compares schema and retained **financial/claims/privacy TABLE snapshots**,
including seeded original/payment records. Some retained tables are empty: these comparisons
do not claim every financial/private table is populated or that production liabilities were
exercised. They establish only the fixture's preservation, not complete native owner, race,
migration or production-original acceptance.

The current composed source includes the reviewed source-derived account-family admission;
the old constructor-bound prerequisite is resolved. The suite still uses ordinary discovery
and unchanged canonical Windows 20s / other 10s test/hook deadlines, without a fake clock,
native wait change or construction bypass.

The corrected build and all 17 compiled synthetic cases have separately passed; see the
compiled note for their exact source/input binding. Genuine Linux POSIX UID-zero owner
acceptance and required exact-head PR/domain CI remain pending. These mounted controls grant no SIWE/enrollment, OS owner,
payment, spend, schedule, public association, deletion or production authority. Hosted
desktop shares the API; other clients receive no new authority. Original269 remains OPEN.
