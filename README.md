# Keryx 🏛️

**Every time an AI uses a creator's work as a source, the creator gets paid — instantly.**

🔗 Live: **[keryx.cc](https://keryx.cc)**

Keryx is a **citation-toll reading agent**. Ask it a question with a budget. It autonomously decides
which paid content sources are worth buying, pays for them per-request over [x402](https://github.com/circlefin/arc-nanopayments),
reads enough to answer, writes a grounded answer with citations, and then settles a **weighted
nanopayment to every source it actually cited** — in USDC on [Arc](https://docs.arc.network). Sources
that contributed more earn more; multi-author works split the reward automatically.

> Built for the **Lepton Agents Hackathon** (Canteen × Circle, on Arc).
> The differentiator: **visible agency** — every buy / skip / cache / stop decision is model-reasoned
> with a human-readable rationale, streamed live to the UI.

---

## Why this matters

The web's economic model breaks when the reader is an AI: agents consume creators' work without
ever sending a click, a view, or a cent. Keryx closes that loop. It makes **citation a payment event**:
the moment an agent relies on your writing to answer a question, you're paid — proportional to how
much you helped — settled sub-cent over Circle's nanopayment rail. Creators onboard in one click
(paste an RSS feed). Agents pay automatically. No accounts, no invoices, no clicks.

## How the agent decides (the 30%)

The agent genuinely **decides** — it does not just automate. For one question it runs:

```
1. DECOMPOSE   break the question into atomic sub-claims
2. DISCOVER    match candidate sources from the registry (free previews)
3. DECIDE      per source: BUY / SKIP / CACHE — weighing expected value vs price vs budget,
               avoiding redundancy, preferring cheaper-sufficient sources   ← logged rationale
4. FETCH       pay the x402 toll only for BUY; reuse CACHE for free
5. SUFFICIENCY after each read, decide "have I read enough?" → stop early to save budget
6. SYNTHESIZE  a grounded answer with inline [S#] citations
7. ATTRIBUTE   assign each cited source a contribution weight (0..1)
8. SETTLE      weighted citation reward → each creator wallet (split across authors)
```

Money safety is enforced in code, not by the model: the LLM proposes value; the orchestrator
enforces the hard budget cap, so a hallucinated number can never overspend.

Example trace (real output):

```
[decide]  BUY Agent Economy Weekly — strong match on x402, autonomous, commerce; worth the $0.004 toll
[decide]  SKIP Garden & Soil Monthly — weak match (no key terms); not worth $0.002
[fetch]   Paid $0.004 to Agent Economy Weekly — S1
[sufficiency] Read 2 sources covering all sub-claims; stopping early to save budget
[settle]  Settled $0.015 → Mara Okoye · $0.010 → Devin Park   (60/40 author split)
📊 $0.032 spent → 100% to creators · 3 bought / 3 skipped
```

## Architecture

```
                    ┌──────────────── Keryx web app (Next.js 16) ────────────────┐
  Ask page ──q+budget──▶  /api/ask (SSE)  ──▶  AGENT BRAIN  (lib/agent)
  (live reasoning UI)                            decompose→discover→decide→fetch
                                                 →sufficiency→synthesize→attribute→settle
                                                        │              │
                            reasoning engine ───────────┤              ├──── payment gateway
                            (Anthropic / DeepSeek /                     │     (Circle x402 + Gateway)
                             offline heuristic)                         ▼
  Creator side:  /register ──RSS──▶ registry (sources + wallets)   x402 fetch toll  ─▶ creator wallet
                 /api/source/[id]  (x402-protected content)        x402 citation reward ─▶ author wallet(s)
  Dashboard:     /api/metrics, /api/payments  ──▶  live traction          │
                                                          USDC on Arc testnet (chain 5042002)
```

### Circle / Arc primitives used (the 20%)
- **x402 pay-per-request** — `@circle-fin/x402-batching`. Sellers wrap content with a 402 challenge
  (`lib/x402-server.ts`); the agent pays inline via `GatewayClient.pay()` (`lib/payments/real-gateway.ts`).
- **Circle Gateway / Nanopayments** — sub-cent batched settlement (the $0.000001 floor) for both the
  fetch toll and the weighted citation reward.
- **Circle Wallets** — an ephemeral agent spend wallet funded from a funder wallet; one wallet per
  registered creator as the `payTo` target.
- **USDC on Arc** — native settlement currency; Arc uses USDC as its gas token too.
- **Circle CLI** (`circle`) — `gateway`, `services`, and `feedback` commands; `arc-canteen` for traction.

### Innovation (the 20%)
- **Open-marketplace discovery** — beyond its own creators, the agent probes the *live* Circle x402
  service bazaar (`circle services search`) every query and reasons BUY/SKIP over real third-party
  endpoints. They settle on other chains (Base/ETH/… mainnet), not Keryx's Arc rail, so the
  orchestrator evaluates and logs them but never purchases — an in-code rail constraint, like the
  budget cap. Keryx sees the whole open x402 economy, then spends only where it safely can.
- **Per-citation settlement weighted by contribution** — not flat per-fetch; the answer's grounding
  determines the split.
- **Multi-author splits** — one reward fans out across author wallets by configured weights.
- **Emergent budget behavior** — the agent stops early, caches, and skips, producing genuine frugality.
- **Two-tier economy** — a small access toll + a weighted citation pool, so fetched-but-uncited
  sources earn only the toll while cited sources earn proportionally more.

## Run it

```bash
# 1. Install (Node v20.18.2+)
npm install

# 2. Configure (optional — runs offline with zero keys)
cp .env.example .env.local
#   add ANTHROPIC_API_KEY or DEEPSEEK_API_KEY for real reasoning
#   fund AGENT_FUNDER_ADDRESS at https://faucet.circle.com/ (Arc Testnet) + set KERYX_FORCE_OFFLINE=0 for real settlement

# 3. Generate wallets (or use the ones in .env.local)
npm run generate-wallets

# 4. Seed demo sources
npm run seed-sources

# 5a. Run the agent on one question (prints the full reasoning trace)
npm run ask -- "How do x402 and stablecoins enable autonomous AI agent commerce?" --budget 0.05

# 5b. Or run the web app
npm run dev          # http://localhost:3939

# 6. Generate autonomous payment volume
npm run seed -- --count 20

# 7. See live metrics
npm run metrics
```

### Modes
| | Reasoning | Payments | DB |
|---|---|---|---|
| **Offline dev** (default) | heuristic (no key) | simulated (`settled:false`) | local SQLite |
| **Demo / live** | Claude or DeepSeek | real x402 on Arc testnet | SQLite or Supabase |

Flip to live: add an LLM key, fund the wallet, set `KERYX_FORCE_OFFLINE=0`.

## Deploy
Primary: run locally + expose at **[keryx.cc](https://keryx.cc)** with **Cloudflare Tunnel**
(`npm run tunnel`) — keeps SQLite, gives a public URL, runs the volume engine for real traction.
Always-on alternative: Supabase + Vercel (adapters included; set the Supabase env vars).

## Project docs
- [`PLAN.md`](./PLAN.md) — phased build plan & status
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision log
- [`DEMO.md`](./DEMO.md) — sub-3-minute demo script
- [`TRACTION.md`](./TRACTION.md) — sources onboarded + real payment volume
- [`FEEDBACK.md`](./FEEDBACK.md) — Circle/Arc dev-tool feedback
- [`CLAUDE.md`](./CLAUDE.md) — orientation for contributors

## Stack
Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · `@circle-fin/x402-batching` · viem · Node `node:sqlite` / Supabase · Anthropic / DeepSeek.

Built on the verified [`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments) x402/Gateway plumbing.
