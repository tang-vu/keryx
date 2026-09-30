# Arc mainnet Gateway contract provenance — 2026-10-01

Status: **M1 partial; deployment-to-audit identity remains open.** This credential-free,
read-only investigation does not approve mainnet, change Keryx configuration, fund a
wallet, or demonstrate settlement. Baseline: Keryx `origin/main`
`57aef9fada210e2de4db2da24f966d716ffde456`. Date uses Asia/Saigon; observations
below occurred on 2026-09-30 UTC / 2026-10-01 local time.

## Authority and pinned observations

[Arc's network reference](https://docs.arc.io/arc/references/connect-to-arc)
publishes mainnet chain ID 5042 and the four credential-free HTTPS endpoints used:

- `https://rpc.mainnet.arc.io`
- `https://rpc.blockdaemon.mainnet.arc.io`
- `https://rpc.drpc.mainnet.arc.io`
- `https://rpc.quicknode.mainnet.arc.io`

[Circle's address reference](https://developers.circle.com/gateway/references/contract-addresses)
publishes Gateway Wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`
and Gateway Minter `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
Public chain reads add the following evidence, separate from address publication.

| Observation | Gateway Wallet | Gateway Minter |
| --- | --- | --- |
| ERC-1967 implementation slot, decoded address | `0xd15002e19d75f6abe69e46b2a94cc7c0cc5857de` | `0x30b6d05cb9b89e73732dbf7d47c028a67346eb3b` |
| Proxy `owner()` return, decoded address | `0x6b8850c498dfca92b54f9e0147040e5c8d83d4e2` | `0xdbd44f0e06644b0281411607afa76b1f056e01db` |
| Implementation runtime bytes | 22,818 | 11,619 |
| Runtime SHA-256 (bytes, not hexadecimal text) | `f975d7da31da8c4822acba46773c0db323eee99a7667b620d841ed605b2f901e` | `1e8fa21e18e208070952a1a5773f17657c7cc29cfdd5e8fff2e9d4fcebc5b302` |

All four providers returned identical entries above at block **`0x167bc01`**,
hash **`0xb72d94695d35b5355d21830da4b5dde363de59d63f6fb3007e061a49402dc493`**.
Initial chain/header calls ran 17:38:03–17:38:05 UTC, storage/owner/header
cross-checks 17:38:36–17:38:38 UTC, and implementation-code cross-checks
between 17:38:38 and 17:39:59 UTC. Initial latest headers differed as the chain
advanced; subsequent state reads all used the primary's initial block number.

Exact methods: `eth_chainId`, `eth_getBlockByNumber` (`latest`, then the pinned
number, transactions=false), `eth_getStorageAt` at
`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`,
`eth_call` with `{to: <published proxy>, data: "0x8da5cb5b"}` (`owner()`),
and `eth_getCode` at the two discovered implementation addresses. Each provider
received 9 calls (36 total): chain/header (2), pinned header/storage/owner (5),
implementation code (2). Requests used bounded 20-second timeouts, with no retry
loop, address scan, signer, account balance query, API authentication, or write RPC.
Agreement across providers supports consistency at that block; it does not prove
independent backend operation or a finality certificate, and does not establish
what implementation a proxy will use after a future upgrade.

## Public source and explorer evidence

The official [Circle Gateway repository](https://github.com/circlefin/evm-gateway-contracts)
was pinned via GitHub's public commit API to
**`c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b`** (`master` at observation).
This is a source snapshot, **not an audited release or deployment identity**.

The pinned [README](https://github.com/circlefin/evm-gateway-contracts/blob/c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b/README.md)
describes deterministic ERC1967Proxy deployment through a placeholder initialized
to the Create2Factory, followed by implementation upgrade/initialization in the
same transaction. The placeholder's initial factory ownership is not evidence of
the currently deployed owner. The pinned [compilation guide](https://github.com/circlefin/evm-gateway-contracts/blob/c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b/COMPILATION.md)
requires proxies/placeholders without `via_ir` and Wallet/Minter implementations
with `via_ir`; a generic `forge build` is not the deployment artifact procedure.

The pinned [GatewayCommon.sol](https://github.com/circlefin/evm-gateway-contracts/blob/c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b/src/GatewayCommon.sol)
uses UUPSUpgradeable and Ownable2StepUpgradeable, with `_authorizeUpgrade`
restricted by `onlyOwner`. Thus source design gives owners upgrade authority;
the observed `owner()` addresses alone do not identify the controlling organization,
multisig threshold, timelock, recovery policy, or a verified deployed access-control
implementation.

The official explorer's public API returned a source-verification record for the
[Wallet implementation](https://explorer.arc.io/api/v2/smart-contracts/0xd15002e19d75f6abe69e46b2a94cc7c0cc5857de):
`name=GatewayWallet`, `is_fully_verified=true`, `is_partially_verified=false`,
`verified_at=2026-07-17T21:44:11.260415Z`, compiler
`v0.8.29+commit.ab55807c`, EVM `cancun`, optimizer enabled/runs 150,
`viaIR=true`, and IPFS metadata bytecode hash. Its returned deployed bytecode
matched the pinned RPC SHA-256 and length. These are explorer assertions, not an
independent local recompilation.

A bounded source comparison then fetched the 29 explorer-provided `src/` files
(the top-level Wallet plus its `src/` dependencies) once each at the pinned
repository snapshot and at the latest commit named in the 2025 reports: 58
credential-free raw-GitHub GETs, 10-second timeout per GET, no retries. Byte-for-byte
text comparison matched **all 29** at `c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b`.
Against `5b5446f5c622901acaea6a875b022425eecb0c13`, 21 matched, four differed
(`src/GatewayWallet.sol`, `src/lib/BurnIntentLib.sol`, `src/GatewayCommon.sol`,
`src/modules/wallet/Burns.sol`), and four paths returned HTTP 404
(`src/modules/wallet/ContractSignersAllowlist.sol`, `src/modules/wallet/Batches.sol`,
`src/lib/BatchedDelta.sol`, `src/modules/wallet/ContractSignatureSigners.sol`).
This establishes a concrete gap against those published audit commits. It does
not prove an absence of later audits. Dependency source outside `src/` was not
compared, and no compilation or formal semantic diff was performed.

The [Minter implementation API](https://explorer.arc.io/api/v2/smart-contracts/0x30b6d05cb9b89e73732dbf7d47c028a67346eb3b)
returned creation/deployed bytecode, creation status, implementations/proxy type
and conflicting-implementation fields, **without source, compiler, name, or
verification-status fields**. Its runtime bytes matched pinned RPC observations.
This response did not establish verified Minter source; absence of those fields
is not proof that no verification exists elsewhere. Browser-tool explorer pages
were inaccessible and a Node fetch encountered a Cloudflare challenge; bounded
PowerShell GETs yielded the JSON records. No challenge bypass was attempted.

## Published audits and missing deployment link

[OtterSec's published Circle Gateway report](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/Circle%20Gateway%20Audit%20-%20OtterSec%20-%207-21-2025.pdf)
states an engagement of May 12–24, 2025, initial scope `f24a7d1` and follow-ups
`ca774f1` / `5b5446f`. Its two findings concern permit front-running/griefing and
code consistency. A report on these commits does not certify an arbitrary newer
implementation or the operation of a particular mainnet deployment.

[ChainSecurity's official audit entry](https://www.chainsecurity.com/security-audit/circle-gateway-smart-contracts/)
identifies completion on July 8, 2025. Its [published report](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CCTP/%5BPublic%5D%20%5BChainSecurity%5D%20Circle_Gateway_audit.pdf)
(scope, page 5) supplies full hashes:

| Received | Reviewed commit |
| --- | --- |
| 2025-04-29 | `f24a7d19bf6f9458443991961a174de87edeee91` |
| 2025-06-05 | `ca774f13f51d924c58d48d40ba6a5735370af26b` |
| 2025-06-24 | `5b5446f5c622901acaea6a875b022425eecb0c13` |

The scope lists contract source files and selected TypedMemView functions, with
Solidity 0.8.29 and Cancun EVM. It reports intermediate issues resolved while
retaining the limits of time-bounded review and deposit griefing. Those facts do
not map the observed Wallet/Minter runtime bytes to the audit scope.

An actual **Circle-maintained Gateway audit index was not located** in the bounded
search. Circle's developer `llms.txt`, Gateway overview, product page, address
reference and repository README did not provide that mapping. Guessed
`/gateway/references/security-audits`, `/security`, and `/faq` paths were inaccessible
and are not cited as an index. The auditor's entry and reports are usable primary
audit evidence; the Circle-hosted HubSpot report URLs alone are not a discovered
Circle index. This remains an explicit documentation gap.

## Release verification still required

1. Obtain or reproduce a complete deployed-source/build manifest for both pinned
   implementations: full source commit, dependency commits, compiler/toolchain,
   split compilation settings, metadata, libraries and creation/runtime artifacts.
   Compare runtime bytes independently, including constructor/immutable handling.
2. Map every deployed source/build difference to an audit-covered release or a
   published follow-up review. Latest `master`, identical proxy runtime, published
   common proxy addresses and source-verification flags each fail this gate alone.
3. Establish current upgrade/ownership and administrative authority from verified
   deployed code and authoritative Circle operations documentation, including
   owners' controller policy and how upgrades invalidate previously accepted
   evidence. Do not label owner addresses as multisigs or Circle-controlled without
   that evidence.
4. Locate a maintained official audit/deployment index or equally authoritative
   release attestation; repeat chain/block/implementation checks at the final
   release review, and separately satisfy Keryx's remaining mainnet gates.

No SDK install, source change, authenticated Circle request, environment/secret
read, wallet creation, signing, transaction submission, deployment, funding,
external contact, or production database access formed part of this investigation.
