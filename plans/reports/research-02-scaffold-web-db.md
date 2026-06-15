# Arc Nanopayments Scaffold: Technical Reference

## 1. Data Model (Supabase Migrations)

### `public.payment_events` — Append-only log of settled x402 payments
`sql
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  endpoint text not null,
  payer text not null,
  amount_usdc text not null,
  network text not null,
  gateway_tx text,
  raw jsonb
);
`
**Columns:**
- id: UUID primary key
- created_at: Timestamp (auto-populated on insert)
- endpoint: Paywalled endpoint path (e.g. /api/premium/quote)
- payer: Buyer wallet address (0x format)
- mount_usdc: Payment amount as string (decimal, e.g. "0.001")
- 
etwork: Network identifier (e.g. "eip155:5042002" for Arc Testnet)
- gateway_tx: Transaction hash (nullable)
- aw: Full settle result + requirements as JSONB (nullable)
- RLS: Public read, service_role insert only

### `public.withdrawals` — Audit trail for Gateway withdrawals
`sql
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  amount_usdc text not null,
  destination_chain text not null,
  destination_address text not null,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'failed')),
  tx_hash text
);
`
**Columns:**
- id: UUID primary key
- created_at: Timestamp (auto-populated)
- mount_usdc: Withdrawal amount (string, decimal)
- destination_chain: Chain name (e.g. "arcTestnet", "baseSepolia", etc.)
- destination_address: Recipient wallet address
- status: ENUM-like check constraint: 'submitted' | 'confirmed' | 'failed'
- 	x_hash: Mint transaction hash (nullable)
- RLS: Public read, service_role insert/update only
- Realtime: Both tables published to `supabase_realtime` for live subscriptions

---

## 2. How Transactions/Settlements Are Recorded

**Flow:**
1. Buyer calls x402-protected endpoint without payment header → receives 402 Payment Required with payment requirements
2. Buyer signs authorization + submits `payment-signature` header (base64-encoded JSON)
3. Server validates via `BatchFacilitatorClient.verify()` against payment requirements
4. Server settles via `BatchFacilitatorClient.settle()` → returns transaction hash + payer address
5. **Insert to `payment_events`:**
   - `endpoint`: route path
   - `payer`: `settleResult.payer ?? verifyResult.payer ?? "unknown"`
   - `amount_usdc`: converted from atomic units (requirements.amount / 1e6)
   - `network`: Arc Testnet network ID ("eip155:5042002")
   - `gateway_tx`: `settleResult.transaction`
   - `raw`: `{ requirements, settleResult }` (full context)

**Trigger:** `lib/x402.ts` → `withGateway()` middleware wraps all premium endpoints. After `facilitator.settle()` succeeds, supabase insert fires (logged to db via service-role credentials).

---

## 3. Dashboard Metrics

**Location:** `/dashboard` (protected by hardcoded session cookie)

### Components Displayed:
1. **Gateway Balance Badge** (top bar, `TopBarGatewayControls`)
   - Displays: `\.XXXXXX USDC available`
   - On-click opens `GatewayBalanceDialog` showing:
     - Gateway Available / Total / Withdrawing / Withdrawable (all in USDC)
     - Wallet USDC balance (from ERC20 balanceOf on Arc Testnet)
   - Refreshes on INSERT to `payment_events` or UPDATE to `withdrawals`

2. **Payments Tab** (main table, real-time, paginated)
   - Columns: Transaction (hash, linked to explorer), Payer (address), Endpoint, Amount (USDC), Date
   - Filter: tx hash / payer / endpoint (case-insensitive substring)
   - Sort: By amount (numeric) or date (lexicographic)
   - Pagination: 10/25/50/100 rows per page
   - Real-time: Subscribes to INSERT/UPDATE/DELETE on `payment_events`

3. **Withdrawals Tab** (main table, real-time, paginated)
   - Columns: Transaction (mint tx hash), Destination (address), Chain, Status (badge), Amount (USDC), Date
   - Filter: tx hash / destination address / chain / status
   - Sort: By amount or date
   - Pagination: Same as Payments
   - Real-time: Subscribes to INSERT/UPDATE/DELETE on `withdrawals`

**Aggregations:** None (raw row counts only); timestamps formatted to `YYYY-MM-DD HH:MM`

---

## 4. API Routes

### Premium (Paywalled) Endpoints
All wrapped with `withGateway()` middleware; return 402 if no valid payment:

| Route | Method | Price | Handler | Response |
|-------|--------|-------|---------|----------|
| `/api/premium/quote` | GET | \.001 | Returns inspirational quote JSON | `{ quote, category, timestamp }` |
| `/api/premium/dataset` | GET | \.01 | Returns analytics dataset | `{ dataset: [...], generated_at }` |
| `/api/premium/compute` | POST | \.0003 | Text analysis (word/sentence/char count) | `{ summary, word_count, sentence_count, char_count, timestamp }` |
| `/api/premium/agent-task` | GET | \.03 | Treasure hunt clue randomizer | `{ clue, step, total_steps, timestamp }` |

### Gateway Management Endpoints
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/gateway/balance` | GET | Fetch seller Gateway balance + wallet USDC balance. Queries Circle Gateway API + Arc Testnet RPC. Returns `{ wallet: { balance }, gateway: { total, available, withdrawing, withdrawable } }` |
| `/api/gateway/withdraw` | POST | Initiate withdrawal from Gateway to recipient on destination chain. Body: `{ amount, destinationChain, destinationAddress? }`. Pre-checks: seller has gas, available balance ≥ amount, destination chain gas available. Calls `gateway.withdraw()`, records to `withdrawals` table with status 'submitted', updates to 'confirmed' or 'failed' after on-chain settlement. Returns `{ id, txHash, amount, sourceChain, destinationChain, recipient, status }` |

---

## 5. Server Actions (`app/actions.ts`)

| Action | Purpose | Side Effects |
|--------|---------|--------------|
| `login(formData)` | Hardcoded check: email === `admin@example.com` && password === `123456`. Sets `session` cookie (httpOnly, 1-day max-age). Redirects to `/dashboard`. | Returns `{ error }` if creds invalid; else redirect |
| `logout()` | Deletes `session` cookie. Redirects to `/`. | No return |

---

## 6. Supabase Setup

**Config:** `supabase/config.toml`
- Local Docker: Ports 54321 (API), 54322 (DB), 54323 (Studio)
- Migrations: `supabase/migrations/20260310000000_create_tables.sql` + `20260310000001_enable_realtime.sql`
- Seed: `supabase/seed.sql` (enabled in config)
- Realtime: Enabled for `payment_events` and `withdrawals`
- Auth: JWT 1-hour expiry, signup enabled, email confirmations disabled

**Clients:**
- Server-side: `lib/supabase/server.ts` → `createServerClient()` (handles cookies, SSR)
- Browser: `lib/supabase/client.ts` → `createBrowserClient()` (client-only)
- Service role: Used in API routes to insert/update payment/withdrawal records

**Realtime Subscriptions:**
- `usePaymentEvents()`: Subscribes to INSERT/UPDATE/DELETE on `payment_events`, maintains state, deduplicates
- `useWithdrawals()`: Same pattern for `withdrawals` table

---

## 7. Frontend Stack

**Framework:** Next.js 16.1.6 (App Router, TypeScript)
**React:** 19.2.4
**UI Library:** shadcn/ui (Radix UI components) + Tailwind CSS 4.2.1
**Icons:** lucide-react
**Toast:** sonner
**Form/Validation:** zod
**Payment Client:** @x402/core, @x402/evm (x402 protocol signing)
**Web3:** viem 2.47.1 (Ethereum utility, ERC20 read, contract calls)

**Key Pages:**
- `/`: Sign-in form (hardcoded credentials)
- `/dashboard`: Main seller dashboard (session-protected)
- `/dashboard/layout.tsx`: Header with TopBarGatewayControls + logout button

---

## 8. Request → Pay → Record → Display Flow

### Buyer Perspective (Agent):
1. Agent calls `/api/premium/quote` (no auth header)
2. Receives 402 + `PAYMENT-REQUIRED` header (base64 JSON with payment requirements)
3. Decodes requirements → signs authorization using buyer private key via x402 SDK
4. Retries request with `payment-signature` header (base64 JSON)
5. Server validates & settles
6. Client receives response + `PAYMENT-RESPONSE` header (confirms success)

### Seller Perspective (Dashboard):
1. `withGateway()` middleware settles payment → inserts to `payment_events`
2. Realtime subscription on `payment_events` table fires → React hook updates state
3. Dashboard table re-renders new row
4. TopBar Gateway Balance component simultaneously subscribes to same INSERT → fetches `/api/gateway/balance` → updates displayed balance
5. User can withdraw via `WithdrawDialog` → POST to `/api/gateway/withdraw`
6. Route inserts 'submitted' record to `withdrawals` table → calls `gateway.withdraw()` → updates record to 'confirmed'/'failed'
7. Withdrawal subscription fires → updates withdrawals tab in real-time

### Data Flow Diagram:
`
Payment Authorization (x402 SDK)
  ↓
POST /api/premium/quote + payment-signature header
  ↓
withGateway() middleware:
  - Verify payment signature
  - Settle via BatchFacilitatorClient
  - Insert to payment_events (settleResult.transaction, payer, amount)
  ↓
Response + PAYMENT-RESPONSE header
  ↓
Supabase Realtime:
  - payment_events INSERT triggers
  - usePaymentEvents() hook updates React state
  - Dashboard table re-renders
  - TopBar balance fetches via GET /api/gateway/balance
`

---

## Key Technical Facts (Concise)

- **Payment Settlement:** Circle's x402-batching SDK (`BatchFacilitatorClient`) verifies & settles offchain signatures, batches to onchain via Gateway. Arc Testnet USDC: `0x3600000000000000000000000000000000000000`
- **Amount Precision:** All USDC stored as string decimals (6 decimal places), e.g. "0.001"
- **Auth:** Hardcoded demo credentials (admin@example.com / 123456), session cookie, no JWT
- **Realtime:** Supabase PostgreSQL realtime subscription triggers on table INSERTs/UPDATEs/DELETEs
- **Cross-Chain Withdrawals:** Uses Circle Gateway's CCTP (Cross-Chain Transfer Protocol); supported chains: Arc Testnet, Base Sepolia, Ethereum Sepolia, Arbitrum Sepolia, Optimism Sepolia, Avalanche Fuji, Polygon Amoy
- **Explorer Links:** Hardcoded to https://testnet.arcscan.app/ for Arc Testnet transactions
- **Gas Management:** Withdrawals pre-check seller wallet has native tokens on source & destination chains
- **Schema Simplicity:** Only 2 tables; no user/merchant model; single seller workflow

---

## Unresolved/Friction Points

1. **Hardcoded Credentials:** Demo auth (admin@example.com / 123456) — not production-grade; no user model, no API key rotation
2. **Amount Precision:** String-based USDC amounts; potential floating-point drift if calculations not careful (though currently read-only after settlement)
3. **Gateway API Errors:** `/api/gateway/balance` falls back gracefully to zeros if Circle Gateway API is down; no retry logic
4. **Withdrawal Gas Checks:** Pre-flight checks use `gateway.getBalances()` which may be async race condition if user drains wallet between check & submit
5. **Realtime Deduplication:** usePaymentEvents/useWithdrawals deduplicate by ID but don't handle concurrent UPDATEs from multiple clients (last-write-wins)
6. **Pagination State:** Dashboard pagination resets when filter/sort changes (UX friction for large datasets)
7. **Agent Task Endpoint:** `/api/premium/agent-task` price (\.03) is highest but content is just random clue string — price-to-value unclear