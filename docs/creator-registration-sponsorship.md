# Creator registration gas sponsorship

October 9, 2026 source candidate: registration sponsorship is **disabled by
default**. Production retains its V1 SourceRegistry authority. V2 and V3 are
separate contract candidates; including their source or selecting a version does
not deploy a contract, migrate existing listings or authorize a mainnet cutover.
See [current deployment records](mainnet-status.md) and
[the complete-product release gates](mainnet-delivery-plan.md).

The implemented pilot lets an eligible creator sign one exact feed registration
while a configured sponsor pays its transaction gas. The creator remains the
source owner and payout wallet. Registration gas is separate from paid reads,
citation rewards and creator withdrawals; successful registration proves none of
those payments or independent adoption. Existing creator-paid registration
remains available under its selected registry profile.

## Creator and contract authority

The [V3 candidate](../contracts/source-registry-v3.sol) adds
`registerWithSignature`. The creator signs the URL hash, payout wallet, complete
author split, read price, content identifier, tags, named relayer, creator nonce
and deadline. The EIP-712 domain binds `KeryxSourceRegistry`, version `3`, the
selected chain and exact registry address. The relayer must match the transaction
sender. Successful signed registration consumes the sequential creator nonce;
a reverted registration rolls it back. The resulting source ID and later edit
authority belong to the signed creator. Direct creator-paid registration retains
its existing call shape. V3 signature recovery currently supports EOAs; it does
not implement EIP-1271 contract-wallet signatures.

The application requires a matching connected wallet and SIWE creator session.
The POST endpoint derives the creator from that session and requires the browser
`Origin` header to match the configured deployment origin. It does not derive
authority from Next's internal listener URL or caller-supplied proxy headers;
the reviewed public server wrapper separately validates ingress metadata. API keys do
not acquire this publishing role. SIWE establishes wallet authentication; it does
not replace the separate registration authorization. See the authoritative
[SIWE specification](https://eips.ethereum.org/EIPS/eip-4361).

Before opening the wallet prompt and again after it resolves, the browser reads
the live Wagmi connection store. An account, chain or connection-state change
refuses submission even before React renders the new identity. Retained intent
checks and the server's session/signature checks remain required.

Publishing control must already be proven through the existing website-file or
RSS-channel claim flow. The exact canonical HTTPS source and RSS URL must share
an origin. The claim must belong to the creator, retain the prepared source and
registry bindings, and have a fresh proof within the existing 24-hour window.
The service reads the retained claim history before preparing or submitting.
Proof of publishing control does not establish content redistribution rights;
the existing source-policy and distribution-permission gates remain separate.

EIP-712 supplies typed hashing and domain separation, while application and
contract nonces supply replay protection. The standard does not provide replay
protection by itself. See [EIP-712](https://eips.ethereum.org/EIPS/eip-712) and the
[shared registration protocol](../lib/sources/registration-sponsor-protocol.ts).

## Configuration and finite allowance

No sponsor is created or funded automatically. Missing
`KERYX_REGISTRATION_SPONSOR_POLICY` leaves the feature unavailable. Activation also
requires the matching `KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY`, a reviewed sponsor
address, matching server/browser registry version `3`, matching registry read and
write addresses, the selected network and deployment origin, and an unexpired
policy. Explicit offline mode refuses the real relay. Secrets belong only in
protected environment files.

The policy allowlists creator wallets and bounds transaction gas, fee per gas,
per-transaction maximum liability, daily/lifetime wei liability, registrations
per wallet, daily attempts and total attempts. Gas and fee maxima must fit the
transaction reservation. These are native gas amounts in wei, separate from
the six-decimal ERC-20 USDC units used by source prices and rewards. Network
configuration follows [Keryx's canonical profile](../lib/arc-network-profile.ts)
and [Arc's connection reference](https://docs.arc.io/arc/references/connect-to-arc).

The relay verifies the chain through the existing attested RPC transport and
checks the registry's exact runtime code hash and `registryVersion() == 3`.
The sponsor key must resolve to the policy address. The service checks creator
nonce and estimated gas, then checks the locally signed transaction's sender,
chain, target, calldata, nonce, zero value, gas and fees before retaining its
hash. It persists that hash before the first broadcast. There is no treasury
fallback, automatic top-up or implicit use of an existing buyer signer.

## Atomic storage and original lifecycle

[The native SQLite journal](../lib/db/registration-sponsor.ts) uses the existing
`sync_state` table and `BEGIN IMMEDIATE` transactions. It admits the complete
immutable original and maximum gas reservation together, including its server
admission time. The policy digest is pinned to a stable cohort of network,
deployment origin, registry and sponsor. Changing a cap or expiry within that
cohort is refused rather than resetting its accounting. Inspection is bounded
to 1,000 retained registration records and 1,000 retained cohort policies.

Immediately before `prepared -> signing`, the same native transaction rereads
the live claim and compares owner, revision, canonical source, exact RSS URL,
linked source, on-chain ID, registry, network, deployment origin and fresh proof.
A claim change during earlier RPC work prevents sponsor signing. A second active
original for the same creator is refused, protecting the sequential registry
nonce. Sponsor signing is also serialized globally while any `signing` or
`submitted` original remains unresolved. The RPC nonce check refuses a separate
pending sponsor transaction.

| State | Retained evidence and gas accounting |
| --- | --- |
| `prepared` | Exact creator intent and full maximum liability; sponsor signing has not been admitted. |
| `signing` | Original sponsor transaction nonce is retained; signing or submission outcome may be unknown. Full liability remains reserved. |
| `submitted` | Exact signed transaction hash is retained before broadcast. Full liability remains until a matching receipt is found. |
| `confirmed` | Matching successful receipt and source-registration event; charge actual `gasUsed * effectiveGasPrice`. Indexing remains a separate check. |
| `reverted` | Matching reverted receipt; charge its actual gas. It does not authorize another registration attempt. |
| `expired` | Only a prepared original with no sponsor nonce/hash/gas evidence can expire and release its monetary hold. Attempt counts remain consumed. |

Daily gas attribution remains on each original's admission day, even when its
receipt is reconciled later. Actual receipt gas, including reverted gas, cannot
exceed the reserved maximum. It is never counted as a creator payout. Terminal
records are immutable; signing/submission uncertainty never expires the hold.

An expired unsigned original may be explicitly renewed only after its contract
deadline is conclusively past: `now >= (deadline + 1) * 1000`. The new request
must name the latest original through `replacesRequestId`, preserve the same
creator, canonical source, claim/source identity and pinned policy, and have a
later admission time. It consumes another attempt under the same caps. The
journal retains and validates the entire predecessor chain. Reloading or
preparing without that explicit pointer returns the retained original; it does
not renew it. A request in `signing`, `submitted`, `confirmed` or `reverted`
cannot be renewed.

Owner-scoped lookup by request ID retains every original. Lookup by canonical
source selects the latest admitted request. Receipt recovery does not require
an active allowance or sponsor key, but still requires the original network,
registry code/version, transaction identity and event evidence. Missing or
corrupt journal state fails closed. Supabase has no equivalent atomic sponsor
journal in this candidate and cannot enable the relay.

## Recovery limits and activation gates

Two operational recovery gaps remain open. A crash or signing failure can leave
`signing` with a reserved nonce and no retained transaction hash. A crash after
hash retention but before broadcast can leave `submitted` with no transaction
on-chain. The implementation retains those originals and their full liability;
it provides receipt inspection but no retry, replacement, rebroadcast or
operator reset feature. Such uncertainty also blocks later sponsor signing.
Removing browser data or changing configuration does not grant another attempt.
Operational resolution needs a reviewed design and acceptance before activation.

Local SQLite/service tests and in-process contract tests exercise synthetic
transport, signatures, concurrency, caps, proof changes and failure retention.
They do not establish funded Arc testnet behavior, a mainnet sponsored
registration, actual gas cost or production availability. No funded testnet or
mainnet sponsorship proof is claimed by this candidate. Exact-source CI/review,
production commit verification and applicable browser acceptance remain release
evidence, separate from financial activation.

Activation still requires explicit finite funding/spending authority, reviewed
dedicated sponsor custody, funded testnet acceptance including unresolved
submission recovery, and owner-authorized registry deployment/cutover with
listing/indexing/payout continuity. Existing mainnet authorization and V1
receipts cannot be repurposed as V3 activation consent or proof. See
[mainnet operations](mainnet-operations.md) and
[the ordinary update flow](mainnet-update-flow.md).

## Supported surface boundaries

| Surface | Registration role |
| --- | --- |
| Web | `/register/sponsored` is an explicit pilot for one verified feed, with creator review/signing and retained request inspection. Bulk import does not automatically receive sponsorship. |
| Hosted API | `/api/sources/sponsor` uses the same SIWE, same-origin, proof, allowlist and atomic caps. Its owner lookup and receipt reader retain original identity. |
| CLI and remote/stdio MCP | Existing research, payment and inspection roles remain. No new publisher private key, creator transaction signing or sponsor executor is distributed. |
| Desktop Operator | Existing desktop/local roles remain; this candidate grants no publisher custody or sponsored registration signing. |
| Browser extension and bots | Existing hosted links and research adapters remain. A browser handoff still requires the creator's own session, proof and signature. |

No synchronized package/installer publication or deployed sponsorship is inferred
from these shared source changes. Each applicable release artifact and production
commit needs its own accepted readback; current role boundaries remain explicit.

## English copy and catalogue boundary

The sponsored registration page, invitation, form and two new listing-control
explanations use the immutable English area catalogue in
[`locales/en/creator-registration.ts`](../locales/en/creator-registration.ts).
Named interpolation receives already formatted display values; it changes no
currency arithmetic, request state, wallet checks, endpoint or signing authority.
Rendered-copy fixtures retain the original English, accessibility labels,
recovery warnings and separation of sponsor gas from creator earnings. Existing
listing-control copy is outside this narrow extraction. This introduces no
locale activation, translation approval or general locale framework, and leaves
all sponsorship funding, custody and operational activation gates above intact.

When this PR rebases onto the UI-copy guard introduction, retire only the old
listing-control `jsx-text` allowance for “Price updates also submit these fields.
Avoid editing this source elsewhere while the wallet prompt is open.” Its
SHA256 identity is `78cbcc36d747c6afd3eb685532c7c0cdb459bc76d8e0395cf92e4e7a5004e345`
with count one. Before that rebase, the guard's existing-source branch still needs
the allowance. The corrected joint inventory has 3,113 candidates in 201 JSX
files and no new inline copy; this count does not establish migration completion.
