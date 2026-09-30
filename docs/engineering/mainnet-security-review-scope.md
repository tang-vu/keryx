# Mainnet security review scope

Internal source review dated September 30, 2026, pinned to
`d9d296919b55c53f37a10e182d7724c5ce0a5050`. This refresh follows D-272
(browser journal) and D-273 (withdrawal rehearsal). It does not certify a
mainnet candidate, inspect deployed secrets, run funded actions, repeat existing
suites or close M3. No mainnet signer/profile activation is inferred.

The threat model now distinguishes implemented controls from historical checks.
The deployed testnet journal activation is recorded separately in the
[cutover runbook](browser-authorization-cutover.md). A source pin alone cannot
prove deployment drain, database activation, backup durability or runtime routing.

## Concrete blocker found by internal source review

The session worker transaction entrypoint checks contract destination and optional
sender, then signs the supplied transaction unchanged. It does not decode the
USDC/Gateway calldata or constrain value/chain. The public account interface
exposes that entrypoint to the page. Script executing with an initialized signer
can request a transaction to USDC encoding `transfer(attacker, amount)` or
`approve(attacker, amount)`: both satisfy the existing destination allowlist.
This bypasses the documented valid-registry-payee restriction for session EOA
funds; the browser/server journal cannot constrain a direct token transaction.
The prior threat-model assertion that the worker prevents sweeping is removed.

Evidence: `lib/session/session-signer.worker.ts:79`,
`lib/session/session-payee-policy.ts:71`,
`lib/session/session-signer-client.ts:136`. Existing
`lib/session/session-signer-worker.test.ts` and
`lib/session/session-payee-policy.test.ts` cover destination allowlists, not exact
permitted transaction semantics. This finding is conditioned on page script
compromise; it does not establish remote unauthenticated execution. Remediation,
focused hostile-calldata tests and independent review remain required. No
implementation changes or financial probes were performed here.

## Required external review and acceptance evidence

| Boundary | Current implementation and source-level regression evidence | Still required |
| --- | --- | --- |
| Browser admission and spend | `app/api/ask/route.ts`, `lib/payments/browser-cosign-gateway.ts`, `lib/hooks/use-ask-stream.ts`, `lib/x402-client-sign.ts`; `lib/ask-route-auth.test.ts`, `lib/payments/browser-cosign-gateway.test.ts` | Independently trace SIWE ownership, durable-v1 refusal, exact economic tuple, nonce exposure and all abort/write-uncertainty branches against the release candidate. |
| Callback recovery | `app/api/ask/sign/route.ts`, `lib/payments/verify-browser-signature.ts`, `lib/payments/pending-signatures.ts`; `lib/payments/browser-authorization-recovery.test.ts`, `lib/payments/browser-sign-route.test.ts` | Verify original admission-time signature bounds versus current live validity; no-cookie cryptographic authority, conflicting replay, restart/replacement and no autonomous resubmission. Multi-instance routing remains unaccepted. |
| Database authority | `lib/db/sqlite-browser-journal.ts`, `lib/db/browser-authorization-journal.ts`, migrations `0067`?`0069`; `lib/db/sqlite-browser-journal.test.ts`, `scripts/test-browser-authorization-postgres.mts` | Audit literal SQL/RPC writer fences, client RLS, transaction capabilities, original retained epochs, alias/revoke/expiry accounting, confirmed-credit deduplication and restore behavior. Process restart fixtures do not prove power-loss durability. Historical missing authorizations cannot be reconstructed. |
| Signer and funding | `lib/session/session-signer.worker.ts`, `lib/session/session-payee-policy.ts`, `lib/session/session-key-vault.ts`, `app/api/session/grant/route.ts`; signer worker/integration and grant tests | Resolve the transaction blocker above; review typed-data domain/schema, derivation-signature XSS, encrypted persistence, funding evidence, treasury separation and cross-environment replay. A worker is not a separate-origin security boundary. |
| Seller and reconciliation | `lib/x402-server.ts`, `lib/gateway/x402-transfer-reconciliation.ts`, `lib/payments/payment-state.ts` and their tests | Audit SDK/facilitator trust, exact integer tuple matching, cursor bounds, terminal-status meanings, settlement-before-delivery evidence and indefinite unresolved holds. Empty search or expiry is never failure proof. |
| Registry and delivery | `contracts/source-registry.sol`, `contracts/source-registry-v2.sol`, contract tests; `lib/registry/payto-guard.ts`, `lib/registry/source-fetch-payto.ts`, `lib/payments/browser-fetch-price-policy.ts`, source/item/cite routes and tests | Review contract deployment identity, creator updates, splits, stale-cache/unregistered fallback, signed offer/version binding and full-text manifests. Public references are free evidence with no payout authority; do not equate corpus metadata with independent ownership. |
| Encryption and privacy | `lib/sources/store-source-item.ts`, `lib/sources/resolve-source-item-content.ts`, `lib/sources/content-cache.ts`, `lib/ipfs/content-crypto.ts`, migration `0033` and their tests | Server master-key custody, key rotation/backup/log policy, encrypted cache/DB fallback, authenticated private result access, retention/deletion and restore. Ciphertext storage does not remove server trust. |
| Authentication and abuse | `lib/auth-session.ts`, `lib/auth.ts`, auth routes, `lib/rate-limit.ts`, `lib/api-keys.ts`; auth-session/sign-in/challenge and API-key tests | Durable challenge consumption, revocation fail-closed behavior, proxy/Host/Origin trust, role freshness, per-actor limits, secret handling and browser headers/CSP against deployed topology. |
| Withdrawal and operations | D-273 and [funded withdrawal rehearsal](creator-funded-withdrawal-drill.md), original claim/mint/cash-out journals and reconciliation paths | Review retained originals, one-attempt relay/gas authority, exact-byte retry, response-loss/unknown-UUID limits, time synchronization, external alert delivery, restore and incident ownership. Funded owner rehearsal is operational evidence, not independent security acceptance. |

The external reviewer must pin the actual mainnet configuration, dependency lock,
contract addresses/code identity and database migrations, report severity and
reachable exploit evidence, verify remediation of critical/high findings, and
explicitly accept documented residuals. The separate M1/M2/M4?M8 gates and final
owner go/no-go remain required under the [mainnet delivery plan](../mainnet-delivery-plan.md).
No test counts or historical green statuses are promoted to current acceptance.

