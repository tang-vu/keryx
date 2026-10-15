# Private association compiled controls — 2026-10-15

Source extension only, **UNRUN**. The existing
[compiled driver](../../scripts/test-browser-owner-run-assignments269-built.mts)
now includes the actual emitted `/me/profile` and `/me/asks` consumers. The
original seventeen case bodies and names remain an unchanged literal prefix;
eleven named cases follow, for twenty-eight total. This is source preservation,
not fresh acceptance of the earlier driver or its whole dependency graph.

Both [profile](../../app/me/profile/page.tsx) and
[asks](../../app/me/asks/page.tsx) mount the existing
[inbox](../../components/keryx/owner-run-assignment-inbox.tsx) with `readOnlyView`.
The driver uses those emitted Next pages, the canonical `useSiweAuth`, native
BroadcastChannel and the existing strict `inboxSchema` synthetic GET fixture.
It introduces no test page, replacement component, hook alias or authenticated
API/native-store authority claim.

Each private page receives these five separately named cases:

| Case suffix | Required observation |
| --- | --- |
| `effective-original-networks-then-suppressed` | Two assigned rows and one claimed row retain their distinct IDs and original mainnet/testnet labels; counts are separately 2 and 1. A subsequent suppressed GET removes all three original run IDs/networks and produces 0/0 counts. Existing inactive assignment audit IDs remain visible. |
| `retired-manage-DOM-cannot-start-IO` | Fill the real manage-page proposal and both checks, retain its actual DOM and React consent/decision/refresh callbacks, then follow the real WalletMenu Next link. The same document realm must contain the readonly consumer; detached native clicks and retained callbacks initiate no GET or POST. No replacement handler is installed. |
| `focus-refuses-held-body` | Focus aborts a pending real GET body, clears assignment data and prevents a deliberately delivered late body from repainting it or starting assignment IO. |
| `local-auth-refuses-held-body` | The real canonical hook handles the local signed-out event, destroys the editor and refuses the held old body. Anonymous focus supplies no assignment authority. |
| `native-peer-refuses-held-body` | Two actual same-origin documents have distinct realms. A native peer `changed` message clears auth/assignment data and aborts the held GET; late bytes and subsequent anonymous focus cannot restore it. |

Every new case asserts zero assignment POST attempts both in the browser fetch
observer and at synthetic route dispatch. Readonly assertions cover all forms,
inputs, textareas, selects, consent/proposal acknowledgements, decision controls,
recovery JSON and replay. The sole assignment button is explicit refresh; the
existing separate manage link remains. Existing ordinary profile/history controls
are outside that region and retain their own roles.

The eleventh case, `asks-readonly-keeps-ordinary-owned-rows-counts-and-JSON`, opens
the real owned-history pane and downloads JSON through its existing browser action.
Two ordinary rows and the recent ledger's count of two remain distinct from the
three assignment rows. The real download stream must equal the synthetic owned
export, including its completion/bounds metadata, with no assignment identifiers.
Its source-valid owned rows use the real strict `ownedPageSchema`, recorded
ownership, offline provenance, unknown funding, unavailable settled totals and no
receipts or creators. They establish no real settlement or ownership evidence.

The exact ordinary GET seams were traced from current source:

| Actual caller | Only admitted synthetic request/reply |
| --- | --- |
| `PrivateProfileView` | `GET /api/me/profile`, no query, expected wallet and abort signal. A truthful 503 unavailable reply leaves ordinary profile/activity unavailable. |
| `VerifiedIdentityPanel` | Its `/api/me/profile/identities` GET occurs only after a valid profile snapshot. The unavailable profile never mounts it; no identity/provider fixture or network exception is added. |
| Default `MyAsksLedger` | `GET /api/me/asks?view=recent`, with two synthetic ordinary rows and source-shaped totals; anonymous lookup returns 401. This existing caller supplies no expected-wallet header. |
| `OwnedHistoryView` initial page | `GET /api/me/asks?contract=owned&limit=25`, expected wallet and the strict version-2 owned page. |
| `OwnedHistoryView` JSON action | `GET /api/me/asks/export?limit=25`, expected wallet and source-shaped `exportOwnedHistory` metadata. |

These exact GET fixtures are available only in the new consumer scenarios.
Mutations, extra selectors, missing owner preconditions where the caller supplies
them, identities, reports, receipts, other history modes and unknown API paths
refuse. The original incidental unavailable GET fixtures remain unchanged. This
does not bypass authentication, broaden a production schema or add a private API
allowlist. Synthetic session replies remain explicitly synthetic.

Source pins now include both real page sources and their ordinary callers and
fixture contracts. Compiled pins include both emitted server pages, their client
reference manifests, and the manifest-bound inbox/ordinary-consumer JavaScript
chunks. Manifest JSON is read without executing emitted JavaScript or walking
the build tree. Actual browser assertions require the new readonly UI on both
pages; an old seventeen-case artifact is insufficient. BUILD_ID and hashes alone
are still observations, not source-to-build attestation. The parent's exact final
source/input build evidence remains required.

All original deadlines, error handling, pageerror failure policy, realm guards,
cleanup and the existing `cp` donor pattern remain. No timeout was increased and
no pageerror was filtered. The already observed synthetic `"11".repeat(32)`
`CONTENT_MASTER_KEY` requirement is bound only in the isolated fixture ENV;
application guards, ENV files and real credentials are unchanged.

The existing different-source review in local
`output/private-association-view-independent-review/review.md` was read. Its sole
P2 was durable discovery of the separate DOM fixture; the subsequent discovery
handoff records the `.test.ts` correction. This worker did not read or modify the
other author's unfinished test, and does not treat it as executed acceptance.
No additional native PR or duplicate source peer is created here.

Only this note and the existing compiled driver are publishable edits from this
assignment. Raw before/after bytes, absence marker, SHA-256 pins, literal-prefix
preservation evidence, guarded full-file unique inverses, the early actual-seam
finding and minimal command record are retained locally under
`output/private-association-compiled-source/`. No inverse was applied. This worker
performed filesystem source reading, writing and literal/hash inspection only:
no project tests, types, runtime imports/modules, build, Q/copy/compiled scan,
database, provider, browser, Git, child agent or production operation ran.

Parent next action: verify actual #503 squash provenance and transplant only the
follow-up onto actual main; finish the separate focused controls/types, then make
**one final current-UI build** and run this extended driver with the existing
`--dist=ABS --output=ABS --port=OWNED` interface and required TEMP/TMP/TSX output
bindings. Complete the focused PR's required CI and coordinated merge/release
workflow. Root's original #503 worktree/head/script remain outside this grant.
Original #269, native durable consent/assignment authority and production
acceptance remain separately open. Public profiles, API/MCP/CLI/extension/bot
contracts and all financial/custody/provider behavior gain no authority here;
desktop rendering follows the same private web pages without a standalone
distribution claim. Deployment remains owned and batched by ROOT.
