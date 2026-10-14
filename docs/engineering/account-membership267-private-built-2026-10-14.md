# Account membership private delivery boundary (#267)

This source-only delta belongs to the same focused original #267 outcome and
[PR472](https://github.com/tang-vu/keryx/pull/472), observed clean at head
`168a3f4a70d83fdd1ac2415ebb73d1e4756d95e2`, tree
`d3b9fa57d4c59c500d8fd5d0a86e6c33c2b1e2ba`. It is NEXT cohort work. Delivered64,
main, production, versions and publication are unchanged. Parent retains branch,
Git publication, focused review/checks and required hosted CI ownership.

Before editing, `/account` contained only the client workspace and had no private
page metadata. Next's existing private-header map included neither `/account`
nor `/api/account/membership`; the global Referrer-Policy could override handler
policy. The delta adds exactly those two paths to the existing
`runClaimPrivateHeaders` map, preserving every prior entry, helper, CSP and Vary
behavior. Constant page `Metadata` now specifies robots noindex/nofollow and
referrer no-referrer. It adds no server-side owner data, request-dependent
metadata, authentication, redirect or account capability. The complete workspace,
core, API, DB, auth, consent, signatures, payments and caps are preserved.

The existing core21/different reviews, 87 unique controls/types and actual421
study/peer remain the parent's accepted evidence. They were not repeated here.
All original owned blobs at the pinned head remain unchanged except the exact
page metadata addition. The study's recorded `runtimeSources` excludes the five
changed executable/configuration paths below; its forward literal-import
traversal does not reach page/config/CI/operations-script callers from its existing
entry. No reached library is changed. Its source graph remains 421; neither the
study pair nor its producer was edited or run.

## Reachable acceptance source

`scripts/test-account-membership-private-built.mts` consumes only CI's existing
default `.next` build. It neither installs dependencies nor builds. It follows
the previously read `test-browser-evidence-drafts.mts` programmatic Next,
`test-support/next-config-fixture.ts` config-copy and HTTP natural-close recipes.
It owns a fresh temporary cwd/data/TEMP and loopback port, drops inherited
application credentials/storage/provider settings, forces offline Arc testnet,
disables discovery and registry subscriptions, and uses no live login/provider.
Only Next's ordinary empty boot schema is initialized; account267 schema stays
absent. Read-only bounded schema/count snapshots check the actual owned boot DB.

There are exactly nine HTTP requests on two paths:

| Request | Required result |
| --- | --- |
| Anonymous `/account` HTML | 200 generic private workspace; constant robots/referrer tags; no owner or enabled account action |
| Anonymous `/account?_rsc=` with RSC header | 200 actual Flight response with generic workspace reference and private metadata; no redirect or fallback retry |
| API GET without cookie | Exact 401 `account_unauthenticated` |
| API GET with malformed cookie | Exact 401 `account_unauthenticated` |
| API GET with inert bearer | Exact 401 `interactive_account_session_required` |
| API POST with same Origin and explicit synthetic create consent, no cookie | Exact 401 `account_unauthenticated`; no account creation |
| API POST with foreign Origin | Exact 403 `same_origin_required` before membership mutation |
| API GET and POST with synthetic local-preflight JWT | Exact 503 `account_unavailable` and generic unavailable message from the actual unsupported ordinary account capability |

The last two requests use an in-memory HS256 transport fixture with no durable
login, account, enrollment or wallet signing ceremony. The token is not logged or
stored. It only reaches the existing early missing-capability refusal; a 503 does
not certify authenticated account access or backed storage. It remains distinct
from the anonymous 401 and foreign-Origin 403 cases.

Every response must retain no-store, no-referrer, noindex/nofollow and the compiled
global CSP/security headers. Ordinary/RSC page Vary retains all four Next Flight
headers; API Vary retains Cookie and Authorization. Location and Set-Cookie are
absent. Generic shell/refusal bodies exclude owner identifiers, private account
IDs, enabled account actions and redirect/fallback error signals. The first HTML
response awaits Next's asynchronous boot; its snapshot requires empty private,
session, signature and payment domains. Snapshots after the RSC/refusal requests
require unchanged schema/counts and those domains still empty. This asserts no
recorded unauthorized effect; it is not a live account, vendor or payment
acceptance claim.

Requests have a 10-second deadline, retain at most 1 MiB each and await response
EOF/request close. The reserved listener closes before Next starts. Cleanup
naturally drains the owned HTTP listener, awaits the built instrumentation's
existing indexer close, closes Next and flushes traces, including on assertion
failure. There is no process kill, unref, explicit destroy, alternate runner,
new lifecycle framework or denial retry. The script retains only its owned temp
fixture; it never removes a build/dependency link or another owner's resources.

Exactly one direct source command is added to the existing production-build/browser
lane, after its existing build and private-identity acceptance:
`node --import tsx scripts/test-account-membership-private-built.mts`.
Every preceding/following command, assertion and workflow gate is preserved.
The only operations tsconfig change is the matching include. There is no package
command, CI gate replacement or claim that merely authoring assertions passed CI.

## Pins and exact inverse

The following are raw SHA256 pins after this delta; the document does not attempt
to hash itself. Original Git blobs are addressed by the full pinned head above.

| Path | Before Git blob | After raw SHA256 |
| --- | --- | --- |
| `app/account/page.tsx` | `89d1adc06443d24cedb8a563de4f492b11063e11` | `0e4f81018bd679133811c13192d3840e57b6545301df5c2f252aebec80b074c1` |
| `next.config.ts` | `684328f959181efb610093ffc8c7cba0a14aff09` | `36f0c10619eb25172611a4af337a9bdd358fff7acd5856cae00753bde728d01a` |
| `.github/workflows/ci.yml` | `fad9c43b32f854f37f8511e4555378f92193464e` | `7609ba5c7cffbbc1c898f1082cc2466e5b7474321436c6c5c5058353a08b2520` |
| `tsconfig.ops-scripts.json` | `68540dbfbdd814b72a933e84c7b5d91f700669ce` | `338e67ec7daa736c882705f8d7666fd1bd1ed07ec07298e83c3c3b2eb3984abe` |
| `scripts/test-account-membership-private-built.mts` | Absent | `9216341fd04d5874fbb18111aa664b7c9da857eca03d54a1ad9a38457fa29682` |

Inverse, restricted to this delta: remove the Metadata type import and constant
metadata export from the page; remove only `"/account", "/api/account/membership"`
from the existing private-header array; remove only the named new CI step and
matching operations include; remove only the new script and this new document.
The four existing files then match their exact before blobs above. Do not restore
the entire branch, roll back the accepted core, or change any other path.

## Acceptance and original gates remain open

This CLI performed source edits, instruction/recipe reads and raw hash inspection
only. New HTTP acceptance and script typing are **UNRUN** here. No tests, compiler,
module/app/Next/build, DB/DDL, producer, provider, live auth credential, model,
search, payment, Git writer, merge, version, deployment, activation, schedule or
issue closure executed. The optional final Git diff read reported that `git` was
not recognized in PowerShell; no alternate executable or denial retry followed.
Parent normal tools own the tiny different delta review, focused script types and
required hosted current-build acceptance on the final focused candidate.

Original #267 remains **OPEN** for actual selected-store admission/migration and
storage parity, wallet-free stable account/profile onboarding and vendor/UI
ceremony, independent multiwallet signing, composed history/profile/figures,
per-key consent and privacy/session/unlink races, custody/payment negatives,
applicable web/API/Desktop/CLI/remote and stdio MCP/extension/bot acceptance, and
authorized rollout/delivery. See the [existing implementation gates](account-membership267-implementation-2026-10-14.md)
and [original design matrix](account-multiwallet-2026-10-13.md). This surface-only
private boundary does not complete those gates or change any private hold.

Parent follow-up: the observed UI-copy guard failure was corrected through the typed English catalogue, preserving all visible text and action logic. Its named regression and first focused private-script/page/copy types passed. The initial ProcessEnv declaration now explicitly supplies the already assigned production NODE_ENV; the failed first types result is retained. Actual nine-request compiled HTTP acceptance remains the required hosted production lane. All421 study inputs and the genuine pair remain unchanged; no producer or build repeated.
