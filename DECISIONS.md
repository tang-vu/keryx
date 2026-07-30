# Keryx — Decision Log

Autonomous architecture/product/UX decisions, with rationale. Newest first.
Format: **D-NN** · area · decision · why · reversibility.

---

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
