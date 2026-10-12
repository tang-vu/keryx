# Creator gas activation readiness — October 12, 2026

The owner requested creator registration gas sponsorship on the site. The current
implementation and this unsigned preparation do not activate it. A dedicated
sponsor allowance, funded testnet acceptance and an approved registry continuity
plan remain open. See [the sponsorship protocol](../creator-registration-sponsorship.md).

## Read-only observations

Public health at `2026-10-12T02:11:17.149Z` reported operational mainnet, real
settlement mode and commit `513c6fa6`. Production server/browser registry addresses
and read addresses all selected V1
`0x42a64061b6cd84067bb660b2a9b8aa881fd225bb`; unset version twins select version 1.
Its deploy block was `23910720`. Protected production environment inspection
reported no registration sponsor policy, no dedicated registration sponsor key and
no dedicated deployer key. Existing funder/treasury key presence grants no sponsor
authority. Environment permissions were `0600`; no secret values were emitted.

The selected sealed store was SQLite, `mainnet-real`, network `eip155:5042`, with
two source rows and zero `keryx:registration-sponsor:v1:` journal entries. The
enrolled SQLite facade exposes native sponsor admission/read/transition methods;
the recovery candidate adds its separately inventoried server-only execution read.
These operations use the existing `sync_state` table and native transactions.
The storage identity binds the network/Gateway profile, rather than a registry
address. A registry change supplies no reason to replace storage, reset financial
history or perform production DDL. Supabase still lacks this atomic sponsor role.

Fresh public RPC at block `25509144`, `2026-10-12T02:13:41.616Z`, read two live V1
listings. The health parity snapshot saying zero was dated October 6 and is stale.
V1 runtime code hash was
`0x4fffb030de9d91ff1638b3a0c6b452d67d7794765b53babfc3a6bd20e6ae1949`.

| On-chain source ID | Creator and payout wallet | Read price, micro-USDC | Active |
| --- | --- | --- | --- |
| `0x814192240e30b9ea872f6f713163b5ec1f5b8dd9071a7b11fcbaf3ebd79a9b7e` | `0xf4a83899ff298582de77b045704e84efe0a2562a` | `5000` | yes |
| `0x1881535394a6c36b638933dc7f398897d2ceba32e052f3484c4295290dacffc7` | `0x3d609ef127094624cc434aad5a9faca0851daa2d` | `2000` | yes |

Both had one author, the same wallet, at 10,000 basis points, and an empty content
CID. The first had tags `keryx,software,release-notes`; the second had none. Sealed
cache rows were active and verified, with URLs `https://github.com/tang-vu/keryx`
and `https://github.com/tang-vu/keryx/tree/main/docs/engineering`, respectively.
These are explicitly first-party records. Their existence establishes neither
current publishing-control proof freshness nor an approved creator allowlist.

## Deployment preparation

The existing `scripts/deploy-source-registry.ts` and `mainnet-unsigned-setup.mts`
deploy or package V1 only. Hardhat currently configures local testing and Arc
testnet, without a mainnet signing network. Do not run either V1 helper expecting
V3. The new
[`prepare-registration-sponsor-deployment.mts`](../../scripts/prepare-registration-sponsor-deployment.mts)
consumes the exact compiled V3 Hardhat artifact and its build-info with explicit
reviewed SHA256 digests. It loads no environment files or private keys, admits
only read/simulation RPC methods and emits one fresh unsigned public JSON packet.
It never deploys, funds, migrates, signs or broadcasts.

Compile/test with the project-pinned contract settings:

```text
npm run test:contracts
```

The relevant output is
`artifacts/contracts/source-registry-v3.sol/SourceRegistryV3.json`. Resolve its
`SourceRegistryV3.dbg.json` `buildInfo` relative path to the matching
`artifacts/build-info/<id>.json`. Review source, Solidity
`0.8.24+commit.e11b9ed9`, Paris EVM, optimizer 200 runs and the exact artifact and
build-info bytes; retain both SHA256 values. Compile in an isolated environment
without personal custody files: Hardhat's existing configuration can read
`.env.local`, although contract testing never broadcasts.

After freezing and accepting a clean release, use explicit public inputs:

```text
node --import tsx scripts/prepare-registration-sponsor-deployment.mts
  --network arc
  --sender 0xca5b29b4f8bfbbd027ddc8516914a262f7ef6478
  --release-commit <full-accepted-release-commit>
  --artifact <absolute-SourceRegistryV3.json-path>
  --artifact-sha256 <reviewed-exact-file-sha256>
  --build-info <absolute-matching-build-info-path>
  --build-info-sha256 <reviewed-exact-file-sha256>
  --rpc https://rpc.blockdaemon.mainnet.arc.io
  --max-gas 2200000
  --max-fee-per-gas-wei 40000000000
  --max-priority-fee-per-gas-wei 1
  --max-liability-wei 88000000000000000
  --current-registry 0x42a64061b6cd84067bb660b2a9b8aa881fd225bb
  --current-registry-code-hash 0x4fffb030de9d91ff1638b3a0c6b452d67d7794765b53babfc3a6bd20e6ae1949
  --output <fresh-absolute-public-packet-path>
```

Join the displayed lines into one command or use the invoking shell's line
continuation syntax. All options are declarations for review, including the
candidate fee ceiling. The CLI requires the exact clean release commit and refuses
duplicate/unknown flags, credential-bearing RPC URLs, changed sources, compiler or
artifact provenance, wrong chain, pending/changed sender nonce, excessive estimated
gas, insufficient fee ceilings, changed legacy code and replacement output files.

At `2026-10-12T02:17:46.246Z`, separately verified official Solidity 0.8.24 WASM
compiler bytes produced V3 creation code of 9,764 bytes and runtime of 8,768 bytes.
An `eth_estimateGas`/constructor `eth_call` simulation for the existing documented
owner public deployer above returned:

| Observation | Value |
| --- | --- |
| Mainnet latest/pending nonce | `2` / `2` |
| Predicted CREATE address at that nonce | `0x3940b88099e62Dd77b31E42655466cf38aD2ADC3` |
| Estimated deployment gas | `1976977` |
| Observed base fee | `20000000000` wei per gas |
| Estimated cost at that base fee | `39539540000000000` wei, or `0.03953954` native USDC |
| Observed sender balance | `159159999754573000` wei |
| Simulated runtime code hash | `0x23af066d0abb79525a6e521cf02224a113d248ef3408075a0d85068258c5bedc` |
| Proposed deployment review ceiling | `2200000 × 40000000000 = 88000000000000000` wei, or `0.088` native USDC |

This is an estimate from a constructor simulation, not a deployed V3 address,
receipt, funding instruction or financial acceptance. Regenerate from the exact
accepted Hardhat artifact before owner signing. A nonce, chain, source or compiler
change invalidates the prediction and runtime hash. V3 embeds EIP-712 immutables:
the helper checks all non-immutable runtime bytes and every EIP-712 immutable:
the exact predicted address, chain, cached domain separator, name/version hashes
and short-string name/version. It rereads the pinned block hash after its nonce
checks before retaining the simulated runtime hash.

The subsequently generated matching Hardhat artifact/build-info from the local
candidate yielded the same gas estimate at block `25510728`. Its artifact SHA256
was `028bcc87d4cb9fa918ecb9f4a4463c4e5d7e366dec3ad509a33ce15c03646731`
and build-info SHA256 was
`596ac57fb64656cd1fd3583cf7a52469ae7ba294593de99c7f8edf636dfec8b6`.
Its simulated runtime hash was
`0x0ed4d229efcdf7467e2b62718886994cba4c88c916e5d49438bf8da943f6aa82`.
Compiler metadata changes runtime hashes even when executable behavior matches;
the Hardhat packet must use its own exact artifact rather than the earlier
in-memory compilation's hash. These local candidate observations still precede
final accepted-release packet generation and deployment approval.

[Arc's connection reference](https://docs.arc.io/arc/references/connect-to-arc)
identifies chains 5042/5042002 and native USDC's 18-decimal precision.
[The fee reference](https://docs.arc.io/arc/references/gas-and-fees) describes
EIP-1559 and currently labels its numeric fee parameters as testnet. The mainnet
base fee above was independently measured through RPC; it is not an inferred
permanent mainnet minimum. ERC-20 prices and payouts still use six decimals.

## Listing continuity gate

V1 and V3 have the same creator/URL-hash source ID formula. An original creator
can re-register the exact same source in V3 and retain that ID, but V3 has no
admin/import function. A deployer cannot migrate somebody else's listing. Neither
public creator wallet above is the public owner deployer account. Do not infer
control from first-party labels or the presence of any existing key.

A coordinated owner-authorized migration is possible only with exact authorization
from each original creator, retained canonical URL/hash and current payout/author,
price, CID, tags and active state comparisons, fresh claim/registry bindings,
accepted indexing readback and retained old-registry payment/claim evidence. V3
revisions start at one; old revision/receipt history does not become V3 evidence.
The singleton registry configuration cannot preserve two simultaneous payout
authorities. Existing indexer `lastSyncedBlock` is also global, rather than keyed by
registry, so a cutover requires a reviewed drain/checkpoint transition even when
the new contract is deployed at a later block.

For staged parallel operation, first design source-specific registry address and
version authority through cache identities, registry reads, author edits, receipts,
proofs, payout guards, source claims and separately scoped indexer cursors. Preserve
the original V1 authority for old sources and select V3 only for newly authorized
sources. The present candidate does not implement that design. Globally replacing
read/write registry pins while the two sources remain V1 is not an accepted path.
The unsigned packet always reports cutover closed; a nonzero legacy count adds
the explicit source-specific-authority design gate.

## Finite sponsor candidates and eligibility

The following limits are review proposals, with no address enrollment, private key
creation, funding, spending or policy installation authorized by this document.
Registration gas itself has not yet been measured for a funded V3 transaction.
Use the actual signed intent's estimate in the service and reduce scope when it
exceeds an approved ceiling.

| Limit | Isolated testnet recovery acceptance candidate | Initial mainnet invited candidate |
| --- | --- | --- |
| Named allowlisted EOAs | one separately approved test creator | up to five separately approved creators |
| `maxGas` | `1000000` | `1000000` |
| `maxFeePerGasWei` | `40000000000` | `40000000000` |
| `maxTransactionWei` | `40000000000000000` (0.04 native USDC) | same |
| `maxDailyWei` | `160000000000000000` (0.16) | `80000000000000000` (0.08) |
| `maxLifetimeWei` | `160000000000000000` (0.16) | `200000000000000000` (0.20) |
| `maxRegistrationsPerWallet` | `4` | `1` |
| `maxRegistrationsPerDay` | `4` | `2` |
| `maxRegistrationsTotal` | `4` | `5` |
| Expiry | exact owner-approved UTC timestamp within 24 hours | same |

These are maximum transaction liabilities, rather than expected actual costs.
Prepare a separate dedicated sponsor account/custody review and exact prefunding
proposal for each network; do not use treasury, buyer, creator or owner deployment
custody implicitly. The sponsor must resolve to the policy address, have no
unresolved pending transaction and retain the same policy/cohort history. Updating
caps or expiry cannot reset journal accounting. The testnet allowance is not a
mainnet funding request, and deployment gas is outside registration allowance.

The owner clarified that wallets already exist. "Dedicated sponsor" describes an
execution role, not a requirement to create another wallet. Prefer an existing
approved account that can serve that role. The existing personal owner wallet
remains the deployment signer without importing its key. Selecting a currently
shared treasury account for automatic gas relay needs explicit role/nonce and
allowance acceptance; copying its key into a sponsor variable alone is not that
review. No new wallet creation is requested by this candidate.

Eligibility requires an allowlisted EOA on the selected network, a matching
connected wallet/SIWE creator session, approved deployment origin, a verified exact
HTTPS publisher/feed on the same origin, fresh publishing-control proof within
24 hours, unchanged claim/source/registry bindings and applicable distribution
rights. No API key, registration label, prior payout, existing listed wallet or
contract-wallet signature establishes this role. Bulk import, edits, cashout and
paid reads do not receive this registration allowance.

## Funded acceptance still required

Use an isolated testnet deployment, protected dedicated testnet sponsor custody,
approved exact allowance, separate SQLite journal and controlled publisher feeds.
Keep production mainnet labels, sealed history and custody out of the test. The
same unsigned helper accepts explicit `--network arcTestnet` and the selected public
testnet RPC; a legacy registry snapshot is optional there. Owner signing and
testnet funding remain separate explicit actions.

There is currently no funded testnet sponsorship acceptance CLI. Existing
Vitest/service/contract tests and `test-browser-registration-sponsor.mts` use
synthetic or local in-process evidence. A future acceptance driver should consume
an explicit already-running testnet origin, exact V3 address/code hash, approved
test creator/session/claim and protected dedicated sponsor policy; it must have no
mainnet mode, account creation, funding or automatic retry. Its read-only report
must link each immutable original ID, nonce, exact transaction hash, independent
receipt/event, actual gas and indexing outcome.

Accept four separately admitted originals under the candidate allowance: normal
registration; interruption after durable creator authorization before retained
sponsor bytes; interruption after retained exact sponsor bytes before broadcast;
and lost acknowledgement after broadcast. Recover by explicit same-original
action and prove unchanged creator intent, sponsor nonce, signed-byte/hash identity,
at most one actual transaction, full held liability during uncertainty and exact
receipt accounting afterward. Receipt observation must continue after allowance
expiry without a sponsor key. Repeat read/recovery must not create another original
or reset attempt caps. Prove fresh creator ownership, payouts, source index and
later edit authority on chain, while retaining old production V1 authority.

Only after those gates and exact-source review/CI pass can the owner review a
concrete mainnet deployment, continuity plan and finite sponsor funding/policy.
After the approved transaction/cutover, rebuild matching public/server V3 profiles,
verify deployed code/version and production commit, and obtain a real sponsored
registration receipt plus indexing readback before reporting availability. None of
the read-only observations or unsigned packets in this note supplies that evidence.
