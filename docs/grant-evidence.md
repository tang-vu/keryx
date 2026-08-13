# Keryx public evidence map

Snapshot captured **2026-08-13 04:18 UTC**. Live values continue moving at
[keryx.cc/proof](https://keryx.cc/proof); this file records what was publicly verifiable at the
v0.13 release boundary.

## Open-source progress

- Main repository: [tang-vu/keryx](https://github.com/tang-vu/keryx)
- Commit history: [main](https://github.com/tang-vu/keryx/commits/main/)
- CI: [TypeScript, Vitest, Hardhat contracts, dependency audit, production build](https://github.com/tang-vu/keryx/actions/workflows/ci.yml)
- Reusable package: [tang-vu/keryx-arc-primitives](https://github.com/tang-vu/keryx-arc-primitives)
- Deployed commit: published live by [`/api/health`](https://keryx.cc/api/health) and linked back to
  GitHub by `/proof`.

The Aug 5–13 work is product/rail work rather than cosmetic churn: article-version x402 purchases,
publisher-signed offers and full-text receipts, encrypted paid storage, ambiguous Circle transfer
reconciliation, safe failed-authorization recovery, and this source-linked proof surface.
The v0.13 release passed **660 Vitest tests**, **16 SourceRegistry contract tests**, TypeScript, ESLint
with no errors, and the full Next.js production build.

## CLI and Arc RPC

The project has used `arc-canteen` for product and settled-only traction updates. For v0.13 the CLI's
RPC path independently returned:

- chain id `0x4cef52` = `5042002`;
- head block `0x3618b06` at capture time;
- `3,859` bytes of deployed SourceRegistry code;
- SHA-256 of the returned bytecode:
  `daeb3f56f0309acaea92c85d5e49207e63065e5f6d0af05d0f9fc86b4c07ecfa`.

The configured tokenized RPC URL is a credential and is intentionally absent. The live proof page
shows only a provider label and the latest watchdog-observed head.

## On-chain and settlement proof

- SourceRegistry: [`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`](https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536#code)
- Recent creator cash-outs: [`/api/withdrawals`](https://keryx.cc/api/withdrawals) returns real Arc
  EVM transaction hashes that open at `/tx/` on ArcScan.
- Citation nanopayments settle inside Circle Gateway and carry Circle transfer ids, not one EVM hash
  per citation. The hourly settlement watchdog compares the settled-only Keryx ledger with Circle's
  public wallet balances and publishes the wallet-level result at `/proof`.
- The SourceRegistry decides payout authority. Database rows remain a cache; article receipts and
  offers cannot redirect `payTo`.

## Usage and traction

Live settled-only snapshot:

| Metric | Verified value |
|---|---:|
| Queries | 1,842 |
| Settled payments | 9,505 |
| Total settled volume | $44.971314 USDC |
| Creator payouts | $39.091314 USDC |
| Independent queries / paying queries | 141 / 131 |
| Independent payments / creator payouts | 611 / $2.635999 USDC |
| Identified external actors / returning | 4 / 4 |
| External feedback | 9 / 9 positive |
| First-party agent queries / payments | 1,701 / 8,894 |
| Creator cash-outs | 12 / $0.753304 USDC |

The first-party bucket is real Arc-testnet settlement and useful load evidence, but it is not
presented as user adoption. Anonymous outside queries are counted as queries and never fingerprinted
or inflated into unique users.

## Evidence still to earn

The next target is qualitative, not another self-volume milestone: more creator-owned registry
entries, public consented testimonials, repeat use cases with dispatch permalinks, and a product
change selected from observed onboarding friction.
