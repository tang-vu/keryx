# Isolated browser authorization recovery rehearsal

This operator-controlled harness exercises the deployed TypeScript browser gateway
against one first-party registered source on Arc testnet. It is not browser UI
acceptance, an independent customer, creator adoption or traction. It does not
directly manipulate the production database or inject production faults, restart
production, deposit, rotate wallets, invoke the treasury or send notifications.
Its financial journal is isolated; the normal paid seller endpoint may record its
receipt and content access. It requires separate authorization for one
testnet payment and an independently observed existing funded signer.

Use a private directory outside Git whose parent has restricted operating-system
permissions. Node's directory mode is advisory on Windows: preserve the parent's
ACL. Supply a trusted full Source JSON snapshot from the operator database; the
harness freshly checks its active registry authority, payout wallet and list price.
The challenge cannot invent the payee or increase the price. Source JSON is not a
secret; private keys are loaded directly from the original operator environment file.
The script never saves keys, signatures, bearer headers or paid response content.

Example, from the feature checkout, with explicit authorized public pins:

```powershell
node --import tsx --env-file=D:/repos/server/Github/Hackathon/keryx/.env.buyer.local scripts/browser-funded-recovery.mts --execute --directory=C:/Users/tangm/.codex/private/keryx-drills/unique-original-run --source=C:/Users/tangm/.codex/private/keryx-drills/source.json --signer=AUTHORIZED_EXISTING_SIGNER --max-micro-usdc=2000
```

Execution refuses an existing directory. Initially it asserts zero canonical rows
and zero spend, then signs the database-admitted original nonce in memory. The
transport forwards exactly one signed source request with redirects forbidden,
observes its response headers, cancels its body and deliberately loses that response
to the gateway without buffering paid content.
A transport failure is not reported as a successful response-loss injection. The
gateway must leave one pending canonical `x402:<nonce>` row and a retained cap equal
to the exact toll, with zero confirmed consumption. The process closes and exits.
Preserve the directory even if the command fails; do not repeat execution to recover.

Start a new process without a key environment file to prove database persistence:

```powershell
node --import tsx scripts/browser-funded-recovery.mts --inspect --directory=C:/Users/tangm/.codex/private/keryx-drills/unique-original-run
```

Inspection opens the original database read-only, independently fetches Circle's
paginated transfer ledger, binds unique nonce, payer, payee, both networks, USDC and
integer amount, and checks the canonical payment row stayed unchanged. It sends
no paid request. Repeat only this inspection within an operator-bounded interval
of at most ten minutes. Missing or mismatched evidence remains unresolved.

Circle `received`/`batched` is payment acceptance under the existing application
policy; it is not chain finality. The output reports Circle `confirmed`/`completed`
separately and always leaves `onchainFinalityVerified=false`. Independently verify
an available Circle transaction hash and successful Arc RPC receipt before claiming
chain finality. This harness does not close the power-loss, full browser callback,
multi-instance routing or mainnet gates.

After exact Circle acceptance, explicitly add `--confirm-local` to inspection to
apply the existing terminal CAS to the isolated original payment only. It asserts
the same canonical ID and nonce, one payment, and unchanged retained consumption;
confirmed signer consumption must equal the toll. This is a local database write,
not read-only inspection. Repeated confirmation is idempotent. Pending or rejected
proof cannot release capacity or create a replacement payment. Never reset or
delete the journal to get another spending allowance.

## Observed rehearsal: 2026-09-30

Candidate `1127304` completed one operator-controlled 2,000 micro-USDC (0.002 USDC)
Arc testnet source request against the deployed first-party source. The operator's
already-funded signer and isolated financial journal were used. The harness made no
direct production database manipulation or production fault injection; the normal
paid seller endpoint may record its receipt and content access. Response headers
arrived and the harness deliberately discarded
them. Exactly one paid HTTP request occurred. The original process exited with one
canonical pending payment, 2,000 retained micro-USDC and zero confirmed consumption.

A new process independently matched Circle's complete original economic tuple.
Circle reported `received`, with no transaction hash. Explicit isolated confirmation
applied the terminal CAS to the original payment and nonce: retained consumption
stayed 2,000 micro-USDC and confirmed consumption became 2,000. Another new process
opened the journal read-only, verified those original identities and amounts, and
left its state unchanged. No paid retry, treasury fallback, funding transaction or
production restart occurred.

This proves the exercised funded response-loss and process-reopen accounting path.
Circle acceptance is observed; chain finality remains unverified at this recording.
The rehearsal does not establish real browser UI acceptance, independent customer
usage, funded withdrawal recovery, power-loss durability or mainnet readiness.
