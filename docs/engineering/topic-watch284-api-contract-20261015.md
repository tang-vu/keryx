# Topic-watch #284 supported API contract — October 15, 2026

**UNRUN — R168 P2 source coverage correction.** The original unconditional-401
factory control is now named provided-context refusal; it does not prove cookie
parsing. An isolated describe in the existing new contract test calls actual
collection/item route exports through real `accountSessionContext`,
`parseWebSession`/JWT verification and `isWebSessionActive`. Only cookie delivery,
selected DB row lookup/private ports and fixed test configuration are synthetic;
the parser and authorization are not mocked. Scoped setup/teardown resets these
module mocks without changing shipped auth or the other factory cases/deadlines.
Authored controls cover missing cookie, invalid JWT signature, expired JWT,
revoked (absent) durable row, exact hash/wallet/issuedAt/expiresAt mismatches and
expired row, with refusal before private-port IO and actual status/cache/referrer
assertions. A proper signed cookie reaches list/read via actual route wiring;
loss of that cookie during awaited list IO exercises fresh interactive rechecking.
No separate `freshInteractiveWebSession` call is claimed. These are real JWT
fixtures around synthetic infrastructure, not production login, native storage,
paid execution or auth-production acceptance. No tests, modules, types, browser,
DB, build, Git writer, network, provider, producer or target were executed.

ROOT acknowledged the supported-contract gap for the same #284 outcome. The static
module `lib/research/topic-watches-openapi.ts` adds two paths through exactly one
import and one paths spread in `lib/openapi-spec.ts`; its incoming body is preserved.
No runtime, auth, UI, schema, migration, configuration or CI implementation changes.

Actual route exports are collection GET/POST and item GET/PUT/POST/DELETE. Both
routes construct `createTopicWatchManagement(accountSessionContext, config.baseUrl)`.
The existing `components.securitySchemes.WebSession` cookie contract applies.
`accountSessionContext` parses the signed cookie and verifies the exact durable
session row through `isWebSessionActive`. These routes do not call a separate
`freshInteractiveWebSession` function. No token query, API key, anonymous or
automation authority is implied; any query string or Authorization header refuses.

Every request requires `X-Keryx-Expected-Wallet`; it is compared to the verified
owner, never used to select identity. Writes require exact configured Origin and
absent or same-origin Sec-Fetch-Site. Reads check Origin when supplied. The factory
captures the selected DB/wallet/session, rechecks across awaits and binds native
storage to the exact session row. Native CAS rechecks session and trusted time in
the transaction; this static contract grants no financial or migration authority.

Item mutations require `If-Match` containing a double-quoted positive safe integer
revision; no wildcard/weak/list form is accepted. List/read supply the revision;
the factory emits no ETag or Vary header. DELETE cancels and retains the tombstone,
history and capacity. It reads no body. POST action accepts only check/pause/resume/
cancel. Create/update use the strict shared spec with bounded terms, explicit
manual consent, cross-field period/cap rules and expiry rules. JSON bodies have a
16,384-byte streamed limit, five-second deadline and fatal UTF-8 decoding. Valid
nonzero caps return `standing_spend_withheld` (422); they never authorize spending.

Created returns 201. Ordinary results, including failed/interrupted/limited and
already-recorded manual outcomes, can return 200. Invalid input is 400, missing
session/Authorization refusal 401, origin refusal 403, missing watch 404, owner/CAS/
revision/overlap conflict 409, semantic refusal 422, missing preconditions 428 and
session/storage/dependency unavailability 503. Response envelopes distinguish
factory `{ error }` from domain `{ result }`. Responses carry private no-store,
no-referrer, noindex/nofollow and nosniff headers, including session errors.

List/read return validated owner-private state, including the owner's spec,
history and metadata hashes; they are not public summaries. Results contain only
the domain result fields and bounded metadata digest. No session selectors,
cookie/token values, paper bodies or client-supplied owner fields are added.
The local curated catalogue supplies lexical title/author/venue matching only.
Every result records `paidRequests: 0` and `standingSpend: "withheld"`; list records
`spendMicroUsdc: 0`. Cadence bounds manual slots, not a scheduler or background run.
There is no automatic retry/catch-up, model or live-provider discovery.

New focused source/factory controls are authored **UNRUN**. Their injected web
session/store boundary is explicitly synthetic, not native storage or financial
proof. Preserve/reuse existing native/source/API 80 + 15 + 3 UI and migration 11
evidence only within its unchanged source/input scope; no duplicated execution.
Build `94dT2my0lyGmB9oShzBUv` qualifies only the unchanged watch UI emitted closure,
not the whole application after this contract addition. Parent owns a different
tiny review, new contract tests, focused types, one canonical check if inputs
change, exact-head required CI/new build and the existing merge/release coordinator.
The active compiled driver and its acceptance document remain parent-owned.
Original #284 remains open beyond this manual metadata increment; deployment is
batched and this source-only handoff claims no delivered surface or successful check.

`output/supported-openapi-handoff.json` retains raw before/after bytes, hashes,
the unique additive aggregate inverse and full four-file restoration, plus pins
for all other incoming tracked/untracked source files. Parent source changes during
this partition are reported separately rather than overwritten.

`output/real-cookie-contract-controls-handoff.json` records this two-file
correction's raw before/after, unique forward replacements and full inverse,
plus unchanged spec/aggregate and all other incoming source pins. Parent next:
a different tiny two-file peer review, FIRST the new API test file and focused
types, final17e composition, ONE canonical mapped-input check when applicable,
then required PR CI through the existing coordinator. Original #284 remains OPEN.


## Focused results, 2026-10-15

The new supported-contract file passed all 31 cases in 3.545s, including the real exported handlers through JWT verification and the exact durable session row. The test boundary remains synthetic storage infrastructure and grants no native/payment authority. A two-field erased schema annotation corrected three TypeScript unknown-property errors; only focused types were refreshed and passed in 22.077s. The 31 successful runtime cases were retained. Final source-map qualification, exact-head required CI, merge and batched delivery remain pending.
