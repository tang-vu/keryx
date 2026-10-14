# Chat account #263 API contract addition — 2026-10-15

The implemented authenticated account routes were absent from the shared OpenAPI
specification. This addition registers their current source contracts using a
data-only module and exactly one aggregator import and paths spread. Existing
descriptions, financial paths, security schemes and generation remain byte intact.
No runtime, authentication, schema, store, policy, hook or credential is changed.

| Route | Actual method and body | Success |
| --- | --- | --- |
| `/api/me/chat-accounts` | GET, no query/body | Current account ID/revision, at most 32 private links with platform/scope/userId/channel/linkedAt, and fixed historical-unavailable reason |
| `/api/me/chat-accounts` | POST `{action:"preview",token}` | Private recipient, expiry, opaque consent proof, account ID/revision, historical-unavailable status |
| `/api/me/chat-accounts` | POST `{action:"unlink",recipient,accountId,revision}` | `{unlinked:true}`; invalidates pending tokens without transferring another account's link |
| `/api/me/chat-accounts/complete` | POST token, consentProof, accountId, revision, exact version-1 consent, empty pastRunIds | `{linked:true,platform,pastRuns:{status:"unavailable"}}` |

There is no DELETE export. The factory's unsupported-method 405 is not a claim
about Next's generated unsupported-method envelope. GET does not parse a body;
the documented caller shape is body-free. All POST objects are closed; recipient
patterns mirror Telegram, Slack and Discord contracts. Unlink's accountId is
parsed as an unconstrained string and revision as an integer, then compared to
the resolved account; completion enforces `acct_` plus 64 lowercase hex digits
and a revision from zero to Number.MAX_SAFE_INTEGER. Do not tighten unlink's
published input schema beyond that actual implementation.

`accountSessionContext` authenticates the existing cookie JWT and active durable
web session. The HTTP boundary compares the exact row hash and session wallet,
requires current explicit membership and own non-enumerable membership/chat
ports, and accepts only the configured origin/network realm. Any Authorization
header refuses: API keys are not eligible. POST requires exact configured Origin,
absent or same-origin Sec-Fetch-Site, application/json (parameters accepted), and
at most 4096 UTF-8 body bytes. GET checks Origin when present. Queries and request
URL fragments refuse; no token query, wallet selector or provider/CLI credential
is introduced. **X-Keryx-Expected-Wallet is not read or enforced by these routes.**
The actual wallet comparison is against authenticated durable state; account
ID/revision and the HMAC are the completion preconditions.

Preview checks a five-minute purpose/origin/network-bound pending token and
asserts current membership before issuing a purpose-separated HMAC using the
existing protected web-auth secret. It binds token digest and expiry, session
hash/wallet/issuedAt/expiresAt, member/credential generations, account ID/revision
and exact origin/network. Completion recomputes it against current authority;
another session, changed lineage, tampering, expiry or secret rotation requires
fresh preview. Native BEGIN IMMEDIATE rechecks fresh exact durable session and
current member/credential proof after body await, consumes once and refuses
takeover without transfer. Unlink rechecks authority in its native transaction.
These are source-traced controls, not executed acceptance in this increment.

| Status | Current refusal mapping |
| --- | --- |
| 400 | invalid_chat_request for path/query/fragment/abort or preview/unlink shape; invalid_chat_consent for completion shape |
| 401 | interactive_session_required for Authorization or durable-row mismatch; account session context may return its fixed sign-in sentence |
| 403 | same_origin_required |
| 409 | explicit_account_membership_required, chat_account_changed, chat_takeover_refused, chat_past_runs_unavailable |
| 410 | chat_token_invalid for unavailable/expired/consumed/wrong-realm pending token |
| 503 | chat_invalid_command for content type/missing body/oversize; chat_unavailable for malformed JSON/UTF-8, missing capability/secret/native refusal or unknown exceptions; session context may return its fixed unavailable sentence |

Errors remain static with no exception/credential reflection. The generic factory
catch maps only chat_takeover_refused/chat_account_changed to 409 and
chat_token_invalid to 410; other thrown ChatAccountError codes map to 503.
Nonempty pastRunIds gets the explicit 409 before strict completion validation.
Shared refusal descriptions include cases applicable to only some operations;
they do not promise every status is reachable from every method. `chatJson`
responses set private no-store, no-cache, no-referrer, nosniff and Vary Cookie/Origin.
Account-session passthrough responses retain their existing authJson headers.
Successful private projections omit token, wallet, session hash and lineage;
consentProof is private preview data. No public answer metadata is extended.

Web and API have the existing interactive private-account workflow. Desktop may
use that hosted web handoff; this increment supplies no separate native workflow.
CLI, remote/stdio MCP and extension have no chat-link credential or completion
adapter added here. Bots retain their verified provider-envelope command role
and private browser consent handoff; they cannot supply authenticated browser
membership. No wallet/payment inheritance or API-key eligibility is inferred.
Existing ChatGPT authentication, models and native policy remain unchanged.

All new unit cases are **authored UNRUN** in existing Vitest style, with synthetic
request-boundary collaborators. They cover actual method/security registration,
closed payloads/projections, token/recipient bounds, bearer/origin/query refusals,
durable-row/membership mismatch, parser statuses, historical refusal, unknown
exceptions and POST unlink. They do not prove native session authenticity or real
provider acceptance. No imports, tests, compiler, native DB, browser, build,
provider, Git writer, target, spend or schedule execution occurred here.

`output/openapi-contract-handoff.json` retains full raw before/after bytes,
minimal patch, complete inverse/restoration and protected source SHA-256 pins.
R157's active compiled harness review is separate; its unfinished driver/doc are
not acceptance inputs. Existing historical #263 claims are preserved.

ROOT next owns the different tiny review, new contract checks, current types,
strict copy/current auth-channel composition, routing build/compiled acceptance,
focused PR and required aggregate/domain CI, then coordinator-serialized merge
and batched delivery. This is a completion partition, not an original #263
closure or production activation claim. Historical exact-list attachment remains
unavailable and original provider/native/production acceptance gates remain open.

Source trace: `lib/chat-accounts/http.ts`, `service.ts`, `contracts.ts`,
`lib/account-sessions.ts`, `lib/accounts/contracts.ts`,
`lib/db/chat-accounts-sqlite.ts`, both `app/api/me/chat-accounts` route files,
and `lib/api/chat-accounts-route.test.ts`. Current durable-consent, research
compatibility and UI-copy documents retain their separate scope and evidence.
