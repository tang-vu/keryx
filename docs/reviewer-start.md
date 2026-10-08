# Reviewer start: retained result and remaining demo gates

The [README](../README.md#try-it-in-two-minutes--no-wallet) is the wallet-free
entry point. Its example opens existing public artifacts; it does not promise a
fresh answer, initiate a purchase or prove independent adoption.

## Verify the example

The [archived report](https://keryx.cc/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913)
was created on October 8, 2026 at `04:42:04.712Z`, using the recorded DeepSeek
engine. It answers a QA prompt about access tolls and citation rewards using
**Keryx Engineering (first-party)**. Treat the location and job in the prompt as
a test persona, not a verified Kenyan participant.

This owner-operated MCP software-client QA run supports the three core payment
facts but omits the requested document revision (`9ea84fa`) from the delivered
answer. It remains a partial original deliverable, not a complete accepted task.

The public report and JSON expose the Low confidence boundary, `[S1]` exact
excerpts and CACHE/SKIP decisions. The Engineering article was already cached.
The [receipt](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt)
reported the following at the checkpoint below:

| Field | Recorded value |
| --- | --- |
| Settlement mode / status / ledger completeness | `real` / `settled` / `complete` |
| Source-access total | 0 USDC |
| Citation reward total | 0.025 USDC, one settled payment |
| Pending / failed / simulated creator payments | 0 / 0 / 0 |
| Network | `eip155:5042` (Arc mainnet) |
| Circle transfer reference | `f2751e74-754b-48a7-b416-6e682410ac9f` |
| Answer SHA-256 | `sha256:b3d4a3de2e706ac2ed8a92167954cc4f41e9832603d9c8cd2f73d21d98bc505e` |
| Receipt payload SHA-256 | `sha256:97803e69c805d4c5ce4fa1470ed2336571799697f0a7ec90d59e33d4674553b6` |

For optional local integrity checking, download the JSON from the report and run
the existing verifier from a configured repository checkout:

```bash
npm run verify:receipt -- ./keryx-receipt-b144ef47-c2f5-46ec-bdb7-e62bc1314913.json --expect sha256:97803e69c805d4c5ce4fa1470ed2336571799697f0a7ec90d59e33d4674553b6
```

The official verifier passed against the retained file and this separately recorded
digest. The response's `X-Keryx-Receipt-Digest` matched the embedded payload digest.
Reconciliation can change a receipt snapshot and its digest; a mismatch needs
inspection, not an assumption that the original answer changed.

A checksum checks integrity, not authorship, factual truth or independent customer
acceptance. The receipt's sanitized Circle reference records settlement evidence;
it is not an individual Arc transaction hash. This documentation check did not
query Circle or revalidate chain finality. See the [receipt trust boundary](research-receipts.md#trust-boundary).

## Public checkpoint

These unauthenticated public GETs were captured once on **October 8, 2026**.
Times below are request-start UTC; SHA-256 values cover the downloaded response
bytes, distinct from the receipt's canonical payload digest. All returned HTTP 200.

| Public artifact | Requested at (UTC) | Response SHA-256 |
| --- | --- | --- |
| [Health](https://keryx.cc/api/health) | 16:24:01.781Z | `9c080cca4d7f66a989a78e070569645a61b400693f5b283c4209524a44bc477f` |
| [Metrics](https://keryx.cc/api/metrics) | 16:24:02.077Z | `e438a219120bf412286f7398a0243c88225cc67e502a350e43d9bb4616b58db7` |
| [Recent runs](https://keryx.cc/api/runs) | 16:24:02.152Z | `66824893d1ed1b837a1c03c92fa1be0991176b6b8a9f8d879c28938fad2df925` |
| [Report JSON](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913) | 16:24:38.835Z | `78244d0432a7826de6280f9073a17e9f32876872154fa4b5e5e9d8889d28d400` |
| [Receipt JSON](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt) | 16:24:39.244Z | `56f0e85d08626507d1679ae4a094b99c16264ff079e0f89bba3477c78780c973` |
| [Report page](https://keryx.cc/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913) | 16:24:39.506Z | `ab8517b0238c40720568df39f50a36822ed8739cddfe513059ce21496c25cae9` |

Health reported `operational`, database `ok`, network `arc`, settlement mode `real`
and deployed commit `3b839ccd`. Vendor/payment admission was `not-probed`; monitoring
snapshots were stale. A healthy response does not establish new-query readiness,
fresh reconciliation or deployment of later source candidates.

Metrics reported 50 stored queries, seven settled payment records, 0.095 USDC
gross settled volume, 0.065 USDC creator access/citation payouts, two earning
creators and zero settled operating fees. The endpoint does not partition outside
users, team and QA. Its eight guest questions are events, not eight unique
independent people. Current mainnet totals are not combined with historical
testnet observations; the [submission pack](tameion-submission.md#event-period-usage-testnet-week-then-mainnet)
keeps those phases and participant evidence separate.

The report HTML contained the cited article, Low confidence boundary, Decision log,
CACHE/SKIP trace and View JSON/Download receipt links. This is HTTP/content evidence;
it does not replace a timed visual browser walkthrough.

## Recording gate

**Current Tameion recording URL: pending.** No newly recorded or hosted video is
asserted. Older testnet rehearsals and `npm run demo` are not current-release
footage. Do not close [issue #254](https://github.com/tang-vu/keryx/issues/254)
until a working reader walkthrough and a reviewed public video under three minutes
are available, and deployment/provenance/figure checks have been refreshed.

After the intended runtime release is deployed and its commit verified, record an
actual screen walkthrough of the public app. Use existing artifacts for this
wallet-free example and label it **archived owner QA / first-party source**. Any
separate fresh research or paid business demonstration needs its own admitted
task, authorization, original receipts and usefulness evidence. This plan grants
no funding, paid request or schedule authority.

| Target time | Actual screen content | Required disclosure |
| --- | --- | --- |
| 0:00–0:15 | README product sentence and example link | Who it serves; archived result, not a fresh run |
| 0:15–0:55 | Public cited answer and `[S1]` excerpts | First-party source; Low confidence and missing requested revision |
| 0:55–1:25 | Expand Decision log and inspect CACHE/SKIP rationale | Reused cached article, zero access toll |
| 1:25–1:55 | Receipt JSON and its digest/settlement fields | Real mainnet 0.025 USDC citation; Circle ID is not an Arc transaction hash |
| 1:55–2:15 | Composer and sponsored admission explanation | No new ask required; shareable questions, quota/cap limits |
| 2:15–2:40 | Dated usage, event delta and remaining evidence | Outside/team counts unavailable; testnet separate; no claimed independent paid demand |

Before adding a video URL to the README, measure the actual encoded duration
below 180 seconds, watch the full export, verify readable UI/receipt text and
accurate narration, and open the final hosted link without author credentials.
Disclose cuts and elapsed time if footage covers a longer original run. Keep
the deployed commit, original report/receipt identity, date, media hash and review
result with the published artifact. Never paste private journals, signed payment
headers, credentials or unapproved participant material into the video or repo.

## Surface boundary

This is a repository documentation change. Web/API, CLI, remote/stdio MCP,
Windows desktop, extensions and bots retain their existing runtime and payment
contracts. The reviewer path uses public web/API reads; it installs no client.
Desktop, library and Monthly details remain linked later in the README. No
package/installer identity, synchronized runtime release, deployment or new
settlement is claimed by this prose update.
