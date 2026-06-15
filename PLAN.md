# Keryx — Build Plan

> **Keryx** (κῆρυξ, *herald*): the agent that announces a creator's work — and pays them every time it does.
>
> A citation-toll reading agent. Ask a question; the agent autonomously decides which paid
> sources are worth buying under a budget, pays per-request via x402, synthesizes a grounded
> answer with citations, and settles a weighted nanopayment to every source it actually used.
> **Every citation pays the creator, instantly, in USDC on Arc.**

**Hackathon:** Lepton Agents (Canteen × Circle, on Arc). **Rubric:** 30% Agentic sophistication · 30% Traction · 20% Circle tooling · 20% Innovation.

---

## North Star
The agent must genuinely **DECIDE** (buy/skip/cache/stop), with a logged, human-readable rationale for every choice, and that reasoning must be **visible live in the UI**. This is the #1 differentiator.

## Architecture (one screen)
```
 Ask screen ──question+budget──▶  AGENT BRAIN (lib/agent)
                                   1. decompose question → sub-claims
                                   2. discover candidate sources (registry + free previews)
                                   3. score value vs price, decide BUY/SKIP/CACHE  ◀── logged rationale
                                   4. x402 fetch (GatewayClient.pay) → toll to creator wallet
                                   5. sufficiency check → stop early to save budget
                                   6. synthesize grounded answer + citations
                                   7. attribute contribution weights per source
                                   8. settle weighted citation reward → creator wallet(s)
                                         └─ multi-author split across author wallets
                                   9. log every decision + payment → DB → dashboard
 Creator side: /register (paste RSS) → ingest (RSSHub) → wallet + x402 endpoint live
 Settlement: Circle Wallets + x402 + Gateway nanopayments, USDC on Arc testnet (5042002)
```

## Reused from `circlefin/arc-nanopayments` (the scaffold — verified working)
- `withGateway(handler, "$price", endpoint)` — x402 seller wrapper (`BatchFacilitatorClient.verify/settle`).
- `GatewayClient.pay(url)` / `.deposit()` / `.getBalances()` — buyer side (real Arc-testnet settlement).
- Wallet generation (viem ephemeral accounts), funder→ephemeral→Gateway deposit flow.
- `payment_events` table + dashboard pattern (Next 16 / React 19 / shadcn / Tailwind 4).
- Constants: USDC `0x3600…0000`, Gateway wallet `0x0077…19B9`, net `eip155:5042002`, RPC `rpc.testnet.arc.network`, Gateway balance API `gateway-api-testnet.circle.com`, CCTP domain `26`.

## What we BUILD (the gap = the win)
The scaffold's "agent" is a dumb 1-tx/sec loop over 4 hardcoded URLs. **Zero reasoning.** Keryx replaces it with a real reasoning agent and a per-citation creator economy.

---

## Phases & checklist

### Phase 0 — Research & ground truth ✅ DONE
- [x] Clone + read scaffold (`agent.mts`, `lib/x402.ts`, migrations, routes)
- [x] Research Circle docs (Gateway/nanopayments, CLI, Wallets, x402)
- [x] Research Arc docs + ARC CLI (`arc-canteen`: rpc, push/traction)
- [x] Survey escrow/commerce/circle-agent for split & seller patterns
- [x] Verify CLIs install + run; verify viem `arcTestnet`; generate wallets
- [x] Reports in `plans/reports/`

### Phase 1 — Foundation ✅ DONE
- [x] Scaffold `keryx` from nanopayments structure (Next 16 + Supabase + x402 libs)
- [x] Repo hygiene: `.gitignore`, `.env.example`, `.env.local` (wallets, gitignored)
- [x] `lib/db` abstraction — SQLite (dev, node:sqlite) + Supabase (prod) adapters
- [x] `lib/llm` abstraction — Anthropic default + heuristic offline fallback
- [x] DB schema: `sources`, `source_items`, `query_runs`, `payment_events`, `cache_items`
- [x] `lib/payments` gateway abstraction: real x402 + offline; per-source payTo
- [x] Compile check green (tsc --noEmit clean)

### Phase 2 — The Brain ✅ DONE (reasoning logs verified offline)  ◀ FIRST CHECK-IN
- [x] decompose, discover, decide (BUY/SKIP/CACHE + rationale + budget guard)
- [x] fetch (x402 buy + cache write), sufficiency (early-stop), synthesize, attribute
- [x] `runAgent` orchestrator emitting a streamed structured reasoning trace
- [x] CLI harness `scripts/ask.mts` + `scripts/metrics.mts`
- [x] Runs end-to-end offline — verified: real buy/skip discrimination, early-stop,
      multi-author split, metrics aggregation, 100% to creators

### Phase 3 — Creator / source side ✅ DONE
- [x] `sources` registry + per-source creator wallet generation (keystore)
- [x] `/api/source/[id]` — x402-protected content (payTo = creator wallet); 402 verified
- [x] `/api/source/[id]/preview` — free preview for discovery
- [x] RSS ingest (`lib/ingest/rss.ts`) → store recent items as purchasable content
- [x] `/api/sources` POST one-click register (paste RSS → wallet + endpoint); UI by frontend agent
- [x] Seed 6 demo sources (multi-author + off-topic for discrimination)

### Phase 4 — Weighted citation settlement + multi-author splits ✅ DONE
- [x] `/api/cite/[id]` dynamic-price x402 → weighted reward to author wallet
- [x] Multi-author split (N payments per author by metadata weights) — verified 60/40
- [x] Per-query economic model (budget → tolls + citation pool by weight)
- [x] Settlement recorded with rationale + weights (real tx hash in live mode)

### Phase 5 — Web app  ◀ frontend agent in progress
- [~] `/` ask screen — live reasoning stream → answer+citations → "creators paid" (building)
- [~] `/dashboard` — metrics, leaderboard, live feed (building)
- [~] `/register` UI (building)
- [x] All backing API routes built & verified (SSE, metrics, payments, sources)

### Phase 6 — Seed / volume engine + traction wiring ✅ (mostly)
- [x] `scripts/seed-engine.mts` — fires agent over a question bank (budget-guarded) — verified
- [x] `arc-canteen push` hook (`--push` flag) for traction events
- [ ] `circle feedback submit` — FEEDBACK.md ready to submit

### Phase 7 — Real testnet E2E + deploy + submission
- [ ] Fund funder wallet (faucet) → verify real settlement E2E   ◀ needs human
- [x] Supabase adapter built (deploy-ready); Cloudflare Tunnel chosen as primary deploy
- [ ] `npm run tunnel` → live URL (needs cloudflared installed)
- [x] `README.md`, `DEMO.md`, `TRACTION.md`, `FEEDBACK.md`, `EASTER_EGGS.md` drafted
- [ ] Enhancements: A2A mode, external x402 discovery, onchain splitter, ERC-8004
- [ ] Final commit + push

---

## Blockers needing the human (batched at first check-in)
1. **LLM API key** — `ANTHROPIC_API_KEY` (preferred). Dev runs on heuristic fallback; demo needs real reasoning.
2. **Supabase project** — URL + anon + service_role keys (hosted; no Docker locally). Or authorize Supabase MCP to provision.
3. **Fund the funder wallet** — `0x384462d9D8e2645A017e4ef34A0cdFd91B4B97cd` at https://faucet.circle.com/ (Arc Testnet, 20 USDC / 2h). Start early — rate-limited.
4. **Deploy login** — Vercel account (for `vercel deploy`).

## Status
Phases 0–4 ✅ · Phase 6 ✅ (volume engine) · Phase 5 (web UI) in progress (frontend agent) ·
Phase 7 pending human credentials (fund wallet, LLM key) + enhancements. Backend fully verified;
docs drafted. Deploy via Cloudflare Tunnel once UI lands.
