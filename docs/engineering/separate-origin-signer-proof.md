# Separate-origin original signer integration proof

This is a test-only browser boundary experiment. It does not replace the deployed
parent-derived signing worker, activate a signer, introduce a production signer
origin, or close the malicious-parent production release gate.

## What the fixture exercises

`lib/session/separate-origin-original-signer.integration.test.ts` runs actual
Chromium against two native HTTP origins and a temporary native SQLite database.
A top-level signer popup creates a dedicated worker. That worker generates its
own synthetic EOA; its parent receives neither the private key nor a derivation
signature. A privileged test harness supplies public identity bindings and models
independent owner intent by signing the real query-policy typed data.

The path uses the existing query admission, immutable original, durable exposure,
signed observation client/server, canonical payment typed data, ECDSA verification,
and database callback. The worker reads the original directly from the backend
with actual CORS preflight. Only an exposed original with matching active grant,
signer, owner, epoch, and query can reach payment signing. Historical terminal
observations remain readable but cannot authorize new payment crypto in this fixture.

The signer page accepts only the captured opener, exact parent origin, and the
bounded three-field command schema. Additional fields, ports, arbitrary signing
commands, duplicated correlations, and other windows are refused. Public bindings
come from trusted signer-side harness instrumentation, never from the parent
command. The payment header goes directly from worker to backend; parent responses
contain only correlation and fixed status fields.

## Evidence and ACK uncertainty

The focused suite covers 13 cases: a valid original under malicious parent input;
prepared, cancelled, revoked, replaced, offline, late, failed, and settled cases;
three ACK-loss modes; and wrong-source/forged-status/restart behavior. Negative
cases assert zero payment crypto and zero callback fetch starts or deliveries,
alongside unchanged economic state. Failed and settled cases retain otherwise
valid active current authority, so their refusal is not explained by an expired
or revoked grant.

ACK loss is tested by closing the socket before response headers, truncating a
JSON response body, and delaying the ACK past the operation lifetime. The first
experiment exposed Chromium's automatic HTTP resend after a zero-header socket
close. The test retains that case: one payment crypto call, one produced
authorization, and one application fetch start can produce multiple native HTTP
deliveries of the identical header. This is not an exactly-once HTTP claim.
Database deduplication preserves the same economic original and reserved capacity.
Parent retries do not cause another signature or application fetch.

Once payment crypto has been attempted, an absent complete valid ACK produces
`uncertain`, not `refused`. Only a bounded complete ACK tied to the fixed original
produces `recorded`. Read-only observation signatures are counted separately from
payment signatures. Server delivery counters and worker fetch-start counters are
also separate. Headers remain only in temporary test memory for identity checks.

The suite asserts browser-visible requests stay on the two fixture origins and
closes browser contexts, HTTP servers, database handles, and temporary files.
This observation does not establish containment of every browser background
network operation.

## Remaining trust and release gates

The signer assets, runtime, synthetic owner-intent harness, and backend are trusted.
This does not demonstrate a real wallet approval interface, durable credential
recovery, production deployment custody, malicious asset/server resistance, host
or extension resistance, or exclusive authority after a restore. A restarted
worker creates a different key; it cannot read the old original and does not
register replacement authority or release old capacity.

The observation remains a descriptive historical read, not an atomic signing
permission or revocation barrier. A grant can change between observation and
crypto. The fixture uses the existing bounded observation lifetime and conservative
UTC headroom, but does not prove real host UTC accuracy or solve that race.

The deployed parent-derived worker's malicious-parent release gate remains open.
Production cutover requires independently approved custody, owner intent, hosting,
recovery, revocation, and activation design, followed by implementation evidence.
No real funds, mainnet activation, production deployment, or product announcement
is part of this test-only change.

## Reproduction

With the repository dependencies and Playwright Chromium installed:

```sh
npx vitest run lib/session/separate-origin-original-signer.integration.test.ts
npx tsc --noEmit
npx eslint lib/session/separate-origin-original-signer.integration.test.ts lib/session/fixtures/separate-origin-original-signer.worker.ts lib/session/fixtures/separate-origin-original-signer-page.ts
```

The Browser signing originals SQLite workflow runs the focused fixture on Windows
and Linux. Local receipts and exact-head CI evidence are recorded in the PR.
The messaging boundary follows the origin/source checks described in the
[HTML messaging specification](https://html.spec.whatwg.org/multipage/web-messaging.html);
the native preflight exercises the
[Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).
