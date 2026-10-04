# Treasury transaction and payment isolation

**Scope:** this document retains the legacy testnet treasury transaction guard.
Production is now Arc mainnet; [current status](mainnet-status.md),
[normal server runtime](mainnet-server-runtime.md) and [operations](mainnet-operations.md)
describe current mainnet authority. Legacy testnet keys/state and dated evidence
remain on their original rail; this document does not authorize a new migration or spend.

The server treasury path and supported local maintenance/demo commands retain Arc
testnet authority. A successful `eth_chainId` preflight cannot authorize whatever
transaction an RPC later prepares: the pinned viem/SDK path accepts
`eth_fillTransaction` results, including a supplied transaction chain ID. A
hermetic synthetic-key reproduction demonstrated a mainnet-domain transaction
being signed after a testnet preflight. No funded key or live network was used.

## Local signing boundary

`sendGuardedArcTransaction` copies the caller's intended destination, calldata,
native value and optional gas. It checks each actual prepared transaction against
that immutable tuple and chain ID `5042002`, permits only reviewed legacy/EIP-1559
forms and refuses foreign fields, serializers or unsupported transaction features.
The RPC transport has a fixed method inventory, bounded requests and no raw-send
retry. It validates the RPC fill before translation, then parses the signed raw
transaction and recovers its sender before broadcast. The local signer cannot
change chain or recipient because a provider returns a different tuple.

Arc's unsigned fill serialization can omit `from`. Only an absent field binds
to the originally captured local signer address; explicit null, malformed or
different senders still refuse. This compatibility rule does not trust an RPC
to choose a signer: the final signed bytes must independently recover that same
account before broadcast, and all chain, tuple, access-list and sticky refusal
checks remain in force. It neither authorizes another funding attempt after
uncertainty nor replaces the retained original journal.

`RealGateway` routes native gas funding, USDC transfer, bounded exact-amount
approval and `deposit(address,uint256)` through that boundary. The deposit ABI
and 120000 gas match the pinned batching SDK's testnet deposit operation. Gateway
availability uses the existing bounded Circle read-only helper; the SDK receives
no treasury private key or deposit authority. Success/reverted receipts must name
the original transaction hash. An exact matched `reverted` receipt is a known
reverted transaction. A failed lookup, missing/mismatched receipt or unsupported
status remains unknown with the original hash. Gateway credit must be observed before
funding succeeds; a timeout is unknown, never an invented deposit result.

`createPinnedArcBatchSigner` gives the batching SDK only an address and a bounded
typed-data callback. It independently checks the testnet scheme/network, token,
Gateway domain, typed-data schema, sender and captured payee/amount before signing.
Existing x402 challenge, source-owned payout, price and settlement checks remain
the payment authorization boundary; a valid typed signature is not settlement.

Each `RealGateway` instance retains one funding promise, including rejection.
Repeated calls with the same budget reuse that outcome; a changed budget refuses.
The orchestrator's initial and reevaluation phases use the same original budget,
and the demo's pre-funding call uses the same cap as its research call. Validate
finite, safe micro-USDC amounts and positive configured deposit before funding
effects. This prevents a local retry loop after uncertainty. It does not fence
other instances, process restart or cloned keys, admit durable nonces/caps, prove
attributed Circle credit or replace the dormant funding ledger. Preserve the
original hash and inspect it through owner operations before any further funding.
The public fallback currently omits detailed treasury hash diagnostics; durable
operator recovery remains a separate M4 gate.

## Supported surfaces and intentional command boundaries

| Surface | Authority and change |
| --- | --- |
| Web, API, remote MCP and server bots | Their shared server treasury gateway uses the pinned transaction and typed-data boundaries. Browser-funded sessions retain the existing co-sign worker/journal. |
| CLI and stdio MCP | Caller-funded buyer transport retains its journal/payment authority and adopts the same guarded transactions and constrained batching callback. Status can remain keyless; existing owner-provisioned custody and explicit trusted merchant policy are prerequisites. The breaking MCP 0.3.0 setup and supported Node range require migration guidance and clean-package tarball/provenance acceptance before publication is claimed. |
| Desktop and extension | Existing Operator/API boundaries remain; they gain no server key, new funding authority or mainnet selector. No npm package or installer interface changes. |
| Test payment and web client scripts | Preserve bounded expected testnet x402 payee/amount and validated settlement transport; no SDK private-key transaction delegation. |
| Treasure hunt | Requires an explicit known `KERYX_TREASURE_PAYEE` for its existing 0.03 USDC toll before wallet construction/funding/network. Discovery is not payout authority. |
| Registry publication | Existing owner-authorized registration signs the exact testnet registry operation through the local guard. |
| Legacy `npm run withdraw -- --live` | Retired with keyless early refusal. The npm command does not implicitly load `.env.local`. It cannot delegate unrestricted mint/withdraw signing to the SDK. |
| Legacy code-golf SDK sample | Retired before custody/network access; direct users to maintained buyer quote/payment/recovery and stdio MCP commands. |
| Legacy environment wallet generator | Retired before entropy or private-file access; help directs deliberate owner-managed environment setup without replacing existing funded custody. |

Modern creator withdrawals retain their separate durable authority and journals.
Use the documented `withdrawal:report` inspection and `withdrawal:relay` owner
workflow in [creator withdrawal recovery](creator-withdrawal-recovery.md); the
relay requires its existing explicit provisioned policy, retained original and
operator authorization. It is not a drop-in fresh cash-out shortcut or a new mainnet
release. Legacy dry-run balances confer no mint authority.

Focused tests exercise actual viem/SDK signing with disposable keys, hostile fill
and typed-data inputs, changed-chain refusal, raw sender/tuple checks, unknown
submission/receipt preservation and the real CLI composition. Linux/Windows CI,
script-specific TypeScript checking, application checks, review and deployment
verification remain release requirements. No settlement, production key rotation,
storage cutover, external audit or mainnet launch is claimed. Host/DB-owner trust,
cross-instance nonce/cap admission, complete recovery and independent review remain
open under [M2–M5](mainnet-delivery-plan.md).
