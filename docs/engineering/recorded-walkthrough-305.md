# Guided recorded reviewer path

The `/walkthrough` page addresses the recorded fallback and discovery portion of
[issue305](https://github.com/tang-vu/keryx/issues/305). It leads a wallet-free
visitor through the existing public October8 owner QA report, its CACHE/SKIP
decisions, and its receipt. README links it first; the landing page links it
before the composer. It remains useful when fresh research is paused or capped.

The example is partial, first-party and mainnet. It records zero access tolls and
one 25,000-micro-USDC citation payment. It omits a requested document revision;
there is no acceptance claim, new BUY, live research narration or outside use.
The dated 160-second recording is a separate app0.27.43 artifact. Keep
[the original scope and checkpoint](../reviewer-start.md) authoritative.

The public receipt was read again with one unauthenticated GET on October9,
2026; its response SHA256 remained
`56f0e85d08626507d1679ae4a094b99c16264ff079e0f89bba3477c78780c973`.
The retained public QA snapshot in `fixtures/walkthrough/` contains the already
published test-persona question and public source/payment metadata, not a
private customer original. It is not imported into a database or a payout policy.

Nothing is requested until the visitor clicks a control. Each control performs
one fixed, credential-free read with redirects and retries disabled, a ten-second
timeout and a bounded body. A failed, malformed or blocked read is reported as
unavailable, never as a pass. Nothing reads a private job, requests a signature,
invokes research or spends.

| Control | Reads | Establishes | Does not establish |
| --- | --- | --- | --- |
| Receipt integrity | Keryx public receipt, one GET, 256KiB bound | The current payload hashes to the separately retained checkpoint digest. | Settlement. |
| Circle transfer record | `gateway-api.circle.com/v1/x402/transfers/<id>`, one GET, 64KiB bound | Circle's own record has the retained transfer ID, recipient, 25,000 atomic USDC, USDC token and `eip155:5042` on both sides, and reports `completed`. | Arc finality or an individual Arc transaction. |
| Arc payout wallet | Public Arc mainnet RPC, one JSON-RPC batch of `eth_chainId` and `eth_call` `SourceRegistry.get(sourceId)` | The endpoint attests chain 5042 in the same response, and the registry currently lists the cited source as active with the recorded payee as payout wallet. | Registry state at payment time, or the payment itself. |
| Research availability | Keryx `/api/research/availability`, one GET | Whether a global research pause is observed now, so a visitor knows the recorded run is the available path. | Admission; a sponsored question can still be refused when its allowance is spent. |

The Circle and Arc controls call no Keryx endpoint. Their expected values are
constants in `lib/recorded-walkthrough-verification.ts`, and a test binds each
one to the retained, digest-checked receipt snapshot, so a third-party record is
compared with the checkpoint rather than with a live Keryx reply. Every
payment-critical field is bound; a present record with another recipient, amount,
token or network is a mismatch. `received`, `batched` and `confirmed` are shown
as not completed, and an unknown status is unavailable.

Both third-party reads were observed from this source on October11, 2026:
Circle returned `completed` with CORS `Access-Control-Allow-Origin: *`, and the
registry returned the recorded payee as the active payout wallet. Circle's record
also names transaction `0x50f6a023...6880a2`; the default public Arc RPC returned
no transaction or receipt for that hash on the same day, so the page presents no
per-payment chain check and continues to say that finality is unproven. The
production content security policy already permits the configured network's RPC
and Gateway API origins. A deployment on the testnet profile does not, and there
the two mainnet controls report unavailable instead of a pass.

The fourth step is a small job ledger from the same receipt: 0.05 USDC
authorised, zero access tolls, 0.025 USDC citation reward, nothing pending or
failed and 0.025 USDC unspent. Service receipts and model/search costs are shown
as not recorded, so no margin is stated. It links the existing public
[job transfer ledger](operator-job-ledger-286.md) without combining its current
figures with the dated example or historical testnet.

## Surfaces and gates

This is a web reviewer flow and a client-only reader of the existing public API.
Desktop browsers may use the URL. CLI, API, remote/stdio MCP, extensions and bots
retain their original research/payment contracts; no new tool, writer, package
authority, native adapter, sponsor enrollment or quota is introduced. No Keryx
route, OpenAPI operation or security header changes; the third-party reads run
only in the visitor's browser. The
retained snapshot can be checked with the existing receipt verifier.

Focused integrity/failure tests and a real-browser component flow cover phone
and desktop layout, no automatic request, credential-free checking, tampering,
Circle mismatch and unfinished status, malformed RPC data, paused and unknown
availability, unavailable fallback and visible limits. The default Next build, built route
readback, independent source review, hosted aggregate and coordinated release
remain separate evidence. No deployed version is asserted by this document.

## Acceptance criteria status

| Criterion | Status |
| --- | --- |
| No-wallet visitor completes the walkthrough in under three minutes | Recorded path delivered; the four steps need no wallet. No timed outside-visitor run is retained, and the live run is not delivered. |
| Every verify control succeeds against live records without a Keryx-only endpoint | Delivered for the one recorded payment through Circle and the Arc registry. Per-payment Arc finality and decision replay controls stay open. |
| Sponsored allowance has a daily cap and per-visitor limit, with tests | The shared `lib/sponsored-admission.ts` enforces per-caller and service daily caps with tests. A walkthrough-specific allowance does not exist because the page starts no job. |
| Degrades to a clearly labelled recorded run when paused or spent | The page is always the labelled recorded run and reports an observed pause on request. Automatic switching from a live run is open with the live run. |
| Linked first in the README and from the landing page | Delivered in PR355. |

Full305 remains open for a genuinely funded one-button sponsored job, actual
stage narration, per-payment Arc finality, decision replay, live
budget/approval demonstrations and bounded sponsored-admission acceptance.
Replay needs a recorded run that carries actual-read checkpoints; the October8
example predates them, and producing another real run is a spending decision.
Existing sponsorship stays disabled/unfunded until its own authority gates pass.
