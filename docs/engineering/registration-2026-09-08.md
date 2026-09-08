# Keryx Engineering registration — September 8, 2026

The owner authorized a new dedicated publisher wallet and funded it through the Arc
testnet faucet. Registration used that wallet's SIWE session and its own registry
transaction, not the buyer wallet or a server-side database override.

- Owner and payout wallet: `0x6644A7C63C559454e77D5834554DCa3a60fcFDA2`
- Network: Arc testnet, chain ID `5042002`
- Registry: `0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`
- Source ID: `0x2132de79e1f90f68e1726075a857ebfd2f8d3e608f7bc8e4dec84483fa9f675c`
- [Registration transaction](https://testnet.arcscan.app/tx/0x1df8d67cc8a631f2e7a6370ad4b752f8bd4ca3d576ac0223e1f8379ffd4c8c7d)
- List price: 0.002 USDC per read; single-author split of 10,000 basis points to the owner.

Verification performed: successful transaction receipt; live registry creator, payout,
active flag and integer price; indexed source with matching transaction; RSS verification
endpoint returned `verified: true`. The public preview lists both dated articles as
`full_text` with encrypted database storage, at 3,071 and 3,473 plaintext bytes.

[Public source preview](https://keryx.cc/api/source/0x2132de79e1f90f68e1726075a857ebfd2f8d3e608f7bc8e4dec84483fa9f675c/preview)

This establishes first-party source onboarding, not a paid read, creator reward,
external customer or independently verified research result. The RSS articles remain
publicly available. Private publisher credentials stay in a gitignored local environment
file and are not included in this record. A new paid full-corpus pilot remains next.
