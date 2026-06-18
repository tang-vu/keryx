# Keryx Codebase Summary

**Version:** 0.2.0 (Decentralized dApp, 2026-06-18)

This document maps the codebase structure for the non-custodial Keryx dApp. Organized by domain; files < 200 LOC per kebab-case naming standard.

---

## Core Agent Brain

### `lib/agent/`
Core decompose→discover→decide→fetch→sufficiency→synthesize→attribute→settle loop. Reads via stable `KeryxDB` interface; agnostic to persistence layer.

| File | Purpose |
|------|---------|
| `run-agent.ts` | Main agent orchestrator. Yields reasoning traces via async generator. Powers both server-side (volume engine) and interactive (SSE). |
| `steps/` | Each step (decompose, discover, decide, etc.) as a separate generator function. |
| `decisions.ts` | Agent decision log: buy/skip/cache per source, with rationale. |
| `prompts.ts` | LLM system/user prompts for each step. |

---

## Authentication & Authorization

### `lib/auth.ts`
JWT session management (SIWE-signed, stateless, httpOnly cookie). Role = creator / dev / asker, resolved at mint from on-chain registry or env allowlist.

| Function | Purpose |
|----------|---------|
| `getSession(req)` | Extract + verify JWT; return `{ address, role }` or 401. |
| `requireRole(role)` | Middleware; 401 if session role ≠ required. |
| `isCreatorWallet(addr)` | Query DB: is this address a registered creator? |
| `generateNonce()` | Create 5-min nonce for SIWE. |

### `app/api/auth/`
SIWE nonce/verify/signout routes.

| Route | Method | Purpose |
|-------|--------|---------|
| `/nonce` | GET | Issue httpOnly nonce cookie (5m TTL). |
| `/verify` | POST | SIWE message + signature → JWT session cookie + user JWT. |
| `/signout` | POST | Clear cookies. |

### `lib/wagmi-config.ts`
Wallet connect configuration. Chains (Arc testnet), storage (cookie), wallets (injected + WalletConnect).

---

## Payments & Settlement

### `lib/payments/`
Multi-backend payment gateway with common interface. Selects backend at runtime based on context (session grant present → browser co-sign; funder key present → real; else offline).

| File | Purpose |
|------|---------|
| `payment-gateway.ts` | Interface defining `payFetch()` + `payCitation()`. |
| `real-gateway.ts` | `RealGateway`: server-side x402 via Circle's `GatewayClient`. Used by volume engine + A2A. |
| `browser-cosign-gateway.ts` | `BrowserCoSignGateway`: browser co-signs via session key. SSE flow emits sign-requests, /api/ask/sign resolves them. |
| `offline-gateway.ts` | `OfflineGateway`: heuristic offline mode. No keys, `settled:false`. |
| `session-grants.ts` | Session grant store: track user-funded session EOAs, spend cap, spent-to-date per tab. |
| `index.ts` | Factory selecting the right gateway backend. |

### `lib/x402-server.ts`
x402 response wrapper: adds 402 challenge header to content, verifies EIP-712 payment authorization before serving.

### `app/api/session/`
Session management endpoints (grant creation, credit/revoke).

| Route | Purpose |
|-------|---------|
| `/grant` | POST: user claims session EOA, cap, tx hash → store grant. |
| `/credit` | GET: check grant balance + spent. |
| `/revoke` | POST: withdraw residual Gateway balance back to user. |

### `app/api/ask/`
Agent entrypoint (SSE) + signature return handler.

| Route | Purpose |
|-------|---------|
| `/` (POST) | Stream agent execution. On BUY, emit `sign-request` event. |
| `/sign` (POST) | Browser resolves pending sign-request with signed EIP-712 header. |

---

## Smart Contracts & On-Chain

### `contracts/`
Hardhat project. SourceRegistry.sol tracks sources on Arc testnet.

| File | Purpose |
|------|---------|
| `SourceRegistry.sol` | `registerSource()`, `updateSource()`, `deactivateSource()`. Emits events; creator-scoped IDs; multi-author splits. |
| `test/` | Hardhat tests (security threats, split edge cases, creator gating). |
| `deploy.ts` | Deploy script. Output: deployed address. |

**Deployed on Arc testnet (2026-06-18):**
- Address: `0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`
- Deploy block: `47474631`
- Deploy tx: `0x3844…97cd` (funder wallet)

### `lib/registry/`
On-chain registry client + off-chain indexer cache.

| File | Purpose |
|------|---------|
| `registry-client.ts` | viem contract client. `registerSource()`, `getSource()`, `getSources()`. |
| `indexer.ts` | Poll Arc RPC for SourceRegistry events; cache in DB as `sources` table. Runs on app startup. |
| `event-types.ts` | Event typings (SourceRegistered, SourceUpdated, etc.). |

---

## Content & Encryption

### `lib/ipfs/`
Encrypted content on IPFS. Pinata client + server-side AES-256-GCM encryption/decryption.

| File | Purpose |
|------|---------|
| `pinata-client.ts` | Upload + retrieve from Pinata IPFS (app-managed gateway). |
| `content-crypto.ts` | AES-256-GCM encrypt (upload) + decrypt (server-side, post-payment-verify). |
| `index.ts` | Public interface. |

**Design:** Content uploaded encrypted to IPFS (ciphertext only). Plaintext decryption occurs inside x402 `produce()` callback after payment verification. Free preview served plaintext.

---

## Database & Persistence

### `lib/db/`
Swappable SQLite (dev) / Supabase (prod) via `KeryxDB` interface.

| File | Purpose |
|------|---------|
| `keryx-db.ts` | Interface: `getSources()`, `createSource()`, `getQueries()`, `getPayments()`, etc. |
| `sqlite-adapter.ts` | SQLite impl (Node built-in `sqlite`). `ensureColumns()` idempotent migrations. |
| `supabase-adapter.ts` | Supabase impl (for Vercel deployments). |
| `schema.ts` | DDL: sources, authors, queries, decisions, payment_events, cache_items, api_keys, session_grants. |

**Key tables:**
- `sources`: URL hash, creator wallet, IPFS CID, split config
- `payment_events`: fetch toll + citation reward per source + cite intent
- `api_keys`: SHA-256 hashed keys, per-creator minting
- `session_grants`: user-funded session EOA, cap, spent

---

## API & Public Interface

### `app/api/`
RESTful endpoints for agent, sources, metrics, API keys.

| Route | Auth | Purpose |
|-------|------|---------|
| `/ask` | SIWE JWT or API key | Stream agent execution (SSE) + sign-requests. |
| `/ask/sign` | SIWE JWT | Receive browser-signed EIP-712 header. |
| `/sources` | GET: public, POST: creator JWT | List sources / register new source. |
| `/source/[id]` | x402 challenge | Fetch content (returns 402 if unpaid, plaintext after x402 settle). |
| `/cite/[id]` | x402 challenge | Citation reward endpoint (dynamic price). |
| `/keys` | SIWE JWT | Mint / verify API keys. |
| `/payments` | SIWE JWT | Fetch user's payment history + earnings. |
| `/metrics` | public | Aggregate traction: total settled, top sources, query volume. |
| `/session/*` | SIWE JWT | Grant / credit / revoke session. |
| `/docs` | public | OpenAPI (Scalar UI). |
| `/faucet` | public | Testnet USDC drip (Arc native token). |

### `components/ask/use-ask-stream.ts`
React hook for SSE stream + sign-request/response loop. Handles connection, back-off, abort, session scoping.

---

## Utilities & Config

### `lib/config.ts`
Centralized config. Sources: env vars, defaults, offline fallbacks.

| Key | Type | Purpose |
|-----|------|---------|
| `jwtSecret` | string | HMAC secret for JWT |
| `llmProvider` | 'anthropic' \| 'deepseek' \| 'heuristic' | LLM source |
| `registryAddress` | hex (0x…) | SourceRegistry on Arc |
| `registryDeployBlock` | number | Indexer start block |
| `pinataJwt` | string | Pinata API key |
| `contentMasterKey` | hex | AES-256-GCM encryption key |
| `forceOffline` | boolean | Run heuristic + no settlement |
| `devWallets` | string[] | Env allowlist for dev role |

### `lib/hooks/use-session-grant.ts`
React hook for session key generation, funding tx, grant creation. Manages session state (key in tab, grant active/revoked).

### `lib/llm/`
Provider-agnostic LLM abstraction.

| File | Purpose |
|------|---------|
| `index.ts` | Factory: Anthropic / DeepSeek / heuristic. |
| `providers/` | Per-provider implementations (streaming response handling). |

---

## Scripts

### `scripts/`
CLI tools for admin + dev. Node --experimental-transform-types.

| Script | Purpose |
|--------|---------|
| `ask.mts` | Run agent once, print reasoning trace. |
| `seed-sources.mts` | Populate DB with demo sources. |
| `seed-engine.mts` | Volume engine: run agent N times with random questions. |
| `metrics.mts` | Print aggregate traction (settled USDC, top sources, query count). |
| `generate-wallets.mts` | Create funder + seller EOAs, write to .env.local. |
| `arc-update.mts` | Push traction snapshot to Arc Canteen (for keryx.cc product card). |
| `ingest-source.mts` | Add source from external registry to local DB. |
| `migrate-content-to-ipfs.mts` | Batch encrypt + pin existing content. |

---

## UI Components

### `components/`
React 19 + Tailwind 4 + shadcn/ui + Keryx Mint design system.

| Dir | Purpose |
|-----|---------|
| `keryx/` | Design system: guilloche, engraver icons, coin, banknote frame SVGs. |
| `ask/` | Ask form, reason trace display, payment receipt. |
| `connect/` | Wallet connect button (custom Radix). |
| `ledger/` | Creator earnings dashboard. |
| `nav/` | Top nav, footer. |

### `app/`
Next.js 16 App Router.

| Route | Purpose |
|-------|---------|
| `/` | Hero + CTA (ask or register). |
| `/connect` | Wallet connect + SIWE sign-in. |
| `/register` | Creator onboarding: wallet (auto-filled), source metadata, splits. |
| `/ask` | Ask page: question form, session grant, agent execution (live trace). |
| `/ledger` | Creator earnings + payments (requires creator JWT). |
| `/dev` | Admin dashboard (requires dev JWT). |
| `/faucet` | Testnet USDC drip. |

---

## Type Definitions

### `types/`
Shared TypeScript interfaces for agent, payments, registry, DB.

| File | Exports |
|------|---------|
| `index.ts` | `PaymentEvent`, `Source`, `Author`, `QueryRun`, `SessionGrant`, `ApiKey`. |

---

## Build & Config Files

| File | Purpose |
|------|---------|
| `next.config.ts` | Next.js config (ESM, SWC). |
| `tsconfig.json` | TypeScript paths, strictNullChecks, JSX React 19. |
| `tailwind.config.ts` | Tailwind setup + Keryx Mint colors. |
| `hardhat.config.ts` | Hardhat: Arc testnet, viem, test timeout. |
| `.env.example` | Template env vars. |
| `package.json` | v0.2.0, deps (Next 16, React 19, wagmi, viem, circle-fin/x402-batching, pinata, siwe, jose, rate-limiter-flexible, tailwindcss, hardhat). |

---

## Key Files by Purpose

### "I want to understand the payment flow"
1. `lib/payments/payment-gateway.ts` (interface)
2. `lib/payments/browser-cosign-gateway.ts` (user flow)
3. `lib/payments/real-gateway.ts` (server/volume flow)
4. `app/api/ask/route.ts` (SSE orchestrator)
5. `lib/x402-server.ts` (challenge + verify)

### "I want to add a new source"
1. `contracts/SourceRegistry.sol` (on-chain registration)
2. `lib/registry/registry-client.ts` (client)
3. `app/api/sources/route.ts` (POST handler, SIWE gated)
4. `app/register/page.tsx` (UI form)

### "I want to encrypt / decrypt content"
1. `lib/ipfs/content-crypto.ts` (AES-256-GCM)
2. `lib/ipfs/pinata-client.ts` (IPFS upload/fetch)
3. `app/api/source/[id]/route.ts` (post-payment release)

### "I want to add auth to a route"
1. `lib/auth.ts` (`getSession()`, `requireRole()`)
2. `app/api/auth/verify/route.ts` (SIWE verify)
3. Any route: `const session = await getSession(req)` at top

### "I want to run the agent"
1. `lib/agent/run-agent.ts` (main loop)
2. `scripts/ask.mts` (CLI entry)
3. `app/api/ask/route.ts` (HTTP SSE entry)

---

## Dependencies Map

| Domain | Key Dependencies |
|--------|------------------|
| Web3 / Auth | `wagmi@3`, `viem@2`, `siwe@3`, `jose@6` |
| Payments | `@circle-fin/x402-batching@2`, `@x402/core@2`, `@x402/evm@2` |
| Storage | `node:sqlite` (dev), `@supabase/supabase-js` (prod) |
| IPFS | `pinata@2`, Node `crypto` (built-in) |
| LLM | `@anthropic-ai/sdk` (default) |
| UI | `next@16`, `react@19`, `tailwindcss@4`, `shadcn/ui`, `radix-ui` |
| Smart Contracts | `hardhat@2`, `@nomicfoundation/hardhat-toolbox@5`, `@nomicfoundation/hardhat-viem@2` |
| Rate Limit | `rate-limiter-flexible@11` |
| Utils | `zod@3` (validation), `sonner@2` (toast), `rss-parser@3` (RSS) |

---

## Offline Dev Mode Invariant

Files must support `KERYX_FORCE_OFFLINE=1` (no LLM key, no REGISTRY_ADDRESS, no funder key):
- `lib/agent/run-agent.ts`: heuristic reasoning fallback
- `lib/llm/index.ts`: no error if LLM provider unavailable
- `lib/payments/index.ts`: select `OfflineGateway` if no funder key
- `app/api/ask/route.ts`: no sign-requests emitted in offline mode

---

## Test Coverage

- `contracts/test/` — Hardhat tests for SourceRegistry (security threats, splits, creator gating). Verified: 16/16 pass.
- Integration tests via `npm run ask` and manual E2E (connect → fund → ask → settle).
- No formal unit test suite yet (test-driven after MVP validation on hackathon judges).

---

## Post-Hackathon Roadmap

1. **Web Crypto non-exportable keys** — Replace sessionStorage with crypto.subtle signing (no XSS export).
2. **Lit Protocol** — Once Arc is added to Lit's supported chains, use Lit for IPFS key release (eliminate server key-holder trust).
3. **Redis rate-limit** — Replace in-process `rate-limiter-flexible` for multi-instance deployments.
4. **On-chain deposit verify** — Query Gateway balance API before marking grant active (closes R2 residual).
5. **Signed author manifest** — Server returns signed author-wallet list for citation payTo validation (closes R1 residual).
6. **Client-side keygen** — Let users self-custody creator wallets on registration (eliminate server key generation for offline-seed path).
