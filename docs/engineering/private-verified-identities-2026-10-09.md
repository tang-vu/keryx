# Private verified identity links — issue265 source increment

The ordinary private profile can verify account control through ORCID or GitHub,
list its dated verified links and unlink immediately. Typed profile links retain
their existing unverified meaning. Verification confirms account control at the
recorded time; it does not certify affiliation, scholarship or creator eligibility.
SIWE wallet/session, payment authorization, source-owned payout authority and
existing rate/allowance limits remain authoritative.

## Consent, minimal data and replay

Only interactive active SIWE can start or unlink OAuth, through body/query-free
same-origin POST/DELETE with a comparison-only expected-wallet header. The saved
profile must already exist. The fixed operator-configured HTTPS origin selects
registered callbacks; request Host, profile links and supplied selectors do not.
Configuration is disabled when credentials/origin or the required storage port is
absent. Client secrets stay in environment only.

Each flow has a fresh 256-bit state and a five-minute encrypted purpose-specific
HttpOnly Secure SameSite=Lax cookie. Ordinary storage holds only its hash, hashed
durable SIWE session selector, expiry and one pending/consumed lineage. The same
active session and provider must match before single-use atomic consumption and
provider exchange. GitHub uses empty public scope and S256 PKCE. ORCID uses
`/authenticate`; unsupported ORCID PKCE is not claimed. Fixed provider transports
refuse redirects, broadened scopes, unbounded bodies and deadlines. No provider
token, authorization code or PKCE verifier is persisted/logged or returned to a
client. Only provider ID, ORCID name or GitHub login and verification date survive.
See [primary provider references](verified-identity-provider-reference.md).

The store rechecks current lineage, saved profile, deadline and active durable
session in the final write transaction. A new flow supersedes earlier pending
work while preserving the prior verified link until success. Provider/ID uniqueness
prevents simultaneous ownership by two wallet profiles. Atomic unlink and profile
deletion invalidate pending and in-flight callbacks; completion cannot recreate a
missing lineage. Revoked sessions and replays cannot complete. Conflict responses
never identify another owner. Local unlink does not delete a provider account;
provider access tokens are discarded rather than stored for later use or revocation.

## Storage and supported surfaces

`KeryxDB.profileIdentities` is an additive nonenumerable ordinary-only capability
installed after private-profile admission. Unknown SQLite domain shapes refuse
without repair; every operation checks the profile/session/identity shape and
foreign-key admission. The additive `0085_profile_verified_identities.sql` source
migration uses private RLS, service-role-only fixed RPCs and enrolled-identity
refusal. Supabase has no REST fallback. The sealed/native inventory, enrolled schema
identities and immutable payment/original receipt paths are not widened.

| Surface | Role and boundary |
| --- | --- |
| Web | `/me/profile` shows private dated links, explicit verification consent and unlink; remount/aborted requests protect wallet switches. New English text uses its own immutable area catalogue. |
| API | Owner GET `/api/me/profile/identities` requires active SIWE or explicit `profile:read`; default/legacy/write-only keys do not acquire reads. Interactive start/callback/unlink require the initiating durable session. OpenAPI describes these separate contracts. |
| Remote/stdio MCP | Additive `profile_identities_read` exposes the allowlisted owner's snapshot with explicit `profile:read`. Existing `profile_read` shape is unchanged; OAuth consent/mutations require the browser. |
| CLI | The same HTTPS owner API/read client can retrieve the snapshot with a scoped key; no local signer/provider credentials or autonomous OAuth flow. |
| Desktop | Hosted profile view uses the same interactive SIWE flow. Native buyer/provider/daemon does not acquire identity-writing authority. |
| Extensions/bots/A2A | No new link propagation or identity authority. Future chat linking and public profiles need separate consent/ownership contracts. |

This slice does not expose public profile JSON: issue264 has no public-profile
contract yet. It must explicitly distinguish verified versus asserted links when
implemented. Account/multi-wallet identity linking remains separate; this source
uses the existing wallet-keyed private profile.

## Acceptance and release gates

Focused route/state/provider tests cover minimal scopes, expiry/replay, owner/session
switches, unlink races, provider failure/oversize/redirect refusal and no secret
redirects. Temporary ordinary SQLite and isolated PostgreSQL acceptance cover
atomic uniqueness, lineage/session/privacy and migration ACLs. Hermetic actual
components with built CSS and packed stdio client fixtures cover surface roles;
synthetic identities never establish live provider/production acceptance.

Run app/operations TypeScript, lint, default production build and full applicable
aggregate/domain/platform CI plus independent review. Main is held for the existing
release45/restoration operational window: this PR may not advance it without
positive admission. Version/distribution reconciliation and current-main health,
publication and public readback remain coordinated release gates.

No production migration/enrollment/provider registration, credential installation,
funding or live verification is performed by this source increment. Current sealed
production remains unavailable. Activation requires reviewed sealed-domain
migration/enrollment and owner-authorized provider configuration, live SIWE/key
and provider acceptance. Issue265 remains open for public-profile and production
activation gates; source acceptance must not close those gates by implication.
