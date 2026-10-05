# Public sources and owner claims

Keryx discovers supported public websites, RSS/Atom feeds and PDFs in response to
a research question. It reads available public content for free within its search,
transport and extraction limits. It does not bulk-import the whole internet.
`/sources` shows retained public feeds and registered creator listings, rather than
every page that could be discovered. A search result, excerpt, abstract or video
description may omit the full work; source discovery does not certify correctness.

Appearing in the source library is separate from proving publisher control.
The library shows retained public feeds and unverified creator listings with content, control and earnings
labels. Article dates are publisher metadata; a feed excerpt or collection timestamp
does not certify the original article's contents or accuracy. A legacy eligibility
flag or on-chain registration alone cannot certify current publisher control.

An owner claim connects a public source to its publisher's wallet. Proving source
control is free and enables no earnings by itself. The owner separately chooses a
policy for an exact registered listing. Existing registered sources retain their
existing behavior until deliberately enrolled in this claim flow.

## Claim a source

1. Open `/sources` and choose **This is my source** on a supported public reference,
   or open `/claim-source` and enter a credential-free HTTPS source URL. Supported
   source kinds include websites, feeds and PDFs. A hosted platform account such as
   YouTube requires separate platform proof and is outside this claim flow.
2. Connect and sign in with the wallet that will manage the claim. Sign-in proves
   wallet control; it is a message signature, with no source-payment transaction.
   The claim, deployment and selected network stay bound to that wallet. Switching
   wallets or networks disables stale actions; refresh reads persisted server state.
3. Choose a proof method and create a challenge. Publish its exact proof, then
   explicitly choose **Check ownership**. Each challenge lasts 15 minutes and is
   single-use. A missing file/token, redirect, expired challenge or conflicting
   owner does not establish control. Fix the reported issue or create a fresh proof.

| Proof method | Where to publish |
| --- | --- |
| Website file | Serve the supplied JSON directly at the source origin's `/.well-known/keryx-source-claim.json`, without redirects. The source and any associated feed must share that origin. |
| RSS/Atom channel | Place the supplied token as a separate word in publisher-controlled channel title/description or Atom subtitle. Post bodies, item text and comments do not establish control. Serve the exact feed without redirects. |

The proof binds the canonical source URL, owner wallet, deployment, network,
challenge nonce and expiry. A retained catalog reference uses its recorded source
and feed pair. For a new RSS claim, the canonical source URL must be the exact feed
URL; feed control cannot claim an unrelated page on a shared host. These checks
establish publishing control, rather than authorship, content accuracy or permission
to distribute every work at that location.

The browser URL retains the challenge selector so an owner can resume an unexpired
proof after reload. A completed claim is loaded from persisted server state. Neither
a local success message nor elapsed time enables payment policy.

## Register or connect an exact listing

After verification, choose an existing indexed SourceRegistry listing for the exact
source, or follow **Register a new listing for this claim**. A new claim-aware
registration reserves that source binding before indexing can enable earnings. It
inherits the dedicated source-control proof and starts with the claim's free policy;
there is no extra feed-token proof or automatic earning activation.

Review the source URL, read price and wallet before registering. Registration is an
owner-submitted transaction on the selected network and may require native gas. It
does not use the research agent's funds or authorize an automatic deposit, purchase
or payout. Wait for transaction confirmation and indexing, then return to the claim
to inspect the exact linked listing. If an existing listing is not connected, choose
it explicitly. Unknown transaction submission remains a recovery operation; do not
register again merely because indexing has not appeared.

The live on-chain registry supplies creator and payout authority, active status,
read price and author splits. The database projects that authority and retains the
claim policy; claiming a public reference does not give its cached metadata payout
authority. A policy action does not change the listing's on-chain toll. Change that
price through the owner listing controls, then refresh and review the policy again.

## Choose a payment policy separately

| Policy | Read price | Creator rewards |
| --- | --- | --- |
| Free | Zero for an eligible free registered read | None for this claim. Verification remains separate from earning. |
| Citation rewards | On-chain read price must be zero | Only new qualified citations may receive a separately budgeted reward after explicit activation. |
| Paid reads | On-chain read price must be positive | Selected new paid reads incur the registered toll; qualified citations may receive separate rewards. |

An eligible zero-price read needs no x402 payment authorization signature and creates
no access-settlement receipt. Ordinary research/read provenance remains visible.
Citation-only mode can still require a separately authorized citation payment when
the agent actually cites qualifying content; zero access price is not a promise of
zero citation reward spending. Reading, registering or verifying a source never
guarantees that it will be selected, cited or paid.

Before activating either earning policy, the owner explicitly confirms distribution
rights. Website or feed control alone does not establish those rights. The listing
must be active, indexed and controlled by this exact registry creator, with the
compatible live read price and fresh source-control proof. Qualified citation
rewards require evidence from the content actually read and the existing budget,
author-split and settlement gates. A preview, metadata entry or owner declaration
cannot substitute for that evidence.

Review the displayed read fee and rights consent, then explicitly activate the
requested policy. Server state is authoritative. On a conflict or uncertain response,
reload the current claim and review again; reload clears stale local activation
consent. Missing or corrupt claim policy, mismatched registry identity or unavailable
current authority withholds new claimed-source payment.

## Future uses and ongoing control

Claim activation takes effect for new uses from its recorded effective time. Each
new admitted use captures the policy revision and timestamps; a later policy change
cannot silently convert that use into a newly payable one. There is no retroactive
billing, stored balance for a future owner, or reassignment of old public citations.

Existing `public:` reference IDs, historical free reads, cached free content and
their original receipts retain their free identity. Claiming their publisher creates
a separate linked creator path; it does not rewrite archived answer or settlement
bytes. An identical public body already admitted into a run does not create another
paid read or reward just because an owner listing also exposes it.

Source-control verification is fresh for at most 24 hours. Earning eligibility pauses
when it expires. Create a new challenge and explicitly verify again to refresh it;
there is no background verification, wallet signing or payment. Public free reading
is unaffected. Disabling earnings with the free policy remains available even after
control expires or registry observation is unavailable. A refresh preserves the
existing policy and history, rather than granting retroactive rewards.

## Supported surfaces and boundaries

Claim management lives in the web creator flow and its same-origin, SIWE-authenticated
write API: challenge issuance, verification, exact-listing linking and explicit policy
updates under `/api/source-claims`. Public claim inspection is read-only; it does not
expose challenge nonces or confer owner authority. Writes use bounded proof fetches,
single-use challenges and expected revisions. No reader can enable earnings by
supplying claim metadata in a research request.

Web research, API clients, CLI, remote/stdio MCP, extensions, desktop and bots retain
their existing reading pipeline and payment authority. They consume the shared
claimed-source eligibility and captured-policy contract; they do not independently
claim sources, prompt for creator enrollment or bypass its payout/evidence gates.
Headless readers do not gain creator-wallet custody through this feature.

Scholarly manuscript rights and payment enrollment remain independently gated. A
website or feed claim cannot enroll an experimental scholarly manuscript, override
its rights policy or imply its mainnet availability. Public scholarly discovery
continues to carry its original free-reference boundary.

This flow requires atomic claim storage and the deployment's reviewed registry
configuration. Backend capability and hosted availability must be verified for the
selected deployment; a local browser fixture establishes behavior, not a live owner,
profit, settlement or synchronized production release. See also
[broad web research](broad-web-research.md),
[creator onboarding and recovery](creator-onboarding-recovery.md), and
[scholarly research](scholarly-research.md).

## API and retained storage contract

All claim responses use `Cache-Control: no-store`. Owner writes require a revocable
SIWE web session, an `Origin` header exactly matching the deployment, and JSON of at
most 8192 bytes. API keys and research-payment signatures do not grant this owner
role. The OpenAPI description is available at `/api/openapi.json`.

| Endpoint | Input and result |
| --- | --- |
| `GET /api/source-claims?canonicalUrl=...` or `?claimId=...` | Public `{ claim, controlMaxAgeMs, network }`; `claim` is null when absent. No challenge nonce is returned. |
| `GET /api/source-claims?challengeId=...` | Owner-only resume of unexpired, unused `{ challenge, proof, proofToken, proofUrl, claim }`. |
| `GET /api/source-claims` | Owner-only `{ claims }`, scoped to the deployment and network. |
| `POST /api/source-claims/challenge` | `{ canonicalUrl, rssUrl?, publicReferenceId?, proofMethod? }`; returns owner proof material. Method defaults to `website-file`; `rss-channel` uses exact feed/channel control. |
| `POST /api/source-claims/verify` | `{ challengeId }`; verifies published proof and returns `{ claim }`. First verification starts free. |
| `POST /api/source-claims/{id}/link` | `{ sourceId, expectedRevision }`; fresh exact registry creator/link check and `{ claim }` in free mode for the initial binding. |
| `POST /api/source-claims/{id}/policy` | `{ mode, expectedRevision, distributionPermission? }`; explicit policy compare-and-set returning `{ claim }`. Missing consent defaults false. |

Challenges bind owner, exact canonical URL/feed, deployment origin, selected network,
nonce and 15-minute expiry. The durable allowance is five challenges and ten proof
fetch attempts per wallet per hour; failed proof attempts consume allowance. Website
proof uses a DNS-pinned public HTTPS fetch capped at 16 KiB; feed proof is capped at
500,000 bytes. Both have a ten-second timeout and forbid redirects and private targets.
RSS proof rejects DTD/entity declarations and never searches arbitrary raw item XML.

Native SQLite and enrolled native SQLite implement claim writes atomically in the
existing `sync_state` table under `keryx:source-claims:v1:`. The records retain initial
control evidence, consumed challenges, every policy revision and source bindings;
this feature adds no DDL or schema-profile change. Supabase and enrolled Supabase
claim writes are unsupported and fail closed. There is no non-atomic `getSync` /
`setSync` fallback. A managed catalog import must carry matching original retained
claim history; unsupported backends reject its sticky `sourceClaimId` marker.

Catalog projection retains that marker even when a source's policy is unreadable,
so one corrupt claim need not prevent other sources from being discovered. The
marker grants no authority: managed reads and new financial admission still fail
closed when their binding or history is missing or corrupt.
Binding writes atomically retain a separate permanent marker. A surviving linked
claim or revision history also retains the managed identity if a binding/marker is
lost. Deleting only a binding therefore never restores legacy earning eligibility;
the affected source requires explicit retained-state recovery before new admission.

The captured policy receipt is `{ id, revision, mode, effectiveAt, verifiedAt }`.
New managed paid source/article/citation requests include both `claimId` and
`claimRevision` query fields. Browser and seller journal admission validate retained
current policy under the existing financial writer transaction before reserving
capacity or an authorization nonce. Same-price policy edits still invalidate new
admission. Seller admission also compares any Keryx browser/hosted original for the
same nonce, because the economic payment signature does not sign URL query fields.
An unsigned query rewrite cannot substitute a newer policy. An already admitted
original economic tuple and original policy remain recoverable after later policy
changes; recovery does not rewrite historical receipts or authorize another purchase.
