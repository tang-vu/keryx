# Keep browser background traffic outside clock admission

The real Chromium clock test serves a small page and the original-observation
protocol from one loopback HTTP fixture. Its protocol handler accepts at most
eight requests per second and bounds outstanding reads. That handler validates
the request and records its admission before dispatching the clock/original
path. It is not an asset server.

The fixture previously passed every request except `/` into that handler. A
browser favicon request consequently received a protocol `503` and consumed
protocol admission. From that source order, a burst of background requests can
use capacity intended for a clock read. A negative clock case could then return
`null` because of HTTP refusal rather than exercise the intended elapsed-clock
guard; the final aggregate clock counter would fail later without naming a mode.

The fixture now dispatches only `OBSERVATION_PATH` and `OBSERVATION_CLOCK_PATH`
to the unchanged handler. Other paths receive a fixture `404` immediately. The
handler still validates allowed-path queries, proofs, methods, rates and lifetimes.
No production route, client, protocol, server, admission limit or deadline changes.

The existing five actual browser modes remain: stable past/future UTC offsets
succeed, and forward/backward elapsed jumps plus the frozen-monotonic sleep model
refuse. The 100 ms injected jump, 600 ms server delay, five-second protocol window
and 30-second test bound are unchanged. Every mode now asserts one successful
clock response and exactly one original read for accepted modes, zero for refused
modes. The original aggregate five clocks/two original reads and unchanged native
state assertions remain, with exactly seven protocol-handler calls as an
additional routing check. Eight explicit favicon requests must return `404`.

Each successful mode emits only its name, boolean outcome and coarse read counts
for CI diagnostics. No signer, nonce, proof, request locator, key, raw original or
response body is logged. These records identify a missing clock response in its
mode instead of allowing a protocol refusal to stand in for the clock check.

## Observed regression and limits — November 10, 2026

PR [#894](https://github.com/tang-vu/keryx/pull/894) originally recorded a Windows
browser-clock aggregate of four successful clock responses instead of five.
The per-mode boolean assertions had passed. The exact same job later passed on
one unchanged-source retry. That old log does not identify its favicon sequence,
refusal reason or failing mode; this change does not prove its exact cause or
claim that all timing failures are eliminated.

A new controlled real-browser assertion on the old fixture expected eight
background `404` responses and actually received eight `503` responses. After
the fixture-only routing change, all 16 client/server/protocol cases passed,
including the full five-case client file. The clock case, including all five
modes, completed in about 4.468 seconds in that local run. Required browser,
native-state, expiry and busy-slot assertions were kept. The existing shared
Playwright 1.63.0 / Chromium headless 1243 executable and recorded cache metadata
remained unchanged; browser profiles and SQLite fixtures used the task's own
temporary directory. No browser installation/download or production request ran.

The local Vitest JSON reporter retained the successful assertion report but
suppressed console rows. Local evidence is bound to that report and exact source;
it does not invent a per-mode transcript. Required PR and exact-main CI must run
the original compiler, default tests and applicable domain/platform gates. Their
default-reporter logs additionally retain all five emitted mode records.
