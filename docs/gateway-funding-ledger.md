# Proposed durable Gateway funding ledger

Design baseline: runtime candidate `93311de0698db130292d7096b6a7a22277d781b8`, reviewed internally
on 2026-10-01. This proposal continues [D-275](../DECISIONS.md) and the
[runtime storage candidate](runtime-storage-manifest.md). It is not production behavior,
treasury authorization, independent external audit, M4 acceptance or mainnet readiness.
At the D-276 design baseline, `gateway-funding-policy.ts` was an **unused pure helper**. It validates copied
terms, replay digests, transition shapes and exposure arithmetic. It cannot establish owner
authorization, a lease, atomic admission, actual balances, receipt validity or persistent state.

## SQLite implementation candidate — 2026-10-01

The reviewed source slice `94a089eb2c552261187c178f90b6938603c62949` implements a
keyless SQLite funding domain; subsequent candidate commits add the native CI matrix and policy
rollover coverage. This remains a dependent draft, outside RealGateway and current production.
The pure policy now supplies validation to this candidate; it still cannot mint authorization or
prove external evidence. D-276 remains the historical proposed direction; D-277 records this stage.

Nine tables in the explicitly enrolled application store retain namespaces, policies, owner
authorizations, admitted operations, reservations, crypto claims, prepared originals, broadcast
claims and observations. There is no sidecar, automatic owner policy or missing-ledger repair.
Exact schema and trigger bodies join storage fence verification, all-table snapshots and backup
coverage. Generic same-identity writers lack the private connection-local funding capability;
they cannot change policies, claims, nonces, exposure or retained history.

The separate owner API inspects a complete logical snapshot and held physical target, then installs
an exact reviewed policy by atomic CAS. Native owner work runs in a minimal-environment child
with a 15-second deadline and 128 MiB V8 heap ceiling; native SQLite allocations remain a host
resource assumption. A failed or malformed acknowledgement can follow COMMIT and returns unknown,
never permission to replace or reset the installation. Inspect the original keyless target.
Only owner-reviewed genuinely unused isolated key namespaces, initial nonce zero and an explicit
history document digest are supported. A document hash is not proof of approval or chain history.
Existing shared funder/spend keys and RPC pending nonce are not an empty-history enrollment lane.

The public asynchronous ledger admits an already installed operation ID, derives canonical step
terms and reserves the original sender nonce. It does not accept a request budget as treasury
authorization. Complete owner document, operation, recipient and integer amount bindings remain
required. Chain/sender namespaces retain their first peer, history, finality policy and lifetime
limits across policy UUIDs. Per-sender gas partitions cannot double the policy gas allowance.

Arc native and ERC20 USDC draw on one balance. Funder aggregate exposure is
`nativeTransferWei + usdcTransferMicros * 10^12 + funderGasWei`; spend aggregate is
`depositMicros * 10^12 + spendGasWei`. Products and sums reject uint256 overflow; distinct movement
caps remain separately enforced. These are exposure ceilings, not actual solvency, revenue or
settlement evidence. Approval grants allowance without moving the deposit amount.
See [Arc's balance and managed testnet RPC documentation](https://docs.arc.io/arc/references/connect-to-arc).

Only a first committed crypto/send claim returns `fresh: true`; exact replay returns `false` and
conflicting claims refuse. Original signed bytes, hash and transaction terms undergo the actual
viem validator and exact persisted readback. Claims and original nonce tombstones are irreversible;
expiry, success and revert cannot reopen lifetime limits. The exhausted nonce high-water sentinel
is retained rather than wrapped. Candidate `unknown`/`seen` observations do not unblock a nonce.

The separate protected observer store accepts a descriptive operation/step locator and the
reviewed receipt issuer's opaque WeakMap token. It loads the persisted original and claims,
unseals against the installed fixed testnet finality digest, then atomically rechecks before an
immutable slot-unique terminal insert. A TS brand or user JSON cannot finalize. Exact token replay
is a no-op; newly different evidence, including changed observation time, refuses rather than
replacing the original. Inspection derives `finalized-success` or `finalized-reverted` from saved
protected evidence; normal progression does not require a replacement token. Revert consumes the
nonce and retains exposure; future controlled orchestration must stop dependent failed-operation
steps. The issuer corroborates Blockdaemon and dRPC at one finalized height, as pinned in
`gateway-funding-receipt-policy.ts`; managed providers are not independent consensus proof.
Execution success does not prove allowance, ERC20 effects, Circle credit or current readiness.

Path/device/inode/birth binding refuses ordinary different-path/new-file copies. It cannot detect
an in-place rollback preserving physical identity or a whole-host image clone. Trusted filesystem
integrity and controlled quarantined restore remain necessary; no external monotonic anchor,
global signer exclusivity or backup signing-resume permission exists.

Local synthetic Windows evidence exercises real native two-process last-budget and different
operation/same-nonce races, exact claim replay, process kills before crypto claim and after claim
or prepared-byte persistence, keyless restart, opaque issuer success/revert/conflict, refusal
preservation and policy UUID rollover. Project types and scoped lint pass. The dedicated
[Linux/Windows run 36788150189](https://github.com/tang-vu/keryx/actions/runs/36788150189)
at `51ab77722d3b16eaf72b0640932956a9663ceb30` passed 48 focused tests on each OS,
including types and scoped lint. This is a scoped source receipt, not runtime acceptance.
The active `earlier()` path still walks prior lifetime reservations and revalidates signed originals;
its work can grow without a per-query bound. This runtime resource gate is OPEN. A proposed
protected monotonic per-sender crypto barrier would advance only from exact protected terminal
evidence, without skipping gaps; no such barrier is claimed implemented here.
Physical-send crash points, backend parity, trusted issuer deployment, shared-key/funded migration,
all four runtime funding steps, real solvency and token effects, Circle credit, drained production
cutover and independent external mainnet acceptance remain OPEN. No funded operation was performed.

## Authority and immutable terms

Funding requires a separately authorized immutable policy and operation. Bind the complete
validated real-testnet `StorageIdentity`, pinned profile, policy UUID, funder/spend addresses,
stable owner authorization UUID/document digest and operation UUID. Canonical replay compares
all fields, including lifetime limits and initial observations; changing a query budget does not
authorize another operation. An authorization document digest is a reference, not proof that
the authorizer approved it. The actual trusted authorization source remains an open decision.

Native gas uses integer 18-decimal amounts; ERC20/deposit quantities use integer micro-USDC.
Reject coercion, malformed/overflowing integers, accessors, unknown fields and implicit mode/profile
selection. Policy chooses reviewed gas/fee and lifetime limits; this proposal supplies no new
mainnet gas cap. Reserve worst-case native transfer, funder USDC transfer, Gateway deposit and
all transaction gas exposure separately before signing. Distinct movement limits must not be
reported as revenue or summed into fabricated settlement metrics. The pure helper conservatively
reserves all four gas ceilings, even when a step can later be skipped.

Approval is exactly the bounded deposit amount to pinned Gateway; deposit uses pinned USDC.
The native/USDC transfer recipient is the policy's spend address. All transaction selectors,
addresses, chain, native value, supported features and prepared fee terms require exact validation.
An already sufficient observed allowance may skip approval; its historical provenance and residual
allowance exposure require review. Available balance/allowance observations never mint authorization.

## Durable pipeline and ownership

Replace automatic wallet `writeContract`/`sendTransaction` funding with explicit preparation and
controlled signing/broadcast. Installed viem supports preparing a transaction, signing serialized
terms, and sending saved raw bytes. Installed Circle SDK 3.5.0 does not support injecting its deposit
signer/transport; do not modify private SDK fields or redesign the public x402 settlement pipeline.

Persist an operation and its per-step records in the enrolled application store. Add all records
to identity fencing, provenance snapshots, backup and recovery coverage. Do not automatically
create/enroll a sidecar or recreate a missing previously used ledger.

Each step records canonical immutable transaction terms, sender, original nonce, worst-case
exposure, revision, signed bytes and locally computed hash. Uniqueness covers operation/step and
chain/sender/nonce. Every mutation repeats full identity/policy validation and transactional CAS.
An ambiguous database response requires exact original readback; missing readback stays unknown.

| Transition | Required durable evidence/boundary |
| --- | --- |
| admitted operation → reserved step | Owner authorization, immutable terms, nonce slot and lifetime exposure atomically retained |
| reserved → crypto-claimed | Irreversible one-shot signing claim; lease expiry cannot issue another claim |
| crypto-claimed → prepared | Exact signed bytes/hash validated, committed and read back before physical send |
| prepared → broadcast-claimed | Irreversible one-shot send claim committed before fetch |
| broadcast-claimed → pending/unresolved | Original hash retained regardless of lost acknowledgement, cancellation or timeout |
| pending/unresolved → finalized result | Keyless server-owned observer validates the exact original transaction and reviewed finality |

Lease/revision fencing coordinates work and observation. It cannot revoke an already admitted
external blockchain action. PostgreSQL CAS and physical fetch cannot share an atomic transaction.
A stale claimant may finish its already claimed original action; replacement workers receive
**keyless reconciliation only**, never new signature, broadcast, nonce or replacement permission.
Do not describe this as exactly-once external execution.

No automatic rebroadcast, fee replacement or fresh attempt follows response loss, restart or lease
expiry, even for identical saved bytes. A crash after crypto claim without saved bytes requires
operator review. Only a reserved step without crypto exposure may be cancelled by CAS; allocated
nonce tombstones remain. Cancellation, success and revert do not refund cumulative lifetime limits.
An unresolved earlier nonce blocks unsafe progression; never fill the gap with a new transaction.

Proposed backend API: `admitFundingOperation`, `reserveFundingStep`, `claimFundingCrypto`,
`savePreparedFundingTransaction`, `claimFundingBroadcast`, `appendFundingObservation` and
`inspectFundingOperation`. A separate `reconcileFundingOperation` receives read-only observers
and a bounded abort/deadline; it has no key or signer/send dependency. A legal pure transition
alone is not permission: finalization also requires a saved original and validated observation.

## Recovery and honest credit evidence

Record bounded immutable receipt observations matching saved hash/bytes, sender, chain, full
transaction terms, block identity and reviewed finality. Revert consumes nonce and gas. Unknown
receipt, empty search, provider disagreement, reorg or unexpected nonce movement stays unresolved;
elapsed time never proves a transaction was absent. Read-only recovery repeats exact identity and
prepared-original validation. It cannot resume signing from a backup or manufacture a payment row.

An on-chain deposit receipt and Circle available balance are separate evidence. Today's bounded
`/balances` reader observes exact depositor/domain availability, not a transaction-correlated credit.
Fresh sufficient availability can establish current funding readiness after an independently
finalized deposit, but cannot prove that this deposit caused the balance. Attributed credit needs
separately validated Circle evidence. Concurrent spend, delayed credit or outage cannot trigger
another automatic deposit; retain the original exposure and readiness uncertainty.

## Implementation slices and open decisions

1. Pure policy/terms and transaction validators, followed by independent source review.
2. SQLite atomic ledger/schema/fences and actual native two-process/crash preservation tests.
3. PostgreSQL restricted RPCs, exact ACL/fences, CAS and actual PostgreSQL/PostgREST parity tests.
4. Controlled signer/raw-byte broadcaster plus RealGateway integration; no SDK deposit fallback.
5. Keyless inspection/recovery tool, operator policy, migration and release evidence documentation.

The coordinator must allocate these files before implementation. Existing browser/withdrawal
journals remain independently scoped; reuse their conventions, not a weaker generalized bypass.

Open choices: trusted treasury authorization issuer/approval lifecycle; maximum lifetime policy;
shared-key nonce migration and all existing key users; safe legacy signed/funded history intake;
finality/provider disagreement policy; attributable Circle credit availability; and operator restore
authorization. Policy replacement/UUID changes must not reset that key namespace's accumulated
exposure; any explicitly approved additional allowance needs a reviewed history-preserving policy.
Every process using a key must share one authoritative nonce namespace, or keys
must be isolated. RPC pending nonce alone is not legacy provenance. A clone with the same full
identity is not global exclusivity. Restores remain quarantined/non-authorizing until original
nonce, exposure and history are reconciled and the authoritative store/key location is reviewed.

## Required actual synthetic acceptance

| Scenario | Required result |
| --- | --- |
| Two processes admit same operation or compete for last budget/nonce | One immutable original; no oversubscription or alternate nonce |
| Changed owner authorization, identity/profile, recipient, amount or fee | Refusal before signature/send; original store unchanged |
| Kill before/after each claim, signature, prepared commit/readback and physical send | Retained original or explicit uncertainty; no automatic new signature/broadcast |
| Lost DB/send/receipt acknowledgement, cancellation, restart or expired lease | Exact original readback/keyless observation only; nonce and lifetime caps retained |
| Actual stale claimant resumes after observer takeover | Only original admitted action possible; no new step/send authority |
| Malformed signed bytes/hash/receipt, nonce reuse or foreign sender/chain | Refusal with no repaired/relabelled history |
| Revert, missing receipt, reorg, empty search or inconsistent providers | Gas/nonce exposure retained; only reviewed finality can finalize |
| Deposit success but Circle unavailable, stale, insufficient or concurrent debit | No readiness/attributed-credit fabrication and no automatic top-up |
| Backup/restore or same-identity clone, missing previously used ledger/key | Non-authorizing refusal; no cap/nonce reset or automatic replacement wallet |
| Keyless fresh-process recovery on both backends | Zero keys, signatures and broadcasts; exact state/evidence preserved |

Acceptance must exercise actual native SQLite and isolated PostgreSQL/PostgREST with actual
installed viem and synthetic generated keys, including asynchronous serializer/HTTP preparation.
Mocks alone do not prove boundary or crash behavior. No funded/private/mainnet operations are
authorized by this proposal. Trusted host/process integrity, protected filesystem/database durability,
single authoritative key-use namespace, RPC/Circle trust and reviewed clock/finality assumptions
remain explicit. None of the matrix is claimed complete by pure-helper unit tests.
