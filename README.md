# Keryx 🏛️

[![npm: keryx-mcp](https://img.shields.io/npm/v/keryx-mcp?logo=npm&label=keryx-mcp&color=CB3837)](https://www.npmjs.com/package/keryx-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.tang--vu%2Fkeryx-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=keryx)
[![live: keryx.cc](https://img.shields.io/badge/live-keryx.cc-1aa251)](https://keryx.cc)
[![settles on Arc testnet](https://img.shields.io/badge/settles_on-Arc_testnet-1f1f1f)](https://docs.arc.network)
[![payments: Circle x402](https://img.shields.io/badge/payments-Circle_x402-2775CA)](https://github.com/circlefin/arc-nanopayments)

**Every time an AI uses a creator's work as a source, the creator gets paid — instantly.**

🔗 Live: **[keryx.cc](https://keryx.cc)** — free to try, no wallet, no sign-up
&nbsp;·&nbsp; ▶️ `npm run demo` — the whole loop, real settlement, ~90s
&nbsp;·&nbsp; 🤖 `npx -y keryx-mcp@latest` — plug Keryx into any MCP agent
&nbsp;·&nbsp; 🧩 [Fork the Arc primitives](https://github.com/tang-vu/keryx-arc-primitives)

---

## The problem

The web's economics assume a human reader: you write, people visit, attention becomes ads,
subscriptions, tips. AI agents broke that contract. They read everything and send back nothing —
no click, no view, no cent. Every answer an assistant gives is built on someone's work, and that
someone is invisible at the exact moment their work proves its value.

Keryx (κῆρυξ — *herald*) exists to fix that one moment. It makes **citation itself the payment
event**: the instant an agent relies on your writing to answer a question, you are paid,
proportional to how much you helped, settled sub-cent in USDC on [Arc](https://docs.arc.network).
No accounts, no invoices, no ad tech. A creator onboards by pasting an RSS URL. An agent pays
because paying is cheaper than not knowing.

## What Keryx is

Keryx is a **citation-toll reading agent** — an autonomous reader with a wallet, and the payment
rail underneath it. Give it a question and a budget:

1. It **decomposes** the question into sub-claims and **discovers** exact article candidates from free previews and the signed offer book.
2. It **decides**, per article version: *buy / skip / cache* — expected value vs effective price vs remaining budget,
   with a human-readable rationale for every choice.
3. It **pays the x402 toll** only for what it buys, checks **sufficiency** after each read, and
   stops early when it has enough.
4. It **synthesizes** a grounded answer with inline citations, **weighs each source's real
   contribution**, and **settles a weighted USDC nanopayment to every creator it cited** —
   multi-author works split on-chain, 100% to creator wallets, 0% platform fee.

The result is a working micro-economy: readers that pay by default, and writers that earn by
being *useful* — not by being clicked.

## An agent that genuinely decides

Most "payment agents" are scripts with a wallet. Keryx's differentiator is **visible agency** —
the model reasons about money and shows its work, streamed live to the UI:

- **Buy / skip / cache with rationale** — every spend decision names the exact article version and explains why.
- **Open article market** — [`/market`](https://keryx.cc/market) and `GET /api/offers` publish exact payable versions, registry list prices, x402 paths, and verifiable EIP-712 discounts signed by publishers.
- **Adjudication** ⚖️ — when two sources conflict, the agent doesn't average them; it decides which
  to trust and says why.
- **Confidence verdict** 📊 — it rates its own answer (High / Moderate / Low) and hedges the prose
  accordingly, instead of bluffing.
- **Evidence ledger** — every rewarded citation carries a claim-indexed exact quote. The
  orchestrator verifies that quote against content it actually read before the marker can receive
  a citation reward; rejected markers are removed from the answer.
- **Cross-query memory** — sources that proved useful (or useless) in past runs *on the same
  subject* shift future buy/skip decisions. A source is scored against the runs that actually read
  it, so a skip never becomes evidence against the source it skipped.
- **Semantic discovery** — candidate matching by embedding similarity, not keyword luck.
- **Emergent frugality** — it stops early, reuses its cache, and correctly spends *nothing* when
  nothing is worth buying.

Money safety is enforced in code, not by the model: the LLM proposes value; the orchestrator
enforces the hard budget cap, so a hallucinated number can never overspend. An economic-invariant
test suite (spend ≤ budget, payouts = weights, splits sum exactly) runs in CI on every push.

Example trace (real output):

```
[decide]  BUY Agent Economy Weekly — strong match on x402, autonomous, commerce; worth the $0.004 toll
[decide]  SKIP Garden & Soil Monthly — weak match (no key terms); not worth $0.002
[fetch]   Paid $0.004 to Agent Economy Weekly — S1
[sufficiency] Read 2 sources covering all sub-claims; stopping early to save budget
[settle]  Settled $0.015 → Mara Okoye · $0.010 → Devin Park   (60/40 author split)
📊 $0.032 spent → 100% to creators · 3 bought / 3 skipped
```

## For creators

- **Claim proven demand** — [keryx.cc/wanted](https://keryx.cc/wanted) shows claims paid
  dispatches left under-covered. Check your RSS feed, offer the exact matching post, and Keryx
  queues a bounded targeted retry after ownership verification. Fulfillment is public only when
  that source passes the evidence gate and its citation reward really settles. Every claim has a
  canonical shareable brief and social card, so the specific gap can reach the writer who covers it.
- **Onboard from your own wallet** — paste an RSS feed at [keryx.cc/register](https://keryx.cc/register)
  and your wallet writes the source to the on-chain registry itself. Keryx sets up the x402-priced
  endpoint and the free preview; it never holds your key, and the faucet on that page covers the gas.
  **All 20 listed sources are written to the on-chain registry**, including real public feeds —
  Hugging Face, Vitalik Buterin, CoinDesk, the Ethereum Foundation, Stripe, Latent Space,
  Simon Willison — each earning per citation.
- **Own your payout** — the payout address is the wallet you signed in with. The first owner-verified
  creator ([conzit.com](https://conzit.com)) proved feed ownership, set its address, was cited &
  paid end-to-end — and has since claimed its registry record from its own wallet, so its on-chain
  `creator` is the creator, not Keryx. We've also proposed this as an opt-in convention upstream in
  [RSSHub](https://github.com/DIYgod/RSSHub/discussions/22315).
  *Honest note:* the demo sources seeded before this switch still have operator-held payout keys —
  they are Keryx's own sample publications, not third-party creators. Nine of the twenty on-chain
  records also name Keryx's treasury as their registry `creator`, so the treasury, not the source
  wallet, can update or deactivate those nine. The payout address is correct on all twenty — an
  hourly watchdog re-reads every record from the chain and publishes the comparison on
  [`/status`](https://keryx.cc/status).
- **Know the moment you're cited** — opt into a plain **email alert** (no webhook server needed,
  rate-capped, one-click unsubscribe) and/or signed webhooks that fire the instant a citation
  settles; every payout on your public earnings page shows the actual *question* your work helped
  answer.
- **Show it off** — an embeddable **"Cited by Keryx" badge** (live SVG at `/api/creator/<id>/badge.svg`)
  displays your real citation count + USDC earned on your own site, with copy-paste Markdown/HTML on
  each creator page. Payouts become portable, verifiable proof.
- **Cash out yourself, gas-free** — a self-serve, non-custodial withdraw: your wallet signs a
  Gateway burn intent in the browser, the treasury relays gas. Real creators have executed real
  on-chain cash-outs.
- **Keep everything** — 100% of every citation reward goes to creator wallets. 0% platform fee.
- **Squat-proof identity** — sources live in an on-chain SourceRegistry
  ([`0x2e12Fa…`](https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536))
  with creator-scoped IDs and on-chain multi-author splits.

## For developers & agents

- **Free, no-wallet trial** — [keryx.cc](https://keryx.cc) answers without any setup, with a
  graceful upgrade path when you outgrow the free budget.
- **Browser extension** ([`extension/`](extension/)) — highlight text on any page and ask Keryx
  from a toolbar popup, or right-click to list a page you own as a paid source. A thin,
  no-key client over the OpenAI-compatible endpoint; load unpacked on any Chromium browser.
- **Remote MCP** — connect an MCP client directly to [`https://keryx.cc/mcp`](https://keryx.cc/mcp)
  over Streamable HTTP: no package or local wallet process. The `research` tool has an anonymous,
  IP-limited trial; an ask-scoped `kx_live_…` Bearer key raises the cap and attributes usage to its
  verified wallet. Creator rewards still settle in USDC on Arc. Quick connect:
  `codex mcp add keryx --url "https://keryx.cc/mcp?client=codex"` or
  `claude mcp add --transport http keryx "https://keryx.cc/mcp?client=claude"`.
  The interactive setup guide is at [`/integrations/mcp`](https://keryx.cc/integrations/mcp).
- **Local x402 MCP** — on the [official MCP registry](https://registry.modelcontextprotocol.io/v0/servers?search=keryx);
  `npx -y keryx-mcp@latest` keeps the caller-funded path: its local Arc wallet pays Keryx's x402
  toll before Keryx researches and pays creators.
- **Discord slash command** — [install the Keryx app](https://discord.com/oauth2/authorize?client_id=1527619548809924678)
  in any server and type `/ask`: the reply embed carries the grounded answer, every creator paid,
  and a link to the dispatch trace. No bot process — signed interactions POST straight to the API
  ([`docs/discord-bot-setup.md`](./docs/discord-bot-setup.md)).
- **Telegram bot** — DM [@keryxai_bot](https://t.me/keryxai_bot) any question (or `/ask …` in a
  group): same full reasoning loop, same real creator payouts, answered in-chat with a
  dispatch-trace link. Webhook-only, no polling process
  ([`docs/telegram-bot-setup.md`](./docs/telegram-bot-setup.md)).
- **Slack slash command** — a `/keryx …` command for any workspace: signed requests POST straight
  to `/api/slack/commands`, the same full reasoning loop and real creator payouts answered in-channel
  with a dispatch-trace link. No bot token or scopes — replies ride the command's `response_url`.
  Setup + app manifest in ([`docs/slack-bot-setup.md`](./docs/slack-bot-setup.md)).
- **Agent-to-agent API** — `POST /api/agent/ask` lets other agents buy Keryx's research over x402:
  an agent paying an agent that pays creators, end to end.
- **OpenAI-compatible endpoint** — point any OpenAI SDK or tool (LangChain, LlamaIndex, OpenWebUI,
  LibreChat, Continue) at `https://keryx.cc/api/v1` with model `keryx`: a drop-in Chat Completions
  API. Free with no key, or pass a `kx_live_…` key as the Bearer token for higher limits. Every
  cited creator is still paid downstream in USDC on Arc; with `stream:true`, the agent's live
  buy/skip/trust reasoning streams as `reasoning_content` deltas. Try it with no install in the
  [browser playground](https://keryx.cc/playground) — it also hands you the exact curl/Python/JS call.
- **Public API with wallet-issued keys** — SIWE-authenticated key minting (hashed, show-once,
  rate-limited) and OpenAPI docs at [`/api/docs`](https://keryx.cc/api/docs).
- **Non-custodial by design** — interactive spend uses a session EOA the *user* funds from their
  own wallet; the browser co-signs each x402 authorization in-tab. The funded amount is the hard
  cap. Keryx never holds your key or your funds.
- **The chain decides who gets paid** — before anything signs or settles, every payee is checked
  against the on-chain SourceRegistry, not against Keryx's database. Editing the database cannot
  reroute a single citation reward, on any path — browser, volume engine, or A2A.
- **Transparent treasury** — [`/api/treasury`](https://keryx.cc/api/treasury) publishes the
  settlement wallet's chain-abstracted Gateway balance (via Circle App Kit), so anyone can audit
  what backs the payouts.
- **Live activity feed** — [`/api/activity`](https://keryx.cc/api/activity) streams the most recent
  real settled citations (source, question, reward) — a proof-of-life surface and a zero-prior-knowledge
  way for tooling to see what Keryx is citing right now; it also drives the live ticker on the landing.
- **Answer archive as an Atom feed** — subscribe to [`/answers/feed.xml`](https://keryx.cc/answers/feed.xml)
  and see every new paid answer as it settles. Keryx onboards creators by reading their RSS feeds;
  this is the same door pointed the other way — Keryx itself becomes a source any reader or agent
  can follow.

## The money rails

Payments are the product, so none of them are pretend. **Policy: no mocked settlement** — every
reported figure is a real, settled transaction; offline dev runs are loudly labeled `SIMULATED`.

- **x402 pay-per-request** (`@circle-fin/x402-batching`) — a two-toll design: a small fixed
  *access* toll to read, plus a dynamic *citation* reward priced by contribution weight. Fetched
  but uncited earns the toll; cited earns proportionally more only after its evidence passes the
  deterministic grounding gate.
- **Circle Gateway nanopayments** — batched sub-cent settlement (floor $0.000001). Average Keryx
  payment: ~$0.0044 — a true nanopayment, uneconomical on any card rail.
- **Circle App Kit (Unified Balance Kit)** — chain-abstracted treasury balance, published live on
  [`/status`](https://keryx.cc/status) and [`/api/treasury`](https://keryx.cc/api/treasury).
- **SourceRegistry contract on Arc** — source identity, IPFS CIDs, multi-author splits; on-chain
  events drive the off-chain indexer.
- **Encrypted content on IPFS** — AES-256-GCM ciphertext pinned publicly; plaintext is released
  only after x402 settlement verifies. Free previews stay plaintext.
- **USDC-native chain** — Arc settles in <500ms with USDC as gas, which is what makes per-citation
  economics physically possible.

## Live numbers

*Arc testnet · snapshot 2026-07-23 · always current at [`/status`](https://keryx.cc/status)*

| | |
|---|---|
| On-chain nanopayments settled | **7,312** |
| Paid to creators | **$28.31** USDC → **22** creator wallets across **20** sources (100% of rewards, 0% fee) |
| Autonomous agent runs | **1,215** · **98.6%** reader→payer conversion |
| Entry paths | 527 payments / $3.26 via web + A2A · 6,785 / $28.77 via the volume engine |
| Creator cash-outs | **12** self-serve gasless withdrawals ($0.75) executed on-chain |

Top earners: Onchain Micropayments Digest $6.15 · Agent Economy Weekly $5.38 · Stablecoin Ledger
$5.17 · Ethereum Foundation $0.86 · Latent.Space $0.67 · CoinDesk $0.66 · Stripe Blog $0.66 ·
Cointelegraph $0.65 · Hugging Face $0.52 · Vitalik Buterin $0.46 · Simon Willison $0.43 ·
Conzit Labs $0.07 (owner-verified).

> **Honesty on usage:** most of this volume is generated by Keryx's own 24/7 autonomous agents
> (volume engine + headless web/A2A clients) — real on-chain settlement, agent-driven rather than
> external human traffic, and labeled as such on the dashboard. The external on-ramps (MCP server,
> A2A endpoint, owner-verified creators) are live; growing genuine third-party usage is the
> current push. Settlements batch through Circle Gateway, so on-chain proof is the batched
> settlement wallet + the SourceRegistry contract on [arcscan](https://testnet.arcscan.app), not
> per-payment tx links.

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
    ◀────────────────────────────────  /api/source/[id]/item/[itemId]?version=…
    client-side session key             /api/offers      (signed article price book)
                                        /api/cite        (citation reward)
    signs EIP-712                       /api/keys        (API key mint/verify)
    auto-signs (NO prompt)              /api/agent/ask   (A2A, x402-priced)
                                        /api/treasury    (App Kit unified balance)
                                        /api/docs        (OpenAPI)

    Agent brain (lib/agent/run-agent.ts):
    decompose→discover→decide→fetch→sufficiency→synthesize→attribute→settle
```

## Run it

**One command — the full cycle (~90s).** Decide → pay the x402 toll → read → synthesize → settle
weighted citation rewards, then print the Arc-testnet wallets whose USDC actually moved:

```bash
npm run demo -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
```

With `ANTHROPIC_API_KEY` + `AGENT_FUNDER_PRIVATE_KEY` + `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS` it
settles for real and prints on-chain proof; without them the same flow runs offline, clearly
labeled `SIMULATED` — a mock is never presented as settled.

```bash
# 1. Install (Node v20.18.2+)
npm install

# 2. Configure (optional — runs offline with zero keys)
cp .env.example .env.local

# 3. Wallets + demo sources
npm run generate-wallets
npm run seed-sources

# 4a. One question, full reasoning trace in the terminal
npm run ask -- "How do x402 and stablecoins enable autonomous AI agent commerce?" --budget 0.05

# 4b. Or the full web app (SIWE auth, session grants, browser co-sign)
npm run dev          # http://localhost:3939

# 5. Autonomous volume engine · live metrics
npm run seed -- --count 20
npm run metrics
```

| Mode | Reasoning | Payments | When |
|------|-----------|----------|------|
| **Offline dev** | heuristic, no LLM key | simulated, labeled | laptop, zero setup |
| **Server treasury** | Claude / DeepSeek | real Arc testnet (funder wallet) | volume engine, A2A |
| **User interactive** | Claude / DeepSeek | real Arc testnet (user-funded session EOA) | the web app |

## Built to stay up

Keryx runs as a real service, not a demo that dies after the video:

- **Public [`/status`](https://keryx.cc/status) + [`/api/health`](https://keryx.cc/api/health)** —
  uptime, deployed commit, settlement mode, live traction, treasury balance.
- **Low-downtime deploys** — new builds compile beside the live one, swap atomically, health-gate,
  and auto-roll-back if the new build doesn't come up (`npm run redeploy`).
- **Treasury watchdog** — hourly cron checks settlement-wallet USDC + gas against thresholds and
  alerts before settlements can stall; failed settlements alert immediately.
- **Rotating off-box backups** of the traction datastore, hourly.
- **CI** — typecheck + the economic-invariant suite on every push.
- **24/7 volume daemon** — the agent keeps reading, paying, and settling around the clock.

## Security & honest trade-offs

The interactive path is non-custodial, with the remaining testnet trade-offs documented (each with
an upgrade path in the [roadmap](./docs/project-roadmap.md)):

1. **Circle facilitator** — x402 settlement batches through Circle's facilitator (no on-chain
   alternative on Arc testnet yet).
2. **Server holds the IPFS decryption key** — content is encrypted at rest, but key release is
   server-side (Lit Protocol planned once Arc is supported).
3. **Session key lives in a Web Worker** — derived there, never returned; the tab holds only
   AES-GCM ciphertext under a non-extractable key. The worker signs payment authorizations to
   registry-authorised payees only, and transactions only to USDC/Gateway — so page-level XSS can
   neither steal the key nor name itself as payee. Residual: the derivation signature is produced
   on the main thread, a one-call window at setup.
4. **Treasury gas wallet** — holds gas only, rotated; a compromise cannot touch creator funds.

Full threat matrix and verification results: [`docs/security-threat-model.md`](./docs/security-threat-model.md).

## Fork the primitives

The reusable building blocks are MIT-licensed and standalone in
[`keryx-arc-primitives`](https://github.com/tang-vu/keryx-arc-primitives) (also vendored at
[`arc-primitives/`](./arc-primitives) — clone with `--recurse-submodules`):

- **Two-toll x402 settlement** — fixed access price + dynamic citation reward.
- **On-chain creator/attribution registry** — squat-proof IDs, multi-author splits, event indexer.
- **Non-custodial spend cap** — server-enforced budget over a user-funded session EOA.

## Project docs

- [`docs/openai-compatible-api.md`](./docs/openai-compatible-api.md) — drop-in recipes for OpenAI SDK, LangChain, LlamaIndex, Open WebUI, LibreChat, Continue
- [`docs/system-architecture.md`](./docs/system-architecture.md) — data/money flow + on-chain components
- [`docs/security-threat-model.md`](./docs/security-threat-model.md) — threat matrix, audits, residuals
- [`docs/codebase-summary.md`](./docs/codebase-summary.md) — module map
- [`docs/project-roadmap.md`](./docs/project-roadmap.md) — where this is going
- [`TRACTION.md`](./TRACTION.md) — real payment volume, updated from the live datastore
- [`FEEDBACK.md`](./FEEDBACK.md) — Circle/Arc dev-tool feedback we filed while building
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision log
- [`CLAUDE.md`](./CLAUDE.md) — contributor orientation

## Origin & where it's going

Keryx started at the **Lepton Agents Hackathon** (Canteen × Circle, on Arc, June 2026) as the
canonical build of the "herald" model — *content cited, paid per citation* — and never stopped
running. It has been live at [keryx.cc](https://keryx.cc) since, settling real value every hour,
onboarding real feeds, and shipping continuously in public. Next: Lit Protocol for client-side IPFS
key release, growing external agent traffic through the MCP and A2A on-ramps, and a single config
flag between this system and mainnet.

## Stack

Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · viem/wagmi · `@circle-fin/x402-batching` ·
`@circle-fin/unified-balance-kit` · `@x402/fetch` · Node `node:sqlite` / Supabase ·
Anthropic / DeepSeek. Built on the verified
[`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments) x402/Gateway plumbing.
