The existing full CI checks lane now invokes the frozen public-profile PostgreSQL fixture after the existing privacy/PG17 fixtures. It reuses their already-present official postgres:17-alpine image, records the actual image metadata, clears ambient inputs and requires the fixture's pull-never, network-none, named owned-container boundary. SQL failures, missing image, absent lock barrier or timeout fail the lane. The fixture's guarded finally removes only its own labeled container; runner cancellation remains a failed/cancelled aggregate, never acceptance. PostgreSQL stdout, stderr and command exit are retained even on failure. A mocked RPC packet or script typecheck does not satisfy this gate.

The existing production lane performs the unchanged stock Next build, then invokes scripts/test-public-profiles-built.mts --acceptance. It uses a fresh ordinary SQLite file, synthetic revocable sessions, explicit test-only public/profile privacy flags and an existing Linux build. It changes no default, database outside that fixture or dependency junction. A fresh fixture reuses the build through an owned Linux .next link; dependencies retain the repository's existing resolution. The Next child uses whitelisted environment inputs and loopback only. There are no intercepted positive API, HTML or image responses.

Before final adapter initialization, the fixture explicitly installs the source-defined application schema and exact RUN_PRIVACY_SQL into its UUID-owned fresh database and closes the bootstrap connection. Ordinary production initialization still requires separately admitted privacy schema; this fixture setup neither activates production privacy nor proves a successful compiled-route run.

The built gate requires actual owner/public routes, Origin and anonymous refusals, explicit PUBLIC-only selection, JSON/HTML/JSON-LD/OpenGraph PNG/sitemap, immediate subsequent unpublish refusal, stale revision conflict and session revocation. Chromium loads the real public page at 320, 390, 768 and 1366px, checks overflow, authored CSS padding, keyboard focus and original report/receipt links, and retains screenshots. Outward browser requests are aborted. This proves those bounded DOM predicates; it is not a full assistive-technology audit, connected-wallet editor exercise or deployed phone trial. Both production capabilities remain default OFF. No research/payment/provider or external database call is part of the gate.

The owned Next child receives one graceful stop; no process enumeration, force kill, shared cleanup or dependency repair is performed. Source/build pins, stdout/stderr, child close/signal and failure-qualified acceptance are retained under .artifacts/public-profile-built-*. Missing BUILD_ID, readiness/CSS/route failure or missing graceful close cannot produce accepted:true. The existing aggregate requires both checks and production lanes. Hosted evidence must match the final reviewed source and build; author static checks alone do not approve auth/privacy or complete #264.
# PR434 CI integration correction

The first required CI run failed rather than qualifying delivery: the copy guard
found new inline labels, the browser migration selector refused the new0091
identity, and the built publication returned403. Public-profile copy now uses an
English source catalogue without a baseline exception. The closed browser fixture
admits only0091 plus its exact existing0083/0085 ordinary prerequisites, installed
before claim/privacy catalog seals; the full native chain remains unchanged.
Native refusal and absence of profile table/RPC, fresh ordinary service-only
readiness, future/duplicate refusal and all existing seals remain required.

Owner writes compare Origin to the configured public binding, preserving the same
origin policy when Next uses an internal loopback request URL. Missing, foreign or
forged matching request origins refuse before session/store access. The built
fixture keeps every original status, owner/private projection, phone, revocation,
body and graceful-child assertion. A bounded machine refusal code aids failures;
it does not replace the positive200 gate. CI retains only named result/log/image
files from the hidden artifact folder, excluding SQLite and the build link.

Fresh actual PostgreSQL17, stock-built routes/phone and full aggregate CI remain
merge gates. No production DDL, privacy/publication activation, historical owner
promotion, deployment or original issue264 closure follows from this source delta.

## Original acceptance and supported surfaces

| Original #264 criterion | Source contract and required evidence |
| --- | --- |
| Invisible until explicit publication; immediate unpublish | Owner session, expected-wallet, Origin and revision checks control publication. Uncached HTML, JSON, image and sitemap recheck it. Actual PostgreSQL races and built subsequent-read refusals remain required; saved external copies cannot be retracted. |
| Selected authoritative fields and PUBLIC research only | Existing private profile and verified identity records supply selected fields. Both adapters require current ownership, explicit PUBLIC visibility and unerased text before projection. Historical missing-sidecar, PRIVATE and UNLISTED research is excluded. |
| Question, date, surface, network, citations, report and receipts | The closed projection retains stored evidence and original report/receipt paths. Missing or conflicting network/funding evidence stays unknown; neither current configuration nor a profile claim supplies a payer. |
| Reader-paid and creator-earned figures | Explicit ledger opt-in exposes wallet-wide recorded settled creator-event aggregates, with exact integer micro-USDC, separate networks and separate treasury sponsorship. Pending, simulated and unsupported financial events do not become settled figures. |
| Ownership, Open Graph and structured data | Signed-wallet publication and recorded/receipt-claimed run proofs are labelled honestly. Only selected text and existing verified links enter metadata. This does not establish a legal identity, linked-wallet membership or assignment authority. |
| Phone/accessibility and visibility/unknown-handle tests | Retained focused and SSR evidence is limited to its exact inputs. The existing built gate must prove the real routes, PNG, JSON-LD, sitemap, responsive CSS and bounded keyboard predicates; full current-source CI and delivery are separate. |

The confirmed #266 source policy remains historical/unowned UNLISTED, new
authenticated-owned PRIVATE by default with explicit owner PUBLIC choice, and
anonymous UNLISTED until ownership is proved. Publication never promotes a run
or supplies missing ownership. Both production capabilities remain default OFF;
source migrations and isolated fixture installation are not production rollout.

Web owners alone receive the signed-wallet publication editor. Public web/API
readers share the closed page/JSON contract. Desktop, repository and published
CLI, hosted/stdio MCP, extensions, A2A and chat bots may follow that public
handoff; they gain no publication tool, private enumeration, linked-wallet
aggregation or signing/payment authority. Existing native/private recovery and
financial roles remain unchanged.

Before final acceptance, normally compose the reviewed dependency with the
feature, preserve both complete source histories, and retain the incoming
canonical study pair whole. That inherited study is not evidence for the new
profile source. The release owner must normalize the actual accepted main and
produce the final changed-source epoch, required CI and delivery evidence.
Original #264 stays open until its remaining criteria are actually accepted.
