# Creator cash-out recovery implementation

Status, 2026-09-11: in progress. The signed-request, single-admission and matched-response layers are
implemented; the production HTTP relay still needs integration with the full recovery
flow. Do not describe this foundation as completed withdrawal recovery.

## Target journey

A creator reviews the amount, recipient and bounded fees, signs once and retains the
original request before transport. The server verifies the original owner/session and
persists the request before claiming the initial Circle call. A lost response, reload
or restart leads to authenticated recovery of that same request. Subsequent steps save
the matched attestation and mint identity before broadcasting, reconcile exact chain
evidence and record a cash-out only after verified success. Pending/uncertain outcomes
remain visible. A fresh salt or signature is a new action, never a recovery mechanism.

## Implemented foundation

`lib/gateway/withdraw-protocol.ts` shares EIP-712 types with the browser builder and
validates an EOA signature against a copied policy and request. It rejects noncanonical
integer strings, uint256 overflow, nonzero address padding, changed recipients/contracts,
unsupported hooks, amounts/fees over policy and modified signed terms. Values stay in
integer micro-USDC. Its identity is the **BurnIntent typed-data digest**, not the vendor's
transfer UUID or encoded TransferSpec hash.

`lib/gateway/withdrawal-request.ts` creates a versioned Arc-testnet private record.
`lib/db/creator-withdrawal-requests.ts` and migration 0062 persist that original record
and a separate single-use transfer claim. Migration 0063 also makes the underlying
canonical TransferSpec unique. Changing a signed fee or block-height limit changes the
BurnIntent ID but cannot create another journal/admission for that same transfer.
Repeated requests return the same stored
snapshot or reject conflicting policy; they cannot overwrite it. Only the newly inserted
claim, with exact readback of its generated token, authorizes the first transfer call.
Response loss leaves the attempt retained. Retry cannot acquire another claim. No
network, signature service, Circle request or mint is performed by these database methods.

Migration 0064 and `lib/db/creator-withdrawal-attestations.ts` save the original matched
response under that same transfer claim. A foreign owner or different claim cannot save
it. Duplicate writes read back the original timestamp and payload; a different response
conflicts. Stored request identity, transfer UUID, spec hash and authority label are
revalidated on every read. A lost database response can be recovered by reading/repeating
the storage operation with the same snapshot, without another Circle POST. This does
not renew an attestation or grant mint permission. No cash-out ledger row is created.

Migration 0065 fixes competing-index races observed in CI runs 34555965891 and
34557046444. Same-request attestation saves take a transaction-scoped request row lock
before insertion; request admission handles a concurrent unique violation only when
the original ID now exists. The adapter still verifies the exact stored original.
Different request IDs cannot reuse a spec or transfer UUID. Original rows and timestamps
remain immutable. The PostgreSQL harness races fresh first insertions across eight
additional requests with three callers each and checks cross-request UUID rejection.

The SQLite schema and Supabase adapter expose identical backend methods. Both retain
request and claim identity; PostgreSQL grants journal reads and RPC execution to the
service role only, with no client access or direct service writes. Signed requests must
never appear in the public `/api/withdrawals` feed. Server retention and eventual
tombstone policy need to preserve replay barriers while respecting the final privacy policy.

## Read-only mint observation

`lib/gateway/withdrawal-mint-observation.ts` revalidates the original request and matched
response, recovers the EIP-191 signer of the payload hash, and queries the intended
minter's signer allowlist. It checks Arc testnet chain identity, nonempty minter code,
attestation expiry and the exact mint call from the selected relayer at one block.
It rechecks that block's hash and timestamp and the chain ID before returning an
`eligible-at-observed-block` observation. This follows the pinned
[Mints.sol](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/modules/minter/Mints.sol)
signature and expiry checks.

The observer has a five-second deadline, propagates cancellation to its HTTP transport
and prevents late completion from returning evidence. Its local freshness policy allows
blocks at most 60 seconds old and at most five seconds ahead of the local clock.
RPC failure, cancellation, unexpected output or inconsistent reads return no observation;
none of these establishes a failed withdrawal or releases funds.

This trusts the operator-selected RPC and local clock. The code hash records observed
minter bytecode; it does not audit a proxy implementation or match a deployed version
to the pinned source. An `eth_call` success at that block is neither future permission
nor finality. No key, nonce reservation, signing, broadcast or database mutation is
performed. Preparing a transaction still needs fresh checks and exclusive bounded
signer authority. This helper is not yet connected to the production relay.

## Remaining implementation and acceptance

### Private relay journal foundation

`lib/gateway/withdrawal-mint-journal.ts` is a separate local SQLite journal for one
dedicated relay key. This boundary applies whether the application uses SQLite or
Supabase: all processes controlling this key must share this exact journal. No
production key or journal has been provisioned by this change, and the HTTP relay
still uses its original flow.

Connections enforce SQLite `synchronous=FULL`; the journal requires reliable local
storage and does not claim safety on an unsupported shared/network filesystem.
Explicit initialization pins the testnet chain, relayer, starting nonce, lifetime
gas ceiling and maximum slot count. Normal reopening cannot initialize missing
state. Initialization also refuses a partially missing journal or unrelated database;
it cannot reconstruct a used key's lost nonce history. An operator must establish
the starting nonce against the intended chain and verify exclusive key custody.

Slot admission validates and retains the original request, matched attestation and
exact gas terms. A SQLite immediate transaction checks contiguous nonce history,
reserves the next nonce and charges the full maximum gas cost against the lifetime
ceiling. Duplicate admission returns the exact original; a conflicting request,
changed policy or over-budget allocation fails. Every admitted slot stays charged,
including slots with no signed bytes. This conservative lifetime ceiling does not
recycle capacity after receipt, timeout, cancellation or attestation expiry.

Prepared bytes are checked against their stored slot, inserted immutably and read
back with their derived hash and recovered signer verified again. A lost readback
leaves the stored original recoverable. The module does not sign or broadcast; a
future worker must only submit the durably read-back bytes. Ordered private request
IDs allow restart recovery without relying on an in-memory queue. No stored signature
or raw transaction belongs in public APIs, application logs or Canteen updates.

Remaining runtime work includes binding the worker lock to its key inventory, protected journal storage
and backup/restore, chain nonce reconciliation, fresh eligibility/gas checks, exact
receipt/finality evidence, bounded replacement/cancellation, and HTTP/browser integration.
Successive reserved nonces may queue behind an unresolved earlier slot; the worker
must recover the original earlier slot, never skip it or reuse its nonce. The journal
is not proof that a key was never used elsewhere or that a transaction was accepted.

### Signed transaction validation

The signed-byte validator in `lib/gateway/withdrawal-mint-transaction.ts` now binds
canonical EIP-1559 transaction bytes to the original request and attestation, exact
relayer, nonce, minter, calldata, zero native value and selected gas terms. It derives
the transaction hash from those bytes. It rejects unsigned, foreign-signed, wrong-chain,
legacy, altered and high-s payloads. Signature recovery alone is insufficient: the
[EIP-2 low-s rule](https://eips.ethereum.org/EIPS/eip-2) is checked separately.
Gas limits and fee products use integer native wei, with a separate explicit ceiling;
they are not interpreted as micro-USDC. Seven tests sign locally with unfunded accounts,
including a high-s payload that recovers the expected sender but must still be rejected.

Its result is `signed-transaction-matched-only`. This validates bytes for the journal's
durable storage/readback, but does not itself persist them, reserve a nonce, establish
exclusive key custody, authorize broadcast or demonstrate current chain acceptance.
Terms must eventually come from the durable operator-owned mint slot, never an HTTP
client. Signed transaction bytes are private bearer data until broadcast and must not
be included in public status feeds or logs. Attestation expiry does not expire an outer
signed transaction: it can still be mined and consume gas while reverting. Unknown
prepared transactions therefore cannot free their nonce or gas reservation on timeout.

### Exact receipt matching

`lib/gateway/withdrawal-mint-receipt.ts` validates a viem-normalized successful receipt
against the original signed transaction and request. Transaction hash, sender, minter,
gas use and effective gas price must fit the prepared terms. The receipt block cannot
exceed the matched attestation's expiration height; the exact expiration height remains
valid under the pinned minter's comparison.

Exactly one `AttestationUsed` event from the intended minter must contain the canonical
token, recipient, TransferSpec hash, source domain, depositor, signer and integer value.
Matching compares full ABI bytes, including address/domain padding. Logs must agree
with the receipt's block/transaction identity, have distinct nonnegative indexes and
not be removed. Unrelated well-formed logs are allowed. The event definition was
rechecked against pinned Circle `Mints.sol` on September 11.

The result says `receipt-matched-only` and retains `chainFinalityVerified: false`.
This helper does not fetch a receipt, establish canonical inclusion/finality, persist
a withdrawal, release reservations or infer a refund from a reverted/missing receipt.
RPC observation, canonical-block rechecks and the operator's deployed-code/finality
policy must precede any completed cash-out projection. Tests use locally signed
synthetic transactions and receipts; they do not demonstrate a live mint.
All eight receipt tests pass locally; the combined receipt, signed-transaction and
journal run passes 25 tests. Focused lint and TypeScript checking also pass.
Receipt matching commit `114dbfe` passed
[CI run 34558650412](https://github.com/tang-vu/keryx/actions/runs/34558650412), including
the journal process tests, PostgreSQL checks and production build.

### RPC inclusion and finality observation

`lib/gateway/withdrawal-receipt-observation.ts` connects the signed-byte and receipt
matchers to read-only viem RPC calls. It verifies chain ID, requests the original hash,
checks that hash at the exact transaction index of the receipt's canonical block and
reads the `finalized` anchor. It reads the receipt and inclusion block again, rechecks
the anchor by number and verifies chain ID again. Changed gas/receipt evidence, missing
or duplicate inclusion, inconsistent blocks, unsupported finality and RPC errors return
no observation. No failure, refund or reservation release follows from that result.

Arc's [bridge integration guide](https://docs.arc.io/integrate/infrastructure/bridges)
and [transaction lifecycle](https://docs.arc.io/integrate/wallets/transaction-lifecycle),
checked September 11, document committed-block finality and `finalized` resolving to
the latest committed block. A matching anchor may therefore be the receipt's own
block; no arbitrary extra confirmation count is imposed. The observer reports
`mint-finalized-observed`, `chainFinalityVerified: true` and explicitly
`finalityBasis: operator-selected-rpc`. This means verification of RPC-reported
inclusion/finality under that documented testnet policy. It does not independently
verify validator signatures, establish RPC honesty or audit the minter implementation.
The lower-level receipt matcher alone continues to report finality as unverified.

The observer uses a five-second deadline, propagates abort to transport and rejects
late completion. The finalized anchor must be no more than 60 seconds old and no
more than five seconds ahead of the local clock, including at completion. Historical
receipts may be older. Eight tests exercise viem's actual JSON-RPC decoding over a
synthetic transport, one-block finality, transaction position, inconsistent reads,
timeouts, caller cancellation and mutation. They send no live transaction. Production
RPC selection, protected storage/backup and cash-out projection
remain part of worker integration; this module is not yet wired to the HTTP relay.

### Stored observation and reconciliation

The relay journal now exposes `reconcile` and `getObserved`. Reconciliation reads its
original slot and signed bytes, then invokes the server-owned read-only RPC observer.
No HTTP client may supply a precomputed observation as authority. The first matching
result is stored immutably in `mint_journal_observations` under that prepared request.
Stored request/transaction/spec identities, recipient, amount, block/anchor relationship
and integer gas accounting are revalidated against the original journal on readback.

Subsequent matching checks return the first saved observation, retaining its original
timestamp and anchor. A later anchor may advance; a changed mint block, amount or gas
result conflicts and never overwrites history. A null/error/aborted latest RPC check
returns `latestCheck: unknown` alongside any previously stored observation. Reading
that history is not a fresh RPC check or an independently verifiable consensus proof.
Its authority depends on the configured observer, protected journal and RPC trust
already described. A lost post-commit readback can recover the original stored result.
None of these operations signs, broadcasts, renews a nonce, releases gas capacity,
records an application cash-out or implies a refund.

The schema helper pins SQLite `user_version=1`. New journals initialize all four
tables atomically. The original three-table journal (version 0) requires an explicit
`upgrade` option, validates the original policy and immutability barriers, and retains
all existing slots/prepared bytes. A version-1 journal missing observation history is
corrupt, not an old journal to silently upgrade. Initialization cannot repair missing
history. No production relay journal has been created or upgraded by this change.

### Relay worker pass

`lib/gateway/withdrawal-relay-worker.ts` now joins journal recovery, mint eligibility,
local signing, original-byte broadcast and receipt reconciliation in one worker pass.
It uses the existing cooperative lock helper in the dedicated relay directory. The
lock remains held until awaited work returns, including when cancellation happens
during an RPC. It is never reclaimed by elapsed time or PID. A process crash still
requires operator inspection of the retained lock before restart.

For each unresolved nonce in order, the worker reconciles any prepared transaction
first. Existing recorded observations are retained and skipped; they do not starve
later work through the active-step limit. Signing/broadcast requires the journal's
relayer, a different configured inventory of other signers, Arc testnet identity,
matching latest/pending nonce, observed mint eligibility, native gas funding, a
compatible block gas/base-fee limit and a simulation with the exact selected gas terms.
It signs locally only when no prepared bytes exist, persists/readbacks the original
and broadcasts only that stored snapshot. Returned hashes must match the stored hash.

Missing submission/receipt responses preserve the original. If a later receipt is
observed, recovery does not sign or submit again. Otherwise, if the nonce remains
available and eligibility still passes, a later pass may resend only the exact same
stored bytes. A consumed/skipped/occupied nonce pauses the pass for reconciliation;
it cannot produce a new nonce or Circle POST. The diagnostic counters distinguish
local signatures, broadcast attempts and observations; they are not traction totals.

`withdrawalRelayDependenciesForRpc` wires the real read-only observers and viem client.
The shared `withdrawal-rpc-transport.ts` combines caller and deadline cancellation,
disables retries and bounds each entire response to five seconds and 4 MiB, including
the body. This avoids the installed viem behavior where an explicit fetch signal
replaces its internal timeout signal and its header timeout ends before body parsing.

Nine worker tests use actual local signatures and journals with synthetic RPC/finality
adapters. They cover save-before-send, lost submission and database readback, exact-byte
retry, nonce/funding refusal, lock lifetime, cancellation, completed-prefix progress
and unexpected returned hashes. Five transport tests exercise real viem HTTP handling
against a mocked fetch, including stalled headers/body and bounded response size.
The combined worker, transport and observer run passes 29 tests locally. No live mint
or public application withdrawal was performed.
Focused lint and TypeScript checking pass. The preceding observation-journal commit
`fef15d8` passed [CI run 34559529412](https://github.com/tang-vu/keryx/actions/runs/34559529412),
including production build.

This is a callable worker core, not a provisioned production service. The operator
entrypoint still must verify actual key inventory, protected directory/journal identity,
backup/restore and shutdown configuration. Complete request admission, withdrawal
projection, reverted/foreign-mint reconciliation, bounded cancellation/replacement,
HTTP/browser integration and live acceptance remain open. The existing production
withdrawal endpoint has not been switched to this worker.

The request-matching layer in `lib/gateway/withdrawal-attestation.ts` now checks a
single attestation or a one-entry attestation set against the exact encoded original
spec, including every routing field, value, salt, empty hook and length. It also checks
the returned expiration height against the payload. Its output explicitly says
`request-matched-only`: this does not authenticate Circle's signature, establish current
mint eligibility, prove settlement or verify chain finality. The encoding is checked
against Circle's [TransferSpec](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/TransferSpec.sol)
and [attestation definitions](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/Attestations.sol)
at the pinned source revision. Deployed-contract/version matching remains required.

1. Integrate the read-only minter observation with prepared-transaction checks and
   deployed-version verification, and bind later Circle transfer status to the exact
   original spec. Persisting a response is not confirmation from HTTP success alone.
2. Integrate the dedicated relay journal with exclusive key custody and bounded
   signing/broadcast. The current general funder also signs elsewhere; pointing its key
   at a new journal would not control those other senders. Use the journal's original
   prepared transaction identity and retain uncertainty after any lost response.
3. Integrate the relay, session revalidation, bounded input, rate limits and authenticated
   request/status history. Reading status must not sign, repeat the Circle POST or mint.
4. Implement durable browser request/attempt storage, account-switch isolation, reload
   and explicit local recovery. Cover missing/replaced storage and cancellation semantics.
5. Exercise transfer-response loss, attestation storage failure, mint submission/receipt
   loss, restart and concurrent callers through the integrated journey. Verify exact
   original chain evidence and idempotent cash-out recording, then perform a separately
   scoped testnet acceptance run. Do not replay historical withdrawal authorizations.

The [Circle create-transfer API](https://developers.circle.com/api-reference/gateway/all/create-transfer-attestation)
documents a transfer UUID and attestation response. [Lookup by UUID](https://developers.circle.com/api-reference/gateway/all/get-transfer-by-id)
provides status and attestation details. These pages, read September 11, do not establish
that repeating a lost POST is safe. Unknown submission state must remain unresolved until
matching evidence supports a transition. [TransferSpec lookup](https://developers.circle.com/api-reference/gateway/all/get-transfer-spec)
documents spec fields, not a substitute transfer-status result. Mainnet/vendor compatibility
must be verified separately from this testnet implementation.

## Current checks

Fifteen focused tests pass, including the actual browser builder signing with an unfunded
local account, modified terms, canonical encoding, caller mutation, SQLite connection/restart
contention, immutable barriers, foreign-owner denial and Supabase committed-response loss.
TypeScript and focused lint pass. The isolated PostgreSQL 17 harness also passes duplicate
request/claim contention, original-attempt retention and service/client permission checks.
Its unsigned synthetic SQL fixture tests database semantics; application tests separately
verify signatures. Attestation checks cover changed spec fields, malformed headers,
wrong set counts and inconsistent expiry. Persistence checks include restart, competing
writes, foreign owner/claim, immutable records and lost-response/corrupt-readback handling.
Synthetic response signatures are deliberately
not presented as Circle authorization. None of these tests sends funds or establishes
the integrated journey. Foundation commit `2bd3801` also passed
[CI run 34554723909](https://github.com/tang-vu/keryx/actions/runs/34554723909), including
the new PostgreSQL check and production build. Attestation persistence and spec-identity
commit `30d6161` passed [CI run 34555613062](https://github.com/tang-vu/keryx/actions/runs/34555613062),
including unit tests, PostgreSQL, browser/contract checks and production build. These
backend layers are not yet wired into the production creator withdrawal journey.

Observer and PostgreSQL concurrency fixes through commit `591a03b` passed
[CI run 34557370494](https://github.com/tang-vu/keryx/actions/runs/34557370494), including
the expanded PostgreSQL contention drill, browser/contract checks and production build.
Signed-byte validation commit `24ca021` passed
[CI run 34557666883](https://github.com/tang-vu/keryx/actions/runs/34557666883), including
production build. The relay journal adds separate SQLite tests for competing OS
processes, connection/restart recovery, exact lifetime gas bounds, initialization and
policy refusal, original prepared-byte recovery after committed-response loss,
immutable records and corrupt hash readback. These use unfunded synthetic accounts
and perform no network or settlement operation. All sixteen journal tests pass locally,
including first-observation persistence, unknown/aborted latest checks, conflicting
evidence, committed-readback loss, retained gas ceilings, corruption and explicit schema
upgrade. Focused lint and TypeScript checking pass. RPC observation commit `2104681`
passed [CI run 34558992243](https://github.com/tang-vu/keryx/actions/runs/34558992243),
including production build.

The read-only observer adds seven tests using real local signatures and viem's RPC
encoding over a synthetic transport. They cover exact calldata and caller, rejected
signers, wrong chain, absent code, expired/stale/future blocks, simulated reverts,
inconsistent block/chain readback, caller mutation, deadline and mid-flight cancellation.
All 22 focused tests pass. These checks do not authenticate a live Circle response or
send a transaction.

```sh
npx vitest run lib/gateway/withdraw-protocol.test.ts lib/db/creator-withdrawal-requests.test.ts lib/gateway/withdrawal-attestation.test.ts lib/gateway/withdrawal-mint-observation.test.ts
node --import tsx scripts/test-creator-withdrawal-postgres.mts
npm run typecheck
```
