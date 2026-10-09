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

[Archived QA walkthrough (2m40s, app 0.27.43, recorded October 8, 2026)](https://github.com/tang-vu/keryx/releases/download/v0.27.43/keryx-current-release-6e591603-archived-qa-05.mp4)
is now available as an unchanged, silent 160-second MP4 on the app43 release.
It reopens the owner-operated, first-party MCP QA report above. No new research,
source purchase or citation payment was submitted during recording. It is not a
live-Ask test, a complete feature tour, or proof of outside adoption.

The capture observed production `6e591603` before and after; its source was
[`6e591603d2842e4ad5ce5327daaa4c7b6a318caa`](https://github.com/tang-vu/keryx/tree/6e591603d2842e4ad5ce5327daaa4c7b6a318caa).
The recording completed on October 8 at `20:32:35Z`. The original QA task took
57,043 ms on that morning; this film is a later artifact walkthrough, not footage
of its execution. The receipt remained byte-identical before and after.

| Approximate segment | Screen shown | Scope |
| --- | --- | --- |
| 0:00-0:15 | Source README and stored report link | Product context; archived owner QA |
| 0:15-0:55 | Archived answer and exact `[S1]` excerpts | Low confidence; requested revision still missing |
| 0:55-1:25 | CACHE/SKIP rationale and receipt link | Cached first-party source; zero access toll |
| 1:25-1:55 | Genuine native-browser formatted receipt | Real/settled/complete; 0.025 USDC citation; Circle ID and digest |
| 1:55-2:15 | Sponsored composer budget area | No question submitted; no live admission test |
| 2:15-2:40 | Source README and event delta | Dated scope; independent paid demand and usefulness remain open |

Review inspected a 40-image timeline sampled once per four seconds, nine full
frames at 8/25/55/83/99/112/126/142/155 seconds, and all ten scene captions.
It did not inspect every encoded frame. The report, quotations, CACHE/SKIP trace,
receipt fields, Circle reference and integrity limit were readable in those
samples. Captions occupy separate bars; the browser viewport was not replaced.
There are no internal cuts; only the idle post-walkthrough tail was omitted.

Visible limits are retained: external badge images and some GitHub metadata were
blocked by the read-only request fence; research availability displayed unknown
when activation was blocked. The Quick controls/question field are above the
main composer budget view, and the dated usage table is not visible in its scene.
Those controls, the full usage table and a new Ask are not visually accepted by
this film. The historical README in the footage still describes recording as
pending; its later public link does not change the captured pixels.

### Published-file and reader-path check

An anonymous whole-file GET returned HTTP 200 on **October 9, 2026 at 00:09 UTC**.
Its 15,766,266 bytes matched the original encoded file exactly:

`sha256:a6dc71e2fd460f8f75fa719337f79b6da7e8a698f66442d7e3d552884cff0e80`

The same bounded anonymous readback checked health, current metrics, the report
and receipt. All returned 200; health before and after reported `6e591603`.
Metrics still matched every numeric value in the dated README table: 50 stored
queries, seven settled payment records, 0.095 USDC gross volume, 0.065 USDC creator
payouts, two earning creators and zero operating fees. The endpoint does not
partition outside users, team and QA; historical testnet totals remain separate.
The original October 8 snapshot is retained rather than relabelled as a new one.

| Rechecked artifact | Response completed at (UTC, October 9) | Response SHA-256 |
| --- | --- | --- |
| [Metrics](https://keryx.cc/api/metrics) | 00:09:30.059Z | `e8d8ceb0e9e852599f498f222232fcb4eca7ad2360f0c964e0e552d8db2d972c` |
| [Report page](https://keryx.cc/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913) | 00:09:32.044Z | `c77422849872f1c3174c9543bb44cd09190e55e8eb80a5f9beca5561bdc517f3` |
| [Receipt JSON](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt) | 00:09:32.533Z | `56f0e85d08626507d1679ae4a094b99c16264ff079e0f89bba3477c78780c973` |

The wallet-free path still opens these existing artifacts. Reading them does not
prove fresh-query availability or revalidate independent chain finality. This
documentation/publication changes no runtime, release version or payment state.

## Surface boundary

This is a repository documentation change. Web/API, CLI, remote/stdio MCP,
Windows desktop, extensions and bots retain their existing runtime and payment
contracts. The reviewer path uses public web/API reads; it installs no client.
Desktop, library and Monthly details remain linked later in the README. No
package/installer identity, synchronized runtime release, deployment or new
settlement is claimed by this prose update.
