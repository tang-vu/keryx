# Identity OAuth return through a committed same-origin document

Source authored on 2026-10-15 against the PRIMARY seven-file plan, SHA-256
`79768128e893c7e8895568beaad38a9a84b43d2e626f523279edcf7c76291a89`.
The initial source-author checks were unrun. PRIMARY subsequently passed the
focused flow/route units, affected TypeScript and all fourteen hermetic Chromium
return scenarios described below. Required exact-head CI, live provider acceptance
and production delivery are separate; no success is inferred for those surfaces.
PRIMARY `/root/release_library_review` owns verification;
`root-issue-completion-01a138ec` remains the sole release coordinator.

The existing genuine Chromium observation showed an external provider document's
GET return sending the Lax identity flow cookie while omitting the Strict session.
Requiring that session on the external GET therefore prevented ordinary returns.
The `keryx_session` cookie and its `SameSite=Strict` policy stay unchanged.

The configured provider callback GET validates the fixed provider configuration,
exact bounded query, encrypted original flow, state and deadline. It never reads
the session, opens a store, consumes a challenge or exchanges a provider code.
It encrypts just a code or denial boolean into a distinct HttpOnly/Secure/Lax
continuation cookie. Key derivation, issuer and audience are separate from the
flow cookie. The continuation binds a purpose-specific hash of the **exact sealed
original flow**, so a replaced flow cannot borrow an old return or PKCE verifier.
Its deadline is the earlier of 60 seconds and the original flow deadline.
Provider error text and URI are bounded and discarded. Mixed code/error,
duplicates, unknown query fields and malformed values refuse admission.

A 303 returns to the same configured callback path with no query. That redirect
does not restore or establish Strict authority. Queryless GET validates both
encrypted cookies and serves an actual no-store/no-referrer HTTP document. Its
queryless HTML meta policy is same-origin; the query-bearing and terminal redirects
retain no-referrer. A no-referrer
form policy would make Chromium serialize Origin as null; the queryless document
permits only its clean same-origin callback URL as referrer, preserving the exact
POST Origin guard without sending any referrer to another origin. Its
fixed, queryless form POST action and manual Continue button contain no code,
state, token, identity or provider error. A CSP-hashed static script submits that
form only from the document load event, after document commit. No payload enters
the script; JavaScript-disabled browsers can use the same manual form. The CSP
forbids other resources, base URLs and framing and restricts form actions to self;
DENY framing and nosniff headers also apply.

Only POST can authenticate the continuation. It requires exact configured Origin,
POST, no query delimiter, no bearer, an actually empty body, unique flow and return
cookies and one nonempty session cookie. The existing session dependency freshly
parses the genuine signed session and checks durable activity. Wallet and current
session hash must match the original flow. An optional owner-comparison header
still cannot contradict the session. The form needs no caller-supplied owner:
its comparison is against the original encrypted, durable challenge.

The existing store consumes that exact challenge **before** exchange, including
denials. PKCE comes exclusively from the original sealed flow. Replay and concurrent
submissions retain the atomic durable consume gate. After exchange, provider identity,
flow/continuation deadlines, fresh session wallet/hash, current provider configuration
and abort state are checked before the original `store.complete`. The completed
record must match wallet, provider, external ID and label exactly. Durable completion
retains unlink, profile deletion, active-session and lineage checks in its write
transaction; no schema, database fallback or new persistence port is introduced.
Terminal callback paths clear both identity cookies; successful START clears an old
return cookie and unlink clears both. No callback writes or weakens the session cookie.

The original positive and negative unit assertions remain, with successful/denied
returns adapted to GET staging, actual document and POST. Added authored controls
cover domain separation, encryption/tamper, exact flow/provider binding, short expiry,
duplicate cookies/query, missing/replaced/revoked sessions, foreign/missing Origin,
body/bearer/query refusals, concurrency/replay, provider removal, cancellation,
store failure and mismatched completion. Unit session fixtures are explicitly injected;
they do not claim genuine browser/session acceptance.

`scripts/test-browser-identity-oauth-return.mts` implements one hermetic real Chromium
harness for both GitHub and ORCID, with automatic and JavaScript-disabled manual
returns plus missing/replaced/revoked session, denial and in-flight unlink controls.
It invokes actual `createIdentityRoutes` through owned Chromium CDP Fetch interception
for every browser request, including actual HTTP redirect follow-ups,
forwarding Chromium-generated request headers and returning actual response bodies
and cookies. Different `.test` sites create a genuine cross-site document navigation.
It asserts the external GET omits Strict and includes Lax, then the committed document's
same-origin form POST supplies Strict. No header or cookie is fabricated on that
return path. JS-disabled setup directly invokes actual START with the genuinely
issued session before seeding its actual flow cookie in Chromium.

The harness uses genuine `issueWebSession`, `parseWebSession`,
`isWebSessionActive` and `webSessionHash` with an actual temporary ordinary
`SqliteAdapter` and actual identity/private-profile stores. The request-local session
bridge uses these existing functions instead of Next's request-context cookie accessor;
it supplies no synthetic positive session result. Only external provider exchange is
replaced at its existing injectable seam. Even that seam verifies durable prior consume.
All browser transport stays intercepted and all Node fetches refuse. No real provider,
credential, production host or database is selected. The harness checks cookie attributes,
safe HTML, terminal clearing, durable replay, single exchange and queryless callback
navigation history. Retained output contains fixed paths, counts and booleans only.
It emits no header, query value, cookie, session hash or provider identity. Neither
Playwright traces nor raw provider-page screenshots are captured.

Actual focused validation used the qualified existing Node 24.21.0 toolchain,
read-only dependencies, isolated outputs and a genuine temporary ordinary SQLite:
68 initial flow/route units passed; after the browser-discovered referrer correction,
three affected route cases (including the new null-Origin refusal) passed, relevant
TypeScript passed in 22.497 seconds, and all fourteen browser scenarios passed in
11.664 seconds. Each capture ended naturally with exit 0, no signal and both EOF.
The initial failed browser captures are retained: user routing omitted redirected
requests, then the corrected transport exposed no-referrer turning form Origin
into null. No assertions or deadlines were relaxed to obtain the final result.

A subsequent source inspection found that Next configured headers take precedence
over handler headers. The exact callback configuration uses the
same pure hash-only CSP constant as the inline document, while all HTTP identity
responses retain no-referrer and only the committed queryless meta policy permits
its clean same-origin form referrer. A new actual Next header-forwarding control
and the browser transport model this precedence. Four affected route controls
passed, including the actual Next forwarding assertion; refreshed relevant types
passed in 22.663 seconds and all fourteen Chromium modes passed in 12.033 seconds,
with natural exit 0, no signal and both EOF. The first TSX config-export interop
failure is retained; the harness now unwraps only that actual module boundary.
The earlier direct-handler fourteen-case result remains separately qualified.

The existing production CI now invokes this hermetic harness beside the identity UI
checks with explicit testnet/offline settings and reuses its existing Next build.
Independent auth review and exact-head required CI remain applicable. The local
harness validates actual route handlers and browser cookie/navigation behavior; it
does not claim a compiled Next HTTP run or live OAuth provider acceptance. HTTP
edge/access logging must retain its existing query-redaction policy: the inbound
provider query exists on the external request, though no subsequent app document
or form carries it.

This correction affects the interactive web/API verification flow. Desktop's web
handoff follows that same callback. CLI, remote/stdio MCP, bots and extensions gain
no new sign-in, identity-write, account, payment, creator or credential authority.
No activation flags, ENV, credentials, financial limits, provider endpoints, package
versions or deployment records change. Live provider acceptance and batched delivery
remain PRIMARY/coordinator work.
