# Keryx System Architecture

**Version:** 0.2.0 Decentralized dApp (2026-06-18)  
**Status:** Shipped (Phases 01–06 complete)

---

## System Overview

Keryx is a non-custodial AI citation-payment agent dApp on Arc testnet. The system spans three domains:

1. **User browser** — SIWE wallet auth, session key generation, x402 co-signing
2. **Backend services** — agent brain, DB, IPFS encryption, API keys
3. **Blockchain + Circle** — SourceRegistry on Arc, x402 settlement via Circle Gateway, USDC as settlement token

---

## High-Level Data Flows

### User Interactive Flow (Web App)

```
BROWSER                              KERYX SERVER                     ARC + CIRCLE
────────                             ────────────                     ────────────

1. User visits keryx.cc
   ├─ See hero + "Ask" CTA
   └─ Not authed → /connect button

2. Connect Wallet (MetaMask Arc Testnet)
   ├─ wagmi detects wallet
   ├─ GET /api/auth/nonce → receive nonce cookie (5m TTL)
   └─ User signs SIWE message in wallet (no tx)

3. POST /api/auth/verify {message, signature}
   ├─ Server: siwe.verify() + role derivation (creator/dev/asker)
   └─ Return: JWT session cookie (7d TTL) + httpOnly flag

4. User on /ask page
   ├─ If low on USDC → /faucet drip (testnet only)
   └─ Click "Fund Session"

5. Fund Session (one MetaMask tx)
   ├─ Browser: generatePrivateKey() → ephemeral session key (held in tab)
   ├─ sessAddr = privateKeyToAccount(sk).address
   ├─ User: MetaMask tx ×1 → Transfer(sessAddr, budget) + native-USDC for gas
   └─ Browser: viem GatewayClient.deposit(budget) into Circle Gateway

6. POST /api/session/grant {sessAddr, budget, txHash}
   ├─ Server stores grant: {sessAddr, cap, spent:0, status:active}
   └─ Session is now funded and ready

7. User asks question + sets budget
   ├─ POST /api/ask {question, budget, sessionId}
   └─ Server streams SSE:

8. SSE Loop: Agent Execution (inside agent/run-agent.ts)
   ├─ decompose: break question into sub-claims
   ├─ discover: query registry, find candidate sources
   ├─ decide: BUY / SKIP per source (rationale logged)
   │
   │  ON BUY:
   │  ├─ emit SSE event: sign-request {reqId, payTo, amount, verifyingContract, ...}
   │  ├─ Browser receives → builds EIP-712 msg from requirements
   │  ├─ Browser signs with session key sk (NO wallet prompt)
   │  ├─ POST /api/ask/sign {sessionId, reqId, paymentHeader}
   │  └─ Server resolves pending promise, retries source with header
   │
   ├─ fetch: GET /api/source/[id] with x402 payment-signature header
   │  └─ Server: x402 verify → decrypt IPFS content → emit SSE "step: fetched"
   │
   ├─ sufficiency: "have we read enough?" → STOP if yes, next BUY if no
   ├─ synthesize: LLM answer + [S#] citations
   ├─ attribute: weight each source by contribution (0..1)
   └─ settle: emit SSE "settle" + USDC-to-wallet breakdown

9. SSE Done: event: done {summary, settled_amount, creator_payouts}
   └─ Browser shows receipt

10. User revokes session (optional)
    ├─ POST /api/session/revoke
    ├─ Browser: GatewayClient.withdraw() residual balance
    └─ Grant marked revoked, in-flight runs abort
```

### Server-Side Volume Engine (No Browser)

```
/scripts/seed-engine.mts                KERYX SERVER                  ARC + CIRCLE
───────────────────────               ────────────                   ────────────

1. npm run seed -- --count 20

2. Load random questions from question bank
   └─ For each: collectRun() (lib/agent/index.ts:13-27)

3. Selection: no SIWE session → use server treasury
   ├─ RealGateway selected
   ├─ Funder key (AGENT_FUNDER_PRIVATE_KEY) funds spend wallet
   └─ Server-side x402 settlement (not browser co-sign)

4. Agent execution (same brain: lib/agent/run-agent.ts)
   ├─ Real x402 settlement to sources
   └─ Real weighted citation payout

5. Store payment_events, metrics → SQLite or Supabase
   └─ Used by /api/metrics + keryx.cc dashboard
```

### Creator Registration Flow

```
BROWSER                      KERYX SERVER                   ARC TESTNET
────────                     ────────────                   ───────────

1. Creator visits keryx.cc/register
   └─ Connect Wallet + SIWE sign-in (same as user flow)

2. Creator form
   ├─ Wallet address (auto-filled from SIWE)
   ├─ Source URL
   ├─ IPFS CID (upload via Pinata first, or use plaintext)
   ├─ Author splits (self 100%, or multi-author)
   └─ Tags (topic keywords)

3. POST /api/sources (SIWE JWT required, role=creator)
   ├─ Server: Create source in DB (sources table)
   ├─ Server: Call SourceRegistry.registerSource(url, cid, splits, tags)
   └─ Arc RPC: Tx settled, SourceRegistry emits SourceRegistered event

4. Indexer (async)
   ├─ Poll Arc RPC for events from SourceRegistry
   ├─ Cache event data in DB (sources table)
   └─ Enables fast discovery in subsequent /ask runs

5. Creator sees earnings
   ├─ GET /api/payments (SIWE JWT required)
   └─ Shows all payment_events where creator_wallet = session.address
```

---

## Component Interactions

### Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────┐
│ SIWE (Sign-In-With-Ethereum)                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. wagmi v3 + viem v2 connect wallet on Arc testnet chain       │
│ 2. GET /api/auth/nonce → server issues nonce (5m cookie)        │
│ 3. Client SIWE message build: domain, chainId 5042002, nonce    │
│ 4. User signs in wallet (non-custodial, no tx)                  │
│ 5. POST /api/auth/verify {message, signature}                   │
│    ├─ siwe.verify() checks: signature, nonce, domain, chainId   │
│    ├─ Delete nonce (single-use)                                 │
│    ├─ Role derivation: isCreatorWallet(addr) from registry?     │
│    │                   isDevWallet(addr) from env allowlist?    │
│    │                   else: asker                              │
│    └─ jose.signJWT {address, role, exp: 7d} → httpOnly cookie   │
│ 6. getSession(req) in route handlers: verify JWT, return {addr, role}
│                                                                  │
│ No server accounts. No password. Wallet = identity.             │
└─────────────────────────────────────────────────────────────────┘
```

### Non-Custodial Payment Spend

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser Co-Sign Session Key Spend                               │
├─────────────────────────────────────────────────────────────────┤
│ 1. User funds session EOA (one MetaMask tx)                     │
│    ├─ generatePrivateKey() → ephemeral session key (tab memory) │
│    ├─ sessAddr = privateKeyToAccount(sk).address                │
│    └─ MetaMask tx: USDC.transfer(sessAddr, budget)              │
│                                                                  │
│ 2. POST /api/session/grant {sessAddr, budget, txHash}           │
│    └─ Server: verify tx on Arc RPC, store grant record          │
│                                                                  │
│ 3. Browser: GatewayClient.deposit(budget)                       │
│    └─ Session EOA credits budget into Circle Gateway            │
│                                                                  │
│ 4. On each source BUY (inside agent loop):                      │
│    SSE event: sign-request {reqId, payTo, amount, ...}          │
│    ├─ Browser: builds EIP-712 msg from payTo/amount/contract   │
│    ├─ Browser: signTypedData(msg) with session key sk (NO prompt)
│    ├─ POST /api/ask/sign {sessionId, reqId, signedHeader}       │
│    └─ Server: resolves pending promise, retries with header     │
│                                                                  │
│ 5. x402 verify: Circle verifies EIP-712 signature               │
│    └─ Source received payment from session EOA                  │
│                                                                  │
│ Spend cap = funded amount. Only browser signs. Server sees no key.
└─────────────────────────────────────────────────────────────────┘
```

### On-Chain Registry

```
┌─────────────────────────────────────────────────────────────────┐
│ SourceRegistry (Arc testnet 0x2e12Fa...)                        │
├─────────────────────────────────────────────────────────────────┤
│ Solidity contract: registerSource(url, cid, splits, tags)       │
│                                                                  │
│ Source ID = keccak256(msg.sender, urlHash)                     │
│   → creator-scoped: same URL, different creator = different ID  │
│   → prevents URL squatting                                       │
│                                                                  │
│ Splits: {[author_addr]: basis_points} Σ = 10,000              │
│   → multi-author split hardcoded on-chain                       │
│   → payout split deterministic, transparent                     │
│                                                                  │
│ Events: SourceRegistered, SourceUpdated, SourceDeactivated      │
│   → Emitted on every register/update/deactivate                 │
│   → Off-chain indexer polls Arc RPC → caches in DB (sources)    │
│                                                                  │
│ Access control: onlyCreator modifier                            │
│   → msg.sender must match the source's creator wallet           │
└─────────────────────────────────────────────────────────────────┘

Indexer Loop (every ~30s in production):
├─ Query Arc RPC: logs from SourceRegistry since last polled block
├─ Parse events: extract (url, creator, cid, splits, tags)
├─ Store in DB sources table (caches on-chain state)
└─ Enables fast /ask discovery without querying Arc every time
```

### Encrypted Content & IPFS

```
┌─────────────────────────────────────────────────────────────────┐
│ IPFS Content Encryption & Payment-Gated Decryption              │
├─────────────────────────────────────────────────────────────────┤
│ UPLOAD PATH:                                                    │
│ 1. Creator provides source content (plaintext or already ciphr)  │
│ 2. Server: AES-256-GCM encrypt {plaintext, CONTENT_MASTER_KEY}  │
│ 3. Server: Upload ciphertext to Pinata IPFS                     │
│ 4. Server: Store CID in DB sources.content_cid                  │
│                                                                  │
│ FETCH PATH (x402):                                              │
│ 1. Agent decided BUY → server GET /api/source/[id]              │
│ 2. x402 GET included 402 challenge header from IPFS CID fetch   │
│ 3. Browser signs EIP-712 → POST /api/ask/sign                   │
│ 4. Server: verifies x402 signature                              │
│ 5. Inside x402.produce() callback:                              │
│    ├─ Fetch ciphertext from Pinata (CID known)                  │
│    ├─ AES-256-GCM decrypt {ciphertext, CONTENT_MASTER_KEY}      │
│    └─ Return plaintext (now paid for)                           │
│ 6. Agent reads plaintext content → includes in synthesis        │
│                                                                  │
│ FREE PREVIEW:                                                   │
│ GET /api/source/[id]/preview → plaintext (no x402, 10% excerpt) │
│                                                                  │
│ Trade-off: Server holds CONTENT_MASTER_KEY. Upgrade path: Lit.   │
└─────────────────────────────────────────────────────────────────┘
```

### Settlement & Accounting

```
┌─────────────────────────────────────────────────────────────────┐
│ Settlement & Attribution (End of Agent Loop)                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Agent synthesizes answer + cites sources [S1], [S2], ...      │
│ 2. Agent computes attribution weights:                          │
│    ├─ S1 weight = 0.6 (heavily cited)                           │
│    ├─ S2 weight = 0.3 (moderately cited)                        │
│    └─ S3 weight = 0.1 (mentioned once)                          │
│                                                                  │
│ 3. Total citation reward budget = (total_spent × citation_rate) │
│    e.g., spent $0.10 on 3 sources, citation_rate = 50% →       │
│    citation_pool = $0.05 (rest goes to fetch toll)              │
│                                                                  │
│ 4. For each cited source (S1, S2, ...):                         │
│    ├─ POST /api/cite/[id] with weight                           │
│    ├─ x402 dynamic price: min($0.0001, weight × citation_pool)  │
│    ├─ Verify settlement → payout to source author wallet        │
│    └─ Store in DB payment_events (type: citation)               │
│                                                                  │
│ 5. Multi-author split (from SourceRegistry):                    │
│    ├─ payOut $0.015 → author_addr_1: 60%, author_addr_2: 40%   │
│    └─ Circle verifies split on its end (Keryx sends 1 tx)       │
│                                                                  │
│ 6. Store aggregate in payment_events:                           │
│    ├─ source_id, payout_wallet, amount, timestamp, query_id    │
│    └─ Used by /api/metrics + creator /api/payments dashboard   │
│                                                                  │
│ Two-tier: fetch_toll (small, per-buy) + citation_reward (scaled)│
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Persistence

### Database Schema

**`sources`** — one per registered creator source
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| url | TEXT | canonical source URL |
| url_hash | BLOB | keccak256(url) for on-chain ID |
| creator_wallet | TEXT | SIWE-authed creator address |
| content_cid | TEXT | IPFS CID (encrypted plaintext) |
| splits | JSON | {author_addr: bp, ...} (10,000 sum) |
| tags | TEXT | comma-delimited (topic keywords) |
| status | TEXT | active / deactivated |
| created_at | DATETIME | registration timestamp |
| on_chain_source_id | TEXT | from SourceRegistry event |

**`payment_events`** — one per BUY or citation
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| query_id | TEXT | links to queries |
| source_id | TEXT | links to sources |
| payout_wallet | TEXT | recipient (author wallet) |
| amount_usdc | REAL | USDC settled (6 decimals) |
| type | TEXT | fetch_toll \| citation_reward |
| tx_hash | TEXT | Arc tx (if settled) |
| settled | BOOLEAN | true = on-chain confirmed |
| timestamp | DATETIME | when payment occurred |

**`queries`** — one per agent run
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| question | TEXT | user question |
| asker_wallet | TEXT | who asked (SIWE) |
| budget_usdc | REAL | user-requested budget |
| spent_usdc | REAL | actual amount spent |
| answer | TEXT | synthesized answer |
| trace | JSON | reasoning log (compact) |
| created_at | DATETIME | query timestamp |

**`api_keys`** — creator-issued API keys
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| creator_wallet | TEXT | issuer (SIWE auth) |
| key_hash | TEXT | SHA-256(rawKey) — stored hash only |
| name | TEXT | human label |
| usage_count | INTEGER | incremented per /api/agent/ask call |
| last_used | DATETIME | tracking |
| created_at | DATETIME | mint timestamp |

**`session_grants`** — user-funded session EOAs
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| session_id | TEXT | browser tab identifier |
| session_address | TEXT | funded EOA (viem generated) |
| grant_cap_usdc | REAL | user-funded amount |
| spent_usdc | REAL | cumulative spend |
| status | TEXT | active \| revoked |
| created_at | DATETIME | when grant issued |
| expires_at | DATETIME | grant TTL (12h default) |

---

## Deployment Topology

### Local Development
```
localhost:3939                   Node.js server
├─ Next.js 16 App Router        + SQLite (data/keryx.db)
├─ Wagmi hooks (client-side)     + Hardhat + Arc testnet RPC
├─ Agent brain + offline gateway + Optional Anthropic API key
└─ SSE + /api/ask endpoint
```

### VPS Production (keryx.cc)
```
keryx.cc (Cloudflare CNAME)
├─ VPS Node.js server (pm2)      + SQLite (/var/data/keryx.db — on disk)
├─ Cloudflare Tunnel             + SourceRegistry indexer (polls Arc RPC)
├─ HTTPS reverse proxy           + Pinata IPFS gateway
├─ Volume engine (cron or npm run seed)
└─ Traction metrics (live dashboard)
```

### CI/CD
- **Commit hook**: linting, build check
- **Push to main**: deploy script runs, restarts app, backfills indexer
- **Release**: tag + GitHub release + traction update via `arc-canteen`

---

## Security & Trust Model

### Non-Custodial Guarantees
1. **User funds** live in session EOA + Circle Gateway balance (user holds the key)
2. **Server never holds** user private keys or session keys (key held in browser tab)
3. **Payment cap** enforced server-side AND browser-side (spend cannot exceed funded amount)
4. **Source wallet validation** — fetch-toll payTo verified against on-chain registry

### Threat Coverage
- **SIWE nonce replay** → single-use + 5-min expiry
- **JWT forgery** → HMAC HS256 verification + exp check
- **Unauthorized registry update** → onlyCreator modifier + on-chain verification
- **Server x402 amount inflation** → browser independently tracks signed total
- **Content tampering** → IPFS immutable hash, x402 payload hash verified
- **Private key exposure** → grep audit (no `sk`, `CONTENT_MASTER_KEY`, or `JWT_SECRET` in logs/responses)

**Documented residuals** (trade-offs, tracked):
- R1: Citation payTo redirect under full compromise (cap-bounded; author manifest fix post-hackathon)
- R2: Grant funding not on-chain verified (retry fails at Gateway; balance API check post-hackathon)
- R3: Session key in sessionStorage (XSS surface cap-bounded; Web Crypto non-exportable post-hackathon)
- R4: Grant state lost on server restart (acceptable for testnet; persist grant metadata post-hackathon)

See `docs/security-threat-model.md` for full matrix.

---

## Scaling & Future Paths

### Limitations (Testnet MVP)
- **In-process rate-limit**: `rate-limiter-flexible` — single-instance only
- **Indexer polling**: every 30s, no backpressure if Arc RPC slow
- **IPFS key on server**: no client-side decryption without server trust
- **Source enumeration**: `sourceIds[]` call is O(n), not paginated

### Post-Hackathon Roadmap
1. Redis rate-limit → multi-instance scale
2. Event-only indexing (subscribe to Arc finality)
3. Lit Protocol key release (once Arc added to Lit)
4. Pagination + cursor-based source discovery
5. Multi-tenant enterprise tier (API key scoping, custom SourceRegistry deployments)

---

## Metrics & Observability

### Live Metrics (/api/metrics)
```json
{
  "total_settled_usdc": 125.43,
  "total_queries": 847,
  "unique_askers": 142,
  "top_sources": [
    {"source_url": "...", "citations": 124, "earnings_usdc": 8.75}
  ],
  "creators": {
    "count": 14,
    "total_earned_usdc": 125.43
  },
  "uptime_hours": 72.5
}
```

### Traction Updates
- **Hourly**: aggregate metrics pushed to Arc Canteen (keryx product card)
- **Weekly**: snapshot in `TRACTION.md` (manual + automated via `npm run arc:update`)
- **Per settlement**: logged to SQLite payment_events for audit trail

---

## API Surface (RESTful + OpenAPI)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| POST `/api/ask` | JWT or API key | Stream agent execution (SSE) |
| POST `/api/ask/sign` | JWT | Receive browser-signed EIP-712 |
| GET `/api/sources` | public | List sources (paginated) |
| POST `/api/sources` | creator JWT | Register new source |
| GET `/api/source/[id]` | x402 | Fetch source content (402 if unpaid) |
| GET `/api/source/[id]/preview` | public | Free plaintext preview |
| POST `/api/cite/[id]` | x402 | Citation reward endpoint |
| GET `/api/keys` | creator JWT | List API keys |
| POST `/api/keys` | creator JWT | Mint new API key (show once) |
| DELETE `/api/keys/[key_id]` | creator JWT | Revoke key |
| GET `/api/payments` | creator JWT | Creator earnings history |
| GET `/api/metrics` | public | Aggregate traction |
| POST `/api/session/grant` | JWT | Create session grant |
| GET `/api/session/credit` | JWT | Check grant balance |
| POST `/api/session/revoke` | JWT | Withdraw residual, revoke grant |
| GET `/api/faucet` | public | Testnet USDC drip (2h cooldown per address) |
| GET `/api/docs` | public | OpenAPI spec (Scalar UI) |

---

## Conclusion

Keryx's dApp architecture distributes trust: users fund themselves (non-custodial), sources register on-chain 
(transparent), payments settle via Circle (auditable), and the agent brain reasons over immutable content 
(IPFS hash-verified). The browser co-sign flow lets users transact without approving each payment, while 
the cap remains hard.

All phases (01–06) shipped 2026-06-18. See `plans/260618-0025-*/` for implementation details and 
`docs/security-threat-model.md` for verified threat coverage.
