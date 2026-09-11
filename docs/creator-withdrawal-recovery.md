# Creator cash-out recovery implementation

Status, 2026-09-11: in progress. The signed-request and single-admission layers are
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
and a separate single-use transfer claim. Repeated requests return the same stored
snapshot or reject conflicting policy; they cannot overwrite it. Only the newly inserted
claim, with exact readback of its generated token, authorizes the first transfer call.
Response loss leaves the attempt retained. Retry cannot acquire another claim. No
network, signature service, Circle request or mint is performed by these database methods.

The SQLite schema and Supabase adapter expose identical backend methods. Both retain
request and claim identity; PostgreSQL grants journal reads and RPC execution to the
service role only, with no client access or direct service writes. Signed requests must
never appear in the public `/api/withdrawals` feed. Server retention and eventual
tombstone policy need to preserve replay barriers while respecting the final privacy policy.

## Remaining implementation and acceptance

1. Bind Circle's attestation bytes and transfer status to the exact original spec;
   persist response evidence without inventing confirmation from HTTP success alone.
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

Nine focused tests pass, including the actual browser builder signing with an unfunded
local account, modified terms, canonical encoding, caller mutation, SQLite connection/restart
contention, immutable barriers, foreign-owner denial and Supabase committed-response loss.
TypeScript and focused lint pass. The isolated PostgreSQL 17 harness also passes duplicate
request/claim contention, original-attempt retention and service/client permission checks.
Its unsigned synthetic SQL fixture tests database semantics; application tests separately
verify signatures. None of these tests sends funds or establishes the integrated journey.

```sh
npx vitest run lib/gateway/withdraw-protocol.test.ts lib/db/creator-withdrawal-requests.test.ts
node --import tsx scripts/test-creator-withdrawal-postgres.mts
npm run typecheck
```
