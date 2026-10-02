# Maintaining the Showcase Arc primitives

The user confirmed on **2026-10-02** that the [standalone Showcase repository](https://github.com/tang-vu/keryx-arc-primitives) should stay current alongside relevant Keryx primitive changes. This is authorized development-session work, not an autonomous scheduler or a promise of execution while the desktop app is closed. Avoid artificial activity commits or claims of momentum without useful verified changes.

## Accepted refresh

Standalone [PR #1](https://github.com/tang-vu/keryx-arc-primitives/pull/1) was squash-merged as [`fea33574e106a91013e52fad9e99bd4db9df1206`](https://github.com/tang-vu/keryx-arc-primitives/commit/fea33574e106a91013e52fad9e99bd4db9df1206), version **0.3.0**. The [GitHub release](https://github.com/tang-vu/keryx-arc-primitives/releases/tag/v0.3.0) includes a built tarball; no npm publication is claimed. The reviewed upstream anchor is Keryx [`2c59c07`](https://github.com/tang-vu/keryx/tree/2c59c07). The preceding standalone source was the July 5 extraction; its September 19 change only updated ignored artifacts.

The refresh fixes reachable safety defects instead of copying the full application: integer money/allocation; required atomic durable journal contracts; single-submit payment with retained ambiguity; confirmed debit evidence across delivery failure; an atomic in-memory reservation reference; finite-height, policy-bound withdrawal signatures; exact attestation and prepared mint transaction identity; treasury gas ceilings; and ordered registry log identities. The original `contracts/source-registry.sol` design remains independent of current upstream `source-registry-v2.sol` work. The standalone does not claim full source/runtime equivalence or mainnet support.

Validation at the accepted source: clean npm 11.19.0 install, formatting, TypeScript, **81 synthetic tests**, ESM/declaration build, a no-network demo, and clean-consumer imports of all **10 exports** plus declaration checking and **27 allowlisted artifact files**. CI pins Node 24.21.0/npm 11.19.0. [Release PR CI](https://github.com/tang-vu/keryx-arc-primitives/actions/runs/37032059024) passed; independent review covered payment/signing, reservations/allocation, registry/indexer, discovery, packaging and documentation. Synthetic checks do not establish real funded settlement or a deployed contract.

## Ongoing update contract

When upstream changes seller/buyer x402 behavior, session admission, money allocation, registry authority/indexing, withdrawal or discovery:

1. Assess which small reusable primitive is affected. Pin a specific upstream commit and trace current code/tests; old plan counts are historical.
2. Preserve source-owned payees, exact amounts, network/asset/payer/nonce identity, atomic admission before exposure/effects, retained uncertain debits and honest receipt evidence. Do not import unfinished mainnet domains or runtime authority.
3. Update the standalone's code, regression tests, dependency closure, migration/changelog and provenance together. Keep host-required authentication, durable storage, browser custody, nonce policy, reconciliation, treasury nonce/gas sponsorship and finality limits explicit.
4. Independently review the extraction, pass reproducible clean install/check/packed-consumer CI, then merge and publish only the supported artifact. A GitHub tarball is separate from npm publication; package ownership must be established before publishing to npm.
5. Update Keryx's `arc-primitives` gitlink to the exact standalone merge commit and accurately update repository docs. Review/check the root change separately. Deploy documentation through the normal root workflow and verify exact health source before publishing a concise product update.

No automatic copying or release is assumed. Changes may intentionally remain upstream-only when they need application state, unsupported custody or unaccepted runtime domains. Record the reason and remaining gates instead of asserting parity.

## Supported surfaces

| Surface | Role in this refresh |
| --- | --- |
| Standalone library and host API | Generated ESM/types, framework-neutral seller results and required journal interfaces; independently versioned 0.3.0 artifact |
| Browser integration | Burn-intent signing/verification and budget-reference contract; complete browser worker/custody/UI stays upstream/host-owned |
| Keryx web/API | Documentation and exact submodule reference updated; deployed TypeScript payment behavior remains authoritative and unchanged by this slice |
| Keryx desktop | Upstream installer/application; no source, package version, rebuild or synchronized installer claim from library-only changes |
| Keryx CLI | Upstream application/signed recovery flows; no adapter/runtime modification needed for this independent extraction |
| Remote and stdio MCP | Upstream distributions and hosted tools; no package bump, publish or synchronized-runtime claim from this refresh |
| Extensions and bots | Consume upstream application/API roles; no changes or new payment authority here |
| Registry | Original standalone contract remains unchanged; creator verification, deployment/runtime contract checks and current v2 authority are separate |
| Mainnet | Separate reviewed activation/funded gates; all standalone defaults remain Arc testnet |

The standalone offers journal interfaces rather than a durable production database or recovery daemon. Its in-memory grant store is unsuitable for live funds, restart or multiple processes. Real funded Circle/mint acceptance, crash/restart/durability checks, browser custody, current fee policy, RPC trust and finality remain open for each host. See [standalone provenance](https://github.com/tang-vu/keryx-arc-primitives/blob/fea33574e106a91013e52fad9e99bd4db9df1206/docs/provenance.md) and [migration](https://github.com/tang-vu/keryx-arc-primitives/blob/fea33574e106a91013e52fad9e99bd4db9df1206/docs/migration-0.3.md).

## Prepared Showcase description

**What primitives are exposed?** Exact weighted micro-USDC allocation; fixed and computed x402 settle-before-delivery; creator-bound registry helpers and ordered indexing; atomic reservation examples; browser-signed, treasury-relayed withdrawal; and additive discovery metadata. Durable admission interfaces and retained uncertainty make payment/recovery boundaries visible.

**What do these add alongside Circle's Arc commerce/P2P references?** Reusable attribution and creator-payment patterns: a second computed toll, exact weighted splits, creator-scoped payout metadata, user-funded signing integration boundaries, and recovery-aware settlement/withdrawal interfaces. This is an independently reviewed extraction, not an exclusivity claim or a full application fork.

This text is prepared for review. Updating source/releasing a tarball does not itself submit a new Showcase entry, establish Arc mainnet deployment, or justify traction figures.
