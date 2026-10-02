# Unsigned setup for the invited browser pilot

This offline operator command prepares inspectable requests on Arc mainnet chain
5042. It never loads environment files, wallets, database state or RPC endpoints,
and never signs or broadcasts. Production remains Arc testnet. Output is neither
launch permission nor proof of creator rights, worker custody, funding or settlement.

```sh
npm run mainnet:unsigned-setup -- --help
npm run mainnet:unsigned-setup -- deploy <public-deployer-address> <full-release-commit>
npm run mainnet:unsigned-setup -- prepare enrollment.public.json register.public.json
npm run mainnet:unsigned-setup -- prepare enrollment.public.json fund.public.json
```

Addresses in public JSON use lowercase, nonzero EVM addresses. Inputs must be
explicit regular JSON files no larger than 16 KiB; symlinks and special files are
refused. Failures omit file paths, validation details and input values. `--help`
needs no enrollment or compiled artifact. Keep credentials out of these files.
Emission requires the requested full release commit to equal the command's local
repository HEAD and a clean tracked/nonignored untracked worktree. Public input
files must be outside that checkout or in an intentionally ignored local handoff
location. Output goes only to stdout; this command writes no output files.

The deployment command emits creation bytecode, runtime bytecode, ABI and
provenance for the existing constructor-free `contracts/source-registry.sol`
**SourceRegistry v1**, not v2 or a proxy. No deployment address is guessed. The
fixed reviewed artifact is `scripts/fixtures/mainnet-source-registry.json`, compiled
locally with Solidity `0.8.24+commit.e11b9ed9`, EVM `paris`, optimizer enabled,
200 runs. Its standard compiler input is retained in the artifact; source text
uses LF line endings. The output includes source SHA-256, canonical compiler-input
SHA-256 and creation/runtime bytecode Keccak-256. For independent reproduction,
extract `compilerInput` and pass it to that exact compiler with `--standard-json`;
compare both `evm.bytecode.object` and `evm.deployedBytecode.object`. No compiler
download or compilation occurs in the setup command.
This is deliberately curated deployment data retained in source control, rather
than whichever ignored `artifacts/` a developer last built. Before emission the
helper verifies its pinned canonical artifact hash, exact compiler/settings and
embedded source against the actual release source with LF normalization. Later
contract changes fail closed until a separately reviewed curated artifact and pin
are updated. The pin includes bytecode and ABI, not only self-declared metadata.

After a separately authorized owner deployment, observe the actual address,
successful original receipt, matching runtime bytecode, and chain authority.
Review the complete public enrollment artifact with that fresh registry address,
exact approved source IDs, creator/payout inventory and release commit. The shared
`parsePublicMainnetEnrollment` and `publicMainnetEnrollmentDigest` define the input;
the unsigned helper does not introduce another enrollment format or parser. Its
`enrollmentDigest` hashes that whole canonical artifact, not `candidateDigest`.
Enrollment parsing itself never enrolls or activates a runtime.

Registration input contains public fields only:

```json
{
  "kind": "register",
  "creator": "0x3333333333333333333333333333333333333333",
  "canonicalUrl": "https://creator.example.invalid/feed.xml",
  "payoutWallet": "0x4444444444444444444444444444444444444444",
  "authors": [{ "wallet": "0x4444444444444444444444444444444444444444", "basisPoints": 10000 }],
  "fetchPriceMicros": 100,
  "contentCid": "ipfs://replace-with-reviewed-public-reference",
  "tags": "replace-with-public-tags"
}
```

The exact URL bytes determine `urlHash`; no URL rewriting occurs. The source ID is
`keccak256(abi.encode(creator, urlHash))`. It must match an approved enrollment ID.
Creator, payout and all authors must be approved, at most five unique author shares
must total 10,000 integer basis points, and positive fetch price must stay within the proposed
per-payment cap. Content CID and tags have the contract's UTF-8 byte limits.
The emitted `register` request must be sent by the displayed creator. A declaration
does not establish feed/content rights or a confirmed active registration.

For funding, first derive the **fresh browser-worker session address from the final
complete enrollment**. Compare that displayed address and owner with the public
funding request before any authorized signing:

```json
{
  "kind": "fund",
  "owner": "0x1111111111111111111111111111111111111111",
  "sessionSigner": "0x2222222222222222222222222222222222222222",
  "amountMicros": 200000
}
```

The owner must be invited, the signer must differ from the owner and retained
testnet signers, and the amount must fit the proposed per-buyer cap. Address
comparison here is declaration-only; this tool cannot prove a worker derived it.
It emits, in order, `USDC.approve(mainnetGatewayWallet, exactAmount)` and
`GatewayWallet.depositFor(mainnetUSDC, sessionSigner, exactAmount)`. The signer is
the Gateway depositor; approval and transfer come from the owner. There is no
unlimited approval, delegate, permit, direct session funding transfer, or mint.
The ABI order is pinned from Circle's installed
`@circle-fin/adapter-viem-v2` GatewayWallet interface and the
[official Gateway Deposits source](https://github.com/circlefin/evm-gateway-contracts/blob/c21d2d2e356d6566b6c7c3dde7ebcbdf1747590b/src/modules/wallet/Deposits.sol),
rechecked October 2, 2026. This ABI evidence does not prove the current proxy's
implementation or grant approval to call it.

ERC-20 USDC amounts use **6 decimals**: 200000 micro-USDC is 0.20 USDC. Setup
transactions require separately reviewed native USDC gas with **18 decimals**.
Gas estimates, fees and transaction nonces are deliberately unset; they require
live owner review and are not included in the research cap. Check existing
allowance and exact approval receipt before deposit. Observe the original deposit
receipt and available Gateway balance before session admission. Repeated unsigned
outputs do not reserve a global budget or authorize additional funding.

The conservative pilot ceilings remain developer proposals, not an approved
funding budget. Registry deployment/registration gas, deposits, funded purchase,
citation reward, ambiguous-original reconciliation and recovery/withdrawal remain
separate financial acceptance and owner-authorization steps.

This command supports operator preparation for the browser-only pilot. Web,
desktop/Operator, buyer CLI, stdio/remote MCP, API clients, extensions and bots
gain no mainnet spending path. Existing testnet commands retain their role.
Focused tests validate encoding and refusal; they are not mainnet settlement
evidence or a financial audit.
