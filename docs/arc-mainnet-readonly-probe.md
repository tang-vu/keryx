# Arc mainnet public evidence probe

This standalone inspector advances external availability evidence for M1. Its
result is always `M1_PARTIAL`, `mainnetReady: false`. It does not activate mainnet,
change runtime configuration, import SDK signers, query private accounts, send a
transaction, contact production, or read environment files. No scheduler is added.

From a dependency-installed checkout, run:

```powershell
node --import tsx scripts/inspect-arc-mainnet.mts
```

No arguments are accepted. JSON goes to stdout; explicitly redirect it to a local
file to retain a new observation. Exit 0 means every fixed public RPC, the Gateway
metadata check and the common-height block comparison were observed successfully.
Exit 1 means some public evidence is unavailable; exit 2 refuses arguments.
Exit 0 never means mainnet settlement or release acceptance. SDK evidence is a
separate static observation and never determines settlement acceptance.

The reusable inspector lives in `lib/readiness/arc-mainnet-probe.ts`. Its only
production dependency is Node crypto. Network access is restricted to four
documented, credential-free HTTPS RPC endpoints and Circle's mainnet `/v1/info`.
It performs no retry and refuses redirects. Each request and response-body read
has a five-second deadline and a 256 KiB response limit. There are at most 37
requests (eight per RPC, four common-height reads, one Gateway read); independent
RPCs run concurrently. Errors are fixed reason codes and never include upstream
bodies, exception strings, credentials or arbitrary URLs.

Only `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode` and `eth_call` are
permitted. The call is constrained to USDC's `decimals()` with a pinned block and
no sender or value. Each RPC must report exact chain ID `0x13b2`; contract code
and decimals are read at that endpoint's head block, and the block and chain ID
are rechecked. Observed endpoints must then agree on the block hash, parent hash
and timestamp at the lowest observed head. Empty, malformed or zero-only code,
inconsistent blocks and decimal mismatch fail closed. SHA-256 hashes describe
returned code bytes; they are not Ethereum keccak hashes or audit evidence.

Circle metadata must have schema version 1 and exactly one Arc/domain-26 entry,
with `Mainnet`, the published Wallet/Minter addresses, USDC support and coherent
processed/expiration heights. The observation does not assert freshness of Circle
indexing, transfer availability or nanopayment settlement. Static inspection reads
the installed package version, client/server bundle text and client declarations
without evaluating those bundles. It checks the pinned 3.5.0 Arc metadata and
records artifact SHA-256 hashes. A changed or unavailable package fails to establish
the metadata match; no network or chain support is inferred from testnet.

## Public observation on September 30, 2026

[Coarse JSON evidence](engineering/arc-mainnet-public-evidence-2026-09-30.json)
was captured from the development host against source baseline `d9d2969`, using
the command above. All four RPCs returned chain 5042 and consistent common-height
block evidence. Each returned nonempty code for the officially documented USDC,
Gateway Wallet and Gateway Minter; USDC reported six decimals. Mainnet Gateway
`/v1/info` listed Arc domain 26 with matching addresses and USDC support. Installed
`@circle-fin/x402-batching` 3.5.0 contains matching Arc mainnet metadata in its
client/server bundles and declarations. This observation supersedes earlier
host-specific HTTP 403 evidence for availability at this time only.

USDC returned 1,798 code bytes; Wallet and Minter each returned 163 bytes with the
same code hash. Equal proxy code does not establish equal implementations or
authenticity: implementation storage, audited deployment provenance and upgrade
authority remain outside this probe. The explorer is published as
`https://explorer.arc.io`; the probe does not scrape it or treat it as finality evidence.

Official references independently checked for this observation:

- [Arc network and public endpoints](https://docs.arc.io/arc/references/connect-to-arc).
- [Arc mainnet USDC address and six ERC-20 decimals](https://docs.arc.io/arc/references/contract-addresses).
- [Circle mainnet Gateway addresses](https://developers.circle.com/gateway/references/contract-addresses).
- [Circle Arc domain and nanopayment listing](https://developers.circle.com/gateway/references/supported-blockchains).
- [Circle-maintained Gateway API environments](https://raw.githubusercontent.com/circlefin/skills/master/plugins/circle/skills/use-gateway/SKILL.md).

The remaining gates include contract audit/provenance, SDK payment-domain and
settlement acceptance, mainnet SourceRegistry payout authority, browser/server
signer and atomic spend isolation, recovery/reconciliation, operational drills and
the owner's explicit go/no-go. The deployed TypeScript testnet payment path remains
authoritative. See [the full delivery acceptance map](mainnet-delivery-plan.md).

Validation: focused hermetic Vitest tests cover wrong-chain refusal, missing code,
decimal/domain/address/network mismatches, malformed metadata, inconsistent blocks,
timeouts, redirects/HTTP failures, response limits, method/payload refusal and
redaction. TypeScript checks include the standalone MTS explicitly because the
root tsconfig does not include MTS files. This slice changes no Next.js route,
dependency, server/client boundary or build configuration.
