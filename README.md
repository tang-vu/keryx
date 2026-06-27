# Keryx 🏛️

**Every time an AI uses a creator's work as a source, the creator gets paid — instantly.**

🔗 Live: **[keryx.cc](https://keryx.cc)** &nbsp;·&nbsp; ▶️ `npm run demo` — the whole loop in ~90s &nbsp;·&nbsp; 🧩 [Fork the Arc primitives](https://github.com/tang-vu/keryx-arc-primitives)

**Fork-and-run.** Keryx is a live app *and* a set of MIT-licensed, standalone [Arc primitives](https://github.com/tang-vu/keryx-arc-primitives)
you can import: **two-toll x402 settlement** (fixed + dynamic), a **squat-proof on-chain creator/attribution
registry** (multi-author splits + indexer), and a **server-enforced spend cap** for non-custodial agent spend.
One command — `npm run demo` — runs the full cycle end-to-end in ~90s with real Arc-testnet settlement and
prints on-chain proof.

Keryx is a **citation-toll reading agent**. Ask it a question with a budget. It autonomously decides
which paid content sources are worth buying, pays for them per-request over [x402](https://github.com/circlefin/arc-nanopayments),
reads enough to answer, writes a grounded answer with citations, and then settles a **weighted
nanopayment to every source it actually cited** — in USDC on [Arc](https://docs.arc.network). Sources
that contributed more earn more; multi-author works split the reward automatically.

> Built for the **Lepton Agents Hackathon** (Canteen × Circle, on Arc) — the **primary RFB 6: Creator
> & Publisher Monetization** track. The org's own **Prior Art #1 is the "Herald model (kēryx/praeco):
> content cited, paid per citation"** — Keryx (κῆρυξ = *herald*) is the canonical build for it.
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
BROWSER (Web App)                    IPFS + Arc Smart Contracts              Circle Gateway + Arc Testnet
─────────────────                    ─────────────────────────               ──────────────────────────────
┌──────────────────┐                 [SourceRegistry]                         
│ /ask page        │ (SIWE           on Arc 0x2e12Fa...                       USDC on Arc
│ + wallet connect │  auth)           • sources[]                             (ERC-20, 6 decimals)
│                  │                   • emit Registry events                  
└────────┬─────────┘                   • indexed by off-chain DB               
         │ session-grant                                                       
         │ (user funds session EOA)     [IPFS Content]                         
         │ MetaMask tx → session       • AES-256-GCM encrypted                [Circle Gateway]
         │ deposits in Gateway          • plaintext released only post-settle  • batch settlement
         │                                                                      • x402 EIP-712 verify
         │                             [Keryx API]                             
         │ co-sign loop (fetch+POST):  • auth: SIWE JWT (browser + API key)   [Arc RPC]
    /api/ask (SSE) ──────────────────▶ /api/session/*   (grant, credit)       rpc.testnet.arc.network
    browser streams                     /api/ask         (agent asks, gets
    sign-requests                       /api/ask/sign    sign-requests back)
    ◀────────────────────────────────  /api/source/[id] (fetch toll + IPFS key)
    client-side session key             /api/cite        (citation reward)
    signs EIP-712                       /api/keys        (API key mint/verify)
    auto-signs (NO prompt)              /api/docs        (OpenAPI)
                                        /api/faucet      (testnet drip)
    
    Agent brain (lib/agent/run-agent.ts):
    decompose→discover→decide→fetch→sufficiency→synthesize→attribute→settle
    (same as v0.1, reads via stable KeryxDB interface)
```

**Key Innovation:** Non-custodial spend. The user funds a session EOA from their MetaMask (once), deposits it into Circle Gateway, 
and the browser auto-signs each x402 authorization with the in-tab session key. The funded amount is the hard cap; Keryx never 
touches the user's key or funds.

### Circle / Arc / Web3 primitives used (the 30%)
- **x402 pay-per-request** — `@circle-fin/x402-batching`. Sellers wrap content with a 402 challenge
  (`lib/x402-server.ts`); the agent pays inline via `GatewayClient.pay()` (server path) or browser 
  co-signs via `BrowserCoSignGateway` (user interactive path).
- **Circle Gateway / Nanopayments** — sub-cent batched settlement (the $0.000001 floor) for both the
  fetch toll and the weighted citation reward. User-funded session EOA deposits into Gateway; server 
  verifies EIP-712 authorization signatures from the browser.
- **SIWE (Sign-In-With-Ethereum)** — `siwe@3.0` + `wagmi@3` for wallet connect + nonce/message/verify flow.
  Role = creator (on-chain SourceRegistry) / dev (env allowlist) / asker (default). Stateless JWT session.
- **Smart Contracts** — `SourceRegistry.sol` deployed on Arc testnet (`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`).
  Tracks sources by URL hash, creator, splits, and IPFS CID; on-chain events drive the indexer cache.
- **IPFS + Pinata** — content encrypted server-side (AES-256-GCM), plaintext released client-side only after 
  x402 settle (via `produce()` callback). Decryption key held by server (Lit Protocol upgrade path post-hackathon).
- **USDC on Arc** — native settlement currency (ERC-20, 6 decimals); Arc uses USDC as its gas token too.
  Native USDC (18 decimals) = gas. Public testnet faucet.
- **Circle CLI** (`circle`) — `gateway`, `services`, and `feedback` commands; `arc-canteen` for traction.

### Innovation & Design Choices (Phases 01–06)
- **Non-custodial browser co-sign** — user funds a session EOA (one MetaMask tx), deposits into Gateway,
  browser holds session key in tab memory and auto-signs each x402 authorization (EIP-712). Keryx 
  never holds the key or funds. Funded cap is the enforced spend ceiling (Phase 03, commits 661452e, 15fcff2).
- **On-chain SourceRegistry** — deployed on Arc (`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`). 
  Creator writes source metadata + IPFS CID; indexer polls events + caches in DB. URL squatting 
  resistance via creator-scoped source IDs; multi-author splits on-chain (Phase 02, commit 46df551).
- **Encrypted IPFS content, payment-gated decryption** — content encrypted server-side (AES-256-GCM), 
  ciphertext pinned to IPFS, plaintext released ONLY inside the x402 `produce()` callback after 
  settlement verify (Phase 04, commit d2b8eb1). Free preview available plaintext.
- **Public API + wallet-issued keys** — both x402 pay-per-call AND stateless API keys (SHA-256 hashed, 
  mint-once-show-once). Rate limited per key. OpenAPI docs at `/api/docs` (Phase 05, commit 3a3a4a1).
- **SIWE 3-role auth** — wallet-based identity, role resolved live from on-chain/DB state + env allowlist. 
  Stateless JWT. No server accounts (Phase 01, commit 7c834a0).
- **Testnet faucet** — native USDC drip for session setup gas (Phase 06 connect UX, commit ca2b6f7).
- **Open-marketplace discovery** — agent probes Circle's live x402 service bazaar per query; evaluates
  but never purchases from other chains (Arc is the rail). Real third-party endpoints visible in reasoning.
- **Per-citation settlement weighted by contribution** — not flat per-fetch; the answer's grounding
  determines the split.
- **Multi-author splits** — one reward fans out across author wallets by configured weights (on-chain).
- **Emergent budget behavior** — the agent stops early, caches, and skips, producing genuine frugality.
- **Two-tier economy** — a small access toll + a weighted citation pool, so fetched-but-uncited
  sources earn only the toll while cited sources earn proportionally more.

## Run it

**One command — the full cycle (~90s).** Decide → pay x402 toll → read → synthesize → settle
weighted citation rewards, then print the Arc-testnet wallet addresses whose USDC actually moved:

```bash
npm run demo -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
```

With `ANTHROPIC_API_KEY` + `AGENT_FUNDER_PRIVATE_KEY` + `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS` it
settles for real and prints on-chain proof links; without them the same flow runs offline, clearly
labeled `SIMULATED` (a mock is never presented as settled). Full setup below.

```bash
# 1. Install (Node v20.18.2+)
npm install

# 2. Configure (optional — runs offline heuristic with zero keys)
cp .env.example .env.local
#   Minimal for offline dev: none (heuristic reasoning, simulated payments, local SQLite)
#   For real Arc testnet: add ANTHROPIC_API_KEY + NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS
#   For user session support: add JWT_SECRET, CONTENT_MASTER_KEY, PINATA_JWT
#   For on-chain registry indexing: add KERYX_REGISTRY_ADDRESS, KERYX_REGISTRY_DEPLOY_BLOCK

# 3. Generate wallets (optional, for server-side treasury)
npm run generate-wallets

# 4. Seed demo sources (populates local DB)
npm run seed-sources

# 5a. Run the agent on one question (prints the full reasoning trace)
npm run ask -- "How do x402 and stablecoins enable autonomous AI agent commerce?" --budget 0.05

# 5b. Or run the web app (with SIWE auth, session grants, browser co-sign)
npm run dev          # http://localhost:3939

# 6. Generate autonomous payment volume (server-side, uses treasury)
npm run seed -- --count 20

# 7. See live metrics / traction
npm run metrics

# 8. Deploy to VPS (requires SSH key, pulls latest main)
npm run deploy
```

**First-time user flow:**
1. Open http://localhost:3939 (or keryx.cc)
2. Click "Connect Wallet" → MetaMask on Arc testnet
3. If low on USDC, hit `/faucet` → drip 20 USDC (2h cooldown)
4. Fund a session (or use in-app faucet integration)
5. Ask a question + set budget
6. Watch the agent decide, fetch, synthesize, settle — live in the UI

### Operation Modes
| Mode | Reasoning | Auth | Payment Path | Payment Status | DB | Use Case |
|------|-----------|------|--------------|----------------|----|----|
| **Offline dev** | heuristic (no LLM key) | none | offline mock | simulated (`settled:false`) | SQLite | laptop, no wallet |
| **Server treasury** | Claude/DeepSeek | optional | `RealGateway` (funder wallet) | real Arc testnet | SQLite or Supabase | volume engine, A2A |
| **User interactive** | Claude/DeepSeek | SIWE JWT + API key | `BrowserCoSignGateway` (session EOA) | real Arc testnet | SQLite or Supabase | web app `/ask` |

**Offline (default):** `KERYX_FORCE_OFFLINE=1` or missing LLM key / no registry address. Agent uses heuristic reasoning, 
sources from local SQLite, no wallet needed.

**Live testnet:** Add `ANTHROPIC_API_KEY` + `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS`. User connects MetaMask, 
funds a session, browser co-signs. Server can also run volume engine with `AGENT_FUNDER_PRIVATE_KEY` (treasury).

**To activate on-chain registry indexing:** Set `KERYX_REGISTRY_ADDRESS` + `KERYX_REGISTRY_DEPLOY_BLOCK`. 
Indexer will poll Arc RPC and cache events in DB.

## Deploy
**Production:** VPS at keryx.cc. `npm run deploy` pulls latest main, restarts the app, runs migrations on 
SQLite (kept on-disk for real traction data). Indexer backfills SourceRegistry events from deploy block 
on startup. Traction metrics update live.

**Local tunnel:** `npm run tunnel` (Cloudflare Tunnel) — exposes localhost:3939 at a public URL, useful for 
testing the full flow locally without a VPS.

**Always-on serverless:** Supabase + Vercel adapters included; set `NEXT_PUBLIC_SUPABASE_URL` + 
`SUPABASE_SERVICE_ROLE_KEY` to use Postgres instead of SQLite. But local VPS/tunnel is preferred to keep 
traction data on the team's own infra.

## Transparency & Honest Trade-offs
The dApp is non-custodial but makes **4 documented trade-offs** (required for testnet, flagged for post-hackathon):
1. **Circle facilitator** — x402 settlement goes through Circle's `BatchFacilitatorClient` (no on-chain alternative on Arc testnet)
2. **Server holds IPFS key** — content is encrypted on IPFS but server holds the decryption key (Lit Protocol upgrade once Arc is on Lit)
3. **Session key XSS surface** — browser session key lives in `sessionStorage` (cap-bounded; Web Crypto non-exportable keys are post-hackathon)
4. **Treasury gas wallet** — server funder wallet can be drained if compromised (holds gas only, no USDC; rotated regularly)

See `docs/security-threat-model.md` for full verification matrix, residuals, and mitigations.

## Forkable primitives (Arc OSS)
The reusable, standalone building blocks live in the [`arc-primitives/`](https://github.com/tang-vu/keryx-arc-primitives) submodule
([`keryx-arc-primitives`](https://github.com/tang-vu/keryx-arc-primitives), MIT) — two-toll x402
settlement, the on-chain SourceRegistry + indexer, and non-custodial browser co-sign spend caps,
packaged to fork and import. Clone with `git clone --recurse-submodules`, or `git submodule update --init`.

## Project docs
- [`PLAN.md`](./PLAN.md) — phased build plan & dApp evolution status
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision log (link to Phase 01–06 decision log)
- [`DEMO.md`](./DEMO.md) — sub-3-minute demo script (updated for dApp flow: connect → fund → ask → settle)
- [`TRACTION.md`](./TRACTION.md) — real payment volume + sources (updated weekly)
- [`FEEDBACK.md`](./FEEDBACK.md) — Circle/Arc dev-tool feedback + tickets
- [`CLAUDE.md`](./CLAUDE.md) — orientation for contributors (rules, file ownership, dev setup)
- [`docs/system-architecture.md`](./docs/system-architecture.md) — dApp data/money flow diagrams + on-chain component details
- [`docs/security-threat-model.md`](./docs/security-threat-model.md) — threat matrix, audit results, residual risks
- [`docs/codebase-summary.md`](./docs/codebase-summary.md) — module map + file purposes

## Stack
Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · `@circle-fin/x402-batching` · viem · Node `node:sqlite` / Supabase · Anthropic / DeepSeek.

Built on the verified [`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments) x402/Gateway plumbing.
