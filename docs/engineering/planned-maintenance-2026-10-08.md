# Independent planned-maintenance front door — issue281

This is a source and non-production candidate based on main `7309f056`. It is
not installed, enabled or admitted on production. It changes no stock38/guardian,
deployment, worker, custody, grant, private-original or financial helper. Issue281
stays open until combined release and hosted/client acceptance pass.

The current documented ingress is Cloudflare Tunnel to the private application
listener. An application-owned maintenance route disappears when that process
stops. The candidate therefore uses a separate, dependency-free Node front door:
reviewed TLS ingress → loopback front door → unchanged loopback application.
The example is front door3938 to existing app3939; it is a proposal, not a change
to the current tunnel, role argv or admitted authority. The front door imports
only Node builtins and the inert existing public-metadata validator. It loads no
app, ENV file, database, credentials, payment gateway or background worker.

## Window and public contract

`deploy/maintenance/window.example.json` is inert example data. The runtime reads
only `window.json` in an **existing** canonical Linux private directory, owned by
its process UID with mode0700. The single-link file must have mode0600, be at most
4096 bytes and match its path/descriptor identity before and after reading.
Symlinks, replacement races, partial JSON, unsupported OS profiles and unprotected
controls fail closed. The module neither creates nor edits controls.

The exact schema contains format, ID, announcement/start/end timestamps, phase
and a short plain message. All times are canonical UTC ISO strings. A window is
at most30 minutes; announcement precedes the start. The states are:

| State | Admission | Meaning |
| --- | --- | --- |
| normal | Proxy once | No marker; application health is not inferred. |
| upcoming | Proxy once with start/end headers | Advance window visible on independent status/page. |
| draining | Deny new requests | Existing streams continue; optional exact retained callback described below. |
| active | Deny application requests | App can be stopped only after the existing positive drain procedure. |
| overrun | Remain held | Expected end was reached. It is no longer an active planned window; there is no automatic extension or reopening. |
| control-unavailable | Remain held | Invalid/unreadable control; no reset or implicit admission. |

During a closed window, browsers receive a static503 page with escaped message,
announcement/start/expected-end dates and a status link. `/api/*` and `/mcp` receive
503 JSON with stable `KERYX_PLANNED_MAINTENANCE`, bounded integer `Retry-After`,
`automaticRetry:false` and explicit front-door non-consumption. An expired marker
uses `KERYX_MAINTENANCE_WINDOW_EXPIRED`; invalid control uses
`KERYX_MAINTENANCE_CONTROL_UNAVAILABLE`. A missing upstream without an active
window uses `KERYX_UPSTREAM_UNAVAILABLE`, `planned:false`, rather than being
presented as planned maintenance. No upstream response is replayed or retried.
Refusals before dispatch say `upstreamOutcome:not-dispatched`; a connection loss
after the one admitted upstream attempt says `unknown`. The latter may already
have consumed authorization: browser/API output must retain that uncertainty,
never claim the payment was unconsumed or turn Retry-After into a paid retry.

`GET /maintenance` and `GET /maintenance/status` remain200 independently of the
app; HEAD is bodyless, other methods405. Status exposes only the public window,
current state and `applicationStatus:not-probed`. It never claims app readiness,
database health, deployed commit or payment recovery completion. The refusal
closes its connection and sends no preliminary100 Continue permission.

## Existing-intent recovery boundary

The launcher has **no recovery exception**. The library's optional source-pinned
exception applies only in `draining`, only to exact `POST /api/ask/sign`, with no
query/encoded alias. All grant/session/funding/withdrawal/order routes remain
closed; active/expired/unavailable states also refuse callbacks. Root and peer
must separately accept the final active application/build/route binding before
enabling this exception. A pathname alone does not prove an existing intent.

The unchanged validator canonical Git blob is
`e2ff42c2b1c761a8b5729c02cc4fdf8a543bc546`; canonical-LF SHA256 is
`02cfc6f0d5a1c22e659e29bec6f6dc197f2b8f2fa74f59e3443edb768adf5c1f`.
It looks up the retained session/request journal, requires an exposed phase,
verifies the original signer/nonce/economic challenge and admission-time window,
persists matching non-bearer metadata, and may deliver only to the original live
captured grant while currently valid. A changed validator disables the exception.
The candidate has no generic route allowlist and no replacement grant or nonce.

Already accepted responses stream unchanged when the marker changes; neither
activation nor graceful front-door close force-kills a stream. Operational drain
must preserve browser callback delivery and positively close old roles before
stopping the app. Unknown payment outcomes retain their original recovery path;
503/Retry-After is advice to check status, never permission to pay or sign again.

## Procedure for separately reviewed integration

1. Verify final source/build/roles, dependency and front-door hashes, current
   protected stock/private originals and rollback provenance. Preserve all old
   fences and failed records. Review canonical protected control paths and trust
   ingress metadata; direct application admission must not bypass the front door.
2. Publish the real upcoming window before closing admission. Root-owned app banner
   and supported-client adapters must expose the independent status URL and
   preserve the original request/journal on503. The current candidate adds the
   endpoint and headers; it does **not** mount an app banner or change client code.
3. At the approved start, replace the protected marker atomically with `draining`
   while preserving ID/start/end. No control writer or schedule is supplied here.
   Observe new paid/auth/signed admission refusing before reaching the application.
4. Finish the existing drain/recovery procedure. Only after positive closure set
   `active`, then stop/update the app using the separately reviewed controller.
   Changing the marker is no substitute for the guardian/stock drain evidence.
5. Read independent status and verify browser/API/MCP responses while app is down.
   If the window expires, report overrun and retain the admission hold. Do not
   silently extend the window or reset original financial/deployment authority.
6. Verify current mainnet source, health, storage, role and original-recovery
   readiness. Clear the marker only through the reviewed operator procedure.
   Verify all supported clients and rollback/readback before claiming restored.

Manual **non-production Linux** launcher example (existing private directory,
no app or service provisioning; callback forwarding remains disabled):

```text
node --import tsx scripts/maintenance-front-door.mts --control-directory /ABSOLUTE/PRIVATE/CONTROL --listen-port 3938 --upstream-port 3939
```

Never apply `deploy/maintenance/cloudflared.example.yml` or this command to the
current production ingress/stock controls without its separate accepted binding.
No production/SSH mutation, new schedule, finance or provider call is part of
this work. Linux owner/mode/inode checks need native CI/non-production evidence;
Windows deliberately cannot claim a protected native profile.

## Verification and remaining gates

Focused Vitest exercises an actual loopback HTTP front door and synthetic app,
then deliberately stops that synthetic app. Browser/static503, API/MCP503 JSON,
reachable status, exact Retry-After, zero upstream/auth admission, upcoming and
unplanned distinction, Expect100Continue refusal and accepted stream completion
are asserted. A separate loopback integration invokes the unchanged real sign
validator: forged header, foreign session/request and unexposed stale challenge
refuse with zero journal acknowledgement/grant lookup/delivery. Existing real
cryptographic verifier tests check nonce, signer, chain, tuple and expiry.
These are synthetic non-production checks, not live payment or recovery evidence.

Local Node24.21.0 checks use the immutable dependency junction with Vitest cache
disabled. Five focused files include the candidate routing/control/recovery tests
and the two unchanged cryptographic/sign-route suites. Targeted TypeScript and
six-file lint passed:20 tests across5 files, zero skipped/failed; TypeScript exit0,
lint exit0 and diff whitespace check exit0. The stopped-app loopback exercise and
ambiguous upstream-response-loss case ran without production, provider, database
or transaction calls. Native Linux file checks remain a separate gate.

Exact-source independent review/CI, native protected-file acceptance, final
root/peer ingress and recovery binding, advance in-app banner, supported client
handling, production exercise/readback and coordinated distribution remain open.
The existing redeploy scripts, role/stock38 and one-use helpers are byte-identical;
there is no package/version bump, current release mutation or `Fixes #281` claim.
