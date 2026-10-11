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
Symlinks, replacement races, malformed UTF-8, partial JSON, unsupported OS profiles and unprotected
controls fail closed. The module neither creates nor edits controls.

The exact schema contains format, ID, announcement/start/end timestamps, phase
and a short plain message. All times are canonical UTC ISO strings. A window is
at most30 minutes; announcement strictly precedes the start. An immediate
emergency window is outside this planned-maintenance contract. The states are:

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
2. Publish the real upcoming window before closing admission. The app banner and
   supported-client handling must be qualified with the independent status URL
   and preservation of the original request/journal on503. The source candidate
   now mounts a banner and handles the browser refusal; this does not activate
   the front door or prove deployed/client lifecycle acceptance.
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

Local Node 24.21.0 checks use the immutable dependency junction with Vitest cache
disabled. The initial candidate `9ddc858a` passed 20 tests across 5 files, including
the two unchanged cryptographic/sign-route suites. After review corrections,
the three maintenance suites passed 11 tests with one explicit Linux-only skip on
Windows. Both the maintenance and central ops-script TypeScript graphs passed,
as did six-file lint and the diff whitespace check. The malformed UTF-8 native
regression rejects structurally valid JSON whose message bytes would otherwise
be silently replaced; equal announcement/start timestamps are also refused.
The Linux protected-file suite is included by `vitest.config.mts` and the full
Ubuntu 24.04 unit-test lane in `.github/workflows/ci.yml`; it must actually pass
there before native file acceptance is claimed. The stopped-app loopback exercise
and ambiguous upstream-response-loss case used no production, provider, database
or transaction calls.

Exact-source independent review/CI, native protected-file acceptance, final
root/peer ingress and recovery binding, deployed advance in-app banner, supported client
handling, production exercise/readback and coordinated distribution remain open.
The existing redeploy scripts, role/stock38 and one-use helpers are byte-identical;
there is no package/version bump, current release mutation or `Fixes #281` claim.

## Browser refusal preparation — 2026-10-11

The research browser accepts the exact nested front-door503 error as plain text,
offers the fixed same-origin `/maintenance/status` link, and restores the submitted
question in the existing tab draft. The bounded wait is informational; it does not
resubmit, sign, probe status automatically, or replace a newly edited draft.
Unknown upstream outcomes explicitly retain the original recovery record. Unknown
or malformed nested errors receive a plain HTTP fallback with no status action;
ordinary flat application errors and accepted SSE handling remain supported.

Focused tests use the real local front-door emitter and browser conversation with
a synthetic refusal and an inert wallet panel, plus the existing successful-stream
and sign/abort scope regressions. They do not establish normal boot, live payment,
deployed client handling or operational maintenance acceptance. This source-only
preparation does not enable the front door or change service/ingress lifecycle.
The follow-up below adds the separate advance notice. Exact combined-source hosted build/CI and the independent
front-door lifecycle, non-production exercise and production readback still gate
the complete issue281 outcome. The shared browser hook also gives the embed plain
error text; its existing question field stays populated, but it has no new status
action. Server API/MCP contracts, repository CLIs, client binaries, extension and
bot adapters are unchanged. Complete supported-client handling remains a separate
issue281 gate; no synchronized delivery or client version change is claimed here.

## Advance-window banner preparation — 2026-10-11

One client component in the request-independent root layout reads only the fixed
same-origin public `GET /maintenance/status`. It omits credentials, rejects
redirects, accepts at most8192 bytes, and times out after5 seconds. One initial
visible-page read and subsequent60-second visible-page observations have a
maximum11-call budget and a10-minute elapsed lifetime. Hidden pages do not read;
visibility changes and effect restarts preserve the instance's budget/deadline.
Any404, malformed response, oversized body, redirect or transport failure stops
observation. An initially absent/inert front door remains hidden. A failed read
after a visible notice reports current status unavailable and labels the retained
snapshot last observed. Finishing the budget/lifetime reports that refresh ended.
The fixed status link lets the reader inspect a newer independent observation.

The shared browser-safe validator copies only the exact public window/status
fields, rejects arrays, coercible enums, accessors and incoherent state/time
packets, and always retains `applicationStatus:not-probed`. The control reader
uses the same literal window validator; a singleton array/object phase no longer
passes through string coercion. Upcoming/active/overrun are derived from the
server's `checkedAt`, never the browser clock. Start and expected-end copy is UTC,
labels the last-observed public status and denies a reopening guarantee. All
window content is rendered as text; every action is the fixed same-origin link.
The banner cannot alter a draft, disable/dispatch research, sign, recover a
payment or extend/reopen a window. These finite public GET observations are
separate from the refusal panel: that panel never automatically probes or retries.

Source inspection found no in-repository blind paid503 retry. Stdio/hosted buyer
`mcp/local-payment.mts` refuses a non402 quote before signing; a failed signed
response retains its original journal/HTTP status and requires recovery before
another payment. Its bounded queue observation/recovery uses GET only. The
extension's `research-client.mjs` renders nested `error.message` as plain text and
has no signer/retry. Local `scripts/ask.mts` runs locally, outside hosted ingress.
Desktop's helper is local inspection/workspace IPC. Bot handlers execute their
accepted server run once; external webhook redelivery is not an in-app retry
guarantee. API/remote-MCP consumers receive the independent front door's exact503
contract; third-party transport behavior still needs client acceptance. No new
adapter, client binary, version, storage capability or operational schedule is
introduced. Actual front-door integration, non-production real-app lifecycle,
final combined build/CI, deployed banner/client readback and production maintenance
acceptance remain root-owned gates; these source fixtures do not close issue281.

## Real built Linux rehearsal — 2026-10-11

`Planned maintenance built Linux` is the focused, non-production acceptance gate.
It builds the actual application on an existing hosted Ubuntu24.04 runner with
Node24.21/npm11.19, explicit offline arcTestnet and no application credentials.
The rehearsal executes in a fresh Linux network namespace with only `lo`; the
build and dependency/browser installation precede that isolated runtime. No
provider, search, RPC or payment request can leave the rehearsal namespace.
It creates its own mode0700 control directory and mode0600 atomic markers,
temporary TLS certificate and ordinary local SQLite store. No production
control, ENV, custody, schedule, service or deployment helper is changed.

The actual request path is Chromium/HTTPS client → disposable Node TLS ingress
→ existing maintenance front-door library → unchanged `startNextPublicServer`
with the actual `.next` build. The TLS ingress supplies the documented trusted
Host/forwarded HTTPS metadata. A rehearsal-only listener records method/path at
the built app boundary; no cookies, bodies, signatures or query values are logged.
The browser receives real documents, assets, API and status responses: no canned
upstream, `route.fulfill`, mocked application handler or synthetic health response.
This qualifies a real isolated ingress profile, not Cloudflare production ingress.

The reproducible procedure is the workflow's **Rehearse documented drain and
stopped application through actual TLS ingress** command. On an existing safe
Linux profile, first install the pinned project dependencies and Chromium and run
`npm run build` with `KERYX_FORCE_OFFLINE=1`, `KERYX_NETWORK=arcTestnet`,
`NEXT_PUBLIC_KERYX_NETWORK=arcTestnet`, blank Supabase variables and no credentials.
Run the same loopback-only namespace command in
`.github/workflows/planned-maintenance-linux.yml`; the script rejects a profile
with any interface besides `lo`. Do not install WSL/Docker, use the production
VPS or provision another host for this check.

The script first observes real health/metrics and demonstrates that the built
SIWE verify route consumes a deterministic disposable challenge even when the
signature is invalid. It reinstates that test challenge and retains a synthetic
unfunded grant and pending-payment sentinel. It publishes one advance window,
observes the in-app banner and upcoming headers in Chromium, waits for the real
start, and verifies draining refusals before stopping the app. With no live paid
work in this profile, the app drains by its unchanged shutdown path; exit143 and
the positive `httpDrained` receipt are required. A direct `ECONNREFUSED` check
establishes that the built app listener is gone.

The independent ingress then must serve browser503/static window dates and a
working status link, API health/metrics503, paid/signed-shaped API and remote-MCP503
with exact stable JSON and bounded `Retry-After`, read-only status200/HEAD/405,
expired-window admission hold, invalid-control hold, and a separately labelled
unplanned upstream failure. Every maintenance refusal must have
`upstreamOutcome:not-dispatched`, no automatic retry, zero additional requests
at the built listener, an unconsumed challenge and identical whole SQLite schema
and rows. Removing the test marker after stopping the app tests failure
classification only; it is not a production restoration procedure.

Both failed and successful runs retain `proof.json`, application drain logs and
advance/static/unplanned Chromium screenshots in the hosted artifact named
`planned-maintenance-built-linux-<source SHA>`. The proof binds Git SHA/tree,
build ID, front-door/launcher hashes, actual ports, responses, audited requests,
exit observations and whole-database equality hashes. Owned application,
front-door, TLS and browser resources are closed; diagnostic profile files stay
on the disposable runner until its normal teardown. Failure is never promoted
to rehearsal acceptance. A passing run URL and exact source binding must be
recorded before the original non-production exercise is claimed complete.

### Surface audit and merge/delivery criteria

| Surface | Current code contract and boundary |
| --- | --- |
| Browser and embed | Shared `use-ask-stream` validates the exact nested503 through `ask-error-response`; the browser restores the question draft, uses a fixed status link, and never signs or resubmits. The finite advance banner reads independent public status. Embed keeps its original question and plain error. |
| Health, metrics and HTTP API | All `/api/*` routes are refused at the front door before application dispatch. Status never fabricates app/database health, commit or payment recovery. |
| Remote MCP | `/mcp` and descendants receive the same stable503 JSON/Retry-After. It is transport unavailability, not a fabricated JSON-RPC result or successful tool response. |
| Stdio MCP and paid CLI buyers | `mcp/local-payment.mts` refuses a non402 quote before signing. After a signed request, it preserves the original journal and HTTP status, treats settlement independently of delivery, and requires recovery before another payment. GET-only status observation does not spend. |
| Bots | Actual `/api/telegram/webhook` and `/api/discord/interactions` admission is refused before handlers run. Already accepted bot execution is not replayed. Provider webhook redelivery is outside the app's retry authority; no bot acknowledgement/success is fabricated. |
| Extension | `extension/research-client.mjs` displays nested `error.message` as text and has no signer or automatic request retry. |
| Local CLI and desktop/native | `scripts/ask.mts` runs locally; desktop/native inspection and workspace IPC do not traverse hosted ingress. Existing local error and recovery contracts remain authoritative. No package/installer or role change is required by this rehearsal-only increment. |

Merge readiness requires the exact candidate's actual `build-and-test` aggregate,
all applicable domain/platform checks, `real-built-linux-ingress` success and
source review. A skipped/cancelled run, source-only fixture, successful build
alone or open PR is insufficient. Preserve the prior accepted maintenance and
recovery review; this increment adds real built ingress evidence and no callback
exception or payment implementation. Workers do not merge while the root's
release freeze remains closed.

Delivery remains root-owned: accept the final ingress/control/active-role binding
with no direct application bypass; retain existing drain/recovery and rollback
authority; coordinate the accepted main build and applicable distribution; verify
deployed identities, advance notice, independent status and browser/API/MCP
readback. Production lifecycle and any existing-intent callback exception require
their separate accepted binding. This rehearsal authorizes no gated-pilot
activation. Keep issue281 open until its original criteria and that delivery hold;
the original acceptance asks for one non-production exercise, not a new funded
payment trial or a worker-operated production outage.
