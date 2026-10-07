# Explicit original-fulfillment supplier window - October 7, 2026

The historical v1 authorization expires at October 7 00:00 UTC. A private date
override cannot renew it, and rewriting its literal would reinterpret retained
records. App 0.27.11 candidate introduces a distinct v2 authorization/native authority with
an explicitly supplied window of at most 90 minutes. This is an admission schema,
not a live grant. See the [procedure](../operator-original-fulfillment.md).

## Authority and recovery

The closed window contains canonical UTC `approvalReceivedAt`, `expiresAt` and
literal `maximumDurationMs: 5400000`. Its duration must be positive and bounded;
the top-level expiry must match, and authorization creation must fall inside the
window. There is no default or rolling extension. Preserve the actual owner
approval receipt time even if CI/deployment consume most of the remaining time.

The exact window enters the canonical native authority hash. Recorded native claim
time must be inside it; live native admission also rejects future timestamps and
expired permission. The existing UNIQUE original and immutable claim/failure
records prevent replacing the window or replaying an unfinished attempt. No DDL
or startup migration is added. Enrolled identity/fences remain authoritative.

Supplier admission still requires the protected authorization bytes, original
host, exact clean reviewed commit and matching old/new reservations. Dispatch
retains its opaque capability and deadline-bounded abort. Keep exactly three new
model calls and the combined 98,640 microUSD conservative reserve; actual billing
remains unknown. No inbound payment, search, creator reward, new fetch, provider
fallback or ordinary research replay becomes available.

Historical parsing validates recorded timestamps rather than applying today's
clock. Genuine prepared results can therefore be verified and completed after
expiry using the existing exact-digest/native metadata transaction. This does not
admit supplier execution or reset a failed claim.

## Validation and supported surfaces

Focused tests cover legacy reads/strict shapes, supplied positive bounded windows,
canonical timestamps, matching expiry and approval chronology, pre-permission
claims, immutable-window/unique-claim replay refusal, three-call reservations,
deadline aborts and prepared metadata completion after expiry. The independent
source review, TypeScript, lint, offline build and exact-head CI are release gates.
Record actual results and deployed identity separately; this document cannot
certify live delivery or owner approval.

| Surface | Boundary |
| --- | --- |
| Private native fulfillment CLI | Reads the v1/v2 tuple through the shared policy; single original execution and explicit metadata completion remain separate commands. |
| Web, API/SSE and A2A worker | Share native database/policy modules and receive the app update. Existing saved-answer and receipt projections omit private recovery authority. No public endpoint grants or retries fulfillment. |
| Hosted remote MCP 0.3.2 and bots | Receive shared server code; tool, answer, receipt and payment contracts remain unchanged. |
| Desktop 0.4.7 | Existing local/operator and saved-result roles remain. A source-bound bundle/installer is separately identified; app deployment never proves an installed desktop upgrade. |
| Caller-funded stdio MCP 0.4.6 | Existing caller-owned purchase/poll/receipt contract remains. Its bundle and npm provenance have independent identities; no package publication is inferred. |
| Public CLI and extension 0.1.1 | Existing answer/receipt adapters remain. No private grant, new signer or local recovery command is exposed through these surfaces. |

Current source/distribution comparisons and exact published/installed identities
must be recorded in retained release evidence before claiming synchronized delivery.

## Operational and financial gates

Preserve the accepted c1 deployment and schema-migration receipts as historical
predecessors. Deploy a newly accepted main commit under a fresh operational
context using the same native maintenance lease, held writers/cadences and the
reviewed no-DDL redeploy interface. Verify actual child closure, commit health,
roles, environment, native failure/ledgers and current cache/telemetry separately.
Landing telemetry is not paid traction and does not alter financial authority.

A live v2 tuple may be provisioned only from an applicable explicit owner approval
whose frozen window remains open, with the same original and all prior holds.
After one execution, private review must approve the actual prepared digest before
native completion. Genuine native delivered proof, ordinary-service restoration
and buyer GET/receipt verification remain required. Useful delivery, customer
traction, profit and hackathon acceptance cannot be inferred from passing tests.
