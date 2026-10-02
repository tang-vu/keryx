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

Custody residual: non-exportability prevents exporting the AES wrapping-key bytes;
it does not prevent compromised same-origin script from retrieving the CryptoKey
handle from IndexedDB and decrypting a ciphertext blob it can obtain. Worker heap
isolation and these namespaces are not a same-origin XSS security boundary. Script
running when the wallet derivation signature is produced can also derive the session
key itself. Any tiny funded pilot must explicitly review and accept those bounds;
separate-origin signer enrollment is a future independent architecture/release gate.

The subsequent `npm run test:browser-isolated-session` acceptance runs the bundled
helper in actual Chromium workers with the real IndexedDB adapter and native browser
WebCrypto. Two workers concurrently retain one wrapping key and restore each other's
ciphertext; a new page/worker recovers tab ciphertext; context/address AAD and foreign
origin/chain checks refuse; an aborted IndexedDB write publishes no account; clearing
the namespace makes original ciphertext unusable. It also demonstrates the documented
same-origin decrypt residual without exporting or printing plaintext/key bytes.
All HTTP is intercepted to fixed fixture documents/scripts, and every owner/key/nonce
is synthetic. CI repeats this bounded component acceptance. A production worker,
candidate enrollment, private session history and the mainnet server/payment/registry
journey remain separate gates; this fixture is not a runnable public mainnet pilot.

## Build-pinned invited browser candidate

The next source slice adds `/mainnet-pilot` and a dedicated worker. Existing web,
desktop, CLI, MCP, API, extension, bot, treasury and funding flows keep their current
testnet roles. Only the isolated invited browser route and its authenticated pilot
API contract are intended for this candidate; a default build without reviewed
public enrollment pins refuses initialization. The isolated server's live factory
also remains closed. Source capability and synthetic acceptance do not authorize
mainnet deployment, owner funding or real settlement.

`public-enrollment.ts` is the shared browser/server schema. Its final SHA-256 digest
covers the complete canonical artifact: source commit, HTTPS origin, static mainnet
RPC/contracts/token/decimals, registry, every source/creator/payout/invited buyer,
retained testnet signers, integer limits, custody epoch and expiry. The draft
`candidateDigest` is a preparation label. The final digest binds key derivation,
delegation, durable server identity and signing challenges. No page message can
select a network, replace the artifact or supply authorized payees.

After committing and reviewing all source, prepare a public proposal with that exact
release commit in ignored `.artifacts/mainnet-pilot/`, then run:

```powershell
npm run mainnet:browser-enrollment -- --input .artifacts/mainnet-pilot/proposal.json --output .artifacts/mainnet-pilot/enrollment.json
```

The offline builder requires clean tracked and nonignored untracked source, bounded
regular input, exact current source SHA, future expiry, and new output names beneath
the checked real artifact directory. It emits canonical public JSON and a companion
`.public.env` containing the two `NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_*` build pins.
Generate these after the final reviewed source commit to avoid a self-referential
commit hash. Build in a fresh isolated process with those public pins; changing a
host or policy requires a new reviewed artifact and browser bundle. These files
contain no wallet key, server cookie, derivation signature or launch authorization.

The browser requests a separate server-issued, short-lived, single-use owner
delegation challenge. Its readable wallet signature covers the final enrollment,
origin/network, owner, fresh signer, server grant epoch, funded cap and expiry.
The private derivation signature is never sent to the server. Server grant admission
must verify the exact signature and fresh actual Gateway funded capacity atomically;
an HTTP-only same-origin cookie binds subsequent calls to that admitted generation.
Restore reuses encrypted tab custody and checks the current cookie grant again.

An SSE event is only a notification. The worker reads the original admitted challenge
itself and checks owner/signer/epoch, final digest, approved source, original nonce,
integer amount and static mainnet domain. It independently attests the fixed mainnet
RPC before and after reads and rechecks a pinned registry block hash. Registry
unavailability, a changed block or an unapproved participant refuses signing without
a testnet/cache/off-chain fallback. Article fetches require the exact immutable
item/version/full-text `db_encrypted` receipt from an authenticated metadata-only
preview, equal registry/preview/request price and source-owned payout. Offers,
publisher manifests, IPFS and other paid delivery kinds are excluded. Citation
payments use the current approved registry authors/payouts and per-payment bound.

A separate native IndexedDB authorization ledger reserves cumulative signed capacity
and each nonce atomically across workers before signing. It retains reservations on
any failure and survives key deletion, reload and replacement server grant epochs.
The worker rechecks current cookie authority before and after cryptographic signing.
The server still owns global ask allocation, nonce admission, settlement and durable
recovery; local signed capacity is an additional bound, not evidence of payment.
Deleting browser storage through developer tools or compromised same-origin script
can damage this additional local bound. It does not remove durable server records;
the previously documented custody/XSS residual still applies.

Sign-out first revokes the server grant/cookie, then destroys this tab's key and
ciphertext. A failed revocation pauses the UI and retains custody for recovery.
Revocation prevents new admitted work; it cannot claw back already exposed signed
authorizations, delete another live worker's heap key, or withdraw/refund Gateway
funds. The authorization ledger and server journals remain retained. Funding must
be an explicit external owner operation to a fresh isolated session, for example
reviewed `depositFor(USDC, sessionSigner, amount)`; this worker cannot sign a funding
transaction or cash-out. A concrete unspent-balance recovery/custody decision remains
mandatory before any real funded launch. Registry deployment gas is separate from
the proposed research allocation and is not represented as paid creator revenue.

The renderer labels maximum allocation and retained capacity separately from actual
settlement, keeps answers when one co-sign leg refuses, and preserves bounded public
trace/receipt/request references through tab reload. `npm run test:browser-mainnet-pilot`
uses the actual renderer and dedicated worker with native Chromium cryptography and
IndexedDB. All wallet owners, cookie/server responses, registry transport and research
payments are synthetic, with every HTTP request intercepted. It verifies real EOA
signatures, reload, wrong authority/item/price/receipt/chain/block refusal, cross-tab
single-use/cap races and other-tab revocation during delayed signing. Integration
against the actual isolated server handler, packaged Next worker behavior, live registry
identity, funding/reconciliation/backup/kill-switch evidence and the owner's final
enrollment/funds decision remain launch gates. No distribution or installer claims
follow from this browser-only acceptance.
