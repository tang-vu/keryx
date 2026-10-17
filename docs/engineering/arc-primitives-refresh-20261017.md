# Arc primitives 0.4 extraction

Owner requested the refresh on October 17 under the existing [maintenance contract](../arc-primitives-maintenance.md). Standalone [PR #2](https://github.com/tang-vu/keryx-arc-primitives/pull/2) merged as `9690ee8fcabdd103b2bb4edfa0d588c80ca35f10`, with an exact gitlink in Keryx. Reviewed upstream anchor: `50ad8e0ebdd65ba35da965dfb3e7ef8b0e6b3ed0`.

## Scope and authority

- Delivery integrity adapts `lib/payments/paid-article-body.ts` and `lib/sources/content-receipt.ts` from the [October 9 fix](https://github.com/tang-vu/keryx/commit/1d5828ac548849b39723e027e90809de4148eed9). Explicit item/manifest commitments are validated and frozen before purchase I/O; exact SHA-256/UTF-8 checking returns the same host payment original on failure without a usable body. Hashes establish consistency, not publisher signatures, selected-version authenticity or settlement. Failed delivery cannot authorize evidence/rewards, capacity release or a fresh payment.
- Registry terms adapt origin-preserving source authority, including the [October 12 fix](https://github.com/tang-vu/keryx/commit/e69bfc967382297d6dba6487e3bb689ca6c9b58a). The helper pins a host-selected original deployment and creator-scoped source ID, then reads active payout/price authority using the library's original Solidity ABI. Missing/inactive/foreign records, malformed economics, wrong chain and RPC errors refuse the operation. Creator/URL ownership, registry origin, RPC trust/freshness and durable signing admission remain host-owned.
- The existing thin SDK buyer requires host challenge validation, aggregate spend admission, non-2xx receipt handling and recovery. New helpers perform no payment/signing/retry or storage mutation. Existing journal contracts, dependency pins and testnet defaults remain.

This is an additive extraction under the existing Showcase architecture decision. Upstream application classes, database journals, browser custody, scheduled recovery, registry v2/v3 and mainnet authority are intentionally outside it.

## Acceptance

At standalone head `122e2349eb852bab4582cbf27845dc26d592212e`: clean Node 24.21.0/npm 11.19.0 install, formatting, TypeScript, 116 synthetic tests, ESM/declaration build, no-network demo and clean packed-consumer runtime/declaration checks pass. The consumer validates all 12 exports and 32 allowlisted files. [PR CI 39042645252](https://github.com/tang-vu/keryx-arc-primitives/actions/runs/39042645252) and [exact-main CI 39042733417](https://github.com/tang-vu/keryx-arc-primitives/actions/runs/39042733417) pass; independent exact-head review found no reachable defects. The merge tree equals the reviewed tree. The [0.4.0 GitHub release](https://github.com/tang-vu/keryx-arc-primitives/releases/tag/v0.4.0) attaches the built tarball with SHA-256 `2a93522191eb92de24c03005a4b1fc7c8f3287b08a8c4c2614ee682bcce5a487`, verified against GitHub's asset digest. No funded or npm-registry acceptance is claimed.

Regression coverage includes conflicting/malformed commitments, multibyte and hex-looking UTF-8 text, exact hash/byte mismatch, unusable bodies, retained settled/pending originals, caller mutation during I/O, missing/inactive/foreign registry records, zero payee, uint64 bounds, wrong chain and RPC failure.

## Supported surfaces

| Surface | Result |
| --- | --- |
| Standalone library/API hosts | Two additive exports, ESM/types and 0.4 integration/provenance docs; version 0.4.0 |
| Browser | Portable UTF-8/SHA-256 delivery helper; existing withdrawal/budget-reference roles; host supplies custody and durable admission |
| Keryx web/API | Exact non-runtime gitlink and documentation only; deployed payment/content behavior remains independently authoritative |
| Desktop/app | Application and installer unchanged; no rebuild, shared version allocation or synchronized distribution implied |
| CLI | Upstream application/recovery paths unchanged; no new signing or spend authority |
| Remote/stdio MCP | Hosted tools and npm distributions unchanged; no MCP publication required |
| Extensions and bots | Continue using upstream APIs; no adapter, runtime or distribution change |
| Registry/contracts | Original standalone Solidity unchanged; v2/v3 adaptation and deployment acceptance remain separate |
| Mainnet | Existing upstream service remains separate; standalone defaults stay testnet, with no funding, custody, spending or schedule change |

The root gitlink is already classified as a non-runtime Showcase dependency by [immutable staging](../immutable-release-staging.md). This synchronization needs root review and existing required CI, with no app/MCP/installer version bump or separate production deployment. The existing coordinator retains the deployment batch and any public product announcement.
