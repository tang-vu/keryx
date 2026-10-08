# Verified run ownership and ingress

This is a partial source implementation of [issue #261](https://github.com/tang-vu/keryx/issues/261).
Current main already attributes both streaming and non-streaming keyed OpenAI
requests to the verified key wallet. Private execution and retained original
fulfillment also already carry their verified original payer. This candidate
fixes the missing payer in synchronous public A2A execution and its durable
worker, and adds closed metadata for new shared research runs.

## Authority and history

`QueryRun.asker` remains the owner lookup used by authenticated wallet history.
It comes from the server's session, verified ask-scoped API key, or the original
paid order's payer. The worker compares the retained payer with its claimed
order before execution. Monthly verifies its wallet proof and creates the same
payer-bound order; it does not create a second inbound payment during redemption.
No request body, IP, user agent, platform user ID or editable client label can
populate ownership. Revoked and insufficient-scope keys retain their refusal.

Ownership does not grant a new allowance or authorize signing. `askerFunded`
continues to mean that the wallet's browser session paid downstream creator
payments. A treasury-funded keyed request or prepaid A2A result cannot increase
those browser-funded totals merely because it is in the wallet's history.
Existing order history, caller limits and payer recovery remain separate.

Private execution still saves through job-scoped effects to owner-scoped private
results, never to public `query_runs`, payment events or cache. Its existing
minimal private result projection remains unchanged. Old protected original
fulfillment records and portable receipts are not rewritten or backfilled.

## Closed metadata

The optional `provenance` packet has exactly three fields:

```json
{"version":1,"surface":"api","ownershipMethod":"api-key"}
```

The closed surface vocabulary is `web`, `remote-mcp`, `stdio-mcp`, `api`,
`agent-to-agent`, `telegram`, `discord`, `slack`, `extension`, `desktop`, `cli`
and `unknown`. Implemented owner methods are `session`, `api-key`,
`verified-payer` and `unknown`. There is no linking, claim-later or assignment
endpoint behind this metadata.

The metadata describes already established authority; it cannot create an
`asker`. Without an owner the method is `unknown`. The browser-safe parser
copies only the closed fields, refuses accessors/extra fields and omits invalid
metadata from public projections. A missing packet on an old run remains absent
and means unknown; payment origin and old wallet values cannot reconstruct it.

| Producer / observed ingress | New metadata | Wallet ownership |
| --- | --- | --- |
| Web/chat/embed `/api/ask` | `web` | Verified session, otherwise absent |
| OpenAI-compatible API, including extension clients using it | `api` | Verified ask-scoped key, otherwise absent |
| Remote HTTP MCP | `remote-mcp` | Verified ask-scoped key, otherwise absent; `mcpClient` stays editable telemetry |
| Public A2A synchronous/queued and Monthly worker | `agent-to-agent` | Verified original payer |
| Isolated private research executor | Packet stays absent | Verified original payer; private storage/projection stays separate |
| Telegram / Discord / Slack | Respective verified bot ingress | Absent: platform authentication is not a wallet link |
| Local `npm run ask` | `cli` | Absent: local execution does not establish a verified wallet |
| Stdio MCP, buyer CLI and desktop using hosted A2A | Observed `agent-to-agent` ingress | Verified payer; remote client identity remains unknown |
| Other internal or unstamped callers | `unknown` | Existing owner, if any, with unknown proof method |
| Retained protected originals and historical receipts | Packet remains absent when absent originally | Existing original authority stays unchanged |

The enum's stdio/desktop/extension labels do not mean that hosted Keryx can
verify those remote apps. An independently authenticated/bound client protocol
would need its own privacy, request-version and release design. This candidate
deliberately records the ingress it can establish.

## Storage and supported contracts

Both ordinary and enrolled database paths already persist the complete run JSON
in `query_runs.data`; the existing indexed `asker` remains the wallet-history
filter. Both application writers use the same closed snapshot for a provided
packet and preserve a missing packet. No column, SQL function, storage identity
digest, enrollment cutover or historical DML is introduced. Rollback leaves
additive JSON readable by older writers; older writers may omit new metadata.

New public API/A2A/remote-MCP result projections expose the packet when present,
without exposing a wallet, API key or raw platform identifier. Old projections
and integrity-checked portable receipt schemas stay unchanged. Authenticated
`/api/me/asks` can include the recorded packet but remains session-only, bounded
and wallet-filtered. OpenAPI and both MCP tool descriptions explain ownership
and the remote-client boundary. Bots, extension and desktop reuse their existing
result/reader roles; there is no new client identity input.

## Validation and release gates

Offline tests cover the real key verifier and revocation against isolated
SQLite, API streaming and non-streaming, forged body/client labels, session and
authenticated bot ingress, current claimed payer, private owner-only results,
and matching SQLite/Supabase JSON/history behavior. Supabase HTTP is intercepted
in a synthetic fixture; it is not a live database or hosted migration proof.
Existing payment, evidence, reservation and original-recovery regressions remain
applicable. No live model, search or payment acceptance was performed.

Exact-source CI and independent review precede any merge. Deployment, app/package
version coordination and actual deployed wallet-history acceptance belong to the
root release. Stdio tool-description distribution needs its normal exact-source
package gate before publication can be claimed. No source-only test closes
#261's deployed acceptance. Linked chat accounts, later claims/admin assignment
and independently verified remote app identities remain unimplemented.
