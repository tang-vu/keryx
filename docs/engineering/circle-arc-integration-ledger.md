# Circle and Arc integration ledger

This is an inventory of demonstrated Keryx integration, not a list of vendor capabilities.
Inventory reviewed in the retained `ec5f39c9750dfc9e80e66edd41348ca6034c01c3`
worktree; relevant source compared with main `133f31465598499745215eacc655267ded9a5588`
on October 14, 2026 (Asia/Saigon; October 13 UTC). Original payment/contract public
readbacks remain dated October 9 local / October 8 UTC. ROOT's October 13 UTC
app63 health receipt is reused below; other current working-link gates remain open.
Official contract references retain their October 13 local review date; only the
missing service references were revisited on October 14 local.
Subsequent deployments have their own identity check at
[public health](https://keryx.cc/api/health).
[Issue #304](https://github.com/tang-vu/keryx/issues/304) remains open. Retained
October 12 evidence includes **real Keryx-relayed testnet registrations with fixture
publisher claims**, distinct from Circle Gas Station and actual user/browser proof.
This documentation review performs no financial or runtime activation action.
See the [original-criteria acceptance map](circle-arc-304-acceptance-2026-10-13.md)
and [remaining sponsored-action proof gate](#remaining-end-to-end-proof-gate).

`Live` preserves the narrow use demonstrated by the dated public evidence below. It does not
establish every caller surface, customer adoption, independent audit or withdrawal.
Current working-link acceptance remains pending the root read-only request; a local
HTTPS failure does not establish that a public service is down.
`Testnet only` preserves historical test-USDC evidence. `Planned` includes implemented
paths whose activation or end-to-end proof is missing. `Not used` gives the reason.
Code links are relative to this document; an em dash means no implementation was found.
Every row has a tracking issue, including deliberate exclusions.

<!-- circle-arc-ledger:start -->
| Tool | What Keryx uses it for | Code | Network | Status | Proof | Tracking |
| --- | --- | --- | --- | --- | --- | --- |
| Circle Gateway | Read the selected public role's available USDC balance without signing or probing payment readiness. | [treasury observer](../../lib/gateway/unified-balance.ts), [HTTP projection](../../app/api/treasury/route.ts) | Arc mainnet | Live | [Treasury observation](https://keryx.cc/api/treasury): `via=circle-gateway-api`, `observation.network=eip155:5042`, `paymentReadiness=not-probed`. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Gateway nanopayments | Offchain authorized access tolls and citation rewards, settled through the batch facilitator. | [buyer](../../lib/payments/server-x402-client.ts), [citation route](../../app/api/cite/[id]/route.ts), [settlement evidence](../../lib/payments/x402-payment-evidence.ts) | Arc mainnet | Live | [Exact citation receipt](https://keryx.cc/api/dispatch/3d91fed3-dbaa-42b4-9970-db218b9f3f8a/receipt): 0.025 USDC, Circle reference `19e49c04-93eb-4ddd-b9f2-b4a6be7c155e`. | [#252](https://github.com/tang-vu/keryx/issues/252) |
| x402 batch facilitator | Seller verification and buyer payment headers using `@circle-fin/x402-batching`; this is Gateway Nanopayments, rather than the separate Facilitator Service. | [seller](../../lib/x402-server.ts), [batch signer](../../lib/payments/pinned-arc-batch-signer.ts) | Arc mainnet | Live | [Exact access receipt](https://keryx.cc/api/dispatch/9d6d9d80-79b4-460e-bf0d-6f9c5e220c3f/receipt): 0.002 USDC, Circle reference `ed41ddfb-5967-4b24-8064-dc0c6a2d9fd9`. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Circle Facilitator Service | Not used: current sellers select Gateway batching; no separate per-payment onchain facilitator integration. | — | None | Not used | No Keryx proof claimed; [vendor distinction](https://developers.circle.com/x402-facilitators). | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Gateway withdrawal and mint | Retained owner authorization, Circle attestation and exact original mint recovery. Production user activation is a separate gate. | [attestation service](../../lib/gateway/withdrawal-transfer-service.ts), [mint boundary](../../lib/gateway/withdrawal-mint-transaction.ts), [owner service](../../lib/gateway/creator-owner-withdrawal-service.ts) | Arc testnet rehearsal | Testnet only | [Exact finalized mint](https://explorer.testnet.arc.io/tx/0x5cee615d7a5ffac3ae7caf4257343483b8a7c08315b4276a727cea3c14a4e257), [dated owner-operated drill](creator-funded-withdrawal-drill.md): 0.002 test USDC; this is not Gas Station proof. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| CCTP | Planned crosschain funding; current Gateway domain configuration is not direct TokenMessenger or MessageTransmitter usage. | [funding plan](../tameion-2026.md) | Future, profile-specific | Planned | No direct Keryx CCTP transaction claimed. | [#256](https://github.com/tang-vu/keryx/issues/256) |
| Bridge Kit | Not used: no Bridge Kit transfer adapter or dependency; Gateway withdrawal is a different protocol. | — | None | Not used | No Keryx proof claimed. | [#256](https://github.com/tang-vu/keryx/issues/256) |
| Unified Balance Kit | Retained testnet treasury aggregation across Arc Testnet, Base Sepolia, Ethereum Sepolia and Avalanche Fuji; explicitly refused on mainnet. | [testnet-only kit reader](../../lib/gateway/unified-balance.ts) | Isolated testnet | Testnet only | [Reader and mainnet refusal](../../lib/gateway/unified-balance.ts); historical implementation, no fresh vendor balance call made for this ledger. | [#258](https://github.com/tang-vu/keryx/issues/258) |
| Onramp Kit / Arc card onramp | Implemented owner-bound card/widget session boundary; a completed purchase and USDC arrival are unproven here. Test-token faucet transfers are separate. | [server boundary](../../lib/onramp/arc-card-onramp.ts), [panel](../../components/keryx/arc-card-onramp-panel.tsx) | Arc mainnet, gated | Planned | [Implemented boundary and remaining proof](../arc-card-onramp.md); no authenticated session creation or purchase attempted. | [#256](https://github.com/tang-vu/keryx/issues/256) |
| Earn / yield | Not used: the reserve observes available USDC; it does not allocate treasury funds to yield products. | — | None | Not used | No Keryx proof claimed. | [#258](https://github.com/tang-vu/keryx/issues/258) |
| Wallets: user-controlled | Implemented Google login and user-owned `ENDUSER` EOA signing. Public configuration availability is not proof of wallet creation or a funded user action. | [server adapter](../../lib/circle-wallet-server.ts), [browser SDK](../../lib/circle-wallet-browser.ts) | Arc mainnet / isolated testnet profiles | Planned | [Public availability](https://keryx.cc/api/auth/circle/config) returned `available=true`; end-to-end wallet proof remains open. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Wallets: developer-controlled | Not used: hosted signing roles use Keryx's reviewed custody, not Circle developer-controlled Wallets. | — | None | Not used | No Keryx proof claimed; never substitute a vendor wallet for existing custody. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Wallets: modular | Not used: current batch payer/session is an EOA; no modular/passkey SCA enrollment. | — | None | Not used | No Keryx proof claimed; SCA substitution needs a separate design. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Gas Station | Evaluated below; no enabled sponsored user action or compatible SCA flow established. | — | Proposed Arc testnet pilot only | Planned | [Official Arc support](https://developers.circle.com/wallets/gas-station), not Keryx proof; sponsored testnet receipt missing. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Keryx creator-registration gas relay | Distinct sponsor EOA pays exact V3 registration gas; creator signs intent and keeps source/payout authority. Controlled-publisher financial rehearsal is retained; actual user admission remains open. | [registration service](../../lib/sources/registration-sponsor-service.ts), [native reservations](../../lib/db/registration-sponsor.ts), [funded driver](../../scripts/test-registration-sponsor-funded.mts) | Arc testnet evidence; separate bounded mainnet policy | Testnet only | [Retained normal registration](https://explorer.testnet.arc.io/tx/0x4b29ca0be1b7379abf28f9ea942f07ed097493bf8d1ee5283d2d2af9b660f966), [dated financial results and limits](registration-sponsor-funded-acceptance-20261012.md). This is Keryx relay gas, not Circle Gas Station or verified user/browser acceptance. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Permissionless Circle Paymaster | Not used: current official supported-network list does not include Arc; paying gas in USDC also does not mean Keryx sponsors it. | — | None for Keryx | Not used | [Official overview](https://developers.circle.com/paymaster); no Keryx UserOperation. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Arc contracts: SourceRegistry | Retained V1 listing authority for source control, pricing and payouts; V3 registration uses separate origins. Database entries remain a cache/fallback. | [V1 contract](../../contracts/source-registry.sol), [V3 contract](../../contracts/source-registry-v3.sol), [origin authority](../../lib/registry/source-registry-authority.ts), [client](../../lib/registry/registry-client.ts), [parity](../../lib/registry/parity.ts) | Arc mainnet | Live | [Exact retained V1 contract](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb), [health registry projection](https://keryx.cc/api/health). V3 deployment is separate from a sponsored registration receipt. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Circle Contracts / Smart Contract Platform | Not used: registry deployment, reads and writes use Keryx's viem/Hardhat paths, not Circle's contract platform. | — | None | Not used | No Keryx proof claimed. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Circle CLI | Optional marketplace metadata discovery is implemented; no production search, purchase or CLI-managed custody proof established by this ledger. | [discovery adapter](../../lib/agent/external-discovery.ts) | Vendor catalog, optional | Planned | Source invokes `circle services search`; dependency/command presence alone is not live usage proof. | [#292](https://github.com/tang-vu/keryx/issues/292) |
| Circle Agent Wallet | Not used: Keryx caller wallets and journals do not use the Agent Wallet service. | — | None | Not used | No Keryx proof claimed. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Agent Marketplace | Discovery metadata exists; public indexing, discoverability and third-party buyer evidence remain open. | [discovery metadata](../../lib/x402-discovery.ts) | Future public listing | Planned | No marketplace listing or external purchase claimed. | [#292](https://github.com/tang-vu/keryx/issues/292) |
| ERC-8004 | Planned agent identity/reputation integration; no registry registration or feedback writer implemented. | — | Future, profile-specific | Planned | No Keryx registration transaction claimed. | [#289](https://github.com/tang-vu/keryx/issues/289) |
| ERC-8183 | Planned agentic-commerce assessment; existing Keryx paid jobs are not ERC-8183 escrow jobs. | — | Future Arc testnet assessment | Planned | No Keryx escrow job transaction claimed. | [#290](https://github.com/tang-vu/keryx/issues/290) |
| Arc memos / sender-preserving batched transactions | Planned exact-settlement metadata and bounded batch withdrawals; existing Circle nanopayment batching is a separate integration. | — | Future, profile-specific | Planned | No Keryx Memo or Multicall3From call claimed. | [#291](https://github.com/tang-vu/keryx/issues/291) |
| USDC | Integer micro-USDC pricing, tolls and rewards; native gas uses a separate 18-decimal unit. | [network profiles](../../lib/arc-network-profile.ts), [allocation](../../lib/payments/split-allocation.ts) | Arc mainnet | Live | [Exact access receipt](https://keryx.cc/api/dispatch/9d6d9d80-79b4-460e-bf0d-6f9c5e220c3f/receipt), [USDC contract](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000). | [#304](https://github.com/tang-vu/keryx/issues/304) |
| EURC | Planned localized quotes/FX assessment; current payment contract remains USDC only. | — | Future, profile-specific | Planned | No Keryx EURC quote, swap or payment claimed. | [#294](https://github.com/tang-vu/keryx/issues/294) |
<!-- circle-arc-ledger:end -->

## Public evidence and its limits

The exact access and citation receipt URLs returned HTTP 200 with `mode=real`,
`status=settled`, `ledgerCompleteness=complete`, `eip155:5042`, the amounts and
Circle references listed above. These are Keryx's public projections of retained
settlement evidence, not unauthenticated reads of Circle's transfer database.
A receipt's SHA-256 digest provides consistency checking, not independent
publisher signatures or a vendor attestation. Individual Circle UUIDs are **not
Arc transaction hashes**; do not construct explorer links from them. Public Circle
reconciliation is distinct from a shared batch transaction and requires its own
exact mapping. The same two receipts are intentionally reused where they evidence
different layers of one payment, rather than counted as additional transactions.

Read-only observations at approximately `2026-10-08T17:54Z` also found:

- Health reported commit `15f56351`, network `arc`, and settlement mode `real`.
  This establishes release identity, not the pending source baseline's deployment.
- Treasury returned `available=true`, `via=circle-gateway-api` and a mainnet
  observation. Its `paymentReadiness=not-probed` is preserved; balance is not payment
  acceptance. No private treasury key or authenticated vendor endpoint was read.
- The exact SourceRegistry explorer API returned `is_contract=true` and
  `is_verified=true`. Contract presence does not prove fresh payout parity for every source.
- The testnet mint explorer API returned the exact hash and successful status;
  its actual fee was `3542725000000000` native wei. The retained drill is owner-funded,
  not a new Gas Station sponsorship or customer withdrawal.

Dynamic endpoints may later change or become unavailable. Recheck each Live proof
when changing its claim; remove the Live label if exact evidence cannot be recovered.
CI verifies ledger structure, tracking links and existing source paths offline. It
does not call vendors or pretend to verify settlement or public availability.

The October 13 native GET of `https://keryx.cc/api/health` failed with
`The underlying connection was closed: An unexpected error occurred on a receive.`
No transport, authentication or execution-policy override was attempted; that
failure is preserved. ROOT's retained public postflight at `2026-10-13T16:42:53.4729332Z`
reports app `0.27.63`, commit `ec5f39c9`, `network=arc`, `settles=real`, operational
health and normal maintenance. Its selected registry is mainnet V3
`0x2217250019ab614dae7391d346d05c3fc4d71ae1`; the older V1 proof keeps its own origin.
ROOT separately binds the installed full ec5 commit/build. Registry parity and
other monitoring timestamps in that health body are stale, not fresh chain proof.
No new Keryx GET was made here. Proof-page HTML, the remaining Live proof URLs
and retained testnet transactions still need the coordinator's readback. The
[acceptance map](circle-arc-304-acceptance-2026-10-13.md) names every URL and the
retained report hashes. Neither this failure nor offline CI supplies fresh HTTP,
vendor, chain or deployment acceptance.

## Official network and service references

Values below were checked against [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc),
[Arc stablecoin contracts](https://docs.arc.io/arc/references/contract-addresses),
[Circle Gateway addresses](https://developers.circle.com/gateway/references/contract-addresses)
and [Gateway networks/domains](https://developers.circle.com/gateway/references/supported-blockchains).
The [source profile](../../lib/arc-network-profile.ts) remains authoritative for Keryx configuration.
The October 13 web-tool projections confirmed the network-specific chain/domain,
USDC and Gateway contract rows below. These are primary-reference readbacks, not
RPC code/hash verification or raw native HTTP captures.

| Parameter | Arc mainnet | Arc testnet |
| --- | --- | --- |
| Chain ID / x402 network | `5042` / `eip155:5042` | `5042002` / `eip155:5042002` |
| Gateway label / domain | `arc` / `26` | `arcTestnet` / `26` |
| USDC ERC-20, 6 decimals | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| Native gas asset | USDC, 18 decimals | Test USDC, 18 decimals |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| Official current public RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Official current explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| Keryx Gateway API base | `https://gateway-api.circle.com` | `https://gateway-api-testnet.circle.com` |

Gateway APIs above are the pinned batch SDK/profile bases; balances use `/v1/balances`.
The prior official [Gateway OpenAPI servers](https://developers.circle.com/openapi/gateway.yaml)
readback listed both bases. On October 14 local / October 13 UTC, the web tool
refused `text/yaml` as an unsupported content type; an ordinary native GET at
`2026-10-13T17:37:40.0435720Z` failed with the same receive error retained above,
without an accepted HTTP status or body. Fresh official mainnet service-base
confirmation remains **UNKNOWN**. The current
[balance API reference](https://developers.circle.com/api-reference/gateway/all/get-token-balances)
explicitly shows the testnet base and read-only balance operation (HTTP POST).
The repository pins the vendor-listed
Blockdaemon mainnet RPC `https://rpc.blockdaemon.mainnet.arc.io`. Its retained testnet
RPC `https://rpc.testnet.arc.network` and explorer `https://testnet.arcscan.app` are
historical aliases; current official references now name the `.arc.io` endpoints above.
This ledger does not change network configuration. Alias availability and any proposed
profile migration need separate read-only validation and network-bound regression checks.

Circle Wallets uses `https://api.circle.com/v1/w3s` in the adapter; the official
[wallet-app guide](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app)
names that base/path in its Arc testnet examples. October 14 local processed reads
of [Wallets supported blockchains](https://developers.circle.com/wallets/supported-blockchains)
explicitly pair mainnet `ARC` / testnet `ARC-TESTNET` with user-controlled EOA/SCA
support. The [initialization reference](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-with-pin-challenge)
shows `https://api.circle.com/v1/w3s/user/initialize`, EOA/SCA options and both chain
enums (tool crawl metadata: four days ago). These establish vendor reference values,
not a live wallet. The missing official mainnet key/environment pairing remains
**UNKNOWN**; neither that API example nor Onramp's sandbox origin proves it.
At main `133f3146`, the adapter chooses `ARC` / `ARC-TESTNET` from the trusted profile,
authenticates a Circle user token and requires `ENDUSER`, `EOA`, `LIVE` wallet data.
Its readiness check only tests configured values; key presence proves neither
environment compatibility nor an authenticated/funded genuine user.
The [official Onramp guide](https://docs.arc.io/app-kit/onramp) describes owner-directed
fiat delivery. The Onramp adapter fixes its hosted widget origin to `https://onramp.arc.io`; the checked-in
kit boundary is not evidence that a purchase occurred. The official
[Onramp hosting reference](https://docs.arc.io/app-kit/references/onramp-hosting-requirements)
names production widget/API `https://onramp.arc.io` / `https://api.circle.com`
and sandbox widget/API `https://onramp-sandbox.arc.io` / `https://api-test.circle.com`
separately. Sandbox is not a mainnet purchase or a Wallets endpoint override.
No address for an unused CCTP,
Bridge, EURC, identity, escrow or memo deployment is copied into Keryx authority.
Use the network-specific official reference before any future implementation.

Read-only Git comparison from ec5 to full main `133f3146` found no changes in
[network pins](../../lib/arc-network-profile.ts),
[Wallets adapter](../../lib/circle-wallet-server.ts),
[Onramp boundary](../../lib/onramp/arc-card-onramp.ts) or
[registry authority](../../lib/registry/source-registry-authority.ts). Reuse the
retained address/code references. Registry origins are trusted deployment inputs,
not hardcoded endorsements; this comparison reads no environment or chain state.

For evaluation only, Circle's [Gas Station contract reference](https://developers.circle.com/wallets/gas-station/contract-addresses)
lists `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25` on both Arc networks.
Keryx does not configure or call that contract. The permissionless Paymaster's
[official network list](https://developers.circle.com/paymaster) does not list Arc;
do not infer an Arc Paymaster address from a different network.

## Gasless user-action evaluation

**Gateway deposit, budget consent and creator withdrawal have no established Circle
Gas Station sponsorship. No new sponsorship or spending is authorized by this review.**
The separate Keryx creator-registration relay has retained real testnet financial
evidence and a separately retained bounded mainnet policy; it must not be described as a zero
global sponsorship budget. Nanopayment authorizations and session consent are already offchain signatures;
they have no user transaction gas to sponsor. Gateway funding and withdrawal minting
are onchain operations with separate payer, receipt and recovery evidence.

| User action | Current gas payer / authority | Proposed sponsorship boundary |
| --- | --- | --- |
| Gateway deposit | Mainnet owner signs bounded USDC approval and `depositFor` to the retained session EOA through [owner funding](../../lib/session/owner-gateway-funding.ts). Owner pays native USDC gas. The legacy testnet session flow signs its own approval/deposit. | Assess an explicit opt-in SCA owner funding an unchanged EOA session. Sponsor only exact approval/deposit actions after compatibility and cost controls pass; never migrate an existing wallet identity implicitly. |
| Enable or increase budget | Owner/session signs offchain consent; atomic spend reservation and exact cap still bind later payments. If funding is needed, it is the deposit flow above. | No separate gas sponsor or unlimited approval. A sponsor's gas allocation cannot increase the user's paid-content cap or authorize a new top-up. |
| Creator withdrawal | Owner authorizes exact withdrawal; an admitted relay or browser submits mint and pays native USDC gas according to the selected existing flow. The retained testnet drill used owner-funded relay gas. | Assess only exact original recipient/amount/spec minting with finite relay gas reservation. Existing relay funding is not evidence of Circle Gas Station sponsorship. |
| Creator registration through Keryx's V3 relay | Creator signs exact EIP-712 registration intent offchain. The separately admitted sponsor EOA signs/submits the zero-value registry call and bears its native USDC gas, including reverted gas. Creator retains ownership/payTo; this does not sponsor research, deposits or withdrawals. | Retain the existing finite Conzit policy and original journals. Public-policy successor source is queued, not admitted runtime authority. Actual creator/browser proof and current availability require separate evidence. |

The retained production D7 scope is the existing Conzit-only policy: exact
origin `https://conzit.com`, maximum 1,000,000 gas at 40 gwei, 0.04 native USDC
per original, 0.08 per UTC day and 0.20 lifetime, five attempts total/day and two
per wallet/origin, fixed expiry `2026-10-13T10:39:10.054Z`. The sponsor role is the
existing public-fee EOA `0xdbd07d89eb85d7a36fb204b2a4d2aa68735c24e1`; V3 is
`0x2217250019ab614dae7391d346d05c3fc4d71ae1`. These are retained owner authority,
not this worker's fresh environment/availability observation or a registration
receipt. Its fixed expiry has passed at this review; do not present those historical
caps as fresh available allowance. Preserve ENV645b, V1 source origins and all existing
holds. Queued public eligibility source does not expand this allowance, renew expiry
or reset attempts.
ROOT's October 13 UTC operating-fee activation on app63 was configuration only;
it neither deploys code64 nor proves a sponsored user action, renews this policy,
adds funding or resets a budget. Settled operating-fee totals remain zero.

The existing relay binds network, deployment origin, registry address/version/code,
creator/payTo, complete source terms, nonce, deadline and publishing proof. Native
admission reserves maximum gas and attempt counts atomically; proof is reread
before signing/broadcast. Sponsor nonce serialization, exact retained bytes and
receipt/event matching prevent an implicit replacement. Ambiguous signing/submission
keeps the full hold; confirmed or reverted receipts charge actual gas. Cap/expiry
changes preserve cohort history. Per-origin limits constrain wallet rotation, but
wallet/IP/account limits do not establish one human. Unauthenticated, changed-proof,
wrong-target, replayed and over-cap actions must refuse at the actual signing boundary.
See the existing [relay protocol](../creator-registration-sponsorship.md); this
ledger changes neither its implementation nor another owner's documents.

Circle [Gas Station](https://developers.circle.com/wallets/gas-station) supports Arc
and sponsors developer-paid fees for ERC-4337 SCAs. The current Circle login adapter
accepts EOAs, while [Gateway Nanopayments](https://developers.circle.com/gateway-nanopayments)
explicitly requires EOA signatures and excludes ERC-1271. An SCA cannot silently
replace the current batch payer. An optional SCA **owner** funding a distinct EOA
session would need separate consent, contract/registration compatibility, recovery and
custody review before any trial. This is an assessment, not a selected architecture.

Circle's [permissionless Paymaster](https://developers.circle.com/paymaster) lets the
user pay gas with USDC; that is different from the developer paying. Its documented
networks currently exclude Arc, where native gas already uses USDC. It provides no
verified gasless route for the current Keryx EOA flow.

### Policy and abuse controls required before a pilot

Proposed acceptance limits below are deliberately finite and **unapproved/unimplemented**.
Any future trial needs its own explicit authorization and reviewed enforceable policy.
For this proposed Circle Gas Station pilot, the default remains disabled with zero
additional sponsor liability. The retained Keryx relay policy above is separate.

- Isolated Arc testnet only, one allowlisted owner and its explicitly bound session,
  one manual funding flow, at most two user operations (approval and deposit), no
  automatic replenishment. Include account deployment/first-operation costs in that
  same allocation or refuse the flow; no extra unbounded enrollment operation.
- Provisional maximum gas liability: 0.01 native test USDC per operation, 0.02 in total
  for the pilot lifetime and UTC day, with at most 300,000 gas units per operation.
  Convert gas using 18 decimals, prices/deposit principal using 6. Admission reserves
  the full `gasLimit × maxFeePerGas` plus any independently bounded account-abstraction
  overhead before submission; refuse unknown/oversized overhead. Do not release an
  uncertain reservation simply because a request timed out.
- Bind chain, exact wallet identity, application origin, expiry, unique action nonce,
  target, selector, token, amount, depositor and recipient. Only decoded USDC approval
  to the selected Gateway Wallet and the exact owner-approved deposit are eligible.
  No arbitrary calls, unlimited allowance, external recipient, multi-chain fallback,
  generic batch, replay, wallet creation farming or unreviewed first operation.
- Atomically reserve per-wallet and global operation/gas limits, add authenticated
  account and IP throttling, and reject duplicates across processes. Wallet/account/IP
  limits do not prove one human or prevent all Sybil abuse. A fixed pilot allowlist and
  lifetime global ceiling are required even if vendor daily counters reset.
- Keep principal, user research cap, creator rewards, vendor fees and sponsor gas in
  separate evidence fields. Sponsor failure must not fabricate settlement, refund a
  completed payment, reset a cap or trigger another signature/deposit. Retain the
  original nonce/hash/vendor reference for read-only recovery; freeze on ambiguity.
- Require enforcement at the actual sponsor/vendor boundary, not only Keryx HTTP
  admission. Log finite reservations, denials and exact confirmed fees without secrets;
  provide a manual kill switch and monitoring, with no new recurring schedule.

Circle's [policy management reference](https://developers.circle.com/wallets/gas-station/policy-management)
documents network-level default policies, daily spend/operation limits, blocked addresses,
and automatic sponsorship. It also exempts an SCA's first transaction from the
per-transaction spending cap and warns that multiple first calls can bypass that check.
No target/selector restriction is documented there. User-wallet calls made outside Keryx
cannot be assumed to pass Keryx's admission checks. Therefore the proposed limits are
**not demonstrated enforceable through these vendor settings alone**. Do not activate
Gas Station until first-operation liability and all eligible-action restrictions are
proven at the actual boundary. Vendor testnet defaults are not authorization to spend.

Gas Station also creates developer billing liability: its current
[official overview](https://developers.circle.com/wallets/gas-station) describes
credit-card billing and a 5% gas-fee markup. Native gas ceilings alone do not bound
that fiat invoice, enrollment overhead, conversion or fees. Any later proposal must
bound those costs separately. The permissionless Paymaster charges the end user;
its stated 10% surcharge applies to Arbitrum/Base and their testnets, not an invented
Arc fee. Neither vendor enrollment nor billing fallback is authorized here.

### Remaining end-to-end proof gate

Retained report hashes were checked against the October 12
[funded acceptance record](registration-sponsor-funded-acceptance-20261012.md).
Four testnet registrations succeeded, with distinct creator/sponsor EOAs and
0.024540160001227008 native test USDC gas. The original fifth attempt expired
unsigned. One separately authorized supplemental expired original reverted and
cost 0.000714400000035720, giving 0.025254560001262728 combined registration gas.
Those are real chain outcomes with controlled publisher fixtures, not synthetic
settlement, Circle Gas Station usage, live publisher control or actual browser/SIWE
acceptance. They must not be counted as five successful registrations.

Issue #304's actual sponsored-user testnet criterion remains unchecked under the
current owner's acceptance direction; fixture/browser checks and ordinary unsigned
actions do not close it. The [minimum authority plan](circle-arc-304-acceptance-2026-10-13.md#minimum-reviewable-action-plan)
first requests missing retained user evidence, without another transaction.
A future separately authorized actual-user run
must publish the exact source/policy digest, chain and wallet roles, sponsor identity,
single original action/reference, successful transaction/UserOperation receipt,
native test-USDC fee and actual payer, principal recipient/amount, and working public
explorer links. Reconcile vendor billing/operation evidence where available and clearly
label private or unavailable evidence; a zero owner balance by itself proves nothing.
Demonstrate denied replay, wrong target/recipient, cap exhaustion, first-operation
overhead and timeout recovery without a second paid action. Synthetic tests, the old
owner-funded mint and Gateway offchain payment signatures do not close this gate.

## Maintenance and supported surfaces

Update a row when code, network, activation or proof changes. Run:

```sh
node --test scripts/circle-arc-integration-ledger.test.mjs
node scripts/circle-arc-integration-ledger.mjs
```

The unconditional CI checks step runs this validator even in the prose lane. It checks
the marked ledger table and every local document link/anchor, using a single document as the source of truth; no vendor,
RPC, provider, payment or database is contacted.

Web/API, remote MCP and bots use hosted payment boundaries; buyer CLI and stdio MCP
retain caller-controlled funding/journals. Desktop and extensions retain their documented
web purchase/signing handoffs. See [surface roles](../surface-parity.md) and
[mainnet operations](../mainnet-operations.md). This inventory adds no sponsorship,
wallet SDK or transaction authority to any surface and changes no shared payment
contract, package or installer version. Future gasless work must cover every affected
surface and its explicit funding/recovery role before coordinated release.
