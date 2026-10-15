# #257 observed five fixture failures — 2026-10-15

Source-only correction of two fixtures, following R150's SOURCEACCEPT of the
25 product/payment source files and reuse of R143's atomic-owner source review.
Neither review accepts these five failed checks. No runtime, facade, authentication,
session, payment, storage guard, migration, timeout or native-family bound changes
are made here. Default model, native policy and ChatGPT authentication are unchanged.

## Authoritative observed result

The parent FIRST nine-file execution recorded **198 PASS / 5 FAIL / 0 skipped**,
natural exit **1**, null signal, both raw streams at full EOF, and **120.270s**.
The evidence directory is
`D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/job257-parent-first-reviewed-native-controls-20261015/`:
`actual-result.json`, `report.json`, `source-and-tool-binding.json`, and
`first-reviewed-native-controls.{stdout,stderr}.raw`.
The earlier child EPERM run had zero cases and remains preserved; it is not
behavior evidence. The parent results govern this correction.

## Observed failures and source trace

| Failed check | Observed failure | Source-supported fixture correction |
| --- | --- | --- |
| Mounted Quick | Empty text instead of NeedsReview | Supply the real session endpoint and complete bounded owned packet. |
| Mounted Deep | Empty text instead of NeedsReview | Same contract, retaining the original 300-second target. |
| Native BUSY | `database is locked` escapes the `.rejects` call site | Defer the facade call inside the repository's existing `Promise.resolve().then(...)` assertion idiom. Retain exact native code and errcode. |
| Post-COMMIT reuse | `Verified storage connection closed` escapes the reuse assertion | Capture the synchronous permanent refusal; retain committed originals, consumed proof and genuinely fresh adapter verification. |
| Source drift | `createWebSession` / `issueWebSession` sees the already closed adapter before manifest drift is injected | Finish the preceding reuse assertion and fresh-adapter boundary; give that preceding case failure cleanup outside the assertion lifetime. Then exercise drift with a real healthy session. |

The mounted component performs a current durable-session read, selected jobs read,
strict packet parse and a second matching current-session read before publishing
(`components/keryx/account-jobs.tsx`). The old fixture returned its loose jobs
packet for every endpoint. That packet cannot parse as `sessionRows`; it also lacks
required wallet, nextCursor, top-level recovery state and history row fields.
The empty rendering is observed; its specific parse refusal is inferred from this
reachable source path, because the component deliberately contains read errors.

The corrected fixture uses the accepted parent pattern in
`lib/api/job-target257-mounted.test.ts`: the existing `accountHistoryItem` projection,
one fresh and stable durable-session tuple across reads, current flags,
`truncated: false`, one row within the existing max-25 bound, the exact ownership
marker, wallet, nextCursor and unknown recovery state. Only existing fetch endpoints
are substituted. The shipped component, hook and service remain real. Quick/Deep
retain original createdAt, the 180000/300000ms targets, within-target state,
payment-boundary uncertainty, unchanged-payment text, unknown-recovery text and
actual selected URL. GET-only and exact original selector assertions are retained.

The third mounted unknown/refusal case is preserved and now receives the same valid
transport contract. Its final session read proves the first packet parsed before
unknown attention renders no alert. Its second selected jobs read returns 401 after
the existing 2000ms delay. Unknown creator payment and recovery never become a hold.
This is a meaningful reached-boundary control in an existing case, not a new suite.

The native facade is a synchronous function that calls `assert()` before invoking
the asynchronous core (`lib/db/enrolled-sqlite-adapter.ts`). The verified connection
checks storage identity inside a native transaction and throws immediately for a
closed connection (`lib/db/storage-identity-connection.ts`). Consequently, evaluating
`expect(db.createOwnedA2aOrder(...)).rejects` can throw before `expect` receives a
Promise. The wrapper captures either synchronous or asynchronous refusal without
discarding the error. The idiom already exists in `lib/db/mainnet-storage.test.ts`.

BUSY still holds a genuine exclusive lock during the refusal assertion, matches
`code: ERR_SQLITE_ERROR` and `errcode: 5`, releases only in finally, checks [0,0],
and then admits through the same adapter after unlock to exactly [1,1]. The facade
explicitly preserves genuine native errcode 5/6 contention. No replacement
connection or enlarged 5000/10/20 bound is used to manufacture that result.

For lost COMMIT acknowledgement, the fault still runs the real native COMMIT first.
An explicit marker verifies that the intended acknowledgement fault was reached.
The core retires the connection after uncertain COMMIT; the facade's rejection
guard then reports the exact closed-connection error. Original and owner remain
[1,1]. Old-port reuse refuses before native prepare/exec; it still refuses after a
genuinely fresh adapter is created. The consumed opaque proof also refuses on the
fresh adapter with `session_unavailable`, while a fresh authentic proof observes
the retained original as `created: false`. Fault spies restore in finally.

The parent source-drift stack stops in session issuance before the manifest mutation.
The preceding case's synchronous reuse exception bypassed its fresh-adapter assignment;
afterEach only restored mocks, and the shared `db` remained closed. This lifecycle
explains the observed stack; it does not prove drift itself was exercised. The
preceding case now creates a genuinely fresh adapter in failure cleanup only if it
has not reached its fresh-adapter boundary. It never revives the old port or mints
a session there. The drift case captures the exact configuration refusal, restores
the manifest bytes in finally, proves permanent old-port closure and no native SQL,
checks [0,0], then uses a genuinely fresh adapter/proof for exactly [1,1].

## Preservation and remaining acceptance

All other test bodies and all current runtime/product/protected bytes are retained.
Readonly refusal, session timing and revocation, rollback, original-owner counts,
exact retained payment rows, receipt uncertainty and old-source guards are not
weakened. Raw before/after bytes, minimal forward patch, full inverse and hash pins
are saved in `output/observed-five-fixture-handoff.json` in the owned worktree.
Raw/base64 payloads are the exact-byte restoration authority; patches normalize
line endings for review. The parent's original input binding remains historical;
the two authorized fixture hashes necessarily change and are recorded explicitly.

**UNRUN here:** the five corrected failures, the existing third case's meaningful
boundary control, types, server-route checks, build, current-main/combined-source
acceptance, canonical acceptance and required PR CI. No authored 203-case repeat,
module execution, browser, database, provider, target, ENV, spend or schedule action
was performed. Only read-only Git commands used the specified absolute Git binary.

Parent next action: obtain a different narrow source reviewer, execute only the five
failed cases plus the meaningful third-case control and preserve valid unchanged-input
198-pass evidence. Then complete server-route/types/build and current-main acceptance;
refresh canonical acceptance only if its applicable inputs changed. Pass required PR
aggregate/domain CI and hand the focused candidate to the existing serialized
merge/release coordinator. Deployment remains batched. No original #257 paid/vendor,
remedy, latency, public delivery or product closure is claimed.
