# Keryx — Decision Log

Autonomous architecture/product/UX decisions, with rationale. Newest first.
Format: **D-NN** · area · decision · why · reversibility.

---

**D-46** · Content authenticity/Confidentiality · *A paid-body receipt proves what is stored, while
SourceRegistry remains the only payout authority.* RSS ingest now labels bodies conservatively as
`full_text`, `excerpt`, `abstract`, or `metadata_only`; it never calls an ordinary snippet full
text. A registry creator may replace one indexed article with a full body and sign EIP-712 over
`sourceId + itemId + canonicalUrl + SHA-256 bodyHash + plaintextBytes + deliveryKind + nonce`.
The owner API refreshes registry authority, verifies the signature against the exact bytes, then
encrypts and pins the body before committing its CID/envelope/manifest. The public receipt carries
only delivery/storage kind, byte count, hash, and manifest identity. It cannot set price, `payTo`,
active state, or author splits.

Every registration and refresh path now crosses one content-storage boundary. Production and
treasury-funded processes fail closed when Pinata or the content key is absent; explicit offline
development remains labeled plaintext. Decrypted caches are envelope-encrypted in SQLite/Supabase,
legacy cache rows are sealed at initialization, and direct public reads of `source_items` and
`cache_items` are removed. Key wrapping now uses a fresh AES-GCM nonce per envelope while retaining
read compatibility with legacy zero-nonce rows. Why: the old RSS path sold `contentSnippet` as full
text, refresh/registry paths bypassed encryption, public DB policies exposed paid storage, cached
plaintext survived settlement, and repeated GCM nonces under one master key were cryptographically
unsafe. Reversible: medium (manifest/receipt columns are additive; ciphertext migration is
one-way unless decrypted with the retained server key).

**D-45** · Reasoning/Attention · *Free cache reuse still spends an explicit attention budget.* The
orchestrator admits at most four paid-or-cached sources into one synthesis context by default,
ranked by expected value per dollar. A `CACHE` proposal must name at least one decomposed claim and
clear a configurable expected-value floor; re-evaluation cannot expand past the same cap. Every
rejection is surfaced as a normal SKIP rationale, independent of the USDC fetch budget. Why: zero
toll does not make text free to read—irrelevant cached bodies consume model context, increase
latency, and dilute evidence even though they do not move money. Reversible: easy (two environment
thresholds; no payment or persistence authority changes).

**D-44** · Settlement/Capacity · *A Circle-terminal failed transfer closes the pending receipt,
but may release browser capacity only into the exact grant generation that reserved it.* Each
create/recover operation assigns a fresh opaque `grantEpoch`; a browser pending payment retains
that epoch beside its non-secret authorization nonce. Reconciliation first requires the same exact
Circle economic tuple as D-43, then atomically changes `pending` to `failed`. It subtracts the
reserved micro-USDC only when the current grant still has the recorded epoch and session EOA.
Legacy rows and failures from an earlier recovered grant close without changing the current cap.
Failed receipts remain visible but count as neither spend, creator earnings, settlement success,
notifications, fulfillment, nor traction.

Why: Circle's terminal `failed` state is definitive evidence that this authorization did not settle,
so retaining its reservation forever is unnecessary; applying that refund to a newly recovered
grant could instead grant extra capacity after the user has already rebased and spent. Reversible:
medium (the failed ledger state is additive; disabling release safely returns to conservative cap
retention).

**D-43** · Settlement/Recovery · *An ambiguous signed submission may become settled only from
Circle's nonce-indexed transfer ledger and one exact economic tuple.* A post-submit timeout keeps
its existing durable pending row and never stores the bearer signature. The reconciliation worker
searches Circle by EIP-3009 nonce, then independently binds the result to the recorded payer,
payee, Arc network as both sending and recipient network, USDC, and integer micro-USDC amount.
`received`, `batched`, `confirmed`, and `completed` all prove the same Gateway acceptance that a
successful settle response would have returned; the Circle transfer id becomes the receipt.
Missing, duplicate, malformed, or mismatched results stay pending and outside traction, earnings,
notifications, and wanted-claim fulfillment. An exact terminal failure follows D-44. Promotion is a compare-and-set on payment
id, nonce, and pending state, so concurrent watchdogs are idempotent and cannot replace a receipt.

Why: retaining uncertainty prevented double-spend but could permanently under-report a real debit
when only the HTTP response was lost. Aggregate Gateway balances cannot identify which concurrent
authorization settled; Circle's transfer search now exposes the nonce and full tuple needed to do
so without retaining replayable payment material. Reversible: low (disable the scheduled worker;
pending rows remain conservatively pending and the original payment path is unchanged).

**D-42** · Dashboard/Positioning · *Lead with the combined settled citation economy; preserve
demand provenance as a compact breakdown instead of fragmenting the headline.* The ledger's first
screen now presents total queries, settled payments, settled USDC volume, and creator payouts as one
economic system. Independent and Keryx-initiated activity remain explicitly separated immediately
below, and independent conversion, retention, satisfaction, settlement reliability, and grounding
remain their own trust layer. Empty-sample KPIs are hidden rather than promoted as `0 / 0` or
`Collecting`; latency and unit economics move to operational detail.

Why: the previous independent-first layout repeated the same usage numbers while burying the
strongest verified settlement totals below the fold. Combining display hierarchy makes the real
economy legible without relabeling first-party settlement as independent demand or changing any
origin bucket, denominator, or settled-only rule from D-20/D-28. Reversible: easy (presentation-only;
the metrics API and provenance model are unchanged).

**D-41** · Demand market/Agency · *A creator may answer a measured wanted claim with one exact
article version; the response guarantees candidacy, never purchase or payout.* Existing registry
creators can submit an already-indexed article from the wanted brief instead of relisting its feed.
Admission recomputes the live gap from completed dispatch receipts, matches only the article's free
title/preview, refreshes SourceRegistry creator/active/list-price authority, and snapshots
`sourceId + itemId + contentVersion + current articleOfferId?`. One semantic gap plus registry
creator admits at most one bounded treasury retry, with the existing per-wallet daily valve.

The worker atomically leases the intent, then refreshes the same registry creator, article version,
and signed discount before spending. A transient registry failure retries within the lease bound;
a changed creator, article, offer, or already-filled gap closes the coordination row without spend.
The exact article is placed first in the reasoning candidates so prompt limits cannot hide it, but
the agent still emits BUY/SKIP/CACHE under its normal hard budget. Fulfillment remains evidence plus
real settlement: the offered article's claim-indexed quote must qualify and its citation reward must
carry Circle evidence. Legacy source-only intents retain their historical generic retry.

Why: `/wanted` exposed demand and `/market` exposed exact supply, but registration was the only
bridge and the retry did not actually carry the offered article. This closes the market loop without
letting creator coordination become recommendation, spend, or payout authority. Reversible: medium
(nullable intent fields and additive route/UI; old retries and the article market remain usable).

**D-40** · Article market/Authority · *Publishers may sign temporary article discounts; the
SourceRegistry creator, list-price ceiling, active flag, and payout wallet remain authoritative.*
An offer is EIP-712 over `sourceId + itemId + contentVersion + priceUsdc6 + expiresAt + nonce` on
Arc testnet. Only the live registry `creator` may publish or revoke an on-chain source's current
offer revision; pricing fails closed when that authority cannot be freshly read. The offer price is
integer micro-USDC, at least the x402 minimum, never above the live registry price, and expires
within 30 days. Replacing or revoking the one current revision makes an earlier `offerId` return
409 before a paid challenge. A content change does the same through the existing version binding.

The server verifies the signature during owner admission, marketplace discovery, agent selection,
and again before 402. Browser co-signers independently refresh SourceRegistry, verify the creator
signature, price ceiling, exact article identity, expiry, challenge amount, and payee before
creating a bearer authorization. Treasury buyers verify challenge amount/payee and paid response
pricing. Fetch receipts persist offer id, effective amount, and list price. Pre-registry sources
retain the documented public-index wallet/price residual; their wallet signs offers directly.
Why: article identity created a stable object, but a source-level price still prevented a publisher
from pricing a flagship investigation differently from a routine post. A public signed offer book
makes price competition inspectable without introducing custody, escrow, buyer order matching, or
article metadata as payout authority. Reversible: medium (drop the additive offer table/routes and
all articles immediately fall back to their registry list price).

**D-39** · Content economics/Evidence · *The exact article version is the unit Keryx discovers,
buys, caches, cites, and rewards; SourceRegistry remains the authority for list-price ceiling and payee.*
For each verified publication, discovery chooses one relevant `source_items` row from free title and
preview metadata. The reasoning candidate carries a separate `item:<id>` asset identity while its
registry `sourceId` remains attached for source-owned `fetchPrice`, `walletAddress`, and author
splits. Paid reads use `/api/source/[id]/item/[itemId]?version=<contentVersion>`; the route rejects a
changed or missing version before issuing a 402 challenge, settles to the source owner, then serves
only that article. Plaintext rows use a SHA-256 content version and encrypted rows use their
content-addressed IPFS CID. Cache keys include source, item, and version, so an old whole-feed cache
or another revision can never silently satisfy the purchase. Fetch and citation receipts,
evidence, public footnotes, activity, and creator notifications carry the same article identity.

The first slice intentionally permits at most one article candidate per publication in one run, so
existing source-level attribution and payout splitting remain unambiguous. Publications with no
item rows keep the historical source-bundle path, and old nullable receipts remain readable. Item
metadata is never payout authority. Post-settlement delivery failure still follows D-38: retain the
settled receipt, exclude unavailable text from evidence, and continue the answer from other reads.
Why: buying an entire feed made the paid object, cited evidence, cache, and creator work disagree;
an article-level receipt makes the market leg inspectable and gives future bidding/reputation a
stable object to price. Reversible: medium (additive route/metadata and legacy fallback; removing it
would collapse new article receipts back into ambiguous source bundles).

**D-38** · Settlement/Delivery · *A confirmed Circle receipt remains settled even when the paid
resource fails after settlement; delivery success never rewrites payment truth.*
`settleThenServe` now builds the `PAYMENT-RESPONSE` immediately after a successful facilitator
settlement and attaches it to both the normal response and any later producer 5xx. Browser co-sign
and server-funded buyers evaluate that receipt before the HTTP status: a valid
payer/network/transaction proof creates a typed settled-delivery error, while a non-success
response without valid proof remains pending. The server-funded path still uses Circle's official
`BatchEvmScheme` to create the authorization; Keryx owns only the response classification because
the SDK's high-level `pay()` discards headers on non-2xx. The agent persists the settled leg, counts
it in spend and creator earnings, keeps
the session/query reservation consumed, and continues without unavailable source content. A
settled citation acknowledgement failure still qualifies the paid creator notification because
the reward itself landed; a fetch delivery failure never enters the evidence set.

Why: source DB, IPFS, decryption, or answer-production work happens after the irreversible payment
boundary. Treating its failure as ambiguous discarded definitive evidence Keryx already held and
could permanently under-report a real creator payment. Treating the failed body as usable content
would instead corrupt grounding. Payment and delivery therefore need explicit, independent state
transitions. Reversible: low (typed error and response-header preservation; no rail/schema change).

**D-37** · Browser co-sign/Settlement · *After a signed authorization crosses the submission
boundary, uncertainty is `pending`, never `failed`, `simulated`, or settled traction.*
The server now binds every 402 challenge to the orchestrator-authorised network, USDC asset,
integer micro-USDC amount, source/author `payTo`, Gateway contract, signing domain, and lifetime.
It then decodes the browser response before submission and requires its signer, payee, value,
nonce, signature shape, and validity window to match that challenge. A mismatch is pre-submission:
the atomic session reservation is released. Once the validated header is sent to the paid route,
any timeout, non-success HTTP response, or 2xx response without a valid Circle settlement reference
creates a durable `payment_events` row with `settlement_status=pending` and the public EIP-3009
nonce, but never the signature. The reservation remains consumed because the facilitator may have
settled before its response was lost. Re-evaluation also treats that reserved amount as spent for
the per-query cap, preventing an ambiguous first attempt plus a replacement from exceeding budget.

Pending amounts appear in the trace, receipt, creator ledger, live payments feed, dashboard warning,
and health telemetry, while remaining outside `settled=true`, spent totals, creator earnings,
notifications, fulfillment, parity claims, and traction. Post-payment cache/ledger write failures
are isolated from the payment call: the dispatch retains the receipt and content instead of
relabelling a completed settlement as a failed purchase. Exact per-nonce reconciliation remains a
separate operation because Circle's public balance endpoint is aggregate; refreshing a session
re-bases its cap from the live balance but does not invent a settlement verdict for the old row.
Why: transport failure after a bearer authorization exists is not evidence that no money moved,
and a missing response is equally not evidence that money settled. Reversible: medium (additive
ledger state and conservative accounting; removing it would reintroduce false payment claims).

**D-36** · Reasoning/Latency · *Provider-step circuit health is durable across workers; an
expired cooldown leases one half-open probe and a failed probe backs off exponentially.*
The Next server and the autonomous volume daemon are separate processes, and each normal volume
tick launches a fresh `seed --count 1` worker. Circuit state therefore lives in the shared database
under `(engine, reasoning step)`, not only in a module `Map`. A closed circuit admits calls. Once
open, it routes immediately to the next configured provider. When the cooldown expires, one worker
atomically leases the probe while concurrent callers keep using the alternate; a crashed probe is
recoverable when its lease expires. A successful real response deletes the streak. Another failed
probe retains it and doubles the cooldown from 30 minutes up to four hours. When a real alternate
exists, one exhausted call is enough to open; a last-provider-to-heuristic transition retains the
configurable two-failure threshold. Database failure degrades to the mirrored in-process circuit,
never turns a successful model response into a failure, and never changes spend or payout state.

Why: production receipts after D-31 still showed zero circuit skips while the same DeepSeek
`decide` and `synthesize` steps repeatedly spent 40–60 seconds on 503s/timeouts before MiMo served
them. The implementation was locally correct but lifecycle-wrong: the worker that learned the
failure exited, and even a long-lived process forgot the streak when the sixty-second cooldown
expired. The result was completed, fully settled answers taking 100–280 seconds despite a healthy
alternate. Durable state and retained half-open history make the resilience mechanism match the
actual deployment topology. Reversible: medium (drop `reasoning_circuits` and inject the memory
store; provider order, receipts, payment authority, budgets, and evidence gates are unchanged).

**D-35** · Public updates/Canteen · *Publish selectively: useful public product progress and
verified real traction belong on Canteen; private operations and security details do not.*
Canteen is an external product channel, not an automatic mirror of commits, deploys, logs, or
internal experiments. A product update must be understandable and useful to an outside reader. A
traction update must use verified, genuinely settled figures and enough public context to interpret
them. Do not publish local caller identities or addresses, daemon cadence or schedules, machine and
PM2 topology, configuration or environment details, credentials, raw operational logs, internal
failure traces, or security-sensitive/anti-abuse implementation details. If an update mixes public
progress with private details, publish only the safe public summary; if no meaningful safe summary
remains, skip the Canteen update.

Why: consistent public progress helps distribution, while indiscriminate operational disclosure
creates privacy and security risk and turns the product feed into noise. Reversible: easy (revise
the editorial boundary), but already-published sensitive data may not be retractable.

**D-34** · Traction provenance/Local caller · *One workstation daemon is one persistent actor;
it may add requests, but it never rotates wallets to manufacture people.*
The owner's workstation may run a low-frequency SIWE-authenticated client against the sponsored
web endpoint. It creates one ignored local wallet, reuses it permanently, asks a title-anchored
question from a current free source preview, and runs once every eight to twelve hours with a
$0.03 budget. Scheduling is persisted before network work, so a crash/restart sleeps rather than
looping treasury spend. It never sends the Keryx bot key and therefore lands as `origin=web` with a
server-verified `asker`. It also never signs unattended x402 charges: creator settlement comes from
the existing bounded sponsored-web path.

Why: a user-directed agent on another machine is real external demand, but wallet rotation whose
only purpose is raising the actors tile is Sybil traffic. This policy can add exactly one identified
actor and, after its second completed run, one returning actor. Later ticks increase that actor's
usage, not the actor count. Current-preview questions make the small spend useful to creators rather
than turning the daemon into a gap generator. Reversible: easy (stop/delete the local PM2 process;
the public identity and schedule remain in ignored local state for audit continuity, while its
signing key remains only in the ignored `.env.local`).

**D-33** · Feed refresh/SSRF · *Pinned DNS answers support both single-result and `all: true`
Node lookup callbacks; never fall back to an unpinned fetch for compatibility.*
The outbound public-URL guard resolves and validates every address, then gives Undici a custom
lookup function that can return only one already-approved IP. That function now responds with
`[{ address, family }]` when Node requests `all: true`, and retains `(address, family)` for the
single-result form. Feed refresh also includes the immediate transport cause below Undici's generic
`fetch failed` wrapper so future network failures remain diagnosable without a reproduction shell.

Why: production moved to Node 24, whose connection family autoselection invokes custom DNS lookup
with `all: true`. The old Node 20-shaped callback returned a string and family; Node 24 interpreted
that as a missing array entry and rejected all twelve external feeds with
`ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`. Using native DNS as a fallback would make
feeds work but reopen the DNS-rebinding gap the pinned dispatcher closes. Supporting both callback
contracts restores refresh while preserving the same vetted address as socket authority.
Reversible: low (only if the minimum Node runtime and Undici contract change together).

**D-32** · First-party quality/Metrics · *Normal autonomous questions are seeded from one current
free preview; broad exploration is explicit, bounded, and still labeled first-party.*
The volume engine now rotates through active, ownership-verified sources that have current items.
For a normal tick it gives the question model one publication's name, description, tags, and up to
four free title/summary previews. The result must share concrete vocabulary with that preview or it
is replaced by a deterministic title-anchored question. Paid item content never enters generation.
Ten percent of fresh ticks may still use registry-wide themes to discover genuine corpus gaps;
`KERYX_ENGINE_QUESTION_EXPLORATION_RATIO` controls that slice. Provider failure on a normal tick
falls back only to the core, corpus-aligned bank, never accidentally to the broad exploration bank.

Why: production's 33% evidence-grounded claim rate was not primarily a permissive/strict gate
problem. Recent first-party runs asked about CCTP, account abstraction and agent toolchains, then
correctly found zero supporting text across the material they bought. Sampling unrelated tags from
the whole registry made a plausible question, not an answerable one. Preview seeding improves the
economic loop honestly: the daemon should pay more often because it found useful evidence, while a
small exploration budget preserves the `/wanted` demand signal. These runs remain `origin=engine`;
the change cannot increment Independent usage, actors, votes, or conversion. Reversible: easy
(raise the exploration ratio or restore registry-wide theme generation).

**D-31** · Reasoning/Latency · *Circuit health is scoped to a provider and reasoning step, and
sub-threshold failures survive until that same step succeeds.*
A model that reliably handles small decomposition and sufficiency prompts may still time out on the
much larger all-source decision payload. Circuit state is therefore keyed by `(engine, step)`:
success in `decompose` cannot erase repeated `decide` failures, and an open `decide` circuit does
not suppress that provider for work it still serves well. Transient failures below the threshold
remain counted while the circuit is closed; the previous implementation accidentally deleted that
counter at the start of the next call, so a transient circuit with threshold two could never open.
Hard 4xx failures still open immediately, cooldown still admits a half-open probe, and every skip
remains visible in the run receipt.

Why: twelve live receipts carried 20 failed `decide` attempts and about 1.57 million milliseconds
in that step alone, yet the six-hour watchdog reported zero circuit skips. Successful lightweight
steps kept clearing the engine-wide state, while the below-threshold deletion also prevented
failure accumulation. Step-scoped containment bypasses only the payload/provider combination that
is failing and preserves independent healthy capability. Payment authority is unchanged: the
selected engine still only proposes decisions; budget, registry payTo, evidence and settlement
remain deterministic. Reversible: easy (return to engine-wide keys, though that restores the live
failure pattern).

**D-30** · Reasoning/Latency · *An available alternate model provider is the retry; do not retry
the same failing transport first.*
When a reasoning tier has another configured model provider behind it, a transient 429, 5xx or
network failure crosses providers after one attempt. Only the last real provider before the
deterministic heuristic retains the three-attempt retry budget, preserving resilience for a
single-provider deployment and giving the model path a final chance before deterministic
degradation. Full transport timeouts and hard 4xx errors already cross immediately.

Why: after cross-provider failover shipped, the live six-hour window showed 21 failed provider
attempts across 82 samples and eight steps saved by the alternate model, with no heuristic
fallbacks, while independent p95 dispatch latency was 83.66 seconds. Repeating a failing primary
was adding wall-clock delay before taking the action that actually recovered the step. The
structured attempt receipt and provider-scoped circuit breaker remain unchanged. Payment
authority is also unchanged: provider rotation cannot choose a payee, exceed a budget, or bypass
the evidence gate. Reversible: easy (restore per-tier retries or make the policy configurable).

**D-29** · Reasoning/Reliability · *A paid dispatch crosses configured model providers before it
may degrade to deterministic reasoning, and the receipt records every tier it actually tried.*
The default chain is credential-aware: Anthropic, DeepSeek Flash, MiMo V2.5, then the heuristic.
A caller-picked model leads the chain and excludes only that exact engine from the default
fallbacks. Each transport aborts at a configurable sixty-second deadline; rate limits, 5xx and
network failures retry three times, while a full timeout crosses providers immediately rather than
waiting through the same deadline again. A process-wide circuit opens after two exhausted
reasoning calls for sixty seconds. A hard
4xx configuration error opens immediately. The circuit is keyed by engine wire name, so one noisy
provider cannot suppress another.

Every completed run persists bounded per-step attempt telemetry: engine, tier, attempt, latency,
outcome, HTTP status and a coarse error category. Provider bodies are never stored because they may
echo paid source context. The dispatch watchdog aggregates real-model failover saves, failures and
circuit skips onto `/status`. The compact `engine` label remains the public summary, but it is now
backed by structured evidence rather than string parsing alone. Payment authority is unchanged:
models still only propose decisions/evidence, while the orchestrator alone enforces spend caps,
payTo, evidence qualification and integer settlement. Why: production showed 4/6 recent runs losing
a reasoning step to the heuristic while both DeepSeek and MiMo passed live probes; resilience was
available but the healthy second provider was not in the default failure path. Reversible: medium
(remove the secondary tiers/telemetry; no database migration or payment-rail change).

**D-28** · Dashboard/Positioning · *Independent demand leads; first-party agent activity remains
visible as provenance, not as a competing traction claim.*
The public ledger now calls human and third-party web/MCP/A2A use “Independent usage” and Keryx's
own runs “First-party agent activity.” The underlying origin buckets and settled-only metrics are
unchanged. Their distinction stays visible in one compact usage-mix strip, while the definition
moves behind an accessible tooltip and the aggregate ledger remains below. Why: blockchain
settlement proves that value moved, but it does not prove who initiated the demand. Keeping that
provenance preserves credible traction without making defensive disclosure the page's headline.
Reversible: easy (presentation-only copy and layout).

**D-27** · Browser co-sign/Security · *A persisted session grant is payment state, not bearer
authentication.*
The `/api/ask` browser co-sign path now requires the active SIWE wallet to equal the client-supplied
session id and the persisted grant owner before the request receives the user-funded exemption or
any sign-request id. A wallet address is public; treating it as sufficient proof let another caller
reserve that wallet's spend cap with invalid payment headers and use the co-sign route to bypass the
anonymous treasury rate tier. The attacker could not sign with or steal the session funds, but could
strand the victim's capacity and consume server-side reasoning. Pending signature slots also bind to
the SSE abort signal, so a disconnect removes the slot and releases the pre-signature reservation
immediately rather than waiting thirty seconds. Why: ownership must come from SIWE, while the grant
only bounds an already-authenticated owner's spend. Reversible: low (removing the binding would
reopen a cross-session denial-of-service path).

**D-26** · Distribution/Demand · *A shareable wanted brief is a live coordination view, never a
bounty promise or payment authority.*
Every published gap may be opened at `/wanted/[gapId]` with claim-specific metadata, a social card,
the failed dispatch receipt, current offer state, and a feed probe scoped to that claim. The URL
carries only the existing opaque semantic id. Both the page and probe rebuild the current
evidence-bounded demand board; a claim that is no longer open cannot be offered from stale shared
state. Registration still re-reads the feed, independently matches the selected post, resolves
SourceRegistry ownership, and applies the one-offer-per-gap-owner plus five-per-wallet daily
admission limits.

The page says explicitly that this is not a guaranteed bounty. Keryx may sponsor one treasury retry
up to 0.05 testnet USDC after indexing and ownership verification, but `filled` still requires
claim-matched evidence, at least 0.4 evidence-bounded coverage, and a genuinely settled citation
leg. Shared metadata, social previews, and feed-probe results cannot select `payTo`, increase a
budget, queue spend, or mark fulfillment. Why: the gap-to-payout loop existed but one undifferentiated
board was difficult to route to the specific writer who could close a claim. Reversible: easy
(remove the permalink and scoped presentation; the queue and settlement path are unchanged).

**D-25** · Treasury/Security · *Treasury-funded work is admitted as a bounded unit, and an
ambiguous post-broadcast transfer keeps its reservation.*
Wanted-claim registration now independently re-runs the public-preview claim matcher instead of
accepting mere feed membership. Admission is atomic at one intent per `(gap, verified owner)`
across every source and post, with a durable five-offer-per-wallet daily limit at the registration
boundary. This makes a creator's semantic offer—not each attacker-selected URL—the unit that can
enter the treasury retry queue. Remote MCP applies the same principle by rejecting a JSON-RPC
batch containing more than one treasury-funded `research` call, so an HTTP-request rate-limit
token cannot fan out into multiple spends.

Untrusted URL classification expands IPv6 before checking IPv4-compatible and IPv4-mapped
addresses, preventing hexadecimal forms such as `::ffff:7f00:1` from bypassing private-network
rules. The testnet onramp reserves an address before sending and releases it only when no
transaction was broadcast or a receipt confirms a revert. A receipt timeout after a transaction
hash is returned becomes `pending` and retains the reservation, because retrying an ambiguous
transfer can double-drip. Why: financial rate limits must cover the actual funded unit, URL
canonicalization must not weaken SSRF policy, and uncertain settlement is not failure.
Reversible: medium (limits are configurable in code; the conservative reservation rule requires
reconciliation before a retry can be made safe).

**D-24** · Demand/Settlement · *A creator's wanted-claim offer is durable coordination, never
payment authority; fulfillment requires evidence and real settlement.*
Each open semantic claim gets a stable SHA-256 id. The feed-match handoff carries only that opaque
id and the matched post URL; registration re-resolves the claim from the current demand board and
requires the post to exist in the RSS payload Keryx just ingested. The resulting `gap_intents` row
snapshots the failed question and offered source, but cannot choose a payee or spend a creator's
funds. The volume daemon atomically leases only intents whose source cache row is active, ownership
verified, and still owned by the wallet that made the offer. It retries with Keryx's existing
server-side x402 treasury path, capped at 0.05 USDC, a ten-minute crash-reclaim lease, and three
attempts; registration and verification requests never spend.

Completion is deliberately stricter than the generic demand board: `filled` requires the offered
source to carry reward-qualified evidence for the same semantic claim, evidence-bounded coverage
of at least 0.4, and a `settled=true` citation ledger leg with a Circle settlement identifier for
that source and retry run. Grounded-without-settlement is `unpaid`; weak/mismatched evidence is
`missed`; an offer whose gap closes before verification becomes `stale` without spend; repeated
execution errors become `failed`. SourceRegistry/payTo validation and integer
micro-USDC splitting remain unchanged. Why: feed matching previously ended at a registration link,
while probabilistic retries could neither target the creator's offer nor prove that the advertised
gap-to-payout loop completed. Reversible: medium (additive queue/table/UI; no new payment rail).

**D-23** · Grounding/Settlement · *A model citation cannot authorize a reward without a
deterministically verified evidence span.*
Synthesis now proposes `claimIndex + marker + exact quote + support`; the orchestrator accepts it
only when the claim index exists, the marker names content actually read, the normalized quote is
present in that source, the marker appears inline in the answer, and synthesis declared it cited.
Public evidence excerpts are capped at 240 characters so a receipt cannot substitute for gated
content. Rejected markers are removed from the public answer and never enter `citations`, so they
cannot reach `payCitation`; a failed final-assessment call also fails reward authorization closed
without discarding the completed answer. Final confidence and the demand board use coverage bounded by both the final
assessment and the strongest reward-qualified evidence, never source count or a stale pre-purchase
snapshot. Fetch tolls already settled remain valid payment for access; when no citation passes the
gate the citation pool stays unspent. Attribution may only weight the evidence-qualified set; an
invalid/incomplete attribution falls back to an equal split inside that set and can never introduce
a payee. Why: a live CCTP retry correctly measured every claim at 0% and wrote a negative answer,
but an empty `citedMarkers` fallback promoted all 13 reads to citations, labelled the answer High
confidence, and settled equal rewards. The model may propose economic state; code must authorize it.
New nullable scalar counters power the dashboard without loading every receipt, while historical
runs remain explicitly unsampled. Reversible: medium (additive run schema, but the reward gate is
now a financial invariant).

**D-22** · Distribution/Telemetry · *Attribute Remote MCP activation with a bounded setup-URL
channel, never with protocol client metadata.*
The stateless Streamable HTTP transport does not retain `initialize.clientInfo` for a later
`tools/call`, so each published setup URL declares one bounded channel:
`?client=codex|claude|cursor`. Missing and unrecognized values normalize to `direct` and `other`;
historical rows remain unknown. This is intentionally self-declared activation telemetry only.
Stable actor attribution still comes exclusively from a verified API-key wallet, and the channel
cannot change auth, rate limits, budget caps, or payment authority. Reversible: easy (stop
publishing tagged URLs; the nullable column is additive).

**D-21** · Distribution/Payments · *Add stateless Remote MCP beside, not instead of, the caller-funded
stdio MCP package.*
`https://keryx.cc/mcp` creates a fresh Web Standard Streamable HTTP server per request and exposes
the shared `collectRun` research core. Remote calls are treasury-funded because a hosted server
cannot safely hold each caller's local x402 buyer wallet: anonymous calls reuse the IP-limited
free tier and `anonMaxBudget`; ask-scoped API keys get the keyed limit, `a2aMaxBudget`, and
server-verified wallet attribution. A separate `mcp` origin keeps this channel measurable without
mislabeling it as inbound-paid A2A traffic. The npm stdio path remains available for agents that
must pay Keryx's x402 toll from their own wallet. Stateless JSON mode fits Next/serverless and gives
up durable sessions/server notifications, which the two request/response tools do not need.
Reversible: easy (remove `/mcp` and the registry remote; additive origin rows stay readable).

**D-20** · Traction · *External completed queries, not aggregate self-generated payments, are the
primary product KPI.*
Persist `origin` on `query_runs` so zero-spend dispatches remain in the correct conversion
denominator; payment-origin alone cannot do that. External means a real web asker or third-party
A2A caller, while the autonomous volume engine remains visible but secondary. Returning actors are
counted only from a server-verified SIWE wallet or a settled inbound A2A payer—anonymous users are
not fingerprinted. Money metrics read only `settled=true` rows. Latency and settlement-success
samples start when telemetry ships; historical rows stay NULL rather than receiving invented
values. Why: the system already proves the rail works, so the next bottleneck is repeat external
demand and answer quality. Remote MCP is a distinct external origin; authenticated MCP actors use
the verified API-key wallet and anonymous MCP callers remain unattributed. Reversible: easy (the
fields are additive; presentation can change).

**D-19** · Notify · *Citation email alerts are a second independent channel beside the webhook, not a column on it.*
Own table (`source_notify_email`) + own dispatcher mirroring the webhook's contract (settled-legs-only,
fire-and-forget, never throws), so a creator can run either channel or both and existing webhook code
stays untouched. Provider = Resend over one HTTP POST (no SDK, no SMTP dep); ships dark until
`KERYX_RESEND_API_KEY`+`KERYX_EMAIL_FROM` are set — same proven pattern as the Slack front door.
Per-source rate cap (default 1/h) because the 24/7 engine re-cites the same sources; unsubscribe is an
unauthenticated tokened link (per-row random secret, constant-time compare, uniform response) because
the recipient must always be able to stop mail even without the owner's wallet. Reversible: easy
(drop table + panel; run path is one fire-and-forget call).

**D-18** · Dashboard/Data · *Creator cash-outs (Gateway withdraws) live in their own `withdrawals` table, never in `payment_events`.* (user: surface real /tx/ proof on the dashboard)
A withdraw moves already-earned USDC OUT on-chain; it is not a new payment. Folding it into `payment_events` would double-count — `metrics()` aggregates that table for total payments, total volume, creator payouts, and reader→payer conversion, so every cash-out would inflate traction. A dedicated table keeps those figures honest while letting the dashboard surface the withdraw's real EVM mint hash — which, unlike the batched Circle settlement UUIDs in the payments feed, resolves at the explorer `/tx/` — as the hard per-tx on-chain proof that rewards are real, withdrawable USDC. Keyed by `tx_hash`, so re-recording the same withdraw is an idempotent no-op (the `withdraw` script persists on each live mint). Reversible: easy (drop the table + panel; no coupling to the payment path).

**D-17** · Trust · *Listing a source is permissionless, but EARNING requires feed-ownership proof.* (user: "do the best one")
Anyone can paste any RSS feed into the register form, so anyone could list a feed they don't own (Stripe's blog, Vitalik's site) with their own wallet and skim citation rewards — the content is real, but the wrong wallet gets paid. Fix: a `verified` flag gates the money path, not the directory. The agent (`run-agent.ts` discovery) only reads/cites/pays sources where `verified !== false`; unverified ones still appear in the registry, just off the rail. Proof = the owner places `keryx-verify:<payoutWallet>` anywhere in the feed (only whoever controls the feed's publishing pipeline can, and the token binds to the wallet so it can't be replayed) then POSTs `/api/sources/verify`. Migration-safe: the column defaults true, grandfathering the 17 curated seed rows + live VPS traction so the volume engine never stalls; only public web submissions start unverified. On-chain `register()` is the same squatting vector, so the indexer writes new rows unverified too (never downgrades an already-verified row). Reversible: easy (flip the discovery filter off). Note: `id = keccak256(creator, urlHash)` namespaces sources per wallet, so a verified owner can list their feed alongside any impostor copy and be the only one that earns.

**D-12** · Settlement · *Reuse x402 plumbing for BOTH toll moments instead of a new transfer primitive.*
Each source has its own wallet as `payTo`. (a) Fetch toll: agent `gateway.pay(/api/source/[id])` → real x402 settle to creator. (b) Citation reward: agent `gateway.pay(/api/cite/[id])` with dynamic price = weighted reward → real x402 settle to creator. Both land in `payment_events`. Why: every payment is a genuine batched on-chain settlement (no mocks), reusing verified code; no bespoke transfer path. Reversible: medium.

**D-11** · Settlement · *Two-tier economics: small fetch toll + weighted citation pool.*
Per query budget B. Fetch tolls are small per-source access fees (only on BUY). A citation pool (portion of B) is distributed AFTER synthesis by LLM-assigned contribution weight to sources actually cited. Sources fetched-but-not-cited keep only their toll; cited sources earn toll + weighted reward. Why: makes "paid per citation, weighted by contribution" literal and demoable; creates emergent budget behavior. Reversible: easy (tune pool %).

**D-10** · Multi-author · *Default to programmatic per-author nanopayments; on-chain splitter contract is an optional enhancement.*
When a source has N authors with split weights, send N weighted nanopayments to N wallets. Why: showcases nanopayment sub-cent floor, no contract deploy risk, fully real. On-chain `PaymentSplitter` (Circle Contracts) offered as enhancement for atomic splits. Reversible: easy.

**D-09** · Agent · *LLM-provider-agnostic `lib/llm` with Anthropic Claude default + deterministic heuristic fallback.*
Why: build/run/test the whole flow offline today (no key blocker); flip to real Claude reasoning for the demo. Claude (not OpenAI) since user is in the Anthropic ecosystem and we want best reasoning for the 30% sophistication score. Reversible: easy (swap provider).

**D-08** · Data · *Swappable `lib/db`: SQLite (better-sqlite3) for local dev, hosted Supabase for deploy.*
Why: no Docker locally → can't run Supabase locally; need to develop unblocked AND have a hosted DB for the Vercel demo. Single `db` interface keeps call sites clean. Reversible: medium.

**D-07** · Dashboard · *Poll every 1–2s instead of Supabase realtime subscriptions.*
Why: adapter-agnostic (works with SQLite + Supabase), simpler than scaffold's realtime, same screenshot-ready live effect. Reversible: easy (add realtime later for Supabase).

**D-06** · Traction · *Wire `arc-canteen push` for traction events + `circle feedback submit` for the dev-feedback prize.*
Why: `arc-canteen` is the literal mechanism the hackathon uses to track the 30% Traction score; feedback CLI captures the free $500 dev-feedback prize. Reversible: easy.

**D-05** · Discovery · *Internal source registry is the primary discovery channel; `circle services search` is a bonus external channel.*
Why: we control owned/registered creator sources (real payouts to real creators = traction); external x402 discovery is a nice-to-have. Reversible: easy.

**D-04** · Ingest · *Onboard sources via RSS (RSSHub or direct feed parse).*
Why: trivial one-click creator onboarding ("paste your RSS") → fast traction; RSSHub turns almost any site into a feed. Reversible: easy.

**D-03** · Product · *Name = Keryx; brand = "creators get paid every time an AI cites them."*
Why: repo is `keryx` (Greek herald/town-crier — announces + is paid); fits the per-citation narrative. Reversible: hard (naming).

**D-02** · Scope · *Keep the scaffold's working x402/Gateway plumbing verbatim; rebuild only the agent + creator economy on top.*
Why: payments are the risky/verified part — don't re-derive them; spend effort on the reasoning brain (the differentiator). Reversible: n/a.

**D-01** · Chain · *Build on Arc testnet (5042002) with a single mainnet config flag.*
Why: hackathon guardrail — no real money without go-ahead. Reversible: easy (config).

**D-15** · Enhancements · *Implement all four enhancements, sequenced by score-impact.* (user: "all four; you decide how to win")
Order: (1) Agent-to-agent mode — expose Keryx as a paid x402 endpoint other agents call; (2) External x402 discovery via `circle services search`; (3) Onchain PaymentSplitter (Circle Contracts) for atomic splits; (4) ERC-8004 agent identity + creator reputation feeding source selection. Core (web app + real settlement + volume) lands first. Reversible: easy (each is additive).

**D-14** · LLM · *Add DeepSeek (OpenAI-compatible) as the default cheap provider; Anthropic still supported.* (user choice — cheaper)
Shared `JsonChatEngine` base holds all prompts once; `AnthropicEngine` + `OpenAICompatibleEngine` are thin transports. Provider priority: Anthropic > DeepSeek > heuristic. Reversible: easy.

**D-13** · Deploy · *Primary deploy = run locally + Cloudflare Tunnel (cloudflared) for the public URL; keep SQLite.* (user suggestion — good fit)
Drops the Supabase + Vercel hard-dependency: the app + funded wallet + volume engine run on the local machine, exposed publicly via tunnel. Trade-off: live only while the machine/tunnel run (fine for demo + volume window). Supabase/Vercel path stays available behind config for always-on hosting. Reversible: easy (config flag).

**D-12b** · Recording · *The agent (client) is the single recorder of payments in both modes; x402 server endpoints settle but don't double-write.*
The agent has full context (queryId, rationale, weight, contribution) and runs the same recording offline & online with the real tx hash from `gateway.pay`. A2A external payers get server-side recording in that endpoint variant. Reversible: medium.

**D-16** · Discovery · *External x402 marketplace = discovery + reasoning only; never purchased (off-Arc rail enforced in code).* (user choice — "discover + decide, don't buy")
Each query the agent probes the live Circle x402 bazaar (`circle services search`, one cached snapshot), ranks endpoints locally by topical relevance, and the engine reasons BUY/SKIP over them alongside registered creators. The orchestrator then forces every external endpoint to SKIP — they settle on other chains (Base/ETH/… mainnet, none on Arc), so they're evaluated and logged but not settled (mirrors the budget-cap enforcement). Honors the no-real-money rule while adding Circle `services` tooling + open-economy agency with zero cross-chain spend. Reversible: easy (a Base-Sepolia testnet pay path can be added behind a flag later).

---

## Open questions (for the human) — RESOLVED
- LLM key: ✅ Anthropic primary + DeepSeek fallback (D-09, D-14).
- DB: ✅ local SQLite on the VPS is the source of truth; Supabase adapter kept behind config (D-08, D-13).
- Funder wallet: ✅ funded; real settlement is live (`KERYX_FORCE_OFFLINE=0`), 500+ settled payments.
- Deploy target: ✅ VPS at keryx.cc via Cloudflare Tunnel, not Vercel (D-13).
