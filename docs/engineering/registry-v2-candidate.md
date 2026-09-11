# Revision-checked registry candidate

September 12, 2026. `contracts/source-registry-v2.sol` is a separately named candidate,
tested only on the local Hardhat network. No V2 deployment, application integration,
source migration or mainnet activation has occurred. The existing V1 source, address,
ABI and production signing path remain in use.

## Why a second contract

V1 replaces the entire source record when changing its price. The browser freshness
check catches changes made before a wallet prompt, but cannot prevent another update
while that prompt is open. V2 makes the expected source revision part of every edit.
It does not expose the unchecked V1 update/deactivate selectors, and cannot be used
as an in-place upgrade of the already deployed V1 contract.

Registration starts the revision at 1. Full updates, price-only updates and delisting
require the current revision and creator, and advance it exactly once. An invalid
transaction rolls the revision change back. Revisions never wrap: checked uint64
overflow reverts. Delisting is permanent; later edits are rejected. `updatePrice`
touches only the price. `getWithRevision` returns both record and revision in one
view call, so callers need not combine reads from different blocks.

Creator-scoped source IDs, the record returned by `get`, validation limits and event
signatures retain V1 shapes. This does not mean V1 clients can safely target V2.
The contract holds no funds, has no administrator or migration import role, and
introduces no ability for an operator to edit a creator's source.

## Local evidence

Run `npm run test:contracts -- --network hardhat`. V2 tests cover competing queued
transactions sharing one revision (one success, one revert), stale full updates and
delists, payout changes before price updates, ABA changes, preserved non-price fields,
creator-only authority, validation rollback, permanent delisting, unavailable legacy
selectors, registration identity and separate source revisions. V1's existing suite
also runs. This is local EVM evidence, not an audit or funded Arc acceptance.

The browser snapshot schema now rejects an empty author list, matching the actual
V1/V2 requirement that at least one author exists and shares total 10,000 basis points.
An old V1 source comment suggesting an empty-list fallback was inconsistent with its
implementation and tests; the candidate comment is corrected. No V1 behavior changed.

## Required integration and migration before use

- Independently review the candidate, compiler settings and resulting bytecode, then
  deploy and verify the intended testnet contract before choosing any mainnet release.
- Bind the client to the approved chain, contract address, bytecode and ABI version.
  Use the atomic snapshot and carry its exact revision into the wallet request.
  A stale-revision revert requires fresh review, never an automatic resign/retry.
- Add browser intent persistence, transaction/replacement recovery and gas limits;
  revision checks prevent stale state changes but do not make failed transactions free.
- Adapt registry indexing, source discovery, price/content offers and receipt binding
  to registry identity. Source IDs can be identical across V1 and V2 deployments;
  they must not silently alias separate authorities or permit cross-registry replay.
- Obtain creator-authorized registration in the new registry and a deliberate cutover
  of discovery and payment authority. V2 provides no operator import shortcut.
- Exercise staged rollback, unavailable RPC, pending transactions, old client refusal
  and independently controlled creator journeys. Keep V1 records and payment evidence.

The production wallet-prompt race therefore remains open until the new protocol is
reviewed, integrated, deployed and migrated with evidence. Adding this candidate does
not close that release gate or authorize real-fund use.
