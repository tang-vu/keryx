# Keryx Project Roadmap

**Version:** 0.14.0 (coverage-aware Quick/Deep research and aggregate activation, updated 2026-08-23)
**Status:** In continuous operation at [keryx.cc](https://keryx.cc) — real settlement 24/7, shipping in public.

---

## Where Keryx is today (v0.14.0, August 2026)

Shipped and running:
- ✓ Non-custodial dApp core (SIWE auth, on-chain SourceRegistry, browser co-sign sessions, encrypted IPFS content, public API + keys)
- ✓ SourceRegistry live on Arc testnet (`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`)
- ✓ Agent capabilities: adjudication of conflicting sources, confidence verdicts, cross-query memory, semantic discovery
- ✓ Creator lifecycle end-to-end: RSS onboarding → owner verification → citation webhooks → public earnings pages → self-serve gasless cash-out
- ✓ External on-ramps: MCP server (npm + official registry), A2A x402 endpoint, free no-wallet trial
- ✓ Ops: low-downtime health-gated deploys, treasury + registry-parity watchdogs, rotating off-box backups, CI (typecheck + economic-invariant suite)
- ✓ Circle stack: x402 + Gateway batching + Wallets + Contracts + App Kit (Unified Balance on `/status` + `/api/treasury`)
- ✓ Public proof dossier: deployed commit + CI, independent usage, RPC/index parity, Circle balance
  parity, and ArcScan-resolvable creator cash-outs on `/proof`
- ✓ Security threat model current through S41 · Hardhat 16/16 · vitest suite green
- ✓ Quick/Deep research modes, free-preview coverage pre-check, and a privacy-preserving 30-day
  reader/creator activation funnel with no actor-level analytics rows

Live figures at [`/status`](https://keryx.cc/status); snapshots in [TRACTION.md](../TRACTION.md).

---

## Timeline & Phases

### Phase 01–06: Decentralized dApp (Complete)

| Phase | Title | Status | Shipped |
|-------|-------|--------|---------|
| 01 | SIWE Wallet Auth (3 roles) + Session Foundation | ✓ Done | 2026-06-18 |
| 02 | On-Chain SourceRegistry + Indexer (DB-as-cache) | ✓ Done | 2026-06-18 |
| 03 | Non-Custodial Browser Co-Sign (Session Key) | ✓ Done | 2026-06-18 |
| 04 | IPFS Encrypted Content + Payment-Gated Decryption | ✓ Done | 2026-06-18 |
| 05 | Public API Productization (Keys + Rate-Limit + OpenAPI) | ✓ Done | 2026-06-18 |
| 06 | Security Hardening + Integration Validation | ✓ Done | 2026-06-18 |

**Key Artifacts:**
- Phase documentation: `plans/260618-0025-*/phase-0X-*.md`
- Security verification: `docs/security-threat-model.md`
- Codebase: `docs/codebase-summary.md`

---

## Next Phases (Q3 2026)

### Phase 07: Security Upgrades (Priority: High) — In progress

**Goals:** Eliminate documented trade-offs + close residuals (R1–R4).

| Task | Description | Status | Notes |
|------|-------------|--------|-------|
| On-chain payTo guard | Citation + fetch payTo validated against SourceRegistry, in the browser *and* on the server | ✓ Done 2026-07-09 | Supersedes the "author manifest" idea below. Narrows R1 |
| Gateway-verified grant cap | Grant cap clamped to the USDC Circle's Gateway actually holds | ✓ Done 2026-07-09 | Closes R2 |
| Persist grant state | Grants in the `session_grants` table; `spent` survives a restart, expired rows swept at boot | ✓ Done 2026-07-09 | Closes R4 |
| Worker session key | Key derived and held in a dedicated Web Worker; tab stores only AES-GCM ciphertext under a non-extractable wrapping key; the worker refuses unauthorised payees and any transaction outside USDC/Gateway | ✓ Done 2026-07-09 | Narrows R3 |
| On-chain registration live | Registry switched on: creators register from their own wallet, indexer projects events into the cache | ✓ Done 2026-07-10 | Ends server-generated payout keys for new sources |
| Lit Protocol | Integrate Lit for client-side IPFS key release | Blocked | Closes C2; needs Arc on Lit's chain list |
| Signed content receipts | Registry owner signs exact full-text hash/bytes/URL; ciphertext-only IPFS or encrypted DB fallback + encrypted cache | ✓ Done 2026-08-10 | Manifest authenticates content, never payout or pricing |

**Two plan corrections found while building:**
- *"Web Crypto non-exportable session key"* is not achievable as written. `SubtleCrypto` supports
  P-256/384/521, never secp256k1, so an Ethereum key cannot be a non-exportable `CryptoKey`. The
  worker + wrapped-ciphertext design above is the reachable version of the same goal.
- *"Server signs an author-wallet manifest"* would have been signed by a key held on the very host
  the manifest is meant to protect against, and would have done nothing for the volume-engine and
  A2A paths, which have no browser. Reading the on-chain registry instead needs no new key, and
  covers every path.

---

### Phase 08: Scalability (Priority: Medium) — Est. 1.5 weeks

**Goals:** Production-ready multi-instance deployment.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| Durable rate-limit | Fixed-window counters in the DB, atomic single-statement consume; in-process limiter kept as the fail-degraded fallback | ✓ Done 2026-07-20 | Closes the real hole (deploys reset every counter, and the web + traction processes counted separately). `lib/rate-limit-store.ts`, migration `0014`. Redis not needed: one shared SQLite file covers every process on the box, and the Supabase path is already shared. **Multi-VPS still needs a shared store** — reopen this row with Redis (or Supabase for both boxes) when the load balancer lands |
| Event-only indexer | WebSocket log subscription wakes the checkpointed getLogs pass; heartbeat poll (30s) backstops WS drops | ✓ Done 2026-07-16 | Near-instant source discovery; idle RPC load cut ~85% vs the 4s poll |
| Cursor pagination | Source list pagination (limit + offset/cursor) | ✓ Done 2026-07-16 | `GET /api/sources?limit=&cursor=` — opt-in (default stays the full list: the browser payTo allowlist must be exhaustive); stable (createdAt, id) cursor survives same-second bulk imports and mid-page deactivations; in OpenAPI spec |
| Multi-instance deploy | Load balancer, session persistence | ✗ Dropped 2026-07-21 | Owner decision: one small VPS is the deployment, and a load balancer in front of a box this size buys nothing. Reopen only if real traffic forces it |
| **Phase 08 Total** | | Closed | Durable limits shipped; horizontal scale dropped as YAGNI |

---

### Phase 09: User Experience (Priority: Medium) — Est. 1 week

**Goals:** Streamline onboarding + session lifecycle.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| Preset funding amounts | Quick-pick chips ($0.05 / $0.25 / $1 — sized to real Keryx budgets) on activate + top-up | ✓ Done 2026-07-12 | `usdc-preset-chips.tsx` |
| Session refresh UI | Live expiry countdown; warn at 10 min; one-click extend (no signature, no gas — worker re-registers the grant); one-click resume from "expired" | ✓ Done 2026-07-12 | `session-active-card.tsx`; TTL is 1h (`KERYX_SESSION_GRANT_TTL`), not 12h as first planned |
| Preview depth control | Creator choice: full summary / short excerpt / titles-only, owner-gated from the profile; the agent scores on exactly what a free reader sees | ✓ Done 2026-07-12 | `lib/sources/preview-depth.ts`; incentive dial, grandfathers every existing row as "full" |
| Bulk import | Paste many feed URLs or an OPML export → one shared feed-read + dedupe, then sequential on-chain register (one signature per source; the contract has no batch register). One wallet-scoped token verifies them all in a single pass | ✓ Done 2026-07-12 | `lib/ingest/feed-list.ts`, `app/api/sources/bulk`, `bulk-import-form.tsx`; single-register core extracted to `lib/sources/prepare-registration.ts` and reused |
| **Phase 09 Total** | | ~1w | Complete |

---

### Phase 10: Enterprise Tier (Priority: Low) — Est. 2 weeks

**Goals:** Multi-tenant API + audit/compliance.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| API key scoping | Keys scoped to specific sources / operations | ✓ Done 2026-07-20 | Scopes `ask` / `export` enforced on both ask paths + the export; optional pin to source ids, always intersected with live ownership. Pre-scopes keys (NULL) keep every scope. `lib/api-key-scopes.ts`, migration `0013` |
| Custom registry | Deploy SourceRegistry per customer | ✗ Dropped 2026-07-21 | Owner decision: no B2B customer asking for it. Speculative infrastructure, cut |
| Audit export | Payment + query history in CSV / JSON | ✓ Done 2026-07-19 | Two scopes: `GET /api/creator/[id]/export` (one source, public, linked from the creator page) and `GET /api/creator/export` (whole portfolio, private — SIWE session or `kx_live_` key, linked from `/dev`). Formula-injection-safe CSV; deactivated sources included |
| Fiat on-ramp | Stripe / Ramp integration for testnet-to-mainnet USDC | ✗ Dropped 2026-07-21 | Owner decision: pointless while Keryx is testnet-only. Revisit as part of mainnet migration, not before |
| **Phase 10 Total** | | Closed | Scoping + audit export shipped; the speculative half cut |

---

## Milestone: Mainnet Migration (Q4 2026)

**Goals:** Production hardening + real-money settlement.

### Mainnet Readiness Checklist
- [ ] Phase 07–09 complete (security + scale + UX)
- [ ] Arc mainnet + Sepolia testnet dual deployment
- [ ] Security audit (external firm)
- [ ] Insurance coverage (Nexus mutual or similar)
- [ ] Rate-limit observability (error budgets + SLO)
- [ ] Creator support (email + Discord)
- [ ] Fiat on/off-ramp (Stripe connected accounts)
- [ ] Legal + compliance (terms, privacy, AML thresholds)

### Mainnet Channels
| Chain | USDC | Status | Notes |
|-------|------|--------|-------|
| Arc mainnet | Native 6-decimal | Q4 2026 | Primary settlement rail |
| Ethereum mainnet | ERC-20 (via bridge) | Q4 2026 (optional) | Cross-chain liquidity |
| Base mainnet | ERC-20 (via bridge) | Q4 2026 (optional) | Creator flexibility |

---

## Stretch Goals (Beyond MVP)

### Platform Extensions
- **Agent Marketplace** — publish trained agents (vs. sources); reward top creators
- **Integrations** — ✓ all shipped: Slack `/keryx`, Discord `/ask`, Telegram bot, and citation
  email alerts (2026-07-23 — per-source opt-in, rate-capped, dark until an email provider key is set)
- **Reputation** — creator leaderboard, verified badge, insurance pool
- **Derivatives** — citation futures (hedge payment volatility), author NFT (stake on quality)

### Content Types
- **Video** — encrypted video on IPFS; timestamp-gated citation (e.g., "cite 12s–45s")
- **Datasets** — query-gated access (e.g., "cite row 42–60"); differential privacy
- **Models** — inference-gated (e.g., "run model, cite result"); on-device settlement
- **Real-time** — live ticker / index; citation per update tick

### Cross-Chain
- **Multichain sources** — source metadata on Polygon + settlement on Arc
- **Atomic swaps** — USDC-to-EURC or stablecoin pairs per creator preference
- **Liquidity pools** — Uniswap v4 hooks for citation reward swapping

---

## Success Criteria by Phase

### Phases 01–06 (Shipped ✓)
- [x] SIWE auth end-to-end (connect → sign → JWT)
- [x] SourceRegistry on-chain (deploy → indexer → cache)
- [x] Browser co-sign non-custodial spend (session key → cap-enforced)
- [x] IPFS encrypted content (upload → store CID → post-payment decrypt)
- [x] Public API (x402 + API keys + OpenAPI)
- [x] Security verified (living matrix + secret grep audit)
- [x] Integration: all phases work together
- [x] Offline dev mode preserved
- [x] VPS deployment ready

### Phase 07 (Security Upgrades)
- [ ] Separate-origin signer boundary removes the one-time derivation-signature XSS residual
- [ ] Lit Protocol integration deployed (once Arc added to Lit)
- [ ] Residuals R1–R4 closed (verified in threat model)
- [ ] No security regressions (all current threat-matrix entries pass)

### Phase 08 (Scalability)
- [ ] Redis rate-limit in production (multi-instance load test ≥1000 qps)
- [ ] Event indexer real-time (finality latency < 30s)
- [ ] Pagination supports 1M+ creators (cursor query < 100ms)
- [ ] HA deployment with zero downtime rolling updates

### Phase 09 (UX)
- [ ] Onboarding funnel: 50% reduction in time-to-first-ask
- [ ] Creator registration: bulk import enables 100+ sources in 1 hour
- [ ] Session UX: 90% of users complete ask without session expiry
- [ ] Net Promoter Score ≥ 40 (beta creator feedback)

### Phase 10 (Enterprise)
- [ ] Enterprise tier: ≥5 B2B customers (SaaS model)
- [ ] Custom registry: ≥3 white-label deployments
- [ ] Fiat on-ramp: ≥20% of USDC inflow via Stripe
- [ ] Audit export: SOC 2 Type II compliance ready

### Mainnet Migration
- [ ] Arc mainnet live (real USDC settlement)
- [ ] TVL in Creator Reward Pool ≥ $500k
- [ ] Daily active creators ≥ 100
- [ ] Monthly settled volume ≥ $50k
- [ ] Uptime SLA ≥ 99.9% (12-month track record)

---

## Dependency Graph

```
Phase 01 (SIWE)
    ├─ unblocks 02, 03, 05 (all need identity)
    │
Phase 02 (Registry)
    ├─ unblocks 03 (spend targeting), 04 (CID storage)
    │
Phase 03 (Browser Co-Sign)
    ├─ parallel to 04 (no shared code)
    │
Phase 04 (IPFS)
    ├─ depends on 02 (CID storage)
    │
Phase 05 (API)
    ├─ depends on 01 (JWT/API key auth)
    │
Phase 06 (Security)
    ├─ tests 01–05
    │
Phase 07 (Security Upgrades) ← blocked on: Lit chain support, Circle API docs
Phase 08 (Scalability) ← blocked on: nothing (after 07)
Phase 09 (UX) ← parallel to 07/08
Phase 10 (Enterprise) ← parallel to 07/08/09
Mainnet ← blocked on: Phase 07–10, security audit, legal
```

---

## Risk & Backpressure

| Risk | Severity | Mitigation | Owning Phase |
|------|----------|-----------|--------------|
| Lit Protocol not supporting Arc by Q3 | Medium | Fallback: Threshold Network + time-lock decryption | Phase 07 |
| Circle API rate-limit on Gateway balance checks | Low | Batch query + local cache (TTL 1h) | Phase 07 |
| Mainnet USDC bridge delays (CCTP) | Medium | Native Arc USDC primary; bridges optional | Mainnet |
| Creator adoption plateau | Medium | Experiment: affiliate rewards, integrations (Slack) | Phase 09–10 |
| Regulatory clarity on stablecoin payments | High | Monitor SEC/CFTC guidance; legal review | Mainnet |

---

## Communication & Feedback

### Build-in-public loop
- **Demo script:** [DEMO.md](../DEMO.md) (sub-3-minute walkthrough)
- **Dev-tool feedback we file upstream:** [FEEDBACK.md](../FEEDBACK.md) (Circle/Arc DX findings)
- **Frequent updates:** product + traction snapshots via `arc-canteen` (keryx.cc product card)

### Creator Feedback Channels
- **Email:** vutang2212@gmail.com
- **Discord:** TBD (community server)
- **GitHub:** Issues + Discussions (this repo)
- **Twitter/X:** @KeryxAgent (updates, feature requests)

---

## Resource Allocation

### Team
- **Lead:** 1 (Tang Vu) — architecture, phase planning, security
- **Researchers:** On-demand — new tech validation (Lit, Threshold, Ramp)
- **Reviewers:** On-demand — security audit, mainnet go/no-go

### Infrastructure
- **VPS:** keryx.cc (Linode or AWS EC2, $50–100/mo)
- **IPFS:** Pinata (free tier + paid if > 1GB, ~$20/mo)
- **Database:** SQLite on-disk (VPS) + Supabase backup (free tier)
- **RPC:** Arc public RPC (free) + Infura/Alchemy (optional, paid)

### Budget (6-month estimate)
| Item | Cost | Notes |
|------|------|-------|
| VPS (6 months) | $300–600 | keryx.cc infra |
| Pinata (6 months) | $120 | IPFS storage |
| Domain (1 year) | $15 | keryx.cc renewal |
| Security audit (1x) | $3–5k | External firm (Q4) |
| **Total** | ~$4–6k | Assumes volunteer dev (you) |

---

## Version Plan

| Version | Date | Focus | Status |
|---------|------|-------|--------|
| **v0.2.0** | 2026-06-17 | Decentralized dApp core (Phases 01–06) | ✓ Shipped |
| **v0.3.0** | 2026-06-22 | Creator lifecycle (withdrawals, webhooks, earnings pages) + MCP/A2A on-ramps | ✓ Shipped |
| **v0.4.0** | 2026-07-02 | Agent depth (adjudication, confidence, memory) + ops hardening + App Kit | ✓ Shipped |
| **v0.5.0** | 2026-07-16 | Security residuals closed (Phase 07) + registry write-mode + OpenAI-compatible API + extension + answer archive | ✓ Shipped |
| **v0.6.0** | 2026-07-21 | Chat front doors (Discord/Telegram/Slack) + creator ledger exports + scoped keys + durable limits + Atom feed (Phases 09–10 closed) | ✓ Shipped |
| **v0.7.0** | 2026-07-28 | Evidence-gated citations, exact-quote ledger, coverage-bound confidence and structured receipts | ✓ Shipped |
| **v0.8.0** | 2026-07-28 | Wanted-claim creator offers, durable targeted retries, evidence + settlement fulfillment receipts | ✓ Shipped |
| **v0.8.1** | 2026-07-31 | Cross-provider reasoning failover, circuits, and per-step attempt receipts | ✓ Shipped |
| **v0.9.0** | 2026-08-05 | Exact article-version discovery, x402 purchase, cache, evidence, citation, and receipts | ✓ Shipped |
| **v0.10.0** | 2026-08-05 | Public article price book, EIP-712 publisher offers, agent effective-price selection, browser verification | ✓ Shipped |
| **v0.11.0** | 2026-08-08 | Existing creators answer wanted claims with exact article versions and evidence-settled targeted retries | ✓ Shipped |
| **v0.12.0** | 2026-08-10 | Publisher-signed full text, honest delivery receipts, encrypted caches, attention-bounded source selection | ✓ Shipped |
| **v0.13.0** | 2026-08-13 | Public proof dossier: deployed source, independent usage, Arc RPC/registry parity, Circle backing, on-chain cash-outs | ✓ Shipped |
| **v0.14.0** | 2026-08-23 | Coverage-aware Quick/Deep research + aggregate privacy-preserving activation funnel | ✓ Shipped |
| **v1.0.0** | 2026-12-31 | Mainnet + Full Feature Parity | Planned |
| **v2.0.0** | 2027-Q2 | Stretch Goals (Agent Marketplace, Video, Derivatives) | Backlog |

---

## Decision Log

### Locked Decisions (No Reversal Expected)
1. **Non-custodial by design** — Keryx never holds user keys/funds. Testnet + live settlement only.
2. **Browser co-sign** — Session key in tab, user funds session EOA. No server-held keys for users.
3. **On-chain registry** — SourceRegistry Solidity contract. Transparent, immutable source metadata.
4. **SIWE for auth** — Wallet-based identity. No email/password. Role derived live from state.
5. **IPFS for content** — Encrypted at rest, gated decryption post-payment. Lit upgrade path noted.

### Deferred Decisions
- Mainnet chain selection (Arc primary + others optional?)
- Enterprise B2B pricing model (% of settled volume? flat fee?)
- Creator insurance pool (smart contract? reinsurance partner?)

---

## Links & References

- **Plan:** `plans/260618-0025-decentralized-dapp-registry-ipfs-spend-permission/plan.md`
- **Security:** `docs/security-threat-model.md`
- **Architecture:** `docs/system-architecture.md`
- **Changelog:** `docs/project-changelog.md`
- **Codebase:** `docs/codebase-summary.md`
- **Demo:** [DEMO.md](../DEMO.md)
- **Traction:** [TRACTION.md](../TRACTION.md)
- **Feedback:** [FEEDBACK.md](../FEEDBACK.md)
