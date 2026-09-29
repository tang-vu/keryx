# Mainnet readiness evidence — 2026-09-29

**Decision: NOT READY across M1–M8.** This is a dated evidence dossier for the
[M1–M8 release gates](../mainnet-delivery-plan.md#mainnet-release-gates), not launch
approval. The inspected worktree uses Arc testnet for payment, signing, withdrawal,
registry and operational state. No mainnet transaction was signed or sent for this
check. A documented external service value does not switch Keryx to mainnet.

## M1: published facts and limited observations

- [Arc's connection guide](https://docs.arc.io/arc/references/connect-to-arc),
  checked 2026-09-29, publishes Arc mainnet chain ID `5042`, primary RPC
  `https://rpc.mainnet.arc.io` and explorer `https://explorer.arc.io`.
  This updates the September 9/11 historical testnet-only observations in the
  delivery plan; it does not erase their historical context.
- [Arc's contract-address reference](https://docs.arc.io/arc/references/contract-addresses),
  checked 2026-09-29, publishes mainnet USDC ERC-20 interface
  `0x3600000000000000000000000000000000000000`, GatewayWallet
  `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, and GatewayMinter
  `0x2222222d7164433c4C09B0b0D809a9b52C04C205`. Its mainnet USDC
  ERC-20 interface uses **6 decimals**; Arc native USDC gas amounts use
  **18 decimals**. The USDC address is the same on testnet, but the published
  GatewayWallet and GatewayMinter addresses differ from Keryx's testnet defaults.
- [Circle's Gateway supported-blockchains table](https://developers.circle.com/gateway/references/supported-blockchains),
  checked 2026-09-29, lists Arc domain `26`, mainnet API chain name `arc`,
  testnet name `arcTestnet`, and nanopayment support on every listed chain
  except Solana. The Gateway domain is not the EVM chain ID.
- A read-only development-host probe reported on 2026-09-29 that both
  `https://rpc.drpc.mainnet.arc.io` and
  `https://rpc.blockdaemon.mainnet.arc.io` returned `eth_chainId = 0x13b2`
  (`5042`), nonempty `eth_getCode` results at the three published mainnet
  addresses above (USDC 1,798 bytes; GatewayWallet and GatewayMinter 163
  bytes each), and USDC `decimals() = 6`. This is code-presence and interface
  response evidence only. The probe output is not archived in this dossier;
  reproduce and retain it at release review. It establishes neither bytecode
  identity/audit nor installed SDK compatibility, live Gateway settlement,
  or a deployed Keryx SourceRegistry.
- Before PR #26, the dependency installed in the main checkout,
  `@circle-fin/x402-batching@2.1.0`, was inspected on 2026-09-29 via
  `@circle-fin/x402-batching/client`: `CHAIN_CONFIGS` exposes `arcTestnet`
  but no `arc` entry. This isolated documentation worktree has no installed
  package; the observation came from the earlier main checkout. It was a concrete
  earlier-version gap, not a conclusion about future SDK releases or
  Circle's service availability. A configuration-only network flip cannot
  satisfy SDK acceptance. The [official npm package page](https://www.npmjs.com/package/@circle-fin/x402-batching)
  lists `3.5.0` and advertises Arc mainnet support as of this check. Its
  `BatchFacilitatorClient` defaults to the **mainnet** Gateway API; upgrading
  an unpinned testnet seller would silently change the facilitator endpoint.
  PR #26 (`a79e882`) upgraded Keryx to `3.5.0`, explicitly pinned both seller
  facilitator instances to `https://gateway-api-testnet.circle.com`, and added
  regression tests. Mainnet SDK behavior remains unvalidated.
- After that merge and a testnet deployment, `/api/health` was reported
  operational. One narrow `scripts/test-pay.mts` live testnet purchase returned
  source HTTP 200 and a Circle settlement UUID; the observed Gateway available
  balance changed from 1 to 0.997 for a 0.003 testnet USDC toll. This supports
  one seller toll path only. Browser co-signing, response-loss recovery,
  withdrawal, and mainnet settlement were not exercised by that observation.

[D-261](../../DECISIONS.md) now has a merged first implementation in `27ed52c`
(PR #25): reservation and release bind to the captured grant epoch and signer;
the browser path fails closed instead of selecting treasury after a grant
disappears; and a valid signed header withheld by the server becomes a pending
payment by nonce. Focused regression tests accompanied that merge. The browser
may retain the bearer header, and the final grant check can still race with
HTTP submission. If the payment ledger write fails after signing, a held
reservation may have no durable payment row for reconciliation. A signed-but-
withheld row can remain pending indefinitely without exact terminal Circle
failure evidence. These residuals need explicit recovery/support policy and
release-candidate drills; the merge does not establish mainnet acceptance.

M2 testnet RPC observation and staged patch, checked 2026-09-29: a read-only
`eth_chainId` probe from `keryx-vps` found both production-configured HTTP and
WebSocket endpoints reporting `5042002` (Arc testnet). No endpoint URLs, tokens,
secrets or RPC response bodies were retained here, and no transaction was sent.
This is one observation, not continuous attestation or mainnet isolation. The
merged [D-265](../../DECISIONS.md) testnet patch adds live chain checks before
configured HTTP RPC operations; registry and indexer authority reads check again
after each response, before cache mutation, and the indexer checks before cursor
advance. WebSocket pushes remain wake-only. Covered server and CLI SDK calls
have a bounded preflight, with an internal switch window and an SDK-selected
withdrawal destination RPC. Each check costs another RPC round trip; an outage
blocks the operation. No post-merge production runtime evidence is recorded
in this dossier.

SDK writes, browser and standalone signing, adversarial RPC switch-back, and
cache/cursor atomicity remain open. M2 is not accepted.

M3 staged browser signer change, validated locally 2026-09-30:
[`lib/x402-client-sign.ts`](../../lib/x402-client-sign.ts) pins `exact`, the
canonical Arc testnet network and chain ID, USDC, Circle batching EIP-712
name/version and testnet GatewayWallet contract. The ask SSE carries the
captured grant signer; the browser requires it, its saved session signer and
the active wallet account to match before signing. It refuses absent source
authority or a local cap. [`BrowserSignBudget`](../../lib/hooks/browser-sign-budget.ts)
reserves integer micro-USDC synchronously per ask before asynchronous source
checks, preventing concurrent SSE requests from overbooking that local cap.
Reservations release only before signer invocation and remain held after
possible signing or POST uncertainty. Focused negative and concurrent tests,
TypeScript, targeted lint and a production build passed locally; there is no
funded runtime or independent security-review evidence for this patch.
The accepted challenge timeout range caps signed `validBefore` at 691,200
seconds from the browser clock. It does not bind validity to grant expiry or
revoke an existing signature. Old streams, multiple asks/tabs, durable
nonce-indexed admission, server verification of the returned EIP-712 signature
and recovery after a payment-row write failure remain open across M3/M4 for that
merged browser patch.

M3 staged server callback guard, validated locally 2026-09-30: [D-267](../../DECISIONS.md)
captures the original validated challenge and grant signer in the live sign slot
before SSE delivery. `/api/ask/sign` now checks a bounded canonical inner-only header,
exact economic tuple and expiry, and recovers the EIP-712 signer against the
pinned Arc testnet domain before acknowledging or resolving the slot. Focused
real-signature, route, and gateway tests, TypeScript, targeted lint, and the
production build passed locally; no funded runtime evidence is recorded. The
nonce remains browser-generated; there is no durable nonce-indexed admission,
cross-instance callback recovery, or replay proof. A
signed header lost before ledger insertion can still leave an unindexed held
reservation. Independent security review and M3/M4 acceptance remain open.

## Gate evidence and owner action

| Gate | Evidence in this worktree | Owner action to close the gate |
| --- | --- | --- |
| M1 Network/services | Official facts and narrow RPC observation above. PR #26 (`a79e882`) upgraded to SDK `3.5.0` and pinned the testnet seller facilitator URL, avoiding its mainnet default. A deployed testnet health check was operational and one live testnet toll reportedly settled. [`lib/config.ts`](../../lib/config.ts), [`lib/chains.ts`](../../lib/chains.ts) and [`hardhat.config.ts`](../../hardhat.config.ts) remain testnet-configured; [`lib/payments/real-gateway.ts`](../../lib/payments/real-gateway.ts) uses `arcTestnet`. | Verify intended mainnet code and identity and evaluate SDK mainnet behavior. A staged Gateway/x402 deposit, authorization, settlement and withdrawal, or Keryx registry deployment, requires separate prior owner authorization and scoped funds/limits; preparing this gate authorizes no mainnet spend. Keep M1 open. |
| M2 Authority/isolation | [`lib/payments/payment-gateway.ts`](../../lib/payments/payment-gateway.ts) now refuses a missing browser grant rather than selecting treasury; [`lib/payments/session-grants.ts`](../../lib/payments/session-grants.ts) persists epoch-bound grants. [`lib/db/index.ts`](../../lib/db/index.ts) selects the configured adapter. The read-only production RPC observation and merged [D-265](../../DECISIONS.md) testnet attestation patch are described above; neither proves production isolation. | Design and test separate mainnet deployment, configuration, secrets and database, with explicit chain and Gateway EIP-712 signing-domain and nonce isolation. Close the SDK, browser, standalone and cursor residuals above; bound treasury/user funds and prohibit activation by an environment override alone. |
| M3 Security | PR #25 (`27ed52c`) merged atomic grant-epoch/signer reservation and release, refusal when the captured grant disappears, and pending recording for a signed header withheld before submission. The staged browser signer and server callback guards have focused local tests. A ledger-write failure after signing can still leave held capacity without a durable payment row; the final grant check still races with submission. | Close durable nonce admission, replay and recovery gaps. Analyze old-stream and grant-lifetime cancellation, the submission race and recovery policy. Obtain independent review of signer/session authority, contracts, x402/Gateway, registry, encrypted delivery and authentication; resolve critical/high findings and record residual risk. |
| M4 Settlement/recovery | [`lib/gateway/x402-transfer-reconciliation.ts`](../../lib/gateway/x402-transfer-reconciliation.ts) and [`scripts/reconcile-payments.mts`](../../scripts/reconcile-payments.mts) provide testnet reconciliation. A single post-SDK-upgrade testnet toll reportedly settled, but neither it nor earlier owner-operated [browser](./browser-pilot-2026-09-09.md) and [private paid](./private-paid-pilot-2026-09-10.md) pilots establishes a mainnet recovery drill. A signed-but-withheld authorization can remain pending without terminal Circle evidence, and a failed payment-row write can leave held capacity unindexed. | Run funded, release-candidate drills for response loss, replay/concurrency, Circle/RPC outages, settled-but-undelivered content, reconciliation and creator withdrawal. Define operator recovery/support for indefinitely pending or unindexed signed authorizations; preserve cap and nonce until an authoritative outcome. |
| M5 Operations | PR #24 (`61ddf06`) merged [`reconciliation-alert`](../../scripts/reconciliation-alert.ts) so failed or thrown out-of-band alert delivery leaves the fingerprint unset and retries next run; focused tests cover this. A [local snapshot restore](./restore-drill-2026-09-09.md) exists, but is narrower than release recovery. | Verify actual alert transport and routing in the release environment. Run full off-host restore, rollback, key rotation, capacity/load, funding-limit and incident-owner drills against the intended release. |
| M6 Product/data policy | The [buyer/creator/developer acceptance map](../mainnet-delivery-plan.md#product-acceptance-map) records partial journeys. PR #27 (`b04a9f0`) merged a separate [`/me/listings` route](../../app/api/me/listings/route.ts) for registry-owned listing links with public fields; it verifies at most 12 candidates per page through four concurrent live reads with four-second RPC timeouts. The original [`/me/sources` route](../../app/api/me/sources/route.ts) still selects the private alert/earnings portfolio by cached payout/author ownership. Stale nonempty URL metadata can hide valid listings; a large metadata-free corpus requires many pages. [`app/api/source/[id]/route.ts`](../../app/api/source/%5Bid%5D/route.ts) and [`app/api/cite/[id]/route.ts`](../../app/api/cite/%5Bid%5D/route.ts) are testnet product paths. | Complete independent wallet and creator journeys, including a fresh creator pilot; evaluate discovery limits, private access/receipt checks, recovery and support terms, then review privacy, retention, pricing and refunds. |
| M7 Economics/adoption | The [economics acceptance](../mainnet-delivery-plan.md#economics-acceptance) requires invoice reconciliation and independent repeat use; testnet activity is not mainnet revenue. | Reconcile private provider invoices and operating costs with settled receipts and obligations; measure independently funded buyers, independent creators and research quality. Keep private figures outside public evidence. |
| M8 Launch decision | No owner mainnet launch/spend approval is recorded. This dossier leaves M1–M7 open. | Present the release candidate, reproduced evidence, funds/limits and residual risks to the owner for an explicit go/no-go before any mainnet spend or deployment. |

Creator listing discovery merged in PR #27, but C1 is not accepted without an
independent creator pilot and resolution of the documented limits. The SDK
testnet pin is merged and has only the narrow testnet runtime evidence above.
The deployed TypeScript payment paths remain
authoritative until their own cutover gates pass. Neither the Tameion event schedule
nor a green testnet build waives any M1–M8 acceptance gate.
