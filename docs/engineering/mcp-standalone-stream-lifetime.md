# Stateless remote MCP stream lifetime

This source candidate contributes to [issue281](https://github.com/tang-vu/keryx/issues/281).
It does not close the issue or activate a maintenance front door. The current
production process is unchanged until the coordinated release passes its gates.

## Boundary and correction

The pinned MCP SDK1.31.0 Web Standard transport uses `enableJsonResponse` only
for POST results. Its standalone GET handler can create a `text/event-stream`
response without initialization when `sessionIdGenerator` is absent. A15-second
keep-alive comment does not terminate that response; cancellation or explicit
transport closure cleans it up. Creating a new transport per request does not
bound its stream lifetime.

Keryx offers a stateless JSON remote endpoint without server-initiated
notifications. `app/mcp/route.ts` therefore returns a finite JSON HTTP405 for GET,
with `Allow: POST, DELETE, OPTIONS` and `Cache-Control: no-store`. A forbidden
Origin still returns403. OPTIONS advertises the same methods. GET refusal occurs
before API-key verification, database access, usage admission or SDK construction,
including when a caller supplies a key or stale session/resumption headers.

This follows the [official Streamable HTTP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server),
checked2026-10-09: a server may answer standalone GET with405 when it does not
offer that SSE stream. The installed SDK client treats this refusal as expected
and continues sending messages with POST.

POST tool dispatch, JSON results and financial fields are unchanged. No new
request deadline, cancellation, retry or budget authority is introduced. DELETE
retains its existing stateless behavior. This correction does not close another
request's transport or cancel legitimate in-flight paid work. Browser ask SSE
and its payment-history/recovery retention remain separate contracts.

## Source acceptance

`lib/mcp/http-lifetime.test.ts` checks the real route and SDK client:

- GET refusal with multiple Accept headers and untrusted credential/session
  metadata never verifies a key, opens storage or invokes provider transport.
- Origin refusals and OPTIONS method discovery retain their explicit behavior.
- A real SDK client receives standalone GET405, then initializes, lists tools
  and reads public status over JSON POST on an ephemeral loopback HTTP server.
- That non-production HTTP fixture waits for an active, deliberately held
  public tools-list POST to finish before `server.close` resolves. It uses no
  forced connection close, research, signer, payment, shared database or provider.

Existing route and remote-server tests cover POST admission, input refusals,
result projection and financial-state reporting. The standard Vitest lane picks
up the new regression; exact-source aggregate CI remains a release gate. The
loopback adapter is an HTTP route fixture, not a hosted or production-Next drain
observation.

## Distribution and remaining gates

The affected runtime surface is remote Streamable HTTP MCP. Its protocol identity
must become0.3.8 in the coordinated next release; this candidate records that
requirement without changing application/package versions independently. Stdio
MCP has its own process transport, and desktop/CLI/browser/extensions/bots retain
their existing interfaces. Clients consuming the remote URL must tolerate GET405
as defined by the protocol. No assertion of published or installed synchronization
is made here.

Deployment requires accepted combined source, applicable actual CI/build evidence
and the owner's release/drain procedure. A new handler cannot repair an already
loaded old process. An established TCP connection with no retained request path
does not identify MCP as its cause. Existing request-start/error/client evidence
would be needed for that attribution; completed-request logs alone cannot rule
out an unfinished stream.

Issue281 still requires independently available planned-maintenance responses,
truthful503/Retry-After and window state, distinguishable unplanned failure,
non-consumption before refusal, and exercised non-production/hosted acceptance.
See the separate [front-door proposal](planned-maintenance-2026-10-08.md).
