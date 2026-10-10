# Anonymous run claims — staged source

Issue #262 is still open. The ordinary claim domain and private HTTP/landing
boundaries are source preparation, default off. They do not activate any current
database. Hosted ordinary PostgreSQL acceptance, remaining ingress/client delivery,
combined release acceptance and separately reviewed deployment/schema admission
remain gates. The two failed PostgreSQL attempts are retained, not passing evidence.

Enablement requires the exact pre-existing ordinary schema and
`KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED=true`. Runtime admission never creates or repairs
SQLite schema. Native/enrolled and archive adapters expose no claim/history ports;
there is no fallback or enrollment change. Migration 0088 refuses native identity
markers. Its narrow immutable catalog seal guards claim metadata, private ACLs,
functions, triggers and the original/session shapes needed by this domain.

A trusted new-request completion closure can create one 256-bit claim credential
for a newly completed unowned run. Only its network/origin-bound SHA-256 is stored,
with a fixed 24-hour expiry. There is no reissue, historical mint, public lookup or
reader-triggered recovery. The private delivery is separate from the immutable
`QueryRun`; a lost direct response cannot recover a link or justify replaying paid
research. Ingress wiring is not yet implemented in this checkpoint.

`/claim-run#<credential>` is a dedicated HTML route with no application layout,
providers, analytics or third-party scripts. Its first synchronous allowed script
keeps the fragment in closure memory and replaces the URL with `/claim-run`.
Exact emitted-byte script/style hashes are the only CSP permissions. HTTP
no-store/no-referrer/noindex and framing refusal apply through final matching Next
header rules. Sign-in opens the existing `/connect` in a separate window without
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

All supported ingress and client phases still require implementation and review:
web/direct API/remote MCP response-only private delivery; hosted bot private or
ephemeral delivery with group preflight before creating a run; applicable desktop,
stdio, extensions, history and profile readers. Claim secrets must never enter
public reports/projectors, analytics, exports, logs or extension recent-run storage.
Already owned/payer-bound and original native runs remain outside this domain.
