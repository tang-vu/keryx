# Issue 304: original criteria and retained proof

Updated October 14, 2026, Asia/Saigon (October 13 UTC), in the retained isolated
`ec5f39c9750dfc9e80e66edd41348ca6034c01c3` worktree; relevant source compared with
main `133f31465598499745215eacc655267ded9a5588`. This supplements the existing
[integration ledger](circle-arc-integration-ledger.md), rather than introducing
another inventory or sponsor framework. [Original issue #304](https://github.com/tang-vu/keryx/issues/304)
remains open. This is documentation and read-only evidence work; root owns review,
PR admission, required CI, merge, publication, release and factual issue closure.

## Original acceptance map

| Original criterion | Verified scope | Remaining acceptance |
| --- | --- | --- |
| The ledger exists, is linked from the README and the proof page, and every live row has a working proof link. | Ledger exists; README Architecture and `app/proof/page.tsx` still link it at main `133f3146`. Retained October 8 UTC payment receipts demonstrate the narrow historical Live claims. ROOT's October 13 UTC app63 health/source receipts are reused below. | **Held.** Served `/proof` HTML and the other exact Live proof URLs lack current readback here. Health/source identity alone does not close every working-link requirement. |
| The path check runs in CI. | The unconditional checks step invokes `scripts/circle-arc-integration-ledger.test.mjs` and `scripts/circle-arc-integration-ledger.mjs`, including the prose lane. Retained #379 checks/aggregate succeeded; validator source remains byte-identical. | Changed documentation needs its focused path/anchor inspection and the new candidate's actual required PR aggregate before merge. Prior CI is not acceptance of this candidate. |
| The gasless evaluation states which user actions are sponsored, the policy limits, and the abuse controls. | Existing evaluation is corrected to distinguish user-paid deposit/mint gas, gas-free consent/payment signatures, Keryx registration relay liability and the disabled Circle Gas Station proposal. Limits, uncertain holds and vendor policy/billing gaps are explicit. | Independent root accuracy review; no activation or financial authority is granted by prose. |
| A testnet run shows one sponsored user action end to end. | Retained real Keryx-relay contract registrations and recovery receipts exist, with a different sponsor and creator. Publisher control was a fixture and the run did not establish actual user/SIWE/browser admission. | **Unmet under current owner direction.** Recover any retained genuine user flow first; otherwise the separately authorized minimum action below is needed. No new transaction is authorized now. |
| Contract and service addresses are read from the official references for each network. | Retained official projections confirm chain/domain, USDC, Gateway and Gas Station contracts, Wallets API base and separate Onramp origins. October 14 local Wallets references explicitly confirm `ARC` / `ARC-TESTNET` and user-controlled EOA support. Relevant main `133f3146` source pins are unchanged. | **Held.** Fresh official mainnet Gateway base and Wallets mainnet key/environment pairing remain **UNKNOWN**. Native Gateway GET failed; processed docs are not raw HTTP/RPC authenticity. No environment or wallet inferred from configured keys. |

The retained #379 acceptance receipt binds head
`55c622f3931648135096f02dcbb7908376fc8561`, merge
`0f61890dc27a2245ab3edcf74acd06c90aa8ebe6`, identical accepted trees
`155e700be284c791df3c7089f1b8dcbdda4ad958`, and actual successful
[checks/aggregate run](https://github.com/tang-vu/keryx/actions/runs/38094055825).
Its merge is an ancestor of this baseline. That receipt concerns combined source
acceptance, including other work; it does not establish issue 304 closure,
sponsorship, current public availability or deployment. The existing validator and
its tests have no diff from that merge. Reuse their unchanged implementation evidence;
run the validator against the edited ledger. No full suite/build or dependency
installation is necessary for this documentation-only checkpoint.

## Official authority and service map

These are network-specific reference comparisons, not evidence of Keryx usage.
The web tool returned processed official documentation; its retrieval/crawl metadata
is not an independently timestamped raw HTTP body or RPC attestation. Retained
historical contract/Onramp references keep their October 13 local dates. New service
reads are dated October 14 local / October 13 UTC. Unused products acquire no runtime
address merely because a vendor publishes one.

| Authority | Mainnet / testnet comparison and exact official reference | Result |
| --- | --- | --- |
| Chain, RPC, explorer | [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc): `5042` / `5042002`, primary `https://rpc.mainnet.arc.io` / `https://rpc.testnet.arc.io`, explorer `https://explorer.arc.io` / `https://explorer.testnet.arc.io`. | Official projections match; Keryx retains its Blockdaemon mainnet RPC and historical testnet aliases. No profile migration. |
| USDC / gas units | [Arc contracts](https://docs.arc.io/arc/references/contract-addresses): both networks use `0x3600000000000000000000000000000000000000`, six ERC-20 decimals; native gas precision is 18. | Matches both profiles. Native and ERC-20 interfaces describe the same wallet USDC balance; gas accounting uses a distinct unit, not an additional asset. |
| Gateway Wallet / Minter | [Circle contract addresses](https://developers.circle.com/gateway/references/contract-addresses): mainnet Wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, Minter `0x2222222d7164433c4C09B0b0D809a9b52C04C205`; testnet Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`. [Network table](https://developers.circle.com/gateway/references/supported-blockchains): domain 26, `arc` / `arcTestnet`. | All contract/domain values match existing profiles. Official reference authenticity is distinct from observing arbitrary code at an address. |
| Gateway service | Main `133f3146` pins mainnet `https://gateway-api.circle.com`; testnet `https://gateway-api-testnet.circle.com`. The October 14 local [balance reference](https://developers.circle.com/api-reference/gateway/all/get-token-balances) still shows only testnet `POST /v1/balances`. [Official OpenAPI](https://developers.circle.com/openapi/gateway.yaml) previously listed both bases. | Fresh official mainnet confirmation **UNKNOWN**. Web read rejected `text/yaml`; ordinary native GET at `2026-10-13T17:37:40.0435720Z` failed with the receive error and no status/body. Configured SDK/profile values do not fill this gap. |
| Gas Station | [Circle contract reference](https://developers.circle.com/wallets/gas-station/contract-addresses) lists `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25` separately for Arc mainnet/testnet. [Overview](https://developers.circle.com/wallets/gas-station) identifies Circle SCA, developer card billing and 5% markup. | Reference read only; no Keryx call/enrollment. [Policy reference](https://developers.circle.com/wallets/gas-station/policy-management) retains first-operation cap/nonce gaps. No bounded activation acceptance. |
| Permissionless Paymaster | [Circle overview](https://developers.circle.com/paymaster): ERC-4337 network list excludes Arc; user pays USDC gas, with the documented Arbitrum/Base surcharge. | No Arc address inferred, configured or sponsored transaction claimed. |
| Wallets service | Retained [wallet-app guide](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app) confirms the API base in testnet examples. October 14 local [supported-blockchains table](https://developers.circle.com/wallets/supported-blockchains) explicitly maps mainnet `ARC` / testnet `ARC-TESTNET`, both supporting user-controlled EOAs/SCAs. The [initialization reference](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-with-pin-challenge) lists `https://api.circle.com/v1/w3s/user/initialize`, both chain enums and EOA/SCA options (crawl metadata: four days ago). | API base and chain/account reference values match main `133f3146`. Official mainnet key/environment pairing remains **UNKNOWN**. The adapter's key-presence readiness check does not prove that pairing or a live authenticated wallet. No session/wallet/account call made. |
| Onramp services | [Official hosting requirements](https://docs.arc.io/app-kit/references/onramp-hosting-requirements) explicitly separates production widget/API `https://onramp.arc.io` / `https://api.circle.com` from sandbox `https://onramp-sandbox.arc.io` / `https://api-test.circle.com`. [Widget quickstart](https://docs.arc.io/app-kit/quickstarts/onramp-embed-widget) independently names the production CSP origins. | Exact pinned production widget origin matches; sandbox is a separate environment, not evidence of an Arc mainnet purchase. Server/client widget and environment-bound key must match. No purchase/provider registration or profile change requested. |
| Keryx SourceRegistry | V1 mainnet `0x42a64061b6cd84067bb660b2a9b8aa881fd225bb`; retained testnet V3 `0x75403cf34cedf107735209abdd1ecd111d5e10b3`; owner-deployed mainnet V3 `0x2217250019ab614dae7391d346d05c3fc4d71ae1`. | Application-owned contracts need owner deployment/source/code/event evidence, not a invented Circle address-list entry. Old V1 listings keep their original origins; V3 proof does not migrate them. |

Read-only ec5-to-main comparison found no diff in `lib/arc-network-profile.ts`,
`lib/circle-wallet-server.ts`, `lib/circle-wallet-config.ts`,
`app/api/auth/circle/prepare/route.ts`, `lib/onramp/arc-card-onramp.ts` or
`lib/registry/source-registry-authority.ts`. The adapter selects the trusted network's
chain enum and requires vendor-authenticated `ENDUSER`/`EOA`/`LIVE` identity;
initialization explicitly requests EOA. Registry origins are configuration inputs
bound to network/address/version/code/deployment, not evidence read from an environment
here. README/proof-page links and unconditional CI validator invocation were also
checked in main's Git objects. Validator implementation remains unchanged; the parent
must run it on the edited docs. No validator or test was run by this successor.

## Current public readback request

At `2026-10-12T17:19:27.765Z`, the native PowerShell GET of
`https://keryx.cc/api/health` failed with
`The underlying connection was closed: An unexpected error occurred on a receive.`
No HTTP status/body or deployed identity was accepted. No authentication, proxy,
TLS, model, tier or execution-policy override was attempted. The request is durable
in Git-common coordination task `issue304-completion-refill-20261012`, request
`issue304-native-public-proof-20261013`. That failure is preserved. This successor
made no Keryx production request and reused the readable ROOT receipts instead:

- Public postflight `owner-fee-public-postflight-20261013.json`, captured at
  `2026-10-13T16:42:53.4729332Z`, SHA-256
  `4e46fa35a09c631b18335d2f36ddf0d46d6e86b794aad653fc6e89c803cd51ed`:
  operational app `0.27.63`, short commit `ec5f39c9`, `arc`, `settles=real`, selected
  V3 `0x2217250019ab614dae7391d346d05c3fc4d71ae1`, normal maintenance. Monitoring
  timestamps, including registry parity, are stale; this is no fresh chain proof.
- ROOT's `public-release63-after-clear-two/receipt.json`, `2026-10-13T02:29:04.858Z`,
  binds the short health commit to installed full ec5, tree
  `9a6cebc1daa5e787e0b151dd1398636531a859ed` and BUILD_ID `A-1Z6lj7isj_NjR9pOc09`.
  Its HTTP 200 captures cover health, OpenAPI and `/`, not `/proof` or payment URLs.
- Actual fee receipt `owner-fee-activation-actual-acceptance-20261013.json`,
  `2026-10-13T16:44:52.693Z`, records configuration-only activation on the same
  ec5/app63 source, unchanged caps/custody/expiry/holds and zero settled operating
  fees. It proves no code64 deploy, new budget, funded user action or sponsorship.

These are dated retained ROOT receipts, not new transport observations by this
worker. The remaining exact URLs below need ROOT's current readback. Nothing in
the original failed GET proves the public service is unavailable.

| Exact URL | Required readback |
| --- | --- |
| [Health](https://keryx.cc/api/health) | ROOT's October 13 UTC postflight supplies app63/ec5/Arc/real identity and selected V3, with stale parity qualified above. Health portion recovered; other proof URLs remain held. |
| [Proof page](https://keryx.cc/proof) | Successful served HTML containing the existing integration-ledger link. README source continuity is independently visible in this checkout. |
| [Treasury](https://keryx.cc/api/treasury) | `via=circle-gateway-api`, `observation.network=eip155:5042`; retain `paymentReadiness=not-probed`. Balance is not spend acceptance. |
| [Citation receipt](https://keryx.cc/api/dispatch/3d91fed3-dbaa-42b4-9970-db218b9f3f8a/receipt) | Real, settled, complete mainnet evidence for 0.025 USDC and Circle reference `19e49c04-93eb-4ddd-b9f2-b4a6be7c155e`. |
| [Access receipt](https://keryx.cc/api/dispatch/9d6d9d80-79b4-460e-bf0d-6f9c5e220c3f/receipt) | Real, settled, complete mainnet evidence for 0.002 USDC and Circle reference `ed41ddfb-5967-4b24-8064-dc0c6a2d9fd9`. Reused for x402/USDC layers, counted once. |
| [V1 registry](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb) and [USDC](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) | Working exact-network address pages; contract verification is distinct from current payout parity. |
| [Owner-funded historical mint](https://explorer.testnet.arc.io/tx/0x5cee615d7a5ffac3ae7caf4257343483b8a7c08315b4276a727cea3c14a4e257) | Exact testnet transaction/recipient/fee; this remains owner-funded relay gas, never Circle sponsorship. |

Circle UUIDs are offchain references, not explorer transaction hashes. The two
public Keryx receipt projections are not independent Circle transfer-API reads.
Any vendor reconciliation must preserve the original nonce, payer, payee, network,
token, amount and exact mapping; unavailable vendor authority stays qualified.

## Retained sponsored transaction inspection

No new funded test was run. Read-only inspection recovered the public reports in
the protected release-evidence `creator-gas-activation-20261012/testnet-private`
directory. No keys, signatures, signed raw bytes or database were read/copied.
Report digests matched the existing funded-acceptance document:

| Report | SHA-256 / source binding |
| --- | --- |
| `frozen-five-attempt-report-51708.json` | `4a53fa1953f3207eb360271c3c0a9023386fea59b0e25bd60175c00c8feb9365`; clean `51708d76e39a11622cf58729a2bfac0bfc24e2b6`, tree `233d138aaf1ae218f648b32bb7020605d3f4b90b`, Node `v24.21.0`, exact input digest `0eb86f972b4ea1704c4cfd54e07a00a5b721d5ba1d1a6301b7497fa39d24120a`. |
| `frozen-supplement-expiry-report-61d226.json` | `74f1e0f69cc8f728a12fd1d8be5edc38c2aecb567d99685963d85e5ca7d9bcd1`; clean `61d2264873b5c479d4290704fada8b27a7a1a59b`, tree `385992c0f9590ce7a94b823c6f7b509b804a2214`, exact input digest `45a84b7061dee30d5be37c8f2a115c08c723b494c0d056b446e5a9a538438c62`. |
| `final-independent-readback-61d226.json` | `4d09d39e67a76c8fdab2217c10a0e91aae939b44c5ceea8dcaf9c068ff77e11a`; readback time `2026-10-12T05:28:54.002Z`, same supplemental source/policy/report binding. |

All registration evidence is `eip155:5042002`, V3
`0x75403cf34cedf107735209abdd1ecd111d5e10b3`, code hash
`0xd459c6f2358823d41e17d49fb230c0791043a0fef4f017eeda3ae8d90b30fae5`.
Creator/owner/payTo is `0xc5965e3175ef063faeb8bcd3abe2d25b5d27d586`;
sponsor gas payer is `0x384462d9d8e2645a017e4ef34a0cdfd91b4b97cd`.
Original policy digest is
`0xc03dab66b51407aac227af9f14171c815cd0f340449c96297328a7fd9cad56dd`;
supplemental digest is
`0x633a6906416d3880b3f65623c6828a48e2108e84bc86765ce1d9775310e3b771`.
Each original held 0.04 native test USDC; cumulative money allowance was 0.16.
These historical allowances authorize no new action now.

| Retained outcome | Exact transaction / sponsor nonce | Block / gas used / actual native fee, wei |
| --- | --- | --- |
| Normal registration, success | [Transaction](https://explorer.testnet.arc.io/tx/0x4b29ca0be1b7379abf28f9ea942f07ed097493bf8d1ee5283d2d2af9b660f966), `132` | `66762478` / `332396` / `6647920000332396` |
| Authorization interruption, same-original success | [Transaction](https://explorer.testnet.arc.io/tx/0xf76d0f6a8fc3291dd529858c16a5030d93aeba03bdc80c11fb139a67d1ea445a), `133` | `66762841` / `298208` / `5964160000298208` |
| Raw interruption, same-bytes success | [Transaction](https://explorer.testnet.arc.io/tx/0x91e13d6e567b11d6a8578b4a44919fcf9df5f83822a57d8890bc2f14e6ac06e5), `134` | `66763151` / `298208` / `5964160000298208` |
| Lost acknowledgment, keyless receipt recovery | [Transaction](https://explorer.testnet.arc.io/tx/0xac73f6cf2f3e652ba0914ba4c2b6a3a66c4f77f8dff6e38aad0623da71867d32), `135` | `66763464` / `298196` / `5963920000298196` |
| Original fifth attempt, unsigned expiry | No sponsor nonce/hash/broadcast | No chain fee; consumed attempt retained. |
| Separate supplemental expiry resolution, reverted | [Transaction](https://explorer.testnet.arc.io/tx/0x46ddb743ada77ffa1c02b2e17f5cf99d050cdbb3b46b63ab3ab01d429719d0f7), `136` | `66768495` / `35720` / `714400000035720` |

Effective gas price was `20000000001` wei. Retained events agree with each original
hash, creator/payTo, source ID and registry origin/index checkpoint; the normal
original is `0x4f415206b04b08c593a359d72f075a156d96418d3846dc0f69ca43da8bf322cd`,
source ID `0xa893e95e726ec270f1b43c30166abf2dad1704fecab2a2fc8cec94c8ac588e07`.
The reported charges sum to `25254560001262728` wei across both cohorts.
These checks establish consistency of retained bytes and historical outcomes,
not a fresh chain observation. The existing report explicitly states
`claimEvidence=controlled-testnet-fixture`, `publisherControlAccepted=false` and
`acceptedCiClaimed=false`. Real chain fees do not turn fixture publishing claims
or synthetic browser checks into a genuine user flow. No Circle Gas Station
UserOperation, billing receipt or vendor-sponsored deposit/withdrawal was found.

## Minimum reviewable action plan

1. Root reuses the accepted app63 health/source receipts above, obtains the remaining
   current public URL readbacks and recovers any retained genuine user
   acceptance recording. For the normal testnet transaction, match actual chain,
   sender/target/nonce/zero value/decoded registration terms, successful receipt,
   event, creator/payTo/source and actual fee to the frozen original. Recover
   existing user/SIWE/publishing-control evidence rather than repeating a paid run.
2. If that user evidence is absent, keep the criterion unmet. After root completes
   the frozen ec5/app63 lifecycle, submit one concrete testnet-only proposal for a
   real consenting existing creator and an actual controlled HTTPS publisher.
   Use the existing testnet V3 and distinct existing sponsor; do not create a wallet,
   deploy a contract, register a provider, request a faucet or fund either role.
3. Before any execution, root must approve the exact accepted source/policy digest,
   origin/registry/code, creator/payTo/source terms and original action. Proposed
   maximum is one zero-value `registerWithSignature`, 1,000,000 gas, 40 gwei,
   1 wei priority and 0.04 native test USDC lifetime/day/per-original liability.
   This is a proposal, not remaining allowance or authority to spend. Preserve
   prior consumed attempts/gas and uncertain originals; no cohort reset/renewal.
4. The genuine user follows the existing isolated testnet browser/SIWE/publishing
   proof path and signs the exact registration. Root or the admitted executor alone
   handles the one sponsor submission. Refuse wrong chain/target/payTo/proof,
   replay and exhausted capacity before any signing; use existing no-spend tests
   for denials. Timeout recovers the same original read-only and keeps its hold.
5. Publish sanitized proof of admission, user intent, original ID/nonces, exact
   network/policy and transaction/event/index/fee/payer; preserve private execution
   separately. Current working explorer links and independent root review must
   pass before the issue checkbox changes. Circle Gas Station usage would require
   a different SCA/custody/vendor-billing review and is not silently substituted.

## Lifecycle and supported surfaces

Only this acceptance note and the ledger are changed. README, proof-page runtime,
CI scripts, sponsor framework, finance policy, mainnet flows and DECISIONS remain
under their existing owners. No architectural implementation choice changed.
Web/API retain hosted signing boundaries; desktop/extension handoffs, CLI/stdio
MCP caller funding and remote MCP/bot roles retain their existing contracts.
No package/installer/version/deploy or product announcement is required for these
docs. Hosted batching remains unimplemented direction: root still requires actual
PR aggregate/domain success and exact-main acceptance for later publication.

Original native author closed at `2026-10-12T17:39:36.981Z`: exit 0, signal null,
both stdout/stderr EOF. Its retained `git add` failure was
`Unable to create D:/repos/server/Github/Hackathon/keryx/.git/worktrees/cli-issue304-completion-refill-20261012/index.lock: Permission denied`.
The successor neither retries that Git writer nor changes the original handoff,
manifest or failed native HTTP receipt.

The two-doc outcome stays owned and unmerged. Parent owns independent review,
the existing docs validator, checkpoint and one coherent focused docs PR with
actual required CI; no extra micro-PR is needed. Remaining public/vendor/user
proof gates keep original #304 open even after a docs merge. Archive and hash-verify
the ignored local evidence/handoff before cleanup, then verify full merge/squash provenance and closed
dependencies. Retain this active worktree until those gates close; do not remove
another owner's evidence, process, dependency target or remote ref.
