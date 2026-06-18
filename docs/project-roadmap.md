# Keryx Project Roadmap

**Version:** 0.2.0 (Decentralized dApp, 2026-06-18)  
**Status:** Phases 01–06 Complete. Preparing for Hackathon Demo.

---

## Current Phase: Launch & Feedback (Hackathon, June 2026)

### Immediate Goals (This Week)
- ✓ Phases 01–06 shipped (SIWE auth, on-chain registry, browser co-sign, IPFS encryption, API, security hardening)
- ✓ SourceRegistry deployed on Arc testnet (`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`)
- ✓ Security threat model verified (23/23 checks pass)
- ✓ Hardhat tests pass (16/16)
- ✓ VPS deployment ready (`npm run deploy`)
- ✓ Volume engine running (real traction metrics)
- Live demo @ keryx.cc

### Success Metrics
| Metric | Target | Current |
|--------|--------|---------|
| Hackathon demo | 3-min walkthrough | [DEMO.md](../DEMO.md) |
| Judges can connect wallet | Arc testnet native USDC | ✓ faucet working |
| Sources registered | ≥5 demo creators | TBD (seeding) |
| Settled USDC | ≥$100 | TBD (volume engine) |
| Judge feedback | Submission form | `FEEDBACK.md` |

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

## Post-Hackathon Phases (Q3 2026)

### Phase 07: Security Upgrades (Priority: High) — Est. 2 weeks

**Goals:** Eliminate documented trade-offs + close residuals (R1–R4).

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| Web Crypto keys | Non-exportable session keypair; browser-only signing | 3d | Eliminates R3 (sessionStorage XSS) |
| Lit Protocol | Integrate Lit for client-side IPFS key release | 2d | Closes C2 (server key-holder); needs Arc on Lit's chain list |
| On-chain deposit verify | Query Gateway balance API before marking grant active | 1d | Closes R2 (funding trust) |
| Author manifest | Server signs author-wallet list; client validates citation payTo | 2d | Closes R1 (payTo redirect under compromise) |
| **Phase 07 Total** | | ~1.5w | Backpressure: Arc on Lit support, Circle API access |

---

### Phase 08: Scalability (Priority: Medium) — Est. 1.5 weeks

**Goals:** Production-ready multi-instance deployment.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| Redis rate-limit | Replace in-process `rate-limiter-flexible` | 2d | Enables load-balanced cluster |
| Event-only indexer | Subscribe to Arc finality events instead of polling | 2d | Real-time source discovery, no RPC backpressure |
| Cursor pagination | Source list pagination (limit + offset/cursor) | 1d | Supports large creator bases |
| Multi-instance deploy | Load balancer, session persistence | 1d | Horizontal scale + high-availability |
| **Phase 08 Total** | | ~1w | Deploy to Kubernetes or multi-VPS |

---

### Phase 09: User Experience (Priority: Medium) — Est. 1 week

**Goals:** Streamline onboarding + session lifecycle.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| Preset funding amounts | UI buttons (quick-add $5, $10, $50 sessions) | 1d | Reduce friction on first ask |
| Session refresh UI | Warn before expiry (12h default); auto-refresh option | 1d | Eliminates mid-run session expiry |
| Preview depth control | Creator choice: full preview, excerpt, or locked | 2d | Better incentive alignment |
| Bulk import | Paste RSS feed → batch register sources | 2d | Creator onboarding at scale |
| **Phase 09 Total** | | ~1w | Incremental shipping |

---

### Phase 10: Enterprise Tier (Priority: Low) — Est. 2 weeks

**Goals:** Multi-tenant API + audit/compliance.

| Task | Description | Effort | Notes |
|------|-------------|--------|-------|
| API key scoping | Keys scoped to specific sources / operations | 2d | Enteprise API isolation |
| Custom registry | Deploy SourceRegistry per customer | 2d | White-label dApp deployments |
| Audit export | Payment + query history in CSV / JSON | 1d | Compliance reporting |
| Fiat on-ramp | Stripe / Ramp integration for testnet-to-mainnet USDC | 3d | Reduce friction: Circle faucet → mainnet spending |
| **Phase 10 Total** | | ~2w | B2B expansion |

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
- **Integrations** — Slack bot ("@keryx ask ..."), Discord command, email digest
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
- [x] Security verified (23-point matrix + grep audit)
- [x] Integration: all phases work together
- [x] Offline dev mode preserved
- [x] VPS deployment ready

### Phase 07 (Security Upgrades)
- [ ] Web Crypto signing reduces XSS impact to zero (no exportable key)
- [ ] Lit Protocol integration deployed (once Arc added to Lit)
- [ ] Residuals R1–R4 closed (verified in threat model)
- [ ] No security regressions (threat matrix still 23/23 pass)

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

### Hackathon Feedback Loop
- **Demo script:** [DEMO.md](../DEMO.md) (3-min judge walkthrough)
- **Feedback form:** [FEEDBACK.md](../FEEDBACK.md) (judge submissions + scoring)
- **Weekly updates:** traction snapshot via `arc-canteen` (keryx.cc product card)

### Creator Feedback Channels (Post-Hackathon)
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

### Budget (Post-Hackathon, 6-month estimate)
| Item | Cost | Notes |
|------|------|-------|
| VPS (6 months) | $300–600 | keryx.cc infra |
| Pinata (6 months) | $120 | IPFS storage |
| Domain (1 year) | $15 | keryx.cc renewal |
| Security audit (1x) | $3–5k | External firm (Q4) |
| **Total** | ~$4–6k | Assumes volunteer dev (you) |

---

## Version Plan

| Version | Target Date | Focus | Status |
|---------|-------------|-------|--------|
| **v0.2.0** | 2026-06-18 | Decentralized dApp (Phases 01–06) | ✓ Shipped |
| **v0.3.0** | 2026-09-30 | Security + Scale (Phases 07–08) | TBD |
| **v0.4.0** | 2026-10-31 | UX + Enterprise (Phases 09–10) | TBD |
| **v1.0.0** | 2026-12-31 | Mainnet + Full Feature Parity | TBD |
| **v2.0.0** | 2027-Q2 | Stretch Goals (Agent Marketplace, Video, Derivatives) | Backlog |

---

## Decision Log

### Locked Decisions (No Reversal Expected)
1. **Non-custodial by design** — Keryx never holds user keys/funds. Testnet + live settlement only.
2. **Browser co-sign** — Session key in tab, user funds session EOA. No server-held keys for users.
3. **On-chain registry** — SourceRegistry Solidity contract. Transparent, immutable source metadata.
4. **SIWE for auth** — Wallet-based identity. No email/password. Role derived live from state.
5. **IPFS for content** — Encrypted at rest, gated decryption post-payment. Lit upgrade path noted.

### Deferred Decisions (Post-Hackathon)
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
