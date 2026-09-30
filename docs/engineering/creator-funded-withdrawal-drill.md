# Owner-operated funded withdrawal recovery rehearsal

This procedure exercises the creator withdrawal engine using the existing operator's
own Arc-testnet balance. It is not customer participation, creator revenue, mainnet
acceptance, or a complete browser UI rehearsal. Production withdrawal HTTP settings,
relay settings, timers, application data and notifications remain outside this drill.

## Limits and custody

The September 30 run selects a 2,000 micro-USDC withdrawal back to the same owner,
a maximum Circle fee of 3,900 micro-USDC, and a dedicated fresh Linux-only relay.
Native funding is exactly 0.010 test USDC. Its funding transaction is capped at
21,000 gas and 30 gwei, or 0.00063 native test USDC. Mint terms are at most 300,000
gas and 30 gwei, with a lifetime protected-journal ceiling of 0.009 native test USDC.
Together with the earlier 0.002 test-USDC source payment, the conservative allocation
is 0.01853 test USDC, below the revised 0.020 total rehearsal ceiling. Native funding
includes the mint gas allocation; do not count both as separate allocations.

The buyer key stays in its original ignored PC environment file. The dedicated relay
key stays in its original owner-only Linux environment file. Transfer only the
retained signed withdrawal record to the private Linux drill directory, never a key.
Use existing operator key inventory only for isolation checks. Creating the dedicated
key, affirming sole custody and funding it are explicit operator steps; the harness
cannot establish custody from a balance or nonce observation.

The deployed protocol permits any caller to mint the original attestation, but binds
the recipient to the original owner. Its validator requires a zero destinationCaller.
This rehearsal preserves that policy; caller pinning needs a separate protocol change.

## Commands and recovery boundaries

Use Node 24 and the installed repository dependencies. Every command is an explicit
operator invocation. The harness does not install a scheduler or alter environment files.
Directory arguments name fresh private directories under existing private parents.
The saved original directories must be retained after any error; never delete or reset
them to repeat a signing, transfer or broadcast step.

1. On the PC, run `creator-withdrawal-preflight.mts --owner OWNER --amount-micros 2000
   --fee-cap-micros 3900 --max-ahead-blocks 2000000 --max-processing-lag-blocks 10000`.
   This is unsigned estimation only. The height limits are selected drill bounds,
   not production defaults. It matches the exact contracts, owner, recipient,
   integer amount, fee cap and finite expiry against live Circle/RPC observations.
2. Run `creator-withdrawal-drill.mts --prepare --directory PC_ORIGINAL --owner OWNER`
   with the same four monetary/height arguments. Review the returned request ID and
   retained unsigned draft before signing. Do not prepare another original after uncertainty.
3. Review the freshly generated Linux relay address and custody. On the PC, explicitly
   load the original buyer environment file and run `withdrawal-drill-funding.mts
   --prepare --directory PC_FUNDING_ORIGINAL --recipient RELAY --expected-nonce NONCE`.
   This signs and persists one bounded funding transaction; it does not broadcast.
   Inspect the original hash and terms. Run `--send --directory PC_FUNDING_ORIGINAL`
   once, then use `--recover` for read-only receipt recovery. `--send` consumes an
   exclusive marker before the one broadcast, so any lost response is recovery-only.
4. On Linux, use the existing `withdrawal-provision.mts` funded-preflight/initialization
   procedure with the new relay, protected parent, maximum one slot and lifetime ceiling
   `9000000000000000`. Do not initialize a used key or reinitialize missing history.
   Keep production environment flags disabled and do not start the withdrawal timer.
5. On the PC, load only the original buyer environment file and run
   `creator-withdrawal-drill.mts --sign --directory PC_ORIGINAL` with the original
   height arguments. It rereads the saved unsigned draft, rechecks finite terms,
   consumes an exclusive signing marker and retains the exact signed original.
6. Transfer `PC_ORIGINAL/original.json` privately to Linux. Run the harness `--submit
   --directory LINUX_ORIGINAL --original SIGNED_RECORD --owner OWNER
   --relay-directory EXISTING_RELAY --gas-ceiling-wei 9000000000000000
   --confirm-isolated-custody` with the original height arguments and explicitly loaded
   original relay/operator environment files. It creates an isolated application
   database and uses the real protected, funded admission and one Circle POST. Its
   returned application response is intentionally discarded after the coordinator
   finishes; durable request, claim and attestation readback is the evidence.
7. Run `--mint-once --directory LINUX_ORIGINAL --relay-directory EXISTING_RELAY
   --gas-ceiling-wei 9000000000000000 --confirm-isolated-custody --gas 300000
   --max-fee-per-gas 30000000000 --priority-fee-per-gas 5000000000`. It estimates real
   mint gas, rejects terms outside the cap, queues the original, persists signed bytes
   and the original hash before one actual broadcast, then deliberately loses the
   RPC response. Gas estimation runs before the exclusive mint-pass marker is
   consumed; a failed estimate leaves the mode unconsumed. After the marker is
   consumed, any eligibility or simulation failure is recovery-only.
8. In a new process with no loaded signing keys, run `--recover --directory
   LINUX_ORIGINAL`. It observes only the saved original hash, verifies the exact mint
   receipt/event and operator-selected Arc RPC finality, then idempotently records
   the cash-out in the dedicated withdrawal ledger. It never POSTs another Circle
   transfer, signs or broadcasts. Repeat recovery to verify accounting consistency.

Prefix each script command with `node --import tsx`. Environment files must be loaded
explicitly with Node's `--env-file` option; never embed secret values in a command.
Private signed records, SQLite databases and raw mint/funding transactions are recovery
artifacts, not repository documentation or public product-update material.

## Vendor response-loss limitation

The live official [Gateway OpenAPI](https://developers.circle.com/openapi/gateway.yaml)
was checked on September 30, 2026. `GET /v1/transfer/{id}` can return an existing
transfer's burn-intent summaries and nested original attestation, but requires its
Circle UUID. [GET transferSpec](https://developers.circle.com/api-reference/gateway/all/get-transfer-spec)
returns only the original spec for its hash, without a transfer UUID or attestation.
The checked specification exposes no transfer-list or spec-hash-to-UUID recovery
endpoint, and no documented idempotency header on withdrawal creation. This is an
observed documented-API limitation, not proof that Circle has no internal capability.

If the Circle response is lost before any UUID/attestation is retained, the original
claim remains `awaiting-transfer-evidence`. Neither a missing spec lookup nor expiry
permits another POST, signature, nonce or released gas hold. Read-only recovery of
that exact original requires vendor evidence/capability still to be established.
The supported funded drill loses the application response after durable attestation
storage and the mint RPC response after durable original transaction storage. It must
not be reported as closing the earlier unknown-UUID Circle-response-loss gate.

## Acceptance evidence

Retain private receipts for the reviewed draft, funding original/receipt, one Circle
attempt, matched stored attestation, one mint broadcast, saved transaction hash and
new-process recovery. Verify the cash-out is recorded once, payment rows remain zero
in the isolated withdrawal database and the admitted gas ceiling remains charged.
Record actual funded outcomes separately from this procedure. Passing unit tests,
quoting a fee or provisioning an empty relay is not funded withdrawal acceptance.
