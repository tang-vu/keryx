# Mainnet runtime domains

October 2, 2026 candidate preparation. This first slice centralizes public network
pins in `lib/arc-network-profile.ts`; it does **not** provide an enabled mainnet
research runtime. `paymentRuntimeProfile` and startup configuration still reject
mainnet. Arc testnet remains the deployed payment authority. Preparing or accepting
a candidate manifest is not permission to deploy it or spend real funds.

The public mainnet profile records chain 5042, six-decimal ERC-20 USDC,
18-decimal native gas, distinct Gateway contracts and Circle service origin. The
[Arc connection guide](https://docs.arc.io/arc/references/connect-to-arc) and
[Circle contract reference](https://developers.circle.com/gateway/references/contract-addresses)
were checked on October 2. The mainnet explorer is `https://explorer.arc.io`.
Testnet URLs retain deployed behavior; changing its legacy RPC/explorer aliases
requires its own observed deployment check.

Browser header construction, worker policy, server verification, seller facilitator,
browser journal payment tuples and reconciliation share static testnet pins. The
worker signing policy imports no server configuration or environment selector. Challenge fields
cannot select a network or Gateway contract. The existing read-only mainnet probe
uses the same mainnet reference constants without gaining signer authority.

## Narrow intended pilot

The next candidate scope is invited, authenticated, browser-funded web `/api/ask`
research with deliberately bounded users, creators and integer micro-USDC limits.
Externally pre-funded buyer sessions can avoid activating unrelated treasury or
automatic-funding domains. Mainnet runtime acceptance still requires the following
coordinated domains; passing one does not implicitly activate another.

| Domain | Actual source boundary | Required change and acceptance |
| --- | --- | --- |
| Browser signer identity | `lib/hooks/use-session-grant.ts`, `lib/session/session-signer.worker.ts`, `session-signing-policy.ts`, `session-key-vault.ts`, `session-storage.ts`, `lib/x402-client-sign.ts` | Explicit independently pinned mainnet worker context; versioned origin/network-bound derivation message and isolated ciphertext/vault/tab namespace; cross-network restore and signature refusal; no testnet key reuse or arbitrary transaction authority. |
| RPC and SDK | `lib/arc-rpc-attestation.ts`, `lib/session/gateway-deposit.ts`, `lib/wagmi-config.ts`, `lib/payments/pinned-arc-batch-signer.ts`, `lib/x402-server.ts` | Chosen trusted profile controls client and pre/post chain attestation; actual installed SDK mainnet-domain/contract checks with synthetic adversarial transport, then separately authorized real bounded settlement evidence. The pilot should disable automatic funding. |
| Invite and spend admission | `app/api/ask/route.ts`, `app/api/session/`, `lib/payments/session-grants.ts`, `browser-cosign-gateway.ts`, `pending-signatures.ts`, `verify-browser-signature.ts` | Exact origin and SIWE owner allowlist, per-ask and lifetime buyer/pilot caps; atomically reserve before nonce exposure. Preserve single-use nonce, original epochs, uncertain spend and authenticated callback/recovery. No treasury fallback or alternate paid entry point. |
| Durable environment identity | `lib/db/index.ts`, `runtime-storage-config.ts`, `lib/db/browser-authorization-journal.ts`, SQLite/Supabase adapters and `scripts/browser-authorization-journal.mts` | Separate mainnet database, custody/environment files and explicit enrollment; profile-bound grant/payment/journal identity; activation rehearsed against the actual chosen backend after old writers exit. Existing testnet activation or schema presence is insufficient. |
| Creator/content authority | `lib/registry/`, `lib/session/session-payee-policy.ts`, `app/api/source/[id]/`, `app/api/cite/[id]/`, article offer/encryption modules | Mainnet registry deployment/identity and deliberately accepted creator/source versions. Never import curated testnet payout rows as mainnet authority. Worker and sellers use fresh authoritative payees; ownership, bounded reward splits and approved content survive updates/outages. |
| Settlement/recovery | `lib/payments/payment-state.ts`, `lib/gateway/x402-transfer-reconciliation.ts`, reconciliation scripts | Mainnet Circle endpoint selected from the retained payment environment, complete bounded cursor search, exact nonce/payer/payee/network/token/amount matching. Lost responses remain pending; exact failed evidence releases once. Test settled-but-undelivered and restart/revoke/concurrent replay before activation. |
| Operations | deployment, health, backups, monitor and review packet | Isolated origin and runner, kill switch/drain, durable time sync, restore/rollback, key rotation, alert owner; exact candidate commit and independent financial review. Owner reviews final concrete bounds/evidence before real mainnet deploy/spend. |

Web/API sellers and callbacks are applicable together: an invited `/api/ask` pilot
cannot leave unguarded source/citation sellers or session endpoints. Desktop, buyer
CLI, browser extensions and bots must remain explicitly testnet or disabled on a
mainnet pilot origin. Remote MCP, stdio MCP, public A2A, anonymous web trials,
autonomous runs, private workers and treasury-sponsored flows are outside this
invited browser pilot. They receive no mainnet authority from these profiles and
require separate caller-funded migration or a default-closed rejection at the
candidate deployment boundary. Creator withdrawal is also a separate domain;
the pilot cannot promise mainnet cash-out until its reviewed workflow passes.

The first slice changes no distribution protocol, installer or package capability.
No deployed commit or published artifact has been verified as mainnet capable.
Full-product adoption/economics gates remain independent of bounded pilot safety;
neither simulated payments nor an accepted manifest establish revenue or traction.

## Dormant isolated signer component

The second source slice provides `lib/session/isolated-session-context.ts`,
`isolated-session-vault.ts` and `isolated-session-signer.ts`. They are building blocks
for a separately reviewed worker entry. The public worker, client, session hook and
routes do not import the isolated signer, and startup still refuses mainnet.

The context is constructed once from canonical static profile pins and a trusted
candidate enrollment: exact HTTPS origin, owner, candidate digest, epoch, maximum
per-payment micro-USDC and fixed signing-context expiry. A readable versioned
derivation message includes every value. The worker component verifies the owner's
signature of that exact message before deriving a salted key; the legacy testnet
derivation message and key are unchanged. A different network/origin/owner/candidate/
epoch yields a different signing identity and isolated storage namespace. Recovering
the same context still requires a deterministically signing wallet and its retained
exact public context. Expired contexts can restore their identity but cannot create
new payment authorizations. They have no cash-out or transaction interface.

The vault authenticates the context digest and derived address with AES-GCM additional
data. It retains an isolated non-exportable wrapping key and does not import/migrate
legacy keys. The IndexedDB adapter atomically retains the first wrapping key. Tests
exercise real wallet signatures and native WebCrypto encryption with an injected
atomic in-memory wrapping-key store; actual packaged worker/IndexedDB and restart
acceptance remain release gates. Restore snapshots the full envelope and bytes before
awaiting storage. Lifecycle operations exclude concurrent derive/restore; clear cancels
publication, waits outstanding storage, destroys the wrapping key, and refuses new
operations until deletion finishes.

Payments use a detached payload and the independently pinned chosen profile, bounded
amount/expiry, exact current origin and an authoritative payee provider captured once
at construction. The helper does not implement a payee authority protocol, source-bound
nonce admission, cumulative budget ledger, RPC pre/post attestation, funding or seller
settlement. Those remain independent server/registry/worker-enrollment domains above.
The server journal must reserve every nonce and enforce lifetime caps before exposure;
local per-payment checks cannot substitute for durable spend authority. An application
must not pass an unverified request's payee list or candidate context into this factory.
No mainnet release, spending authorization or real settlement evidence follows from
these synthetic checks.
