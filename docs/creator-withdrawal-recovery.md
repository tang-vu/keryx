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

The SQLite schema and Supabase adapter expose identical backend methods. Both retain
request and claim identity; PostgreSQL grants journal reads and RPC execution to the
service role only, with no client access or direct service writes. Signed requests must
never appear in the public `/api/withdrawals` feed. Server retention and eventual
tombstone policy need to preserve replay barriers while respecting the final privacy policy.

## Remaining implementation and acceptance

The request-matching layer in `lib/gateway/withdrawal-attestation.ts` now checks a
single attestation or a one-entry attestation set against the exact encoded original
spec, including every routing field, value, salt, empty hook and length. It also checks
the returned expiration height against the payload. Its output explicitly says
`request-matched-only`: this does not authenticate Circle's signature, establish current
mint eligibility, prove settlement or verify chain finality. The encoding is checked
against Circle's [TransferSpec](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/TransferSpec.sol)
and [attestation definitions](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/Attestations.sol)
at the pinned source revision. Deployed-contract/version matching remains required.

1. Authenticate the request-matched attestation against the intended deployed minter,
   and bind later Circle transfer status to the exact original spec. Persisting a response
   is not confirmation from HTTP success alone.
2. Establish exclusive, bounded mint signer/nonce authority. The current general funder
   also signs elsewhere; an isolated nonce counter would not control those other senders.
   Persist prepared transaction identity before broadcast and retain uncertainty after
   any lost response.
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

```sh
npx vitest run lib/gateway/withdraw-protocol.test.ts lib/db/creator-withdrawal-requests.test.ts lib/gateway/withdrawal-attestation.test.ts
node --import tsx scripts/test-creator-withdrawal-postgres.mts
npm run typecheck
```
