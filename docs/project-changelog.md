# Keryx Project Changelog

**Last Updated:** 2026-08-24
**Current Version:** 0.17.0

All significant changes, features, and fixes from v0.1 (citation-toll agent) to v0.2 (decentralized dApp).

---

## Unreleased

### Claim-aware evidence portfolios (2026-08-24)

- Replaced per-row expected-value/list-price sorting with a deterministic portfolio selector that
  maximizes predicted claim coverage with diminishing returns under the existing Quick/Deep
  attention ceiling and fetch-budget cap.
- Made the two scarce resources explicit: BUY consumes its authoritative registry/offer price plus
  one attention slot; CACHE consumes zero fetch USDC plus one attention slot. A cache entry's list
  price can no longer crowd a stronger exact source out of the synthesis context.
- Kept the selector downward-only: it may choose a subset of model BUY/CACHE proposals after the
  preview gates, but cannot promote SKIP, add a source, alter `payTo`/price, raise a budget, or
  authorize evidence/citation rewards.
- Added a visible pre-spend portfolio trace, archived per-claim predictions, post-run evidence yield,
  an answer-card summary, and the same bounded data in portable research receipts.
- Added focused selection, permutation, dual-budget, diminishing-return, outcome and end-to-end
  economic regression tests. Final confidence and money remain evidence/Circle-gated exactly as
  before.

### Portable, integrity-checkable research receipts (2026-08-23)

- Added public `GET /api/dispatch/{id}/receipt` and a download affordance on every permalink. One
  deterministic payload carries the exact answer and answer hash, visible BUY/SKIP/CACHE decisions,
  claim-indexed evidence, cited article versions/public content receipts, and a sanitized creator
  settlement snapshot.
- Added recursive sorted-key canonical JSON plus a SHA-256 integrity block and
  `npm run verify:receipt -- <file-or-url> [--expect sha256:…]`. URL verification also compares the
  HTTPS response header; file verification can compare a separately retained digest. The receipt
  says explicitly that its self-hash is not a server, publisher, Circle, or on-chain signature.
- Kept economic truth fail-closed: only Circle-evidenced rows enter settled totals; pending,
  terminal failed and offline simulation amounts stay separate. Missing durable rows make the
  settlement snapshot `incomplete`, and payer addresses, authorization nonces and internal row ids
  never enter the export.
- Kept the feature read-only. It invokes no Gateway, session reservation, registry mutation,
  content purchase or decryption, and exact Circle reconciliation may update only the exported
  settlement snapshot—not the archived answer.

### Living answers: exact citation drift and re-ask deltas (2026-08-23)

- Extended archive freshness from a feed-level "new posts" hint to an exact paid-asset audit:
  each versioned citation's SHA-256/IPFS identity is compared with the article Keryx currently
  indexes and classified `current`, `superseded`, or `unavailable`.
- Added public `GET /api/dispatch/{id}/freshness` metadata receipts with explicit interpretation
  limits. The endpoint never buys, decrypts, or judges replacement content, and adapter failures
  stay visible as unknown rather than becoming a false "current" result.
- Added a receipt delta for user-initiated same-question re-asks: sources added/removed, exact
  versions changed, matched-claim coverage, confidence, verified evidence spans, dispatch cost,
  and Circle-settled creator payout movement. Missing ledger rows render that delta unprovable;
  simulations never appear as settled money. Genuine follow-up questions are never compared as if
  they were the same scope.
- Kept archived answers, evidence and settlement immutable; current material enters an answer only
  through the existing explicit budgeted re-ask and x402/citation payment flow.

### Faster research modes and privacy-preserving activation funnel (2026-08-23)

- Added a Quick web default (two claim-targeted reads, no external marketplace probe or expansion
  round) beside the existing Deep research pass; both preserve the same visible budget, evidence
  gate, payout authority, and honest settlement state.
- Added a free-preview coverage pre-check before any paid fetch. Untargeted and below-floor
  purchase proposals become visible SKIPs; preview coverage can only narrow spend and never
  authorize a payee, citation, or reward.
- Added a public 30-day reader/creator activation view backed only by UTC-day event counters. No
  analytics cookie, wallet, IP, fingerprint, question, source, or payment id enters the counter
  table, and the dashboard labels the figures as events rather than unique people.
- Updated the privacy policy and added SQLite/Supabase parity plus tests for the new counters.
- Redacted credential-bearing RPC/WS URLs from indexer error logs without changing checkpoint or
  retry behavior.

### Security and operational hardening (2026-08-22)

- Stopped durable rate limits from ever receiving raw API bearer values, keyed verified callers by
  non-secret key id, and purged legacy secret-bearing buckets on SQLite/Supabase startup/migration.
- Completed Supabase schema parity for feedback/query memory and locked every private table and
  economic RPC behind explicit RLS/service-role privileges.
- Bounded questions, wallet-scoped browser compute, and each session dispatch budget while keeping
  browser signer custody, atomic reservations, and Circle-evidence-only reconciliation unchanged.
- Added stale/critical pending-authorization health, deduplicated ops alerts, swap-backed deploy-time
  TypeScript gates, and global CSP/transport/frame/MIME/referrer/permissions headers.
- Updated the safe dependency lane to Next 16.3.2, MCP SDK 1.30, Circle App Kit packages, and x402
  2.23; production audit now has zero critical/high advisories and CI gates on high severity.
- Made the MiMo/DeepSeek/Anthropic fallback order operator-configurable with documented partial-list
  semantics and deterministic heuristic fallback.
- Pinned the standalone MCP buyer and treasure-hunt client to Arc testnet, removed the old
  environment-only mainnet switch, and cleared all React/ESLint warnings without changing UI flows.

### Public proof links every claim to the system that can verify it (2026-08-13)

- Added `/proof`, a live evidence dossier that binds the deployed commit to GitHub CI, exposes
  settled-only citation totals, and keeps independent usage visibly separate from first-party
  autonomous volume.
- Composed SourceRegistry parity, Circle wallet-balance parity, and recent ArcScan-resolvable
  creator withdrawals in one place while stating what each layer does—and does not—prove.
- Retained the Arc RPC head in the registry watchdog summary and exposed only a safe provider label;
  tokenized Canteen RPC URLs and their secret paths never enter the public response.
- Made settlement evidence preserve provider uncertainty: if a Gateway shortfall needs an Arc
  balance read and the RPC does not answer, the public verdict is `unknown`, never a fabricated
  zero balance or false settlement alert.
- Added a public evidence map for grant/community review plus a CI badge and current, provenance-
  separated traction snapshot in the repository documentation.
- Release validation: **661 application tests**, **16 contract tests**, TypeScript, ESLint (no
  errors; pre-existing warnings only), and the full Next.js production build.

### Signed full-text receipts and attention-bounded reading (2026-08-10)

- Added a creator-owned EIP-712 full-text vault: the live registry owner signs the exact article
  URL, SHA-256 body hash, UTF-8 byte count, delivery kind, and nonce before Keryx encrypts it.
  Ciphertext prefers IPFS and falls back to private encrypted DB storage when Pinata is absent;
  public discovery/citations expose only a content receipt, never the body or payment authority.
- Made RSS disclosure honest (`full_text` / `excerpt` / `abstract` / `metadata_only`) and routed
  registration, on-chain preparation, and feed refresh through one fail-closed encrypted-storage
  boundary.
- Encrypted decrypted-content caches at rest, sealed legacy rows on boot, removed Supabase public
  read policies for paid storage, and replaced the reused AES-GCM key-wrap nonce with random v2
  nonces while preserving legacy reads.
- Added a separate four-source attention budget. Cached reads need a claim target and minimum
  expected value, and re-evaluation cannot grow synthesis context past the same visible cap.

### Failed Circle transfers safely restore browser capacity (2026-08-09)

- Exact Circle-terminal failures now close ambiguous pending receipts as visible `failed · not
  charged` attempts, excluded from spend, earnings, notifications, fulfillment, and traction.
- Bound every browser reservation to a fresh grant generation so reconciliation restores capacity
  only to the unchanged session grant, never to a newly recovered/rebased cap.
- Made failure and release one idempotent transaction in SQLite and Supabase; added permanent failed
  receipt telemetry to the dashboard and health response.

### Ambiguous x402 submissions now self-heal from Circle evidence (2026-08-08)

- Added a nonce-indexed reconciler for signed submissions whose HTTP settle response was lost.
- Promote only one exact Circle transfer matching payer, payee, Arc network, USDC amount, and nonce;
  missing, duplicate, malformed, or conflicting evidence remains fail-closed.
- Made promotion atomic and idempotent across SQLite and Supabase, scheduled it every ten minutes,
  and exposed its last verified result on `/api/health` and `/status`.

### The ledger now reads as one settled citation economy (2026-08-08)

- Promoted total queries, verified payments, settled USDC volume, and creator payouts into one
  headline block instead of splitting the strongest totals below independent-demand cards.
- Kept independent and Keryx-agent activity visible as a compact provenance breakdown, so combined
  settlement scale is never misrepresented as third-party traction.
- Grouped conversion, retention, satisfaction, settlement reliability, and grounding as trust
  signals; sample-free KPIs stay hidden until they have evidence, while latency and unit economics
  sit in operational detail.

### Wanted claims now accept exact articles from creators already in the market (2026-08-08)

- Added a SIWE owner flow on each wanted brief that finds the creator's matching indexed article,
  optionally publishes an EIP-712 discount, and queues one bounded response without relisting RSS.
- Gap intents now retain exact item/version/offer identity. The worker refreshes registry creator and
  immutable pricing state before treasury spend; stale responses close without payment.
- The exact response is guaranteed a candidate slot, not a purchase. BUY/SKIP stays visible and
  autonomous, and fulfillment still requires qualifying evidence plus a real settled citation.
- Legacy source-only gap intents remain readable and retry with their historical behavior.

### Publishers can sign article-level offers; agents buy against an open price book (2026-08-05)
Keryx now exposes every payable article version at `/market` and `/api/offers`. A publisher can
open the Article Offer Desk on its creator page, choose an exact item, price and expiry, and sign an
EIP-712 offer without sending a transaction. The signed payload binds source, item, content
version, integer micro-USDC amount, expiry and nonce. One current revision per article makes
replacement and revocation deterministic.

SourceRegistry remains the hard authority: its creator is the only signer accepted for on-chain
sources, its price is the ceiling, its active flag gates the rail, and its payout wallet receives
the x402 settlement. A stale version, revoked/replaced offer or expired signature returns 409
before 402. Browser session co-signers independently refresh the registry and verify payee, creator
signature, article identity, expiry and challenge amount; treasury buyers verify the same paid
terms around settlement. Agent decisions, SSE traces and payment receipts retain effective price,
list price and offer id, while invalid offers safely fall back to list price during discovery.

### The thing Keryx buys is now an exact article, not an entire feed (2026-08-05)
Discovery now chooses one relevant article per verified publication using only free title and
preview metadata. The model reasons about that article, and the same `itemId + contentVersion`
continues through the x402 fetch, versioned cache, evidence ledger, citation, payment receipt,
activity feed, and creator notification. Public footnotes link to the work that actually supported
the answer instead of naming only its parent publication.

The paid article route rejects a missing or changed content version before returning a 402
challenge, then settles the publication's existing registry price to its source-owned wallet and
releases only that article. Plaintext uses a SHA-256 version; encrypted content uses its immutable
IPFS CID. Free previews now publish that payable identity and `paidPath` without weakening the
creator's summary-depth setting, so outside agents can discover and buy the same object. SourceRegistry remains payout authority, including multi-author splits—article metadata
cannot redirect funds. Historical source-level receipts and sources without item rows keep their
old path. A post-settlement article delivery failure retains the receipt but cannot enter evidence.

### Settled receipts survive paid-resource delivery failures (2026-08-05)
A creator payment can finish before Keryx reads IPFS, refreshes a cache, writes a database row, or
produces the paid response. A failure in that later work used to return HTTP 500 without the Circle
receipt, so the browser conservatively retained an already-confirmed debit as `pending` forever.

The seller wrapper now attaches its valid `PAYMENT-RESPONSE` to post-settlement 5xx responses.
Both browser co-sign and treasury-funded buyers check that proof before HTTP status and pass a typed
settled-delivery failure to the orchestrator. The treasury transport continues using Circle's
official batching signer, but reads the paid response itself because the SDK's high-level `pay()`
throws away response headers on non-2xx. Keryx records the settled creator payment and consumes its
budget, but skips unavailable fetch content so it can never become citation evidence; the rest of the answer
continues. Citation rewards whose acknowledgement fails after settlement remain paid and eligible
for the existing settled-only creator notification. No signature or bearer authorization is
persisted.

### Provider outages survive the worker that observed them (2026-08-04)
Production kept recording DeepSeek `decide` and `synthesize` failures with no circuit skips even
after the per-step circuit fix. The missing boundary was the process itself: every normal volume
tick launches a fresh one-shot worker, while web and A2A requests run in a different Next process.
The module-level failure streak died with the worker, and the old sixty-second cooldown was always
over before the next autonomous dispatch. Completed answers still settled correctly through MiMo,
but recent dispatches took 100–280 seconds after waiting through avoidable 503s and timeouts.

Circuit state now lives in the shared SQLite/Supabase store under `(provider, reasoning step)`.
Open circuits route directly to the next configured model across workers and deploys. One atomic
half-open probe is admitted after cooldown; concurrent callers keep using the alternate, a failed
probe doubles the cooldown from 30 minutes up to four hours, and only a real provider success clears
the streak. The store fails down to its in-process mirror if persistence is unavailable. Attempt
receipts include the remaining retry delay, while budget enforcement, evidence qualification,
payTo authority and settlement are unchanged. Regression tests model two fresh workers sharing one
database. The previously broken ESLint flat-config override was also attached to the Next config
object that owns `react-hooks`, restoring `npm run lint` with the intended warnings and zero errors.

### One workstation is one caller, not a wallet farm (2026-08-04)
A new opt-in local caller gives the owner's workstation one durable SIWE identity and asks a
current-preview-grounded question every eight to twelve hours. It uses the bounded sponsored web
path, so the process never receives authority to sign recurring x402 charges, and it never sends
Keryx's bot key. The persisted schedule is written before each request to prevent a PM2 crash loop
from repeatedly spending treasury funds.

The durable signing key stays in ignored `.env.local`; the state JSON holds only its public address
and schedule. Existing local state migrates without rotating the actor.

The identity is deliberately non-rotating. Its first completed run can add one identified external
actor; its second makes that same identity returning. Later runs add honest usage, not actors. A
different key per tick would make the dashboard move, but it would describe wallets manufactured by
Keryx rather than independent people or agents.

### Node 24 no longer turns every pinned feed request into an invalid IP (2026-08-04)
Keryx validates every DNS answer for a creator-supplied feed and pins the actual socket to one of
those public addresses. After the VPS moved to Node 24, family autoselection began asking the custom
lookup callback for `all: true`; the callback still returned Node's older single-address shape.
Node read that result as `undefined`, so all twelve real feeds failed before opening a connection.

The pinned lookup now returns the address-array form Node 24 requires while retaining the legacy
single-address form. It does not fall back to unpinned DNS, so the SSRF/DNS-rebinding defense stays
intact. Refresh errors now retain Undici's immediate transport cause instead of reporting only
`fetch failed`. Regression tests cover both callback contracts, and a no-write live probe fetched
and parsed all 12 production feeds successfully.

### The background agent asks what the corpus can answer (2026-08-03)
The autonomous question generator sampled tags across the entire registry. Those combinations
sounded realistic but repeatedly asked for claims absent from every item Keryx could buy: recent
runs on CCTP, account abstraction and agent toolchains correctly finished with zero evidence. That
behavior created useful gaps occasionally, but as the default it paid access tolls without giving a
creator a fair chance to earn a citation and pulled the evidence-grounded claim rate to 33%.

Normal background ticks now rotate through active, ownership-verified sources and seed one question
from that source's current free titles and summaries. A deterministic vocabulary gate rejects an
adjacent-topic completion and falls back to a title-anchored question; paid content is never exposed
to generation. A configurable 10% exploration slice still samples broad registry themes for honest
`/wanted` discovery. Normal provider failures use only the corpus-aligned fallback bank. All daemon
traffic remains first-party, so none of this can manufacture Independent usage or returning actors.

### A provider can be healthy for one reasoning step and unhealthy for another (2026-08-03)
The live receipt log showed 20 failed `decide` attempts across twelve runs and roughly 1.57 million
milliseconds in that step, while the watchdog reported zero circuit skips. The circuit was keyed
only by provider: a successful small `decompose`, `sufficiency` or `reevaluate` call erased the
failure from the much larger all-source decision payload. A second state bug deleted transient
failure counts below the threshold at the beginning of the next call, so the default two-failure
circuit could not open at all.

Circuit state is now process-wide per `(provider, reasoning step)`. Repeated decision failures can
temporarily route only `decide` to the next configured model while the same primary keeps serving
the steps it handles well. Sub-threshold failures accumulate until that step succeeds; cooldown
still permits a half-open probe, hard configuration errors still open immediately, and circuit
skips remain explicit in each receipt and `/status`. No payment or evidence authority moved into
the resilience layer.

### Failures rotate providers before they multiply latency (2026-08-03)
The first production window after multi-provider failover proved the recovery path but exposed its
cost: 21 failed provider attempts across 82 samples, eight reasoning steps saved by the alternate
model, no heuristic fallbacks, and an independent-dispatch p95 of 83.66 seconds. Retrying the same
primary before crossing providers was spending wall clock on the path that had just failed.

A configured alternate model provider is now the retry. A transient 429, 5xx or network failure
crosses to it after one attempt; only the last real provider before the heuristic keeps the local
three-attempt budget. A deployment with one provider therefore retains its existing resilience,
while a deployment with several independent transports rotates through them without serially
exhausting each one. Timeout, circuit-breaker and sanitized per-attempt telemetry behavior stays
intact, as do every budget, evidence and settlement invariant.

### Reasoning now fails across providers, not straight into a heuristic (2026-07-31)
Production's six-hour outcome window showed four of six dispatches losing at least one reasoning
step to the deterministic fallback even though live probes confirmed both DeepSeek and MiMo were
answering. The resilience wrapper retried DeepSeek, then skipped the healthy second provider and
went directly offline.

The default chain is now credential-aware: Anthropic → DeepSeek Flash → MiMo V2.5 → heuristic.
A picked model leads the same chain without repeating itself. Provider requests abort after a
configurable 60-second deadline; a full timeout crosses providers immediately, while faster
transient failures may retry. A process-wide circuit stops later dispatches waiting through
a repeatedly dead tier (two exhausted calls, sixty-second cooldown by default; hard 4xx failures
open immediately).

Each run now carries bounded attempt telemetry for every reasoning step—served engine, tier,
attempt, latency, outcome and sanitized error category/status. Provider response bodies are never
persisted. The dispatch watchdog and `/status` expose provider failures, circuit skips, steps saved
by cross-provider failover and which engine actually served them. The payment path is unchanged:
the orchestrator still owns budget enforcement, evidence qualification, payTo validation and
settlement.

### Independent demand now leads the ledger (2026-07-30)
The public ledger now presents outside web, MCP, and A2A use as “Independent usage,” with Keryx's
own volume labeled “First-party agent activity.” Both buckets remain visible in a compact usage-mix
strip, but the provenance explanation now lives in an accessible tooltip instead of competing with
the primary KPI. Settlement totals and origin classification are unchanged: Arc proves the
payments, while the retained split explains who initiated the demand.

### Browser co-sign sessions are identities again, and every advertised brief stays offerable (2026-07-30)
The co-sign ask route no longer treats a public wallet address as bearer authentication. Before it
exempts a request from the anonymous treasury tier or emits a sign-request id, the active SIWE
wallet must match both the requested session and the persisted grant owner. Disconnecting an SSE
request now cancels its pending pre-signature slot immediately, so an unused cap reservation is
released without waiting for the thirty-second signing timeout.

The shareable wanted page and scoped feed judge could advertise up to 1,600 live claims from the
400-dispatch window, while final registration revalidated only the top 400. A lower-ranked creator
brief could therefore pass the BUY judge and then be rejected as outside the window. All three
surfaces now share the same four-claims-per-dispatch detail horizon, with a regression covering a
live claim ranked below the condensed board cutoff.

### Every wanted claim is now a shareable creator brief (2026-07-29)
Each open or recently filled demand gap now has a canonical `/wanted/[gapId]` page with the measured
coverage, recurrence count, failed dispatch receipt, current creator offers, and a banknote-style
social card. A creator can share or open one exact brief, paste an RSS feed, and ask the same
BUY/SKIP judge about that claim alone instead of scanning the whole board. Open and filled brief
URLs also enter the sitemap.

The narrower handoff does not narrow the safety checks. The scoped feed probe resolves the opaque
id against a freshly rebuilt board and refuses a stale or filled claim. Registration still re-reads
the RSS payload, independently matches the selected post, verifies source ownership, and applies
the durable offer quotas before anything can enter the treasury queue. The page calls the offer
what it is: an invitation to one bounded testnet retry, not a guaranteed bounty. Only qualifying
evidence plus a real settled citation can mark it fulfilled.

### Treasury-funded entry points now admit the funded unit, not just the HTTP request (2026-07-29)
Wanted-claim offers are independently matched against the selected feed preview at registration,
atomically limited to one offer per gap and verified owner across sources/posts, and capped at five
offers per wallet per day. Remote MCP rejects batches containing multiple `research` calls, closing
the equivalent one-request-to-many-spends path.

The shared public-fetch guard now recognizes hexadecimal IPv4-mapped IPv6 addresses before applying
private-network rules. The testnet onramp also distinguishes a pre-broadcast send failure from an
unknown receipt after broadcast: only the former (or a confirmed revert) releases the reservation;
an ambiguous transaction returns `pending` with its hash and cannot be retried into a double drip.

### A wanted claim can now become a verified creator payout (2026-07-28)
The feed checker used to stop at “List this feed”: it knew which post matched which open claim, then
discarded both facts during registration. Now every match has a stable opaque claim id and its own
“Offer this post” handoff. Registration distrusts that URL state: it rebuilds the live demand board,
requires the claim to remain open, and requires the selected post to be present in the RSS payload
Keryx itself ingested before it writes an idempotent `gap_intents` row.

The 24/7 volume daemon services those offers before probabilistic gap retries. An atomic lease makes
the queue crash-reclaimable and single-worker safe; only an active, feed-verified source still owned
by the offering wallet can be leased. The retry spends Keryx's existing testnet treasury path, never
the creator or browser session, with a hard $0.05 ceiling, ten-minute lease, and three-attempt bound.
No new escrow, transfer primitive, or payout authority was added.

Most importantly, “filled” is now financial state rather than copy. The offered source must produce
reward-qualified exact-quote evidence for the same semantic claim, final evidence-bounded coverage
must reach 40%, and the citation ledger must contain a real settled leg plus Circle settlement id
for that source and run. Evidence without settlement is `unpaid`; weak evidence is `missed`; a
claim filled while its source waits for verification becomes `stale` without spend; bounded
execution failures are `failed`. `/wanted`, `GET /api/wanted`, registration success, and the public
dashboard expose the queue/funnel without leaking it into traction: offer and fill counts are
separate from external-query KPIs, and simulated payments can never increment fulfillment.

### A citation must carry evidence before it can carry money (2026-07-28)
A live CCTP retry exposed a financial-state bug, not merely a weak answer: re-evaluation correctly
measured all four claims at 0% and synthesis correctly said none of the sources contained the
answer, but an empty `citedMarkers` fallback promoted all 13 gathered sources to citations.
`lastGaps` still held its default zero, so the run called itself High confidence, attribution fell
back to equal weights, and real citation rewards settled to every source.

Synthesis now proposes a claim index, source marker, exact quote and support score for every
citation. `lib/agent/evidence-ledger.ts` validates the claim index and marker, confirms the quote
occurs in content the agent actually read, and requires the marker both inline and in the declared
citation list. Only that intersection can reach attribution and `payCitation`; rejected markers
are removed from the public answer, and public excerpts are capped at 240 characters. A final
coverage pass runs after cache reads and re-evaluation
purchases, then each claim's public coverage is capped by its strongest reward-qualified evidence.
No evidence means Low confidence and an unspent citation pool, while access tolls already settled
remain valid. If that final assessment fails, answer delivery continues but citation rewards fail
closed.

The evidence ledger is persisted on `QueryRun`, shown on dispatches, and returned in Remote MCP,
A2A and OpenAI-compatible structured receipts. Invalid attribution can no longer name a new payee;
it falls back only inside the evidence-qualified set. Citation rewards are allocated across sources
and authors in integer micro-USDC. Regression tests cover the production CCTP shape, fabricated
quotes, oversized excerpts, missing citation legs, final-assessment failure and attribution
redirection. Dashboard evidence metrics use nullable scalar counters rather than loading every
receipt; historical rows remain explicitly unsampled.

### The agent was learning the wrong lesson from its own history (2026-07-27)
Cross-query memory summarises past runs into the `decide` prompt so a buy/skip call knows how a
source has actually performed. Read against the live log, what it was telling the agent was wrong in
two ways that both pushed the same direction.

It was **subject-blind**. The `topics` column had been written on all 902 stored runs and never once
read back; a source's hit rate was its citations divided by *every* recent run, whatever the
question. On production data that told the agent Vitalik's blog was cited in 8% of runs and
Stablecoin Ledger in 64% — but the 92% Vitalik "missed" were questions about CCTP and card rails
that his blog has no business answering, while the broad sources scored well by being present
everywhere. The prompt was rewarding breadth and quietly penalising exactly the specialist that
would have answered the question in front of it. Scoring is now scoped to past runs that share
subject vocabulary with the question being asked, reusing the archive's own tokeniser so a stored
`transfers` still meets a freshly-stemmed `transfer`.

And it kept **only positive evidence**. Nothing was recorded but citations, so "this source was read
and quoted" was storable and "this source was read and ignored" was not — the module's own docstring
promised a `cited 0/3` line that no data path could ever produce, and its `totalQueries` counter
incremented in lockstep with `citedCount`, always equal, hiding the gap behind a denominator that
looked real. What gets bought gets cited, and what gets cited gets bought. Runs now record every
source they read, cited or not, and save that record even when the run cited nothing at all.

The denominator is deliberately *runs that read the source*, not *runs where it was listed*. Counting
a skipped source as a miss would let one skip justify the next and condemn a newly listed source
before it was ever tried — so a source simply absent from the summary is stated as absent, not as
failing. Two calls came from measurement rather than taste. Backfilling the new column from
`payment_events` looked easy and is impossible: 4,819 distinct run-source pairs were cited but only
2,085 were ever paid a fetch toll, because 57% of reads are cache hits that leave no payment row —
a backfill could recover reads that ended in a citation and almost none that didn't, rebuilding the
exact bias being removed. Historical rows are therefore skipped rather than guessed at, and the
summary stays silent for the few runs it takes to earn a real one. And requiring *two* shared topic
tokens instead of one cleanly killed a homonym (`prune tomato plants` binds to runs about pruning
chain state) but also silenced short questions squarely on subject — "how does x402 settle a
per-request toll" shares two tokens with exactly one past run out of 400. A missing record costs the
decision more than a weak one, so the floor stays at one token and the scoring window is filled by
overlap strength instead, letting close matches crowd out coincidental ones where a subject is well
covered.

Verified end to end on a real dispatch: the run recorded 8 sources read against 5 cited, and the next
question on that subject drew `Recalled 5 past runs`, a summary carrying both `cited in 4 of 6 runs
that read it` and `read in 1 run on this subject, never cited`, and decide rationales that cite the
subject-scoped reputation back (`high reputation (★★, 30/100)`). 475 tests.

### Circle confirms the payouts Keryx claims it made (2026-07-26)
Every payout figure on the site came from Keryx's own database, which is a weak proof for the one
claim the product rests on. Citation rewards settle inside Circle's Gateway, so their receipt is a
Circle transfer id rather than an EVM hash: of 7,893 payment rows, exactly zero carried a hash
anyone could open on ArcScan. Circle answers this itself — its balance API is public and needs no
key — so an hourly watchdog (`npm run check-settlement`) now asks it, wallet by wallet, what it
holds for every payee Keryx has ever paid, and publishes both numbers side by side on `/status` and
on each creator page, with the `curl` to run. The first sweep confirmed 20 of 22 wallets, several to
the exact micro-USDC.
The invariant is deliberately one-directional: only a claim *nothing* accounts for is a finding. A
wallet holding more than Keryx booked is the creator's own money — deposits, or payouts from any
other x402 service that pays that address — and never alerts. Two subtleties came from the data
rather than the design. Circle rejects more than 20 depositors per request, and because a rejected
chunk marks its addresses unknown, one address over the line blanked the entire first production
run (correctly claiming nothing, but proving nothing either). And the two wallets that came up
short, by $0.046 and $0.061, turned out to be holding exactly that money in their own wallets
on-chain: a Gateway balance belongs to its owner, who may cash out through Circle's CLI or anything
else that signs for them, and only this app's own withdraw leaves a row here. A shortfall now gets a
second reading against the wallet's on-chain balance, and money that merely moved to its owner is
reported as a cash-out — counted apart from what Circle confirms, since the Gateway plainly is not
holding it.

### A second house in the picker: Xiaomi MiMo (2026-07-26)
`keryx:mimo-v2.5` and `keryx:mimo-v2.5-pro` join the catalog — the first models here served by a
provider other than DeepSeek, on their own credential
([`https://api.xiaomimimo.com/v1`](https://mimo.mi.com/docs/en-US/api/chat/openai-api),
OpenAI-compatible, JSON mode confirmed against both wire names before a line was written). Verified
end to end, not just credentialed: a real dispatch on V2.5 Pro ran the whole chain — decompose,
decide, re-evaluate, synthesize, attribute — and recorded itself as `llm:mimo:mimo-v2.5-pro`, the
label the resilience layer only grants when that model actually served every step.
Adding a provider meant first removing the assumption that there was only one. DeepSeek's key and
host were written out in three places — the picker's availability filter, the engine builder, and
the hourly watchdog — so a second provider would have had to be added to all three, and whichever
one got missed would have failed exactly the way this codebase least wants: silently, by answering
from a working model while every log kept naming the one the asker picked. They now share
`lib/llm/provider-endpoints.ts`, whose null-for-uncredentialed result is what keeps the picker
honest: a model the box has no key for is never offered rather than offered and quietly degraded.
Two consequences fall out of doing it properly. A non-default pick now falls back to *this box's*
default chain rather than to DeepSeek by name, so a deployment credentialed for one provider only
still degrades to something it can actually reach. And the watchdog probes each model through its
own provider's credentials — probing all four with one key is precisely how a second provider's
outage would have looked like a healthy box. `npm run check-llm` → 4/4 answering. The default stays
DeepSeek Flash: it is the tier every other pick falls back onto, and that is not a job for the
credential that is optional. 447 tests.

### "Would Keryx buy your feed?" — the demand board answers back (2026-07-26)
[`/wanted`](https://keryx.cc/wanted) tells a writer what the corpus is missing and then leaves them
to work out whether any of it is theirs. Now they can ask: paste an RSS URL and the agent reads the
feed and returns the same verdict it would give the source on the money path — **BUY or SKIP**, its
own rationale, and the open claims it expects the posts to address. No wallet, no signature, nothing
stored; the feed is read for the length of one request. `POST /api/wanted/match`.
Getting to an honest answer took discarding two that looked right. **Word overlap** between claims
and posts, measured against the live board and eight real feeds, produced its best pairs by matching
*"Caching reduces bandwidth and latency costs"* to a post about a Philippine bank's stablecoin pilot:
shared vocabulary between a ten-word claim and a 280-character summary is not evidence, and no
threshold separates the two — strict returns nothing, loose returns nonsense. Then **asking whether
the previews *support* the claims** (the `sufficiency` step the board is built from): the model
answered honestly and answered 0.2 to everything, including for a feed that genuinely covers the
subject, because a title and a summary never support anything — that is the entire reason the agent
pays for the full text. The question that works is the one the agent actually asks about a source it
has not read: `decide`. The feed is presented exactly as discovery presents a listed source (four
recent items, `- title: summary`), which surfaced a bias worth recording — an earlier cut labelled the
candidate *"Unlisted RSS feed"* in its description, and the agent duly held that against it in its
rationale, a penalty this check had invented for a fact the money path never sees. It now carries the
feed's own blurb, and the verdicts sharpened accordingly: an on-topic feed goes BUY at 0.9 expected
value naming x402 and per-citation settlement, general crypto news goes SKIP *"none of the subClaims
about CCTP, EIP-712, sub-cent USDC"*. Two guards on what gets shown: claim indexes outside the list
are dropped (a hallucinated one would put a stranger's claim in front of a writer as their own), and
a target list covering more than half the board is dropped whole — offered forty claims production
named thirty-six, which is the agent saying "broadly relevant", not "these ones", and printing it as
a shortlist would send someone off to work on all of it.
Because the caller now picks an address this server connects to, `lib/net/public-fetch.ts` resolves
every hop before the socket opens and refuses loopback, RFC-1918, link-local (`169.254.169.254` is
the reason this exists), CGNAT and their IPv6 equivalents, checking *every* address a name answers
with rather than the first, and unwrapping IPv4-mapped IPv6. Its one residual is stated in the file:
a record that changes between our lookup and the socket's is not stopped by this. Rate limit is a new
IP-keyed tier (6/min), tighter than public reads because each call is both an outbound fetch and a
reasoning call. A verdict reached without a model is labelled *word overlap (reasoning offline)*
rather than dressed up as the agent's. `/register?rss=` prefills the feed, so a verdict leads
straight into listing. 441 tests.

### The model picker no longer offers models it cannot serve (2026-07-26)
The hourly reasoning watchdog reported 7 of 8 models returning 403 — not a bad key, a dead account:
three said *"your subscription payment is past due"*, four *"this model requires a subscription"*. From
production run labels the open-weight tier last answered **2026-07-24 01:08** and was falling back by
**2026-07-26 00:10**. Nothing was broken in the demo path, which is the uncomfortable part: the
default tier answered throughout, the two affected runs were correctly stamped
`deepseek-v4-flash (fallback from llm:ollama:kimi-k2.7-code)`, and the watchdog fired exactly as
designed — *"7 reasoning models unavailable (default tier is fine)"*. The system degraded honestly and
kept working. But a picker offering eight models where seven answer only by silently becoming a ninth
is a promise the product cannot keep, so the Ollama Cloud tier is withdrawn rather than left on the
shelf. Owner's call: no intention of paying that bill.
The catalog is not down to one, though — checking rather than assuming turned up that
`deepseek-v4-pro` was routed through Ollama while **DeepSeek's own API serves it** on the key the box
already has (`curl https://api.deepseek.com/models` → `deepseek-v4-flash`, `deepseek-v4-pro`). It was
re-pointed, so two real models remain. That re-pointing had a trap worth naming: a `deepseek`-provider
pick was built as a bare `OpenAICompatibleEngine()`, which falls back to `config.llmModel` — so V4 Pro
would have run **Flash** while every log named it Pro, the exact mislabelling `effectiveName` was
added to prevent. Non-default picks now pin their wire model explicitly. The six withdrawn ids all
still resolve, onto the workhorse: a public id is a contract, and one of them may be sitting in a
saved widget embed or someone's API client. `OLLAMA_API_KEY` / `KERYX_OLLAMA_BASE_URL` are gone from
config; the picker and `/api/v1/models` were already data-driven off the catalog, so both narrowed on
their own. 413 tests.

### The demand board pays out: Keryx re-asks what it missed (2026-07-26)
[`/wanted`](https://keryx.cc/wanted) published the holes; a board nobody returns to is a wishlist.
Now the agent goes back. A slice of volume-engine runs (`KERYX_ENGINE_GAP_RETRY_RATIO`, default 25%)
re-asks a question the corpus was paid for and left under-covered — a full dispatch at the normal
budget, buying whatever is new and paying whoever wrote it — so a creator who lists a feed against an
open claim does not have to wait for a reader to happen by. Two lists now: what is still wanted, and
what got **filled**, each filled row naming the sources that dispatch paid and linking the trace.
Everything hard here is in the guards, because a retry costs real USDC. It fires only when content
has arrived since that question failed — and "arrived" had to mean two things, not one: a new post
shows up as a publication date, but a *newly listed source* does not, since an established blog's
posts are all back-dated, so registration day counts too. That was the case the whole feature exists
to serve and the naive version would have missed it entirely. Dates after now are ignored, because
feeds do stamp items ahead of time and one such item would sit above every dispatch forever, making
every gap permanently retryable. A retry that fails pushes the gap's own date past the content, and
one that succeeds takes it off the open list, so a gap stops being eligible on its own either way —
except when the retry measures *nothing* (heuristic fallback, truncated reply), which records neither
and would have let the engine re-ask that one question every tick for as long as the reasoning
provider stayed down; a retry ledger keyed on the question text closes that. The honesty rule that
matters most: **a retry is not demand.** It is a real paid dispatch and it can genuinely close a
hole, but it is Keryx arriving, not a reader, so it never adds to the recurrence count — otherwise
the board would inflate the very holes it chose to re-test, and the "asked 11×" that makes a claim
worth writing about would partly be the agent talking to itself. Filled requires the covering
dispatch to postdate the *last* miss: coverage regresses, and a fill from before the most recent
failure proves nothing about today. Also in `GET /api/wanted` as `filled` (OpenAPI updated).
`lib/demand-retry.ts`, `lib/demand-signal.ts`, 35 tests.

### The corpus now publishes what it could not answer (2026-07-26)
Keryx knows something a search engine does not: not what people looked for, but what they **spent
money on and did not get**. Every dispatch breaks its question into sub-claims and scores, per claim,
how well the sources it bought actually covered each one — and that score was being written to the
trace and read by nobody. [`/wanted`](https://keryx.cc/wanted) publishes it: the claims real paid
dispatches finished short, worst and most-recurring first, each linking to the dispatch that proves
it. For a creator weighing whether listing a feed is worth the trouble, that is the difference
between a guess and a market signal — demand already proven, supply missing, with a receipt. Sampled
across 14 consecutive production dispatches: 14 carried coverage data and 19 claims finished under
40%, among them "the agent must learn from past spending outcomes", "fintechs integrate USDC via
APIs to facilitate instant settlement", "agreement among authors is necessary for a fair split".
The honesty rules do the real work here, because the page asks people to write something on the
strength of it: a run carrying **no** coverage assessment (an older run, or one answered by the
deterministic fallback) is skipped entirely rather than counted as a failure — absence of
measurement is not evidence of absence; the run's **last** assessment wins, since coverage is
re-scored as the agent reads and the early checks legitimately read 0 before anything is bought; and
identical claims across dispatches collapse into one line carrying the worst coverage but the
freshest date, so a reader learns the hole is still open rather than when it first appeared. An
earlier cut grouped gaps into keyword topics the way the archive groups questions and the facets came
out as "reduce", "guide", "time" — sub-claims are sentences, so their tokens describe grammar as
often as subject. The claim itself is the unit; nobody can act on "time". Two things the live board
taught within the hour: the engine re-decomposes every question from scratch, so one hole arrives as
a family of near-identical sentences ("…transfer USDC *between* domains" / "…*across* domains" were
two rows) — merging on the claim's significant vocabulary rather than its exact text turned three
gaps shown as six rows into three, and lifted the top entry to **CCTP burn-and-mint, 11 dispatches
at 0% coverage**. That merge is equality on the token set and never a similarity threshold, because
"reduces fees" and "increases fees" overlap on nearly every token and mean opposite things. And
since anyone can ask anything through the front doors, "Hi" decomposed into a sub-claim no source
covered and reached the board twice; a claim carrying fewer than two subject words is now dropped as
describing nothing anyone could write. Also public as `GET /api/wanted` (in the OpenAPI spec),
linked from the registry and the nav, in the sitemap. `lib/demand-signal.ts`, 15 tests.

### A cached copy stops being free once the source has moved past it (2026-07-26)
Found by the panel built the same day, on its first look at real production data: one source had been
weighed in **396 dispatches, read 383 times, and bought zero times.** `cache_items` holds one blob per
source with no expiry, so "never charge a creator twice for the same text" had quietly become "never
pay that source again" — and, worse, answers were being synthesized from copies taken before every
post those feeds have published since, while the freshness note on the archive was telling readers
those same sources had moved on. Feed refresh (2026-07-24, +79 posts) had widened the gap without
anything noticing. Measured precisely on the live corpus: of 20 sources, the 8 that never went stale
are **static seed sources with one or two fixed items** — they publish nothing, so a permanent cache
there is correct and no toll is owed. All 12 real feed sources carry dated posts, and those are the
ones that were being read stale and for free. The rule now is the
narrowest one that fixes both halves: **a cached copy is a free read until the source publishes
something newer than the copy.** Nothing expires on a timer — a quiet feed's cache stays valid
forever, because nothing about it has changed — so the cost is self-limiting at one fresh toll per
source per batch of new posts, not one per dispatch. Staleness is resolved at the *decide* step, not
at fetch time: a stale CACHE becomes a BUY before the fetch-budget reservation, so a forced re-read
is capped like any other purchase and turns into a SKIP when the budget can't cover it — converting
it later would have settled a toll the budget never accounted for. Date handling is deliberately the
same as the archive's freshness note (shared `clampedNewest`): publication dates only, future dates
ignored so one bad timezone can't force a re-buy every run, undated items never counted.
`lib/agent/cache-freshness.ts` + `getCachedAt` on both DB adapters; 13 tests, three of them driving
the real orchestrator to prove the money invariant still holds. Verified in production on the first
dispatch after deploy: Simon Willison's Weblog (copy 2026-07-24 06:46, posted 07-25 00:42) and
Latent.Space (copy 07-24 15:45, posted 07-25 07:25) each earned a fresh toll, while Hugging Face and
the Ethereum Foundation Blog — neither of which had published since their copies — stayed free.

### A source can now read why the agent passed on it (2026-07-26)
A creator page could say what a source earned; it could never say why. The answer was already
written down — every dispatch records a reasoned buy/cache/skip for each candidate with a rationale
in plain words ("weak match (no key terms); not worth 0.004 USDC") — but scattered across hundreds of
permalinks nobody was going to read hunting for their own name. The new panel does that reading per
source: how often it was weighed, chosen, cited and passed across the recent dispatch window, the
median expected value on each side of the choice, and the last four skip rationales **verbatim**,
each linking to the dispatch it came from. One comparison line carries the weight: the median listed
price of the sources the agent *did* choose in the very runs that passed on this one — same question,
same budget, same minute. No advice is rendered anywhere. Price and preview depth are the creator's
dials; the honest input to using them is the comparison, not our coaching. Cache hits count as
choices, since on a warm corpus most reads are cache hits and a BUY-only bar went null on the
majority of runs — the wording therefore says "chose", never "paid". A source the window never
weighed renders nothing rather than a row of zeros. Public, like the traces it aggregates:
`GET /api/creator/{id}/performance` (in the OpenAPI spec), `lib/creator/source-performance.ts`,
12 tests.

### Something now watches what the agent did, not just whether the models answer (2026-07-25)
The watchdog written this morning asks every provider a question and alerts when one cannot answer.
It would have caught the first half of the outage and slept straight through the second: once the
models were restored, the agent still bought nothing for hours, because the decide reply had
outgrown its token ceiling. A probe proves a provider *can* answer. It cannot prove a run *used* the
answer — and the run is what creators get paid for. So the second watchdog reads the agent's own
recent dispatches instead, where nothing can be claimed that did not happen: **five failure shapes,
each one something that has or could have gone silently wrong.** Nothing dispatched at all in the
window (that is the daemon, not the agent). Runs answered outright by the deterministic fallback —
the label each run now earns makes this countable. Most runs losing at least one step to it, which
is a provider answering unreliably rather than cleanly down. Every run recording no decision, the
signature of decide being handed nothing to reason about. And a window in which no creator earned
anything at all. That last one is the load-bearing check, and it works because citation rewards
settle even when the content came from cache: a window that pays nobody cited nobody, which is the
shape of a broken decide step, not of an agent shopping frugally. The restraint matters as much as
the alarms — a window under three runs proves nothing and stays quiet, a box with no model
credentials is *supposed* to answer from the heuristic and is never accused of an outage, and a run
with no engine label is counted as neither model-reasoned nor heuristic, because laundering the
unvouchable ones into the good column is exactly the failure this replaces. The verdict lands in
`sync_state` and renders on [`/status`](https://keryx.cc/status): the last six hours as they really
were, sitting directly beneath the `reasoning: deepseek` row that stayed green throughout the
outage. `lib/ops/dispatch-health.ts` + `scripts/check-dispatches.mts`, hourly at :50; 12 tests, two
of them replaying the exact windows of 2026-07-25. First production run: 5 dispatches, 5
model-reasoned, 5 paying, $0.107 to creators — no alarms.

### The agent had stopped reasoning, and everything said it was fine (2026-07-25)
Found while pulling live figures for a traction post: **every reasoning step in production had been
failing and falling back to the deterministic heuristic.** DeepSeek retired the `deepseek-chat` wire
name — the default tier *and* the tier every other model pick falls back onto — so decompose, decide,
sufficiency, synthesize and attribute were each returning HTTP 400 and dropping to the offline
engine. Runs still completed, still cited, still settled real USDC. Nothing anywhere said otherwise:
`/api/health` reported `reasoning: deepseek`, and every dispatch was stamped
`llm:deepseek:deepseek-chat` on its permalink, in the archive and in the API response. Resilience
without a watchdog does not prevent an outage; it converts one into a silent quality regression,
which is worse, because the product's whole claim is that the buy/skip decisions are model-reasoned.
Four fixes, each closing a different half of the failure:
- **Wire names now match what the providers actually publish** (verified against both live model
  lists — 8/8 answering). The Gemma pick was broken the same way: the provider serves it only under
  its size tag. Public ids are a contract, so `deepseek-chat` keeps resolving onto its replacement
  rather than silently dropping API callers, saved widget embeds and OpenAI-compatible clients to the
  default.
- **A run is labelled by the engine that answered it.** `ResilientEngine` tallies which tier served
  each step: the pick when it answered, `heuristic (fallback from …)` when nothing it produced
  survived, and the middle tier by name in a chained fallback. Engines are no longer cached across
  runs — per-instance tallies would blend concurrent askers — which costs a few field assignments.
- **A truncated reply fails instead of reading as a decision.** With the model restored, the agent
  bought *nothing*: the corpus had grown to 20 sources and the decide reply no longer fit the flat
  2048-token ceiling (measured: `finish_reason=length`, 2048/2048 completion tokens, unparseable
  body), and truncated JSON parsed to an empty object, which the orchestrator read as "nothing was
  worth buying" — a trace that looked like a deliberate frugal choice while every source earned zero.
  Both transports now throw on a ceiling stop with a retryable status; the steps whose reply scales
  with the corpus ask for a ceiling sized to the item count; and `decide` refuses outright to turn an
  empty reply into a decision while candidates were on the table.
- **An hourly watchdog** (`npm run check-llm`, cron at :15) probes every credentialed model with a
  real `decompose` call through the same engine the agent uses. A default-tier failure alerts loudly;
  a broken alternative pick, which still degrades to a real answer, is reported without the alarm.

Verified end-to-end on production: all 8 models answering, and a real dispatch making 20 model-reasoned
decisions with specific rationales (4 CACHE / 16 SKIP), 2 citations, $0.02 settled to creators.
17 new tests. Two dispatches between the first and third fix (08:37 UTC) recorded zero decisions and
zero spend — they are real runs that bought nothing, and are left in the log as they happened.

### An archived answer now says whether it still stands (2026-07-25)
A dispatch is a finished record: it read what its sources held that minute, paid for it, and
stopped. The sources kept publishing, and nothing in Keryx noticed — a two-week-old answer read
exactly like one minted five minutes ago. With ~450 answers in the archive and search as the way
strangers arrive, staleness was the corpus's one real quality problem. Every permalink now carries
the provable half of that question: **how many posts have the sources this answer cited published
since it settled**, with a re-ask that buys the new material (and pays those creators again). It
never claims the new posts *change* the answer — deciding that means buying and re-reading them,
which is the reader's money to spend, not our guess to make. The wallet's own ledger at `/me/asks`
carries the same signal per row, from one query for the whole page rather than one per dispatch.
The care is all in what the note refuses to say: a source with **no feed** is one Keryx never
re-reads, so its silence is ignorance rather than evidence and the note stays away entirely — only
sources Keryx actually polls can support a "nothing new since" claim, and when only some of them do,
the note says which fraction. Sources that are **delisted or unverified** drop out of both the count
and the denominator, because a re-ask could not buy from them anyway. Posts dated in the **future**
are ignored (feeds do get timezones wrong, and one bad date must not pin an answer to "stale"
forever), and undated posts never count, since they cannot prove they are new. Ingest now normalises
every feed date to ISO — these comparisons are lexicographic, and one RFC-822 date sorts above every
ISO string, which would have read as newer than every dispatch ever settled. `lib/answers-freshness.ts`
plus two indexed adapter queries (`countItemsPublishedBetween`, `newestItemDates`, migration `0018`
+ a matching SQLite index); 26 tests. Verified against a production build on real data: a dispatch
whose cited blog published 3 posts shows the count and its re-ask, a dispatch whose watched source
has been quiet shows "still current", and one citing only feedless sources renders no note at all.

### Public pages are cacheable again — one `headers()` call was making the whole site dynamic (2026-07-25)
`/answers` declared `revalidate = 600` and had been ignoring it for as long as it existed: every hit
re-read 600 runs, rebuilt the archive, and re-rendered ~450 cards, at ~1.6–2.0s TTFB. So did every
dispatch permalink, `/sources`, the landing page — even `/privacy`, which has no data at all. The
cause was one line in the root layout: it read `headers()` to seed wagmi's wallet state from the
request cookie, which opts *every page under that layout* into per-request rendering. It bought
almost nothing — the header's real state is the SIWE session, which is fetched client-side anyway,
so the server never rendered a signed-in header regardless. Wallet connection is now restored on the
client from the same cookie storage, and the menu shows a neutral chip while wagmi reconnects
instead of flashing "Connect Wallet" at a returning visitor. A side effect worth naming: the shared
HTML no longer embeds *any* visitor's connection state, so a cached page can't describe the wrong
person. Every page that reads the database was then given an explicit rendering mode rather than
inheriting one: the archive, its topic hubs and `/sources` revalidate every 10 min, dispatch
permalinks hourly (a settled dispatch is a finished record; only follow-ups and related links move),
and `/creator/[id]` is pinned per-request on purpose — an owner opens it seconds after registering,
where a cached miss would hold a 404 for the whole window. Dynamic-param routes also needed
`generateStaticParams` before Next would honour `revalidate` at all. Verified against a production
build: `/answers` and each topic hub serve `s-maxage=600` cache hits, permalinks `s-maxage=3600`,
`/privacy` fully static, `/creator/[id]` still `no-store`, and no hydration mismatch on any page.

### The answer archive is browsable: instant filter + topic hubs (2026-07-25)
The archive is the organic on-ramp — people find a Keryx answer in search, then ask their own — but
it had grown to hundreds of answers presented as one flat list with no way in. A visitor after
"settlement" had to scroll past everything about compost. Two additions fix it without giving up the
thing that makes the page work (every card server-rendered, crawlable, no JS required to read it).
**A filter box** narrows the list as you type, matching question text and cited source names; the
cards stay server-rendered and the match strings are built on the server, so filtering is a pure
render with nothing to keep in sync and no second copy of the corpus shipped to the browser. With
JS off the box does nothing and the full list still reads exactly as before. **Topic hubs** at
`/answers/topic/[slug]` are real pages, not client-side filters: a crawler and a reader without JS
can both follow them. Topics are derived from the questions themselves — a token that appears across
enough distinct questions *is* a beat this corpus covers — so the set grows with the archive instead
of rotting like a hand-maintained category list, and the extraction is deterministic so a topic's URL
never drifts between rebuilds. Tokens that would return most of the corpus are dropped (a facet that
narrows nothing is not a facet), plurals fold onto their singular, and topic pages join the sitemap.
`lib/answers-topics.ts` (11 tests); the shared answer card moved to
`components/keryx/archive-answer-row.tsx` so the archive and every topic page can't drift apart.
Verified in a real browser: 19→12 cards on "stablecoin" with the counter agreeing, empty state on a
no-match query, full list restored on clear, and a chip navigating to a hub that renders its 8
answers.

### A wallet can finally see what it dispatched — and what those tolls paid for (2026-07-25)
Keryx had a management desk for the wallet that *earns* (`/me/sources`) and nothing at all for the
wallet that *pays*: a dispatch existed only at its permalink, so losing the link lost the receipt,
and there was no way to answer "what have I spent, and who got it?". Dispatches are now attributed
to the wallet that ran them — read from the server-verified SIWE cookie, never from a client-supplied
field, so nobody can write into another wallet's ledger — and `/me/asks` presents them: every
question, its toll, its confidence, and the creators the money actually reached, each one a link to
that creator's page. The summary strip keeps **own spend apart from free-trial dispatches**: a
signed-in ask on Keryx's treasury still belongs in your history, but its USDC was never yours, and
totalling the two together would tell a user they spent money they didn't. Anonymous, volume-engine
and A2A runs stay attributed to nobody — none of them has a wallet that proved anything. New column
`query_runs.asker` (+ `(asker, created_at)` index), added by the same `ensureColumns` upgrade path
the live database already relies on, and Supabase migration `0017`. 5 tests, including the
legacy-database upgrade; verified end-to-end against a local offline server (signed-in ask lands in
the ledger, anonymous ask lands nowhere, another wallet's rows never appear, signed-out request 401s).

### Listed feeds no longer freeze at their register-day snapshot (2026-07-24)
Registration ingested a feed exactly once — a creator's blog could publish daily forever and
Keryx would never see a post past register day, so "creators get paid per citation" quietly decayed
into "creators get paid for what they'd written by the day they signed up." Two refresh paths fix
it: the traction daemon now starts every tick with a feed sweep (`npm run refresh-feeds`) over
active + verified sources that list a feed, and `/me/sources` grows a per-row **Refresh feed**
button (`POST /api/me/sources/[id]/refresh`, SIWE owner-gated) for the "I just published — make it
purchasable now" moment. Both paths dedupe by item link against what the DB already holds (the same
rule the registry claim path uses), link-less items are skipped so they can't duplicate on the next
pass, and an unreachable feed writes nothing. The refresh limiter is keyed by source, not caller —
the cost is the outbound fetch of the creator's blog host, so one hot button must not hammer it.
Unverified rows are never crawled: nobody proved they own that feed. First local sweep pulled 17
real posts across 3 feeds that had been frozen since registration. Core in
`lib/ingest/refresh-feed.ts` (6 tests); also retired the `npm run ingest` alias, which pointed at a
script that never existed.

### Creators can reprice and delist their own sources (2026-07-23)
The source lifecycle stopped at register: the registry contract always had creator-signed
`update()` and `deactivate()` (and the indexer already projected both events), but no surface ever
called them — a creator's price was frozen at whatever the register slider said, forever. The
creator page now carries an owner-only **Listing controls** panel: a price-per-read dial and a
two-step permanent delist. On-chain sources stay non-custodial — `GET /api/creator/[id]/listing`
returns the live on-chain record (payout, author splits, tags) so the owner's wallet re-signs
`update()` with only the price swapped, the contract's `onlyCreator` does the real gating, and the
indexer syncs the cache within seconds; a mismatch note warns when the connected wallet isn't the
registering one. Offline/dev sources take the DB-direct `POST` path (price band $0.0001–$0.05,
whole micro-USDC). DB-side writes to on-chain sources are refused outright so the cache can never
drift from the registry and trip the parity watchdog.

### One page to manage every source a wallet owns (2026-07-23)
Per-source settings live on each source's creator page, which worked until bulk import let one
wallet own twenty feeds with no single place to see them. `/me/sources` is that place: sign in and
every owned source (payout or author, deactivated included) lists with earnings, citation counts,
and notify state at a glance, each row linking into its creator page. The bulk bar applies one
citation-alert email to the whole portfolio in a click — same address everywhere, but a fresh
unsubscribe token per source, so stopping one source's mail never stops the rest. SIWE session
only (`/api/me/sources` GET/POST); scripts keep using the existing portfolio export. Linked from
the site nav.

### Creators can get a plain email when they're cited and paid (2026-07-23)
The notify-on-citation loop had one channel: a signed webhook — great for creators who run
software, useless for the writers Keryx exists to pay. Now every source owner can opt into
**citation email alerts** from their creator page: when the agent cites their source and the
reward settles on-chain, they get a short email carrying the question their work answered, the
USDC amount, and links to the dispatch trace and their earnings page. A per-source rate cap
(default one mail/hour, `KERYX_EMAIL_MIN_INTERVAL_MIN`) keeps the 24/7 volume engine from
flooding an inbox, every mail carries a tokened one-click unsubscribe
(`/api/notify/unsubscribe`, constant-time compare, uniform response so ids can't be probed), and
delivery is best-effort fire-and-forget so a mail-provider outage can never stall a run. The two
channels are independent — saving one can't clobber the other — behind the same owner-gated
`/api/creator/[id]/notify` route. Ships dark until `KERYX_RESEND_API_KEY` + `KERYX_EMAIL_FROM`
are set (the panel says so honestly). New table `source_notify_email` (migration 0016),
dispatcher `lib/notify/citation-email.ts`, 9 new tests.

### Seed sources now link to their real home instead of example.com (2026-07-22)
The eight built-in seed sources have no external website — their articles live in the Keryx
datastore — but the public registry (`/sources`) rendered their placeholder `example.com` urls as
outbound links, which read as fake data on an otherwise fully-real page. Their `url` now points at
their `/creator/<id>` page (the source's public earnings-and-proof home), assigned by the seed
script once the row id exists; `scripts/relink-seed-source-urls.mts` backfills existing databases.
On-chain records are untouched — the indexer and parity watchdog resolve rows by stored
`onchain_id`, never by re-hashing the row's url.

### Pick the agent's brain — a chat-app-style model picker with a guaranteed fallback (2026-07-22)
Askers can now choose which reasoning model drives a dispatch, the way any chat app offers GPT vs
Claude: the ask form gained a "Counsel" picker, `/api/ask`, `/api/agent/ask` and the OpenAI-compatible
surface accept a `model` field (`keryx:<id>`), and `GET /api/models` / `GET /api/v1/models` list what's
live. Eight models ship in the catalog — DeepSeek V3 (the default workhorse via the DeepSeek API) plus
seven open-weight options served by Ollama Cloud (GLM 5.2, DeepSeek V4 Pro, Kimi K2.7 Code,
Qwen 3.5 397B, MiniMax M3, GPT-OSS 120B, Gemma 4).

The invariant that makes this safe to expose: **an ask always answers.** Every pick runs inside a
tiered `ResilientEngine` chain — the chosen model retries on transient failures, then falls back to
DeepSeek, then to the deterministic offline heuristic. Unknown or unconfigured ids silently run the
default rather than erroring. The engine name (e.g. `llm:ollama:glm-5.2`) is stamped on each run for
provenance. The volume engine keeps DeepSeek as its workhorse and uses an alternate model on only a
small env-tuned slice of runs (`KERYX_ENGINE_ALT_MODEL_RATIO`, default 10%) so the rate-limited
Ollama account never becomes a dependency. New env: `OLLAMA_API_KEY`, `KERYX_OLLAMA_BASE_URL`.

## v0.6.0 — 2026-07-21 — Ask Keryx from anywhere you already chat

Release wave gathering the work since v0.5.0 (16 commits in 5 days). The theme: meet askers where
they already are, and give creators a real ledger. Three chat front doors went live — Discord
(`/ask`), Telegram ([@keryxai_bot](https://t.me/keryxai_bot)) and Slack (`/keryx`) — each running
the same full reasoning loop and settling the same real USDC citation rewards. Creators gained
per-source and whole-portfolio payout exports; API keys gained scopes and source pinning; rate
limits moved into the DB so a deploy no longer resets them. The agent's confidence verdict now
travels with the answer to every surface, any dispatch can take a threaded follow-up, and the
answer archive became a subscribable Atom feed.

### The answer archive is now a subscribable Atom feed (2026-07-21)
The `/answers` archive grew to hundreds of canonical answer pages, but the only way to see a *new*
one was to come back and look. Now `/answers/feed.xml` is an Atom feed of the newest 60 paid
answers — question, snippet, what was paid to whom — with `<link rel="alternate">` autodiscovery
on every page and a visible subscribe link on the archive. There's a narrative symmetry doing real
work here: Keryx onboards creators by reading their RSS feeds, and now publishes one of its own —
the same door, pointed the other way, so readers, aggregators and other agents can treat Keryx
itself as a source. Selection is identical to the archive page (real cited answers only, one
canonical dispatch per question), so the feed can never advertise a page the site would not stand
behind. Pure builder in `lib/answers-feed.ts` (escaping + structure unit-tested, 6 tests, 259
green); the route is a thin ISR shell on the same 600s cadence as the page.

### Confidence is now a first-class signal on every dispatch (2026-07-21)
The agent already judged its own answer — High / Moderate / Low, derived from how many sources
corroborated it, how many sub-claims were left thin, and how many disagreements it adjudicated. But
that judgement lived only inside the reasoning trace as one step, so nothing outside the trace could
show it: the answer archive, the permalink metadata, the social card all stayed silent on how much
to trust an answer.

`confidence` is now a field on the run. It surfaces as a wax-seal badge on the dispatch permalink
(with its reason), a chip on every row of the `/answers` archive, a line on the live answer card,
and a `High/Moderate/Low confidence ·` prefix in the permalink's `<meta>` description and OG card —
so a search result or a shared link says up front how sure the agent is. A citation-toll agent that
flags "Low confidence" prominently is more trustworthy than one that states everything with equal
certainty; the badge makes that honesty impossible to miss rather than buried a scroll down.

No migration, no recompute: `deriveConfidence()` reads the field when present and falls back to the
trace's verdict step for the ~hundreds of dispatches recorded before the field existed, so every
archived answer shows its badge immediately. A malformed or unknown level reads as "no badge" rather
than surfacing garbage. Early-return runs (no sources, nothing read) label honestly as Low. Shared
`ConfidenceBadge` server component across all four surfaces; `lib/agent/confidence.ts`, 6 new tests
(253 green).

### Follow-up dispatches (2026-07-21)
Every dispatch was a dead end: a reader who wanted "how does that compare to Solana?" had to
restate the whole question on the home page. Permalinks now carry an **Ask a follow-up** box, and
a dispatch shows the thread it sits in — what it followed from, and what followed from it.

The economics are unchanged on purpose: **a follow-up is a full paid dispatch**. It buys sources
and pays creators again. What it inherits from the parent is the *question*, never the *answer* —
feeding the parent's answer back in would let the next dispatch be written from text earlier
sources were paid to produce, no buy, no citation, no payout. `buildFollowUpQuestion()` anchors
"how does that compare?" to the parent question and passes an already-self-contained question
through untouched. The rewrite is deterministic: an LLM round-trip here would add latency and a
failure mode in front of the agent's own decompose step. Its reference detection is deliberately
eager — padding a question that did not need context only re-anchors the reader's own topic, while
missing a real reference produces a question nothing can answer; the tests pin that trade-off
rather than hide it.

The form hands off to the existing ask flow (`?q=…&parent=…&run=1`) instead of growing a second
streaming console, so a follow-up inherits the co-sign session, budget dial and live trace. The
parent id is UUID-validated client-side and re-read server-side; an unknown id degrades to a
standalone ask rather than failing the dispatch. `parent_id` column + index, migration `0015`,
NULL on every existing row — accurate, they were all asked standalone. 247 tests green.

### Scaling + speculative enterprise work dropped (2026-07-21)
Owner decision, recorded on the roadmap rather than left as perpetual "planned": multi-instance
deploy, per-customer registries and the fiat on-ramp are cut. One small VPS is the deployment; a
load balancer in front of it buys nothing, no B2B customer has asked for a white-label registry,
and a fiat on-ramp is meaningless while Keryx is testnet-only. Each row says *why*, so a future
reader can reopen one on evidence instead of guessing.

### Rate limits now survive a deploy (2026-07-20)
The limiters lived in process memory, so every deploy handed every caller a fresh allowance — and
Keryx deploys on every change. The throttled tiers are the treasury-funded ones (anonymous
`/api/ask`, the Discord/Slack/Telegram front doors, the unkeyed A2A endpoint, both faucet valves),
where a reset window costs real USDC. The web process and the traction daemon also kept separate
counts of the same buckets, so the effective limit was whatever the two happened to sum to.

Counters now live in the DB: one row per bucket, fixed window, consumed in a **single statement**
(SQLite upsert with `RETURNING`, Postgres via `consume_rate_limit`). A read-modify-write would
admit both of two concurrent requests on an exhausted bucket, which is the case the limit exists
to stop. `checkRateLimit()`'s signature is unchanged, so no call site moved.

A DB failure falls back to the in-process limiter — degraded (per-process, resets on restart) but
never open. The two faucet routes, which each carried a private `RateLimiterMemory`, now share the
same store. Redis is not needed here: one SQLite file already covers every process on the box.
A multi-VPS deployment would still need a shared store — noted on the roadmap row rather than
claimed as done. `lib/rate-limit-store.ts`, migration `0014`, 5 new tests (234 green), including a
real restart: same DB file, new adapter, counter still spent.

### API key scopes + source pinning (2026-07-20)
A key used to do one thing — identify a caller on the ask paths. Once the earnings export
existed, the same key also read every payout its wallet ever received, so a key handed to a
script that only asks questions handed over the accounts too. Keys now carry scopes: `ask` (run
dispatches) and `export` (read the ledger), plus an optional pin to specific source ids. Calling
outside a key's scopes returns 403 on `/api/agent/ask`, `/api/v1/chat/completions` and
`/api/creator/export`.

Two invariants, both tested: a pin is **intersected with live ownership**, never unioned — a key
naming a stranger's source id gets nothing, and a key pinned to a source its wallet later loses
stops returning it. And a key minted before scopes existed stores NULL, which reads as *all*
scopes: silently narrowing keys that work today would break live integrations. An empty scope
request also mints full power, because a key that can do nothing is a support ticket, not a
security win. Scope picker + per-key scope display on `/dev`; new columns via sqlite backfill and
Supabase migration `0013`. 229 tests green.

### Portfolio audit export, wallet-scoped (2026-07-19)
`GET /api/creator/export?format=csv|json` — every payout across every source one wallet owns, in
one ledger, with a per-source breakdown in the JSON envelope. Authenticated by SIWE session (the
"Download my ledger" link on `/dev`) **or** `Authorization: Bearer kx_live_…`, so both a creator
in a browser and an accounting script are served. Unlike the per-source export this one is
private: merging a portfolio reveals which sources belong to the same person.

Ownership is resolved from the sources (payout wallet or listed author wallet), never from the
payment rows — having once received a split must not grant read access to a stranger's history.
Shared `ownsSource` extracted to `lib/sources/source-ownership.ts` and reused by the preview-depth
and citation-webhook routes, which each carried their own copy. New `db.listAllSources()` includes
deactivated sources: retiring a feed on-chain must not erase what it earned from an audit file.
In OpenAPI. 214 tests green.

### Creator earnings export (2026-07-19)
`GET /api/creator/[id]/export?format=csv|json` — a creator's full payout ledger as a downloadable
file, plus an "Export ledger (CSV)" link on the creator page. The page shows the last 25 payouts;
reconciling a withdrawal or filing the income needs all of them, with the question that triggered
each. Public, like the rest of `/api/creator/[id]`. `settlement_ref` is Circle's settlement id, not
an EVM tx hash — the header says so, so nobody pastes a UUID into arcscan and concludes the payouts
are invented. Amounts render at USDC's 6dp (never exponent form), cells are RFC-4180 escaped, and
any question starting `=`/`+`/`-`/`@` is neutralised so a creator's own ledger can't execute a
formula in Excel. `lib/creator/earnings-export.ts` + 11 tests.

### Three chat front doors: Discord, Telegram, Slack (2026-07-17 → 19)
The highest-friction step for a new asker was leaving the app they were already in. Three slash
commands remove it: `/ask` in any Discord server (public install link, signed interactions POST
straight to the API — no bot process to babysit), a Telegram bot ([@keryxai_bot](https://t.me/keryxai_bot),
webhook-only, answers DMs or `/ask …` in groups), and a `/keryx` command for any Slack workspace
(replies ride the command's `response_url`, so no bot token and no OAuth scopes to grant). All
three run the identical reasoning loop as the web app and settle identical real citation rewards;
each reply links its dispatch trace so the payment claim is inspectable, and each platform's
treasury-funded budget sits behind the shared rate-limit buckets. Setup guides + manifests in
`docs/discord-bot-setup.md`, `docs/telegram-bot-setup.md`, `docs/slack-bot-setup.md`. Discord and
Telegram are live and user-verified in production; Slack ships dark until a workspace app is
created against it.

---

## v0.5.0 — 2026-07-16 — Security closed, registry on-chain for real, and three new front doors

Release wave gathering the work since v0.4.0 (48 commits). The Phase-07 security residuals closed:
every payTo the browser signs is now validated against the on-chain SourceRegistry (server-side
too), the session grant cap is clamped to the USDC the Gateway actually holds, grants persist
across restarts, and the spending key moved into a dedicated Web Worker the page cannot read.
Registry write-mode switched ON: creators register from their own wallet, all twenty prod sources
were backfilled on-chain (including one claimed by its real owner's wallet), an hourly parity
watchdog proves the DB cache honest in public on `/status`, and the indexer now wakes on registry
events over WebSocket instead of hammering a 4-second poll. Three new front doors for external
askers: an OpenAI-compatible `/api/v1` endpoint (any OpenAI SDK works, with a no-install
playground + client recipes), a Chromium MV3 browser extension (highlight-and-ask on any page,
store-ready with privacy policy + listing kit), and a public `/answers` archive (~380 canonical,
search-indexed answer pages that grow with every query). Creator side: an embeddable Ask widget +
"Cited by Keryx" badge + live activity ticker, bulk feed/OPML import, per-source preview-depth
control, session extend without re-signing, and USDC preset chips. The public source catalog
gained opt-in cursor pagination (`GET /api/sources?limit=&cursor=`) that never truncates the
payment allowlist by default. 154 vitest tests green.

---

## v0.4.0 — 2026-07-02 — Agent judgment + creator value loop + ops hardening

Release wave gathering the work since v0.3.0 (63 commits). The agent gained judgment: multi-pass
reasoning with per-claim confidence, adjudication of conflicting sources (trust one side, with a
logged rationale), a self-rated confidence verdict, cross-query memory, and semantic discovery via
embedding similarity. The creator value loop closed: non-custodial cash-out from the app,
feed-ownership verification gating citation earnings, earnings pages with ERC-8004 reputation,
notify-on-citation signed webhooks, and payouts labeled with the triggering question. New on-ramps:
`keryx-mcp` published to npm + the official MCP registry, a one-call testnet onramp, an obvious free
no-wallet trial, shareable dispatch permalinks + social cards, and the one-command `npm run demo`
full-cycle demo. Ops hardened: a 22-test economic-invariant vitest suite gating CI, exact micro-USDC
multi-author split allocation, rotating SQLite backups with off-box copy, a treasury watchdog with
failed-settlement alerts, and low-downtime redeploys with `/api/health` + `/status`.

---

## v0.3.0 — 2026-06-22 — Visible agency + external-agent onboarding

Release wave gathering the work since v0.2.0 (64 commits): the non-custodial session-payment path
made reliable end-to-end, the on-chain SourceRegistry catalog published with verifiable provenance,
the A2A endpoint made discoverable (GET x402 challenge), a 24/7 traction daemon, a full demo-path
hardening pass, every public spend endpoint capped + rate-limited, and two new visible features —
the **live budget meter** and the **"call Keryx from your own agent"** card. Detailed entries below.

---

## Post-Launch Fixes (v0.2.x)

### 2026-06-30 — Notify-on-citation webhooks (close the creator value loop)

#### feat: creators get a signed POST the instant the agent cites them and pays
**Why:** A creator only learned they were cited + paid by opening the dashboard. The creator value
loop had no push side — no way for their own agent/system to react to earning in real time.
**Change:** A source can register a webhook URL (at register time or later from its own profile).
When the agent settles a weighted citation reward for that source, Keryx fires a best-effort,
fire-and-forget `POST` to the URL carrying the question, source, per-author settlement legs (with
real tx state), and total reward. Each delivery is HMAC-SHA256 signed (`X-Keryx-Signature:
sha256=<hmac>`) with a per-source secret shown to the owner exactly once (like an API key); the
creator verifies it by recomputing over the raw body. The dispatcher no-ops when a source has no
webhook or no leg actually settled on-chain, and its own timeout + total error-swallowing guarantee
a slow/dead endpoint can never stall or fail an agent run (the answer + settlement already stand).
Config is stored off-chain in its own `source_notify` table keyed by source id (private url+secret,
never exposed in public listings; works for both the on-chain-registry and DB-direct register paths).
**Files:** `lib/notify/citation-webhook.ts` (new), `lib/db/keryx-db.ts`,
`lib/db/sqlite-adapter.ts`, `lib/db/supabase-adapter.ts`, `supabase/migrations/0010_source_notify.sql`
(new), `lib/agent/run-agent.ts`, `app/api/sources/route.ts`,
`app/api/creator/[id]/notify/route.ts` (new), `components/keryx/register-form.tsx`,
`app/creator/[id]/notify-webhook-panel.tsx` (new), `app/creator/[id]/creator-detail-view.tsx`.
`tsc --noEmit` + `next build` clean.

### 2026-06-24 — Fix the 14-day settled chart undercounting older days

#### fix: chart settled volume from a full-table daily aggregation, not the capped feed
**Why:** The dashboard "Settled · 14 days" chart bucketed the live payments feed, which the dashboard
fetches capped at the 200 most recent rows. The volume engine settles many payments per day, so those
200 all fell in the last day or two — every older day collapsed to a ~zero stub and the chart total
read $1.47 against $7.97 of real settled volume. Looked broken; undercounted real traction.
**Change:** New `db.dailySettled(days)` — a GROUP-BY-day aggregation over the entire `payment_events`
table (settled rows only), zero-filled to the window oldest→today via a shared `fillDailySeries`
helper. `/api/metrics` returns the series; the chart renders it directly instead of re-bucketing the
capped feed. Implemented for both adapters (SQLite uses `substr(created_at,1,10)`; Supabase filters
to the window and tallies in JS). Verified live: the series now spans every active day since launch
and sums to the headline total.
**Files:** `lib/types.ts`, `lib/db/daily-series.ts` (new), `lib/db/keryx-db.ts`,
`lib/db/sqlite-adapter.ts`, `lib/db/supabase-adapter.ts`, `app/api/metrics/route.ts`,
`app/dashboard/page.tsx`, `components/keryx/earnings-chart.tsx`. `tsc --noEmit` + `eslint` clean.

### 2026-06-24 — Published keryx-mcp to npm (npx one-liner)

#### build: ship the MCP server as an installable npm package so any agent wires up with one command
**Why:** The MCP server was only runnable from a cloned repo via `node --import tsx`, which gated the
external-traction on-ramp behind a clone + dev toolchain. A judge or agent should be able to add
Keryx without touching the repo.
**Change:** Packaged `mcp/` as [`keryx-mcp`](https://www.npmjs.com/package/keryx-mcp) on npm. An
esbuild step bundles `keryx-mcp-server.mts` + `keryx-buyer.mts` into a single self-contained ESM bin
(`dist/keryx-mcp.mjs`) that runs under plain `node` with its four runtime deps declared, so
`claude mcp add keryx -- npx -y keryx-mcp` works from any MCP client (Claude Code/Desktop, Cursor,
Windsurf) with no clone. Verified end-to-end: a fresh `npx -y keryx-mcp@latest` download boots and
lists both tools. The dashboard card now shows the npx one-liner.
**Files:** `mcp/package.json` (new), `mcp/README.md`, `components/keryx/a2a-call-card.tsx`,
`package.json` (esbuild build dep). Bundle handshake + npx download verified.

### 2026-06-23 — Keryx MCP server (add Keryx to any agent)

#### feat: expose Keryx's paid research endpoint as MCP tools so any agent can call it in one line
**Why:** External agents calling the paid A2A endpoint are the top traction lever, but the only
on-ramp was a hand-built `circle services pay` call. Most agent runtimes (Claude Code/Desktop,
Cursor, …) speak MCP, not raw x402. Without an MCP surface, a judge running an agent couldn't become
a real external caller in a glance — and external, on-chain volume during the judging window is
exactly what the traction rubric rewards.
**Change:** A stdio MCP server (`mcp/`) wrapping the buyer side of `/api/agent/ask`. Two tools:
`ask_keryx` (pays the 0.02 USDC toll from the caller's OWN Arc-testnet wallet via
`GatewayClient.pay`, returns the cited answer + the creators Keryx paid downstream) and
`keryx_wallet_status` (prints the pay-from wallet, balances, and exact faucet steps). Self-contained
— reads only its own `KERYX_*` env, never Keryx's treasury keys, so it runs unchanged on any
machine; generates + persists a wallet to `~/.keryx`, auto-deposits to Gateway on first call. Every
call is a real on-chain USDC payment, visible live on the dashboard as external traction. The
dashboard "Call Keryx from your own agent" card now also shows the one-line MCP install.
**Files:** `mcp/keryx-buyer.mts` (new), `mcp/keryx-mcp-server.mts` (new), `mcp/README.md` (new),
`components/keryx/a2a-call-card.tsx`, `package.json` (`@modelcontextprotocol/sdk` dep + `mcp`
script). `eslint` clean; MCP `initialize`/`tools/list` handshake + buyer balance reads verified
against live Arc testnet.

### 2026-06-22 — Creator cash-outs panel (real per-tx on-chain proof)

#### feat: surface creator Gateway withdraws on the dashboard with /tx/-resolvable EVM hashes
**Why:** The payments feed's "on-chain ↗" link points at the batched settlement wallet because the
per-payment Circle settlement IDs are UUIDs that do NOT open at `/tx/`. The `withdraw` tool already
mints accrued Gateway earnings on-chain via Gateway withdraw — and that mint returns a REAL EVM tx
hash that does resolve on ArcScan. Nothing surfaced it, so the strongest per-tx on-chain proof Keryx
has was invisible to judges.
**Change:** New `withdrawals` table (kept separate from `payment_events` so cash-outs never inflate
payment/volume/creator metrics — see D-18). `scripts/withdraw.mts` persists each live mint
(idempotent on `tx_hash`, resolves the creator's source name from the wallet). New
`GET /api/withdrawals` + a "Creator cash-outs" dashboard panel that links every row to
`testnet.arcscan.app/tx/<hash>` — the per-tx proof the batched settlement IDs can't give. Panel is
hidden until at least one cash-out exists.
**Files:** `lib/types.ts`, `lib/db/keryx-db.ts`, `lib/db/sqlite-adapter.ts`,
`lib/db/supabase-adapter.ts`, `supabase/migrations/0009_creator_withdrawals.sql`,
`scripts/withdraw.mts`, `app/api/withdrawals/route.ts` (new),
`components/keryx/creator-cashouts-panel.tsx` (new), `app/dashboard/page.tsx`. `tsc --noEmit` +
`eslint` + `next build` clean.

### 2026-06-22 — "Call Keryx from your own agent" card on the dashboard

#### feat: copy-paste A2A integration card so external agents can wire up in one glance
**Why:** External agents calling the paid A2A endpoint (`/api/agent/ask`) are the top traction
lever, but the dashboard only exposed the contract as a link to `/api/docs` — a reader had to
reconstruct the call by hand. Friction kills A2A recruiting before the first payment.
**Change:** A dashboard card surfacing the exact two-step x402 call: `curl -s …/api/agent/ask` to
inspect the toll (free), then `circle services pay …/api/agent/ask -X POST` with the
`{question, budget}` body — copy button included. States the price ($0.02 USDC), network
(Arc `eip155:5042002`), and that inbound fees count as external traction. The facts mirror
`GET /api/agent/ask`, which stays the live source of truth; full schema + SDK path link to
`/api/docs`. Reuses the existing clipboard idiom; no endpoint change.
**Files:** `components/keryx/a2a-call-card.tsx` (new), `app/dashboard/page.tsx`. `tsc --noEmit` +
`eslint` + `next build` clean.

### 2026-06-22 — Live budget meter in the reasoning console

#### feat: show the agent spending against its authorized budget in real time
**Why:** Keryx's headline claim is that money safety is enforced in code, not by the model — the
orchestrator caps spend so a hallucinated number can never overspend, and the agent stops early to
save budget. That discipline was only visible *after* a run (the answer card's "Spent" stat); while
the trace streamed, the viewer couldn't see the budget filling. The single most on-message "visible
agency" gap.
**Change:** A live budget meter in §I · The decision. The console derives spend from the trace it
already receives — `fetch` and `settle` steps each carry a `PaymentRecord` (`amountUsdc`), so
`spentFromSteps()` sums them as they stream (CACHE reuse, skipped buys, and settle errors carry no
amount and are excluded). The §I heading now reads `$spent / $budget` live, and a thin treasury-green
bar fills under it with a vermillion hairline marking the hard cap. When the agent stops early, the
bar visibly halts below 100% and labels the unspent remainder `$X under cap`.
**Files:** `components/keryx/budget-meter.tsx` (new), `components/keryx/reasoning-console.tsx`,
`lib/hooks/use-ask-stream.ts` (carry `budget` in stream state), `app/page.tsx`. No server/agent/API
change — purely a read of the existing trace. `tsc --noEmit` + `eslint` clean.

### 2026-06-21 — Harden public spend endpoints against treasury abuse

#### fix: cap + rate-limit the anonymous treasury `/api/ask` path; ceiling on `/api/cite`
**Why:** keryx.cc is live and public. The no-session `/api/ask` path runs on the treasury gateway
(`RealGateway`), yet `budget` was caller-controlled (coerced only to finite > 0) and the route had
**no rate limit** — a script could POST a large budget in a loop and drain treasury USDC or
fabricate volume. This was a deliberately-deferred item from the 2026-06-21 demo-path hardening pass;
the app being public makes it a real, not theoretical, exposure.
**Change:**
- **Budget clamp (treasury path only):** no-session requests clamp `budget` to `config.anonMaxBudget`
  (env `KERYX_ANON_MAX_BUDGET`, default 0.1 — just above the UI dial's 0.08 max, so the demo is
  unchanged). The browser co-sign path spends the user's own grant-capped session and is left as-signed.
- **IP rate limit:** new `treasuryAsk` tier (5 / 60s) keyed by client IP (`cf-connecting-ip` behind
  the Cloudflare Tunnel, then `x-forwarded-for`). Co-sign sessions are exempt. Reuses `lib/rate-limit.ts`.
- **Citation ceiling:** `/api/cite/[id]` rejects `amount > config.maxCitationUsdc` (default 5). Not a
  drain (caller self-pays via x402 to a source-validated wallet) — a fat-finger / leaderboard-skew bound.
- **A2A budget clamp + IP limit:** `/api/agent/ask` clamps `budget` to `config.a2aMaxBudget`
  (env `KERYX_A2A_MAX_BUDGET`, default 0.5 — more generous than anon since A2A is x402-paid) and
  rate-limits unkeyed callers by IP via a new `a2aPublic` tier (10/60s). Keyed callers keep the `ask`
  tier. The traction `a2a-client` (budget 0.03) is unaffected. Closes the same drain class on the paid path.
**Verification:** `tsc --noEmit` + `eslint` clean. Logic harness confirmed: anon budget 1000 → 0.1,
demo 0.08 → 0.08 untouched, co-sign budget preserved; `clientIp` precedence (cf > xff > x-real-ip);
`treasuryAsk` limiter blocks on the 6th call. Threat-model rows S24/S25/S26 added.
**Files:** `lib/config.ts`, `lib/rate-limit.ts`, `app/api/ask/route.ts`, `app/api/cite/[id]/route.ts`,
`docs/security-threat-model.md`.

### 2026-06-20 — A2A endpoint discoverable by x402 tooling

#### feat: serve the x402 challenge on GET so discovery tools see the endpoint
**Commit:** `0fb0db0`  
**Why:** External agents are the 30% traction lever, and they probe a paid endpoint before paying.
`circle services inspect <url>` issues a GET; the POST-only `/api/agent/ask` answered `405`, so the
canonical Circle discovery tool reported the endpoint **"unavailable"** — friction that kills A2A
recruiting before a single payment is attempted.  
**Change:** Added a side-effect-free `GET /api/agent/ask` that returns the same x402 v2 challenge the
paid POST emits (in the `PAYMENT-REQUIRED` header), plus a human-readable body (price, method, payTo,
request schema, docs link). Extracted `challengeResponse()` in `lib/x402-server.ts` so GET and the
unpaid POST emit byte-identical requirements (DRY). The paying path (POST + payment) is unchanged.  
**Verification:** Live on keryx.cc — `circle services inspect` now reports `Status: payable` ($0.02
USDC, `eip155:5042002`, seller `0xC596…D586`); GET returns `402` + challenge + descriptive body; POST
without payment still returns `402` + `{}` + the same header.

### 2026-06-19 — Non-custodial session payment path

Three bugs blocked the end-to-end user (web) flow: deposit → session active → pay/settle. All
only affected the browser co-sign path; the server-side volume engine (SDK `gateway.pay()`) was
unaffected, which is why they surfaced only on real keryx.cc usage. Each sat one step further
down the pipeline than the last.

#### fix: Gateway balance unit mismatch stranded funded sessions in "confirming"
**Commit:** `53a23e4`  
**Symptom:** After a real deposit, the session never flipped to "active" — UI showed
"Deposit confirming on Circle Gateway… activates automatically" indefinitely, across reloads
and signature recovery.  
**Root cause:** `/api/session/credit` forwarded Circle's balance as a decimal USDC string
(e.g. `"0.05"`), but its sole consumer (`use-session-grant.ts`) parsed it as atomic units via
`BigInt()`. `BigInt("0.05")` throws; the throw was swallowed → the poller returned `false` on
every tick → status pinned at `confirming` forever.  
**Fix:** Endpoint now converts decimal → atomic (`parseUnits(decimal, 6)`), honoring its
documented "atomic units" contract. Consumer unchanged (already correct for atomic).  
**Verification:** Live — endpoint returns atomic integers; session reaches "active" after
Circle credits the deposit (user-confirmed: "Session active — $1.15 remaining").

#### fix: browser co-sign payload missing x402 envelope → Circle verify 400
**Commit:** `1266b1d`  
**Symptom:** Session-funded queries failed paid fetch / citation reward with 500
"payment processing error" — §III creator payouts stayed empty.  
**Root cause:** Browser co-sign sent only the inner `{ signature, authorization }` blob.
Circle's facilitator requires the full x402 PaymentPayload and rejected with 400:
`"x402Version/resource/accepted/payload: Required"`. (Full message recovered from VPS pm2
logs; the UI truncated it at `"Inva…"`.)  
**Fix:** `settleThenServe` now normalizes both buyer shapes — the SDK's full payload passes
through; the inner-only browser blob is wrapped into `{ x402Version, resource, accepted,
payload }` before verify + settle. `accepted` reuses `buildRequirements()`, so it always
matches what the browser signed. The EIP-712 signature itself was already correct.  
**Verification:** Live — a real web query settled a $0.005 fetch toll on Arc (settlement
`794928e9…`), confirming verify + settle end-to-end on the fetch path.

#### fix: citation payouts dead-ended on a 30s sign-request timeout
**Commit:** `02345df`  
**Symptom:** Fetch tolls settled, but the §III citation reward to cited creators never
completed — UI showed "sign-request timed out after 30s — skipping <source>" and §III
stayed empty.  
**Root cause:** The browser's payTo allow-list (`knownSourceWallets`, built from
`/api/sources`) holds only SOURCE payout wallets. A citation's payTo is an AUTHOR wallet
(`getOrCreateWallet("${id}:author-${i}")`), distinct from the source wallet and never exposed
by the API — so it was never in the set. The allow-list, intended for fetch tolls only,
silently refused every citation signature; the server's `awaitSignature` then timed out after
30s and skipped the payout.  
**Fix:** Thread a `kind` ("fetch" | "citation") flag through the sign-request. The browser
applies the source-wallet allow-list to fetch tolls only; the funded cap remains the
containment for citation payTo (the documented design — not a weakening).  
**Verification:** Deployed (commit live on VPS, tsc + eslint clean). End-to-end citation
settlement pending confirmation from a real wallet query.

### 2026-06-19 — Session expiry UX + treasury-fallback guard

Follow-up hardening (not a blocking bug): when a grant's 1h TTL lapsed, the client kept
showing "active" while the server had already dropped the grant, and the next ask silently
fell back to the treasury gateway — spending Keryx's own USDC for a user who meant to spend
their own.

#### fix: surface grant expiry and block silent treasury fallback
**Commit:** `38be98a`  
**Change:**
- Client: a timer at `expiresAt` flips the grant to a new `"expired"` state showing the
  recover prompt (session key + Gateway balance untouched; a reload auto-recovers via
  `tryRecover`, or one signature via `recoverViaSignature`).
- Server: `/api/ask` returns 401 `session_expired` when a `sessionId` is presented but its
  grant is invalid, instead of falling back to treasury. Anonymous (no `sessionId`) asks
  are unchanged.
- `useAskStream` flips the UI to expired on a 401 `session_expired`, covering the race where
  the client still thinks it's active or the server was restarted.  
**Verification:** Deployed (commit live on VPS, tsc clean, eslint 0 errors). Time-based
expiry is verifiable by setting `KERYX_SESSION_GRANT_TTL=60` for a 60s session.

---

## v0.2.0 — Decentralized dApp Transformation (2026-06-18)

### Overview
Completed 6-phase evolution from custodial agent to non-custodial dApp. Users now fund their own sessions, 
sign transactions themselves, and Keryx never touches their keys or funds. All on Arc testnet with real USDC settlement.

### Phases Completed

#### Phase 01 — SIWE Wallet Auth (2026-06-18)
**Commit:** `7c834a0`  
**Description:** Added Sign-In-With-Ethereum for wallet-based identity. No server accounts. Role = creator / dev / asker, 
resolved live from on-chain registry or env allowlist.

**Key Changes:**
- Added `wagmi@3`, `siwe@3`, `jose@6` for wallet connect + SIWE sign-in + stateless JWT
- New `lib/auth.ts`: `getSession()`, `requireRole()`, nonce management
- New `app/api/auth/` routes: `/nonce`, `/verify`, `/signout`
- New `lib/wagmi-config.ts`: chain config (Arc testnet), SSR hydration
- New `app/providers.tsx`: WagmiProvider + QueryClientProvider wrapper
- Modified `app/layout.tsx`: wrap children in Providers
- Modified `app/register/page.tsx`: gate form behind SIWE, prefill wallet
- New `app/connect/page.tsx`: custom wallet connect button
- New `lib/db` interface method: `isCreatorWallet(addr): Promise<boolean>`
- New env vars: `JWT_SECRET`, `NEXT_PUBLIC_WC_PROJECT_ID`, `KERYX_DEV_WALLETS`
- Build passes; no RSC violations (wagmi hooks only in `'use client'` components)

#### Phase 02 — On-Chain SourceRegistry + Indexer (2026-06-18)
**Commit:** `46df551`  
**Description:** Smart contract on Arc testnet tracks sources as on-chain state. Creator wallet registers source metadata; 
off-chain indexer caches in DB.

**Key Changes:**
- New `contracts/SourceRegistry.sol`: `registerSource()`, `updateSource()`, `deactivateSource()`, multi-author splits
- Creator-scoped source IDs via `keccak256(msg.sender, urlHash)` (prevents URL squatting)
- Split validation on-chain: sum = 10,000 bp, ≤ 20 authors, no zero-bp, no zero-address
- New `lib/registry/registry-client.ts`: viem contract client
- New `lib/registry/indexer.ts`: polls Arc RPC for events, caches in DB
- Deployed to Arc testnet: `0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536` (block 47474631)
- New env vars: `KERYX_REGISTRY_ADDRESS`, `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS`, `KERYX_REGISTRY_DEPLOY_BLOCK`
- DB schema: added `sources.on_chain_source_id`, `sources.splits` (JSON)
- Hardhat tests: 16/16 pass (security threats, creator gating, split validation, URL squat resistance)

#### Phase 03 — Non-Custodial Browser Co-Sign (2026-06-18)
**Commit:** `661452e`  
**Description:** Ephemeral session key held in browser tab. User funds session EOA from MetaMask (one tx). Browser auto-signs 
each x402 authorization with session key. Keryx never holds key or funds.

**Key Changes:**
- New `lib/payments/browser-cosign-gateway.ts`: implements PaymentGateway interface, suspends on sign-requests
- New `lib/payments/session-grants.ts`: track user-funded session EOA, cap, spent
- New `lib/hooks/use-session-grant.ts`: React hook for key generation, funding tx, grant creation
- New `app/api/session/grant`, `/session/credit`, `/session/revoke` routes
- Modified `app/api/ask/route.ts`: emit SSE sign-request events, await browser signature
- New `app/api/ask/sign/route.ts`: browser posts signed EIP-712 header
- New `lib/x402-client-sign.ts`: EIP-712 msg builder from x402 requirements
- Payment gateway selection: session grant → BrowserCoSignGateway; funder key → RealGateway; else OfflineGateway
- Session key never transmitted; server sees only `sessAddr` (public)
- User funds own gas + USDC (no Keryx relayer for user sessions)
- Dropped custom SessionEscrow contract (YAGNI; cap = funded balance)
- SSE co-sign loop: no WebSocket, reuses existing fetch+ReadableStream path

#### Phase 04 — IPFS Encrypted Content + Payment-Gated Decryption (2026-06-18)
**Commit:** `d2b8eb1`  
**Description:** Content uploaded encrypted to Pinata IPFS. Plaintext released server-side ONLY after x402 settlement verify, 
inside the `produce()` callback.

**Key Changes:**
- New `lib/ipfs/content-crypto.ts`: AES-256-GCM encrypt (server, on upload) + decrypt (server, post-payment)
- New `lib/ipfs/pinata-client.ts`: Pinata SDK wrapper (upload + fetch)
- Modified `app/api/source/[id]/route.ts`: x402 GET flow → decrypt → plaintext
- New `app/api/source/[id]/preview`: free plaintext preview (10% excerpt, no x402)
- New env var: `CONTENT_MASTER_KEY` (AES-256-GCM key, server-held)
- New env var: `PINATA_JWT` (Pinata API key)
- DB schema: added `sources.content_cid` (IPFS CID for encrypted plaintext)
- Offline mode: plaintext stored in DB directly, no IPFS/encryption
- Trade-off documented: server is trusted key-holder. Lit Protocol upgrade path (post-hackathon, once Arc on Lit)
- Security grep audit: `CONTENT_MASTER_KEY` never logged or serialized

#### Phase 05 — Public API + Wallet-Issued Keys (2026-06-18)
**Commit:** `3a3a4a1`  
**Description:** Productized API with both x402 pay-per-call AND stateless API keys. Rate limiting per key. OpenAPI spec.

**Key Changes:**
- New `app/api/agent/ask/route.ts`: alternative to /api/ask, uses API key auth (Bearer header)
- New `app/api/keys/route.ts`: creator can mint / revoke API keys
- New `lib/api-keys.ts`: key minting (SHA-256 hash storage), timing-safe verification
- Rate limiting via `rate-limiter-flexible@11`: 429 + Retry-After header on breach
- New `app/api/docs/route.ts`: OpenAPI spec (Scalar UI at /api/docs)
- DB schema: added `api_keys` table (hash, creator_wallet, usage_count, created_at)
- Key mint returns raw key once (show-once pattern); subsequent verify uses hash
- Timing-safe comparison prevents length-extension oracle
- New env var: `RATE_LIMIT_REQUESTS_PER_MINUTE` (default: 60)

#### Phase 06 — Security Hardening + Integration (2026-06-18)
**Commit:** `15fcff2`  
**Description:** Full threat model verification, browser-enforced spend cap, testnet faucet, role-fix. All phases integrated + tested.

**Key Changes:**
- Comprehensive threat model: 23-point verification matrix + 4 documented trade-offs + 4 residuals
- Browser-enforced spend cap (`signedTotal` per ask run) + server-side second layer
- Hardhat contract security tests: 16/16 pass (NotCreator, split validation, boundary tests)
- New `/api/faucet` endpoint: testnet native USDC drip (20 USDC per address, 2h cooldown)
- Fixed SIWE statement: ASCII-only (em-dash broke EIP-4361 parser)
- Fixed auth: resolve creator role live from DB + registry, not baked into JWT
- New connect UX: EIP-6963 wallet picker, Arc testnet chain guard, faucet integration
- Session key lifecycle: generate (tab), fund (MetaMask), grant (POST /api/session/grant), spend (co-sign), revoke (withdraw)
- Grep audit: no `sk`, `CONTENT_MASTER_KEY`, `JWT_SECRET`, `ANTHROPIC_API_KEY` in logs/responses (CLEAN)
- SQLite idempotent ALTER migration pattern verified
- Offline dev mode invariant preserved (KERYX_FORCE_OFFLINE=1 end-to-end works)
- All 6 phases integrated: auth → registry → spend → IPFS → API → security
- Deploy + indexer + metrics: ready for VPS production

---

## v0.1.0 — Citation-Toll Agent (Previous Release)

**Status:** Superseded by v0.2.0  
**Key features retained:** Agent brain (decompose→discover→decide→fetch→sufficiency→synthesize→attribute→settle), 
x402 pay-per-request, weighted citation reward, multi-author splits, offline heuristic mode.

**What changed in v0.2:**
- Custody model: custodial (v0.1) → non-custodial (v0.2)
- Auth: none (v0.1) → SIWE wallet (v0.2)
- Registry: heuristic in-memory (v0.1) → on-chain SourceRegistry + indexer (v0.2)
- Source wallet generation: server-side hardcoded (v0.1) → user-provided wallet (v0.2)
- Spend flow: server-signed x402 (v0.1) → browser co-signed (v0.2)
- Content storage: plaintext in DB (v0.1) → encrypted IPFS + gated decryption (v0.2)
- API: internal scripts (v0.1) → public x402 + API key endpoints (v0.2)

---

## Breaking Changes

### User-Facing
- **Wallet required:** users must connect MetaMask on Arc testnet to use `/ask` interactively
- **Session funding:** users fund their own session EOA (one MetaMask tx) before asking
- **API key auth:** programmatic access now requires API key (Bearer header) or x402 payment
- **Preview URL:** `/api/source/[id]/preview` replaced free public fetch; now 10% excerpt only

### Developer-Facing
- **Registry address required:** set `KERYX_REGISTRY_ADDRESS` + `KERYX_REGISTRY_DEPLOY_BLOCK` to enable on-chain sources
- **SIWE JWT cookie:** requests must extract session via `getSession()`, not anonymous access
- **Source wallet:** source.walletAddress now user-controlled (SIWE auth), not server-generated
- **IPFS key:** new `CONTENT_MASTER_KEY` env var required for content decryption
- **SQLite schema:** new tables (api_keys, session_grants) + columns (sources.content_cid, sources.on_chain_source_id)

---

## Migration Guide (v0.1 → v0.2)

### For Local Dev
1. `npm install` (adds wagmi, siwe, jose, pinata, rate-limiter-flexible, hardhat)
2. `npm run generate-wallets` (create funder + spend wallets)
3. Create `.env.local` with new vars: `JWT_SECRET`, `CONTENT_MASTER_KEY`, `PINATA_JWT`, `KERYX_REGISTRY_ADDRESS`, `KERYX_REGISTRY_DEPLOY_BLOCK`
4. `npm run dev` (starts indexer, populates sources from on-chain)
5. `npm run seed-sources` (seed demo sources if DB empty)
6. Visit `/connect` to sign in before `/ask`

### For Existing Sources (Mainnet or Old Setup)
1. If you registered sources in v0.1 without on-chain record, use `npm run ingest-source` to migrate to DB
2. Call `SourceRegistry.registerSource()` on Arc testnet to get on-chain source ID
3. Update `sources.on_chain_source_id` in DB
4. Indexer will cache subsequent updates

### For Offline Dev (Heuristic Mode)
No changes required. `KERYX_FORCE_OFFLINE=1` still works end-to-end:
- Auth: none (open endpoints)
- Sources: from DB (no on-chain read)
- Payments: simulated (no real settlement)
- Content: plaintext (no IPFS encryption)

---

## Known Limitations (Testnet MVP)

### Security
- **Server holds IPFS key** — Lit Protocol upgrade blocked on Arc testnet support (documented C2 trade-off)
- **Session key in sessionStorage** — XSS risk cap-bounded by funded amount; Web Crypto non-exportable keys post-hackathon (R3 residual)
- **Grant funding not on-chain verified** — manual retry fallback; balance API check post-hackathon (R2 residual)
- **Citation payTo redirect under compromise** — cap-bounded; author manifest fix post-hackathon (R1 residual)

### Scalability
- **Rate limit in-process** — `rate-limiter-flexible` single-instance only; Redis post-hackathon
- **Indexer polling** — 30s interval; event subscription post-hackathon
- **Source enumeration** — O(n) call, not paginated; cursor-based post-hackathon

### User Experience
- **Manual session funding** — future: MetaMask preset amounts / shortcuts
- **No session refresh** — session TTL 12h; manual re-fund on expiry
- **Free preview limited** — 10% excerpt only; full free preview requires source creator choice

---

## Metrics (Real Data, 2026-06-18)

| Metric | Value | Notes |
|--------|-------|-------|
| Smart contract deployed | ✓ | Arc 0x2e12Fa… (block 47474631) |
| Hardhat tests | 16/16 pass | Security threats verified |
| Threat matrix verified | 23/23 pass | All surfaces covered |
| Phases shipped | 6/6 complete | 01–06 ready for hackathon demo |
| Offline dev mode | ✓ working | KERYX_FORCE_OFFLINE=1 end-to-end |
| Volume engine | ready | npm run seed (server-side) |
| VPS deployment | ready | npm run deploy (keryx.cc) |

---

## Post-Hackathon Roadmap

### Security Upgrades (Priority: High)
- [ ] Web Crypto non-exportable session keys (eliminate XSS export)
- [ ] Lit Protocol IPFS key release (eliminate server key-holder trust)
- [ ] On-chain grant deposit verification (close R2)
- [ ] Signed author-wallet manifest (close R1)

### Scalability (Priority: Medium)
- [ ] Redis rate-limit (replace in-process)
- [ ] Event-only indexer (subscribe to finality, no polling)
- [ ] Cursor-based source pagination
- [ ] Multi-instance deployment support

### User Experience (Priority: Medium)
- [ ] Preset session funding amounts (UI shortcuts)
- [ ] Session token refresh before expiry
- [ ] Creator control over preview depth
- [ ] Bulk source import from RSS feed

### Enterprise (Priority: Low)
- [ ] Multi-tenant API key scoping
- [ ] Custom SourceRegistry deployments
- [ ] Audit-trail export
- [ ] Fiat on-ramp integration

---

## Testing & QA Status

| Area | Status | Notes |
|------|--------|-------|
| Smart contracts | ✓ tested | 16/16 Hardhat tests pass |
| Security audit | ✓ verified | Full threat matrix in security-threat-model.md |
| Integration | ✓ manual | E2E: connect → fund → ask → settle |
| Offline dev | ✓ tested | Heuristic mode end-to-end works |
| Volume engine | ✓ tested | npm run seed generates real settlement |
| Deployment | ✓ ready | VPS + indexer + metrics operational |
| API coverage | ✓ complete | 13 endpoints + OpenAPI docs |

---

## Deploy History

| Date | Version | Change | Status |
|------|---------|--------|--------|
| 2026-06-19 | 0.2.0 | Fix: session-expiry UX + treasury-fallback guard (`38be98a`) | ✓ Live |
| 2026-06-19 | 0.2.0 | Fix: citation payout sign-request scope (`02345df`) | ✓ Live |
| 2026-06-19 | 0.2.0 | Fix: co-sign x402 envelope for Circle verify (`1266b1d`) | ✓ Live |
| 2026-06-19 | 0.2.0 | Fix: session activation — Gateway balance units (`53a23e4`) | ✓ Live |
| 2026-06-18 | 0.2.0 | Decentralized dApp (Phases 01–06) | ✓ Live |
| 2026-06-15 | 0.1.0 | Citation-toll agent MVP | Superseded |

---

## References

- **Plan:** `plans/260618-0025-decentralized-dapp-registry-ipfs-spend-permission/plan.md`
- **Security:** `docs/security-threat-model.md`
- **Architecture:** `docs/system-architecture.md`
- **Codebase:** `docs/codebase-summary.md`
