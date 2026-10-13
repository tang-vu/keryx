# Creator registration gas sponsorship

The finite Conzit gas pilot was activated on Arc mainnet on October 12, 2026, in
application **0.27.62**, source `d7f79046`; its policy was retained in the October 13
**0.27.63** delivery. V3 is
`0x2217250019ab614dae7391d346d05c3fc4d71ae1`; both existing V1 listings retain
original creator/payout/price authority. Sponsorship stays **disabled by default**
for unconfigured profiles, and future activations require the gates below.
See [deployment, receipts and retained history](mainnet-status.md).

The installed policy names only `https://conzit.com`, the existing public-fee EOA
`0xdbd07d89eb85d7a36fb204b2a4d2aa68735c24e1`, and ceilings of **0.04 native
USDC/original, 0.08/day, 0.20/lifetime**, at most five attempts/day and five total and two per
wallet/origin. It starts `2026-10-12T10:39:10.054Z` and expires
`2026-10-13T10:39:10.054Z` (**17:39:10.054 Vietnam time, October 13**), with no
renewal or automatic funding/top-up. Digest:
`0x961e313198b014bc0ed4f4328b63e7bb36d21f473fc8ca5686a0c1b376d737eb`.

The [Conzit publishing-control handoff](https://keryx.cc/claim-source?url=https%3A%2F%2Fconzit.com%2F&rss=https%3A%2F%2Fconzit.com%2Frss.xml)
returned HTTP 200. Authenticated availability/proof refusal and server-side
session revocation passed; receipt SHA-256:
`3f3834a1504f5a2db7411796de9f0d52c911b9fc288b1e3b71bf8696fdd62c63`.
This acceptance did not verify Conzit's publishing control or submit a registration.
The publisher must still prove control and sign; availability is not a completed listing.
Funded [testnet acceptance](engineering/registration-sponsor-funded-acceptance-20261012.md)
retains its original profile/source and is separate from these mainnet observations.

The implemented pilot lets an eligible creator sign one exact feed registration
while a configured sponsor pays its transaction gas. The creator remains the
source owner and payout wallet. Registration gas is separate from paid reads,
citation rewards and creator withdrawals; successful registration proves none of
those payments or independent adoption. Existing creator-paid registration
remains available under its selected registry profile.

## Creator and contract authority

The [V3 contract](../contracts/source-registry-v3.sol) adds
`registerWithSignature`. The creator signs the URL hash, payout wallet, complete
author split, read price, content identifier, tags, named relayer, creator nonce
and deadline. The EIP-712 domain binds `KeryxSourceRegistry`, version `3`, the
selected chain and exact registry address. The relayer must match the transaction
sender. Successful signed registration consumes the sequential creator nonce;
a reverted registration rolls it back. The resulting source ID and later edit
authority belong to the signed creator. Direct creator-paid registration retains
its existing call shape. V3 signature recovery currently supports EOAs; it does
not implement EIP-1271 contract-wallet signatures.

The application requires a matching connected wallet and authenticated creator session.
The POST endpoint derives the creator from that session and requires the browser
`Origin` header to match the configured deployment origin. It does not derive
authority from Next's internal listener URL or caller-supplied proxy headers;
the reviewed public server wrapper separately validates ingress metadata. API keys do
not acquire this publishing role. SIWE establishes wallet authentication; it does
not replace the separate registration authorization. See the authoritative
[SIWE specification](https://eips.ethereum.org/EIPS/eip-4361).
Google/Circle EOAs use the same wallet session, publishing proof and typed
authorization gates; live Google end-to-end acceptance remains open.

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

The claim page accepts an optional exact same-origin HTTPS RSS URL with the
website-file proof and preserves it through wallet sign-in and proof reload.
After verification it offers a direct sponsored-registration handoff for an
eligible publisher. Conzit's draft pairs `https://conzit.com/` with
`https://conzit.com/rss.xml`; this draft establishes no ownership or registration.

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

The policy allowlists named creator wallets or exact HTTPS publisher origins and bounds transaction gas, fee per gas,
per-transaction maximum liability, daily/lifetime wei liability, registrations
per wallet, daily attempts and total attempts. Publisher-origin admission requires
a fresh ownership proof and a finite per-origin attempt cap shared across wallets
and URLs. It does not require pre-enrolling the publisher's wallet. The October 12
mainnet policy allows only `https://conzit.com`, up to two attempts per wallet/origin,
five attempts/day and five total, 0.04 native USDC per transaction, 0.08 daily and
0.20 lifetime over the fixed 24-hour policy above. Gas and fee ceilings are
1,000,000 and 40 gwei. Deployment is separately bounded to 0.088 native USDC.
These are ceilings, not observed spending or an automatic renewal. Gas and fee maxima must fit the
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
| `reverted` | Matching reverted receipt; charge actual gas. A separate reviewed replacement consumes another capped attempt and retains this predecessor. |
| `expired` | Only a prepared original with no sponsor nonce/hash/gas evidence can expire and release its monetary hold. Attempt counts remain consumed. |

Daily gas attribution remains on each original's admission day, even when its
receipt is reconciled later. Actual receipt gas, including reverted gas, cannot
exceed the reserved maximum. It is never counted as a creator payout. Terminal
records are immutable; signing/submission uncertainty never expires the hold.

An expired unsigned original or a conclusively receipt-reverted original may be
explicitly renewed. Unsigned expiry requires its contract deadline to be
conclusively past: `now >= (deadline + 1) * 1000`. The new request
must name the latest original through `replacesRequestId`, preserve the same
creator, canonical source, claim/source identity and pinned policy, and have a
later admission time. It consumes another attempt under the same caps. The
journal retains and validates the entire predecessor chain. Reloading or
preparing without that explicit pointer returns the retained original; it does
not renew it. A request in `signing`, `submitted` or `confirmed`
cannot be renewed.

Owner-scoped lookup by request ID retains every original. Lookup by canonical
source selects the latest admitted request. Receipt recovery does not require
an active allowance or sponsor key, but still requires the original network,
registry code/version, transaction identity and event evidence. Missing or
corrupt journal state fails closed. Supabase has no equivalent atomic sponsor
journal for this relay and cannot enable it.

## Recovery limits and activation gates

The October 12 release retains the creator signature atomically with signing
admission and the exact signed transaction atomically with its hash before
broadcast. These bearer values live only in the private journal envelope;
creator lookups, API responses and browser storage receive only the existing
public original. The native reader uses one consistent snapshot. Legacy
originals without retained execution remain inspectable but cannot be resumed.

An explicit owner action, POST `operation: "resume"` or the browser's
"Resume original sponsored transaction" button, first inspects any original
receipt. If execution is still unresolved and authority remains live, it may
finish signing the same original transaction nonce or send its retained signed
bytes unchanged. It creates no new registration attempt, nonce, fee ceiling or
gas reservation. Fresh registry observations precede native publishing-proof
checks immediately before signing and broadcast. Reload and GET inspection
never execute a transaction. Proof/policy/deadline changes refuse execution;
unknown outcomes retain the complete hold.

After authorization expires, explicit POST `operation: "resolveExpired"` or the
browser resolution button can finish only that retained original, within its
existing reservation and still-live policy. Fresh canonical chain observations
must establish the expired deadline before signing and broadcast. The exact
expired calldata cannot register a source in a later block. A submitted original
may have succeeded before expiry while its receipt was unavailable; matching
successful registration evidence remains recoverable in that race. This action
requires no fresh publisher proof because it can create no source, but retains
the authenticated owner, original signature, nonce, fees and gas. Its matching
reverted receipt charges actual gas and closes uncertainty before a separately
reviewed replacement. Policy expiry refuses further execution; keyless original
receipt recovery remains available. There is no cancellation, changed transaction,
fee bump, autonomous retry or hold reset. Missing outcome continues to block
later sponsor signing. Removing browser data or changing configuration does not
grant another attempt.

Local SQLite/service tests and in-process contract tests exercise synthetic
transport, signatures, concurrency, caps, proof changes and failure retention.
They do not establish funded Arc testnet behavior, a mainnet sponsored
registration, actual gas cost or production availability. Funded evidence is
recorded separately in [the acceptance record](engineering/registration-sponsor-funded-acceptance-20261012.md),
including its source pins and any remaining gates. Exact-source CI/review,
production commit verification and applicable browser acceptance remain release
evidence, separate from financial activation.

Any future activation still requires explicit finite funding/spending authority, reviewed
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
| Hosted API | `/api/sources/sponsor` uses the same authenticated wallet session, same-origin, proof, allowlist and atomic caps. Its owner lookup and receipt reader retain original identity; explicit resume preserves the original private execution authority. |
| CLI | Existing research, payment, inspection and offline audit tools remain. No publisher private key, creator transaction signing or sponsor executor is distributed. |
| Remote and stdio MCP | Existing research, payment and inspection roles remain; package publication grants no sponsor signing authority. |
| Desktop Operator | Existing desktop/local roles remain; this rollout grants no publisher custody or sponsored registration signing. |
| Browser extension | Existing hosted research links remain. Browser handoff requires the creator's own session, proof and signature. |
| Bots | Existing hosted research adapters remain. Browser handoff requires the creator's own session, proof and signature. |

The live deployment and limited GitHub manifest observations are dated in the
[mainnet record](mainnet-status.md). MCP 0.4.18's manifest records
`npmRegistryPublished: false`; npm/binary byte equality was not verified by this
readback. Each package/installer retains its own source acceptance and channel role.

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

The historical UI-copy guard rebase handoff required retiring only the old
listing-control `jsx-text` allowance for “Price updates also submit these fields.
Avoid editing this source elsewhere while the wallet prompt is open.” Its
SHA256 identity is `78cbcc36d747c6afd3eb685532c7c0cdb459bc76d8e0395cf92e4e7a5004e345`
with count one. Before that rebase, the guard's existing-source branch still needs
the allowance. The corrected joint inventory has 3,113 candidates in 201 JSX
files and no new inline copy; this count does not establish migration completion.
