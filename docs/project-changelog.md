# Keryx Project Changelog

**Last Updated:** 2026-06-22  
**Current Version:** 0.3.0

All significant changes, features, and fixes from v0.1 (citation-toll agent) to v0.2 (decentralized dApp).

---

## v0.3.0 — 2026-06-22 — Visible agency + external-agent onboarding

Release wave gathering the work since v0.2.0 (64 commits): the non-custodial session-payment path
made reliable end-to-end, the on-chain SourceRegistry catalog published with verifiable provenance,
the A2A endpoint made discoverable (GET x402 challenge), a 24/7 traction daemon, a full demo-path
hardening pass, every public spend endpoint capped + rate-limited, and two new visible features —
the **live budget meter** and the **"call Keryx from your own agent"** card. Detailed entries below.

---

## Post-Launch Fixes (v0.2.x)

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
