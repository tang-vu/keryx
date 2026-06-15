# Keryx — Decision Log

Autonomous architecture/product/UX decisions, with rationale. Newest first.
Format: **D-NN** · area · decision · why · reversibility.

---

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

---

## Open questions (for the human)
- Which LLM key to use (Anthropic preferred)?
- Provide hosted Supabase creds, or authorize Supabase MCP to provision?
- OK to fund funder wallet `0x384462d9D8e2645A017e4ef34A0cdFd91B4B97cd` via faucet now?
- Deploy target confirm: Vercel?
