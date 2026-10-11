# Anonymous run claims — staged source

Issue #262 is still open. The ordinary claim domain and private HTTP/landing
boundaries and the first private ingress subset are source preparation, default
off. They do not activate any current database. Remaining ingress/client delivery,
fresh combined-source acceptance and separately reviewed deployment/schema admission
remain gates. The four failed PostgreSQL attempts are retained, not passing
evidence. The third reached the timestamp fixture after migration/catalog setup;
the timestamp fixture was corrected with parenthesized expressions.
The fourth exercised more domain cases but its deliberate added-column fixture
changed JSON row shape; no-write comparison now snapshots every claim field after
that intentional DDL, before refused calls. Original/financial comparison still
precedes the mutation. The closed browser fixture explicitly registers only 0088
as ordinary-only and retains exact native refusal. The dedicated ordinary-domain
PostgreSQL lane subsequently passed on source `7c08de848a157047478ed7f228e82f901779b210`
([run 38094718412](https://github.com/tang-vu/keryx/actions/runs/38094718412)).
That source acceptance does not admit a production database or activate the feature.

Enablement requires the exact pre-existing ordinary schema and
`KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED=true`. Runtime admission never creates or repairs
SQLite schema. Native/enrolled and archive adapters expose no claim/history ports;
there is no fallback or enrollment change. Migration 0088 refuses native identity
markers. Its narrow immutable catalog seal guards claim metadata, private ACLs,
functions, triggers and the original/session shapes needed by this domain.
The ordinary deployment must already grant its service role the original-table
read/lock authority needed by the invoker guard, including `query_runs` and
`a2a_orders`; otherwise admission refuses. The isolated browser fixture grants
only the missing original-table SELECT before creating the immutable seal.
Runtime does not widen grants or bypass the guard. Isolated built-server fixtures
copy one shared, exact config dependency graph, including the literal CSP assets,
and qualify it with Next's actual configuration resolver.

A trusted new-request completion closure can create one 256-bit claim credential
for a newly completed unowned run. Only its network/origin-bound SHA-256 is stored,
with a fixed 24-hour expiry. There is no reissue, historical mint, public lookup or
reader-triggered recovery. The private delivery is separate from the immutable
`QueryRun`; a lost direct response cannot recover a link or justify replaying paid
research. The first hosted ingress subset prepares ordinary admission before
research and completes its request-local closure only after the existing save
boundary. A late issuance failure preserves the saved answer and returns a fixed
unavailable packet without replay or a replacement credential.

Protected web delivery uses a dedicated dynamic `/research/private` initial
document. Enter through a native full-page link. A proxy matched only to that
path refuses browser RSC, prefetch and non-document requests; it overwrites internal
request headers, sets a fresh nonce CSP on request and response, and admits a
bootstrap only for an actual navigate/document request. No-store, no-referrer,
noindex, frame denial and same-origin COOP apply. Other routes retain their public
archive and analytics policies. The dedicated CSP refuses external scripts,
analytics, frames and wallet/RPC connections. Funded browser controls remain on
ordinary research; this is not funded private-web acceptance.
Question and report visibility follows ordinary research. This surface protects
the account claim handoff, not the visibility of the research itself.

Installed Next reconstructs proxy URLs from its listen address and normalizes
loopback hosts to `localhost`. Entry therefore checks the exact configured Host
and protocol, rejecting alternate hosts and ambiguous forwarded protocols.
The ticket still binds the configured external origin. API admission reuses the
existing configured-Origin CSRF check, strict same-origin Fetch Metadata and the
signed ticket; request Host/forwarded headers confer no API authority. Next strips
Flight headers before Proxy, so the browser's required navigate/document metadata
is the primary initial-navigation check. Flight-header tests alone are insufficient.

The bootstrap installs a nonenumerable initial-document closure. A pathname,
React prop or in-app transition cannot supply admission. Its fixed 24-hour ticket
uses a fixed domain-separated HMAC derived from the existing strong `JWT_SECRET`,
without fallback; it grants document admission only, never account or payment
authority. The document ticket is not the run-claim credential. Trusted first-party
bundles are within the boundary; this does not protect against malicious
privileged same-origin JavaScript. Leaving the document forgets its ticket and
any pending account handoff.

When enabled, an anonymous web ask prepares ordinary claim admission before
providers and completes delivery after trusted run persistence. The private SSE
packet follows the unchanged `done` run and is parsed separately into a one-shot
closure, outside React run/turn state, DOM, storage, clipboard and public exports.
Only a matching completed run and clean stream EOF enable the explicit handoff.
Abort, a new request, malformed delivery, expiry or lost final acknowledgement
discard it without replay; completed answers and payment records are preserved.
Reload/close cannot recover it. Built-browser initial-document, header/CSP,
hydration, injection refusal, hard-navigation and handoff acceptance are required
before web delivery is qualified; local fixture evidence is distinct from fresh
hosted default-build acceptance and production/schema admission.

`/claim-run#<credential>` is a dedicated HTML route with no application layout,
providers, analytics or third-party scripts. Its first synchronous allowed script
keeps the fragment in closure memory and replaces the URL with `/claim-run`.
Exact emitted-byte script/style hashes are the only CSP permissions. HTTP
no-store/no-referrer/noindex and framing refusal apply through final matching Next
header rules. Config and the response renderer import the same plain JavaScript
literal-asset and header modules with explicit file extensions. Next evaluates
configuration before application bundling; it must not depend on resolving the
response renderer's TypeScript graph to compute these hashes. Sign-in opens the
existing `/connect` in a separate window without
the credential or a return selector. Focus/session return only refreshes the
displayed owner; saving requires an explicit click and a fresh owner comparison.
Reload/close loses the delivered secret. A submitted request is never automatically
retried, including when its acknowledgement is lost.

`POST /api/me/run-claims` accepts only bounded `{token}` JSON and a current
interactive wallet session. API keys cannot claim. Exact configured Origin and
`X-Keryx-Expected-Wallet` comparison protect the write. Read-only domain admission
precedes durable wallet and hashed-IP limits; both limits precede body/token
parsing and token lookup. No memory limiter fallback is allowed. The storage
transaction rechecks the same active session, exact binding and unchanged original
after lock waits. Unknown, malformed, expired, used, already-owned and changed
original claims receive the same unavailable response without credential echo.

Authentication precision: SIWE and the reviewed Circle Google wallet flow both
mint the existing durable web-session contract, which does not record an issuer
method. This boundary uses that verified interactive wallet authority and durable
revocation checks; it cannot distinguish which of those flows issued the session.
“SIWE-only” in the earlier design described interactive session versus bearer
authority, not a login-method discriminator. No new authentication policy or
shared authentication/schema change is inferred.

`GET /api/me/run-history` and `/api/me/run-history/:id` use active wallet sessions
or explicitly scoped `history:read` keys. Bearer presence never falls back to cookie
authority. Owners are never URL/body selectors. Bounded keyset history joins
recorded and claimed attribution without duplicates; summary fields omit answers,
claim hashes and secrets. Detail returns the verified saved original unchanged,
with ownership separately. Claiming never rewrites payer, receipts, settlement,
funding provenance or creator rewards. Claimant attribution is not financial truth.

The private packet is separate from `QueryRun`, `RemoteResearchResult` and
`keryxMeta`. OpenAI-compatible JSON/terminal SSE returns it as `keryx_private`,
outside answer/metadata projections. Remote MCP returns a separate private text
item and `keryx/privateRunClaim` response metadata; its public structured result
is unchanged. These are caller-owned response/conversation deliveries, not public
report footers. A generic client may ignore these extras; no hosted OpenAI widget
exists and none is claimed here. Response loss loses the credential permanently.

Discord establishes ephemeral visibility in the initial deferred ACK and edits
that same reply. Slack explicitly sends both ACK and final result as ephemeral,
disables unfurls, and validates its signed private response transport before
enabled research. Telegram must first receive a confirmed sender-private chat
and placeholder acknowledgement; an unavailable or mismatched DM starts no
research. Group replies never receive the result credential, including after
private edit failure. Placeholder IDs and raw tokens are not persisted. Delivery
failures omit third-party response/error bodies from logs.
Telegram sends the bounded answer and the complete plain-text credential in
separate protected private messages; appending to its full-size answer could
otherwise exceed Telegram's message limit and lose the delivery.

The extension validates a live same-origin, exact-run private packet and keeps
it only in popup closure memory. An explicit button hands it once to a new claim
tab. Popup close/pagehide, a new request, expiry or incomplete stream loses it.
No credential enters the DOM, device recent reports, clipboard or research exports.
The clean owned-browser replay uses the actual popup/module bytes with synthetic
extension APIs; it is not real MV3 installation/publication acceptance.

Anonymous web admission is fail-closed when the flag is enabled until a protected
initial research document and hard-navigation boundary are accepted. The current
analytics-allowed research document receives no credential. The dedicated dynamic
page, narrowly matched nonce proxy and transient SSE/UI delivery are staged here;
actual built-browser HTML/CSP/hard-navigation and fresh hosted default-build
acceptance remain release gates. Authenticated owned requests retain their existing behavior.

Supported-surface review remains open. Stdio `ask_keryx` uses paying-wallet A2A
and exact original recovery; desktop prepares and resumes private native buyer
tasks. Those paths are already payer-bound and must not acquire ordinary claim
ports or change native/archive enrollment. Internal verified engine drivers are
self-volume operational calls, not user-private delivery. The local unowned
`scripts/ask.mts` console path still needs an explicit CLI delivery/role decision;
it is not falsely classified as wallet-owned. Existing history/profile clients
also still need claimant-sidecar integration. Public reports, feeds, OG, metrics,
exports and logs never acquire claim fields or claimant financial attribution.
Full #262 remains open; no operational activation or synchronized release is claimed.
