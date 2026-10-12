# Bounded creator sponsorship testnet acceptance — October 12, 2026

This is isolated **Arc testnet**, chain `5042002`, not production activation,
mainnet spending, creator earnings or adoption. The owner-authorized validation
uses existing testnet custody, with no wallet creation, faucet, top-up, production
database or implicit mainnet signer reuse. Publisher claims use clearly labelled
`.invalid` fixtures; their financial transactions and receipts must be real.

## Fixed roles and allowance

- Existing local `AGENT_FUNDER_PRIVATE_KEY` public account
  `0x384462d9d8e2645a017e4ef34a0cdfd91b4b97cd` is the explicit testnet
  deployer/sponsor for this validation only.
- Existing local `SELLER_PRIVATE_KEY` public account
  `0xc5965e3175ef063faeb8bcd3abe2d25b5d27d586` is the distinct fixture creator,
  source owner, payout wallet and 10,000-basis-point author.
- Both network labels in the protected subset environment are `arcTestnet`.
  The original environment and all historical custody remain retained.
- The original source environment's Windows ACL admitted Everyone; it was left
  unchanged. A subset copy of the two existing testnet keys was written only
  after its fresh directory received a protected owner-only DACL, allowing the
  current user and trusted SYSTEM/Administrators. No secret values were emitted.
- Deployment maximum: `2200000` gas, `40000000000` wei maximum fee per gas,
  priority `1` wei, zero value; total maximum `88000000000000000` wei, or
  **0.088 native test USDC**.
- Registration allowance: `1000000` gas, `40000000000` wei maximum fee per gas,
  `40000000000000000` wei per original, and daily/lifetime maximum
  `160000000000000000` wei, or **0.16 native test USDC**. The fifth expiry
  scenario adds an attempt slot, rather than money authority: per-wallet/day/total
  counts are five, and its admission must fit remaining capacity after actual
  preceding receipts. The exact expiry and policy digest remain pinned in the
  private native fixture manifest; no renewal/reset is allowed.

Read-only baseline at `2026-10-12T03:57:59.895Z` observed chain 5042002, sponsor
balance `46192153976618031750` wei with latest/pending nonce `131`/`131`, and
creator balance `20000000000000000000` wei with nonce `0`/`0`. Funding was not
needed. Every first broadcast still requires fresh nonce/chain observations and
an explicit original declaration to the coordinating agent. Another pending EOA
transaction refuses signing/broadcast; no alternate nonce is acquired implicitly.

## Real V3 deployment evidence

The accepted contract source and compiled artifact were unchanged by application
recovery work. The unsigned reviewed packet bound source commit
`9f3ce5c94372ad71b24b0cfe3a34465168f576ba`, Solidity
`0.8.24+commit.e11b9ed9`, Paris EVM, optimizer 200 runs, artifact SHA256
`028bcc87d4cb9fa918ecb9f4a4463c4e5d7e366dec3ad509a33ce15c03646731`
and build-info SHA256
`596ac57fb64656cd1fd3583cf7a52469ae7ba294593de99c7f8edf636dfec8b6`.
Its creation bytecode hash was
`0x4b3769cd4048fff1ab8838475fa5f9c1c44cedf4ea7f2ab80818550c4516a1c5`.

| Real testnet deployment observation | Value |
| --- | --- |
| Transaction | `0xfbd2fd223a0f2ec85d21a558e19c2f823c73e3eac19baa55b7bd7f21047b1702` |
| Creator-independent deployer nonce | `131` |
| Contract | `0x75403cf34cedf107735209abdd1ecd111d5e10b3` |
| Receipt block | `66758711` |
| Gas used | `1960252` |
| Effective fee per gas | `20000000001` wei |
| Actual deployment charge | `39205040001960252` wei, or `0.039205040001960252` native test USDC |
| Verified runtime hash | `0xd459c6f2358823d41e17d49fb230c0791043a0fef4f017eeda3ae8d90b30fae5` |
| `registryVersion()` | `3` |

The exact signed deployment raw/hash were flushed before its single broadcast;
there was no replacement or retry. The initial receipt-journal append hit a
BigInt serialization error after broadcast, so completion was recovered through
read-only receipt/code inspection and a bigint-safe append. Original evidence
remains retained. Observed deployed code exactly matched the simulated runtime,
including every EIP-712 immutable for the predicted address and testnet chain.
This is real testnet contract proof, not mainnet contract or registration proof.

## Service-backed recovery driver

[`test-registration-sponsor-funded.mts`](../../scripts/test-registration-sponsor-funded.mts)
has no mainnet mode, key generation, funding or deployment operation. It requires
the two exact existing testnet identities in a protected subset environment and
the fixed reviewed V3/allowance. It uses the actual registration service and native
SQLite admission/transition functions, rather than a mocked settlement transport.
Run `node --import tsx scripts/test-registration-sponsor-funded.mts --help` for
the action-specific explicit flags.

Before initialization, freeze/review the candidate. The fixture manifest records
actual HEAD/tree, Node version, conservative literal application-source closure
hashes and package/lock/tsconfig hashes. A dirty candidate can record its exact
executed bytes, but never claim accepted CI. Every subsequent action, including
keyless report and explicit resume, rechecks this binding and refuses a changed
source, commit/tree, runtime or dependency declaration. Source-pin metadata is
included in its public report. A final commit change requires inspection from the
original frozen checkout; it does not authorize replacing an active manifest.

The existing private directory holds `funded-registration.sqlite`; initialization
refuses an existing database. Native SQLite uses full synchronization and retained
immutable metadata/events. Creator authorization is retained before sponsor signing,
and the exact signed transaction is retained before broadcast. Reports expose
original identities, nonces and hashes, never signatures or signed bearer bytes.
Keys remain in the protected subset environment only.

Each `admit` creates one exact original and maximum reservation for a named
scenario, returning its ID and fresh sponsor nonce without signing. The coordinating
agent declares those terms before `start`, `resume` or explicit expired resolution.
Execution requires the exact original ID and expected sponsor nonce. No command
automatically replaces an original, retries a broadcast, extends a deadline or
renews the allowance. A process crash retains its local execution lock; only an
explicit same-scenario resume/reconciliation can take it over after positively
checking that the prior same-host PID is dead. This process coordination is not
a distributed custody/clone-exclusion guarantee.

| Scenario | Actual interruption and required outcome |
| --- | --- |
| `normal` | One exact sponsored registration, independently read successful receipt/event, original creator/payTo and indexing. |
| `authorization-interrupt` | Process exits `77` in the signing callback, after durable creator authority and reserved sponsor nonce but before signed sponsor bytes; explicit resume retains the same intent/nonce/reservation. |
| `raw-interrupt` | Process exits `78` in the broadcast callback, after exact raw/hash retention but before any broadcast; explicit resume broadcasts those same bytes without another signature. |
| `ack-lost` | One real broadcast succeeds, then process exits `79` before returning its acknowledgment; keyless reconciliation finds the same receipt without rebroadcast. |
| `expired-original` | Newly prepared fixtures use a 300-second setup deadline. Signing interruption retains the original. After two actual attested chain deadline observations, explicit gas-paying resolution sends the exact expired calldata/nonce/fees and must produce a real reverted receipt, charge its gas and retain the consumed attempt. No source event/index is created. The earlier unsigned 60-second original below remains unchanged. |

Publishing-control rows and URLs are explicitly controlled fixtures, with no
content distribution permission. They do not prove SIWE/browser acceptance,
external publishing control, `conzit.com` ownership, useful paid reading or creator
payouts. The contract's successful registrations and expired revert still require
real network receipts; unit tests cannot supply their financial evidence.

## Original registry projection and cursor

The actual indexer receives the verified V3 `SourceRegistryAuthority`:

```json
{
  "network": "eip155:5042002",
  "address": "0x75403cf34cedf107735209abdd1ecd111d5e10b3",
  "version": 3,
  "codeHash": "0xd459c6f2358823d41e17d49fb230c0791043a0fef4f017eeda3ae8d90b30fae5",
  "deployBlock": "66758711"
}
```

Native fixture projection and the same immutable origin sidecar used by the SQLite
adapter are bound atomically, then read back together. Actual `syncOnce` exercises
the origin-scoped cursor from the verified deployment block; readback must cover
the receipt block and the old singleton `lastSyncedBlock` must remain absent.
Receipt verification compares chain transaction hash/from/to/nonce/calldata/value/
gas/fees against the retained signed original. Actual chain records retain the
fixture creator/payTo, exact author split/price/CID/tags and revision. Live-node
`eth_call` edit simulations prove the creator's access and the sponsor's explicit
`NotCreator` rejection without another gas-paying transaction.

## Evidence retention and remaining gates

Protected custody, deployment raw/journal, unsigned packet and draft fixed policy
are retained outside tracked source beneath the existing local release-evidence
directory's `testnet-private` child. Retain the native fixture journal and bounded
reports there when execution creates them. Archive and verify these artifacts
before any worktree cleanup; they are not generated files to discard. No keys or
raw bearer transactions belong in Git, public reports or logs.

The original frozen report was captured before further source changes:
`frozen-five-attempt-report-51708.json`, SHA256
`4a53fa1953f3207eb360271c3c0a9023386fea59b0e25bd60175c00c8feb9365`.
It binds clean HEAD `51708d76e39a11622cf58729a2bfac0bfc24e2b6`, tracked tree
`233d138aaf1ae218f648b32bb7020605d3f4b90b`, Node `v24.21.0`, 307 actual
application/dependency-declaration inputs and source digest
`0eb86f972b4ea1704c4cfd54e07a00a5b721d5ba1d1a6301b7497fa39d24120a`.
The exact original policy digest was
`0xc03dab66b51407aac227af9f14171c815cd0f340449c96297328a7fd9cad56dd`,
wrapper SHA256
`a96a9aa75429dccf7232f1a34d769de400b5330688d1d51022d0f66baece7755`,
expiry `1791864973292` milliseconds. The source report makes no hosted-CI claim.

### Original cohort results: four real successes and one unsigned expiry

| Scenario | Sponsor nonce | Real transaction | Receipt block / gas used | Actual native gas, wei |
| --- | --- | --- | --- | --- |
| `normal` | `132` | `0x4b29ca0be1b7379abf28f9ea942f07ed097493bf8d1ee5283d2d2af9b660f966` | `66762478` / `332396` | `6647920000332396` |
| `authorization-interrupt` | `133` | `0xf76d0f6a8fc3291dd529858c16a5030d93aeba03bdc80c11fb139a67d1ea445a` | `66762841` / `298208` | `5964160000298208` |
| `raw-interrupt` | `134` | `0x91e13d6e567b11d6a8578b4a44919fcf9df5f83822a57d8890bc2f14e6ac06e5` | `66763151` / `298208` | `5964160000298208` |
| `ack-lost` | `135` | `0xac73f6cf2f3e652ba0914ba4c2b6a3a66c4f77f8dff6e38aad0623da71867d32` | `66763464` / `298196` | `5963920000298196` |
| Original `expired-original` | none retained | no signed sponsor transaction or broadcast | conclusively unsigned-expired | `0` |

All four receipts were successful, with effective gas price `20000000001` wei.
Total registration gas was `24540160001227008` wei, or
**0.024540160001227008 native test USDC**, below the unchanged 0.16 allowance.
One signing and one broadcast were recorded for each confirmed original.
Authorization interruption recovered the retained creator signature and nonce;
raw interruption recovered the exact previously retained bytes/hash without a
second signing; lost acknowledgment completed through keyless receipt inspection
without rebroadcast. Real source records preserved the original creator/payTo,
author split, price, tags/CID and revision. Real app indexer projections and durable
origin sidecars read back correctly; the scoped cursor reached `66763609` and
never imported the old singleton checkpoint. Creator edit simulation succeeded
and sponsor edit simulation returned the explicit `NotCreator` error.

Original request IDs were respectively
`0x4f415206b04b08c593a359d72f075a156d96418d3846dc0f69ca43da8bf322cd`,
`0x5117ceb7bf6a693563a57cbe37616534b273a81db731183efdbba197f87ebbb7`,
`0x86fa1dda57d9ae3136d21790f170bcb49392a3e587102f0bef178c4d6b135a7d`,
`0xa23cc0db27b11dec074070d34318766100f9aff34d8186bcd89cb4f356d17b06`
and `0xa2a3df62572210b0f3e19a8a9574397ed4c5ef2824fe1a8d0fd3d5ccbb8acf7f`.
Creator registration nonces were 0 through 3 for the real successful transactions; the
unsigned fifth retained creator nonce 4 but no sponsor nonce/hash/execution.

The fifth fixture's 60-second deadline was too short for coordination/process
setup. It elapsed before service signing admission, so the service expired its
unsigned original and released only its monetary hold. Its fifth attempt remains
consumed. No signing/submission uncertainty remained. This result is unsigned
expiry containment, **not funded expired-original resolution**; it cannot be
reported as five financial scenarios passing.

### Explicit supplemental expiry cohort

After observing the closed original books, the coordinating owner-authorized flow
admits one supplemental sixth test attempt under the same cumulative **0.16**
registration money authority, without another deployment, wallet, funding or
mainnet action. It uses a new run ID and distinct deployment origin
`https://registration-sponsor-funded-expiry.test.invalid`, the same verified V3
and existing testnet identities, a separate private SQLite journal, and maximum
transaction/day/lifetime **0.04** with per-wallet/day/total counts **one**.
Its newly prepared expiry deadline is 300 seconds. No original row, deadline,
policy, count or hold is rewritten or reset.

The explicit format is `keryx-registration-sponsor-funded-expiry-supplement-v1`.
Initialization additionally requires `--baseline-state-directory` pointing to the
retained original private directory. The
[`read-only baseline helper`](../../scripts/helpers/registration-sponsor-funded-baseline.mts)
checks the exact frozen report, five retained originals, four real confirmed
charges, one unsigned expiry, zero uncertain originals and exhausted original
count five. It fingerprints all original native books and verifies that same
read-only fingerprint before every supplemental action/report. The verified original
native fingerprint is hard-pinned at initialization and every subsequent action:
`f7db56a58a67d257221d5e947896388ec522befd9c37a2c81954e01b8e2b9814`.
The original database stays read-only; the real core recovery reader validates a
bounded in-memory copy of its consistent native snapshot, including retained
policy/original lineage and private execution hashes. Each fixture table is capped
at 512 records before copying; a different closed journal with the same totals
cannot substitute for this fingerprint. The budget bound
is `24540160001227008 + 40000000000000000 = 64540160001227008` wei, or
**0.064540160001227008** maximum combined registration exposure, below 0.16.
This supplemental cohort must be named separately in source/execution reports;
its receipt must not be relabelled as the original fifth attempt.

At this update, the original report above is captured and supplemental source/
policy review and a new exact-source freeze precede its execution. Funded expired
resolution remains open until its real reverted receipt, exact original identity,
actual gas, absent source event/index and released execution barrier are recorded.
Mainnet sponsored availability, new live creator eligibility and legacy V1
continuity still require their reviewed production configuration, real mainnet
receipt and applicable release acceptance. No testnet evidence changes its network
or authority, establishes external publisher control or becomes creator revenue.
