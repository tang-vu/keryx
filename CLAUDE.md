# CLAUDE.md — Keryx

Orientation for any Claude Code session in this repo. Read this first, then `PLAN.md` and `DECISIONS.md`.

## What this is
**Keryx** = a citation-toll reading agent. A user/agent asks a question + budget. Keryx autonomously
decides which paid content sources to buy (x402), reads enough to answer, synthesizes a grounded
answer with citations, and settles a **weighted nanopayment to each source it actually cited** —
creators get paid per citation, in USDC on Arc. Built for the Lepton (Canteen × Circle) hackathon.

The winning angle is **visible agency**: every buy/skip/cache/stop choice is model-reasoned and logged
with a human-readable rationale, streamed live to the UI.

## Architecture
- **Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui** — web app, API routes, dashboard.
- **`lib/agent/`** — the brain: decompose → discover → decide → fetch → sufficiency → synthesize → attribute → settle. Emits a structured reasoning trace.
- **`lib/x402.ts`** — Circle x402 seller wrappers (`withGateway` fixed price, `withDynamicGateway` citation reward). Buyer side uses `@circle-fin/x402-batching` `GatewayClient.pay`.
- **`lib/llm/`** — provider-agnostic LLM (Anthropic default, heuristic fallback). Streaming.
- **`lib/db/`** — swappable persistence: SQLite (dev) / Supabase (prod). Tables: `sources`, `authors`, `queries`, `decisions`, `payment_events`, `cache_items`.
- **`app/api/source/[id]`** — x402-protected creator content (payTo = creator wallet). `/preview` is free.
- **`app/api/cite/[id]`** — dynamic-price x402 citation reward to creator wallet(s).
- **`scripts/`** — `ask.mts` (run one query, print reasoning), `seed-engine.mts` (volume engine), `generate-wallets.mts`.

## Arc testnet constants (verified)
- Chain: `eip155:5042002` (id `5042002`), viem chain `arcTestnet` (built into viem).
- USDC: `0x3600000000000000000000000000000000000000` (ERC-20 = 6 decimals; native gas USDC = 18 decimals).
- Gateway wallet contract: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`.
- RPC: `https://rpc.testnet.arc.network` · Explorer: `https://testnet.arcscan.app`.
- Gateway balance API: `https://gateway-api-testnet.circle.com/v1/balances` · CCTP domain `26`.
- Faucet: `https://faucet.circle.com/` (Arc Testnet, 20 USDC / 2h per address).
- The x402-batching SDK needs **only funded wallets + RPC** — no Circle API account for the core demo path.

## Env / setup
- Node v20.18.2+ (have v24). `pnpm` or `npm`. `.mts` scripts run via `node --experimental-transform-types`.
- Copy `.env.example` → `.env.local`. `npm run generate-wallets` fills wallet keys.
- Keys: `ANTHROPIC_API_KEY` (LLM), `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (prod DB),
  `SELLER_ADDRESS`/`BUYER_PRIVATE_KEY` etc. (wallets). Missing LLM/Supabase → offline dev mode (heuristic + SQLite).

## Run commands
- `npm run dev` — web app (localhost:3000).
- `npm run ask -- "<question>" --budget 0.05` — run the agent once, print the reasoning trace.
- `npm run seed` — volume engine over the question bank.
- `npm run generate-wallets` — create seller + funder wallets into `.env.local`.

## CLIs available
- `circle` (v0.0.5): `gateway deposit/balance/withdraw`, `services search/inspect/pay`, `feedback submit`, `contract address`.
- `arc-canteen` (ARC CLI): `login`, `rpc`, `rpc-url`, `push` (traction), `status`, `ls`.

## Reference code (read-only, NOT in repo)
`C:/Users/tangm/_hackathon_ref/` — `arc-nanopayments` (primary scaffold), `circle-agent`, `arc-escrow`, `arc-commerce`, `ARC-cli`. Ground-truth reports in `plans/reports/`.

## Rules
- **No mocked settlement in the demo path** — payments must really settle on Arc testnet.
- Secrets only in `.env.local` (gitignored). Never commit keys.
- Mainnet behind a single config flag; never spend real money without explicit go-ahead.
- Report only real, settled transactions in any metric.
- Keep files < ~200 lines; kebab-case names. Log a rationale for every agent decision.
