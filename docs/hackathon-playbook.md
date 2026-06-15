# Keryx — Lepton Hackathon Winning Playbook

> Source of truth for how to WIN. Read this every session before deciding what to build next.
> Captured from the Lepton kickoff (2026-06-15), the Canteen "Distribution Bootstrap" article, and
> the org's RFB / Prior-Art list. **Keryx is dead-center in the winning lane — sharpen, don't rebuild.**

## The contest
- **Event:** Lepton Agents Hackathon (Canteen × Circle, settled on Arc in USDC). Online.
- **Window:** **Jun 15 → Jun 29, 2026.** Judged work must be built in-window. Judging is **async after the deadline — there is NO live demo day.** So the **video + repo + live link must stand on their own.**
- **Prize pool $50k:** 1st **$10k**, 2nd **$7.5k ×2**, 3rd **$5k ×3**, Standout **$7.5k** split 10–12 teams, **Feedback $500**, **Easter eggs $2k**.
- **Arc finality:** Malachite BFT (Tendermint-style); >2/3 precommit ⇒ final, **<500ms**. A payment is "settled enough" once the facilitator confirms the batch — trust the settlement result + sub-500ms finality.

## Judging rubric (equal-ish weights) — score every decision against this
| Weight | Criterion | What judges look for | Keryx status |
|---|---|---|---|
| **30%** | Agentic sophistication | "How much does the AI actually DECIDE vs automate?" | ✅ visible reasoning trace: buy/skip/cache/stop, all logged |
| **30%** | Traction | "Real users, real payments, real volume **during the window**" | ⚠️ MUST go live: real creators + real settled USDC volume |
| **20%** | Circle tooling | Creative use of Wallets, Gateway, App Kit, Contracts, x402, USDC | ✅ x402 + Gateway nanopayments + Wallets; add Contracts (splitter) |
| **20%** | Innovation | Novel approaches, emergent behavior | ✅ weighted per-citation, multi-author splits; add A2A |

> "Judges have the final say, and the best projects tend to break the rules." → be bold, show emergent behavior.

## Submission (do early & often — multiple submissions encouraged)
1. **<3-min video demo** (Loom / YouTube / Vimeo) — REQUIRED. Hook → live agent reasoning → creators paid (real tx) → dashboard volume.
2. **Public GitHub repo** — REQUIRED. Excellent README (have it).
3. **Live product link** — encouraged (Cloudflare Tunnel URL).
4. **Form:** https://forms.gle/SMqLaw2pMGDe58LFA — "submit as many times as you like." Submit a v1 EARLY, then resubmit as we improve.
5. **CLI traction:** `arc-canteen push` product/traction updates each phase ("daily tasks") — feeds visibility/traction. Login via `arc-canteen login` (GitHub OAuth, interactive — user runs it).

## Why Keryx wins — alignment proof
- **RFB 6: Creator & Publisher Monetization is THE focus round** ("this round leans toward RFB 6"). Its traction metrics are *creators earning · total payouts · average payment per piece · reader-to-payer conversion* — **exactly Keryx's dashboard metrics.**
- **Prior Art #1 (org's own list): "Content citation tolls — payments settle to source authors when an LLM or aggregator cites them."** ⇒ Keryx is the canonical build for this prompt.
- **Prior Art #4: "Recursive royalty splits following lineage graphs"** ⇒ our multi-author splits; can extend to lineage.
- Also touches **RFB 1** (autonomous paying agents under budget) and **RFB 3** (agent-to-agent) via the A2A enhancement.

## TRACTION strategy (the 30% that's still open — top priority after going live)
The Distribution Bootstrap thesis: **attach permissionlessly to open-source creator communities that already emit clean, settlement-grade event streams; the moat is the creator→wallet registry, not the code.**

For Keryx the play is:
1. **Onboard REAL creators fast via RSSHub.** RSSHub (44k⭐, org-listed for "paid feeds and citation tolls") turns almost any site/blog/publication into an RSS feed. Ingest 10–30 real feeds → each becomes a registered source with a wallet. This is the registry moat.
2. **Generate REAL settled volume** with the volume engine: fund the agent wallet, `KERYX_FORCE_OFFLINE=0`, run `npm run seed -- --loop --limit <cap>`. The agent autonomously reads & pays per citation continuously → genuine autonomous payment volume to real creator wallets, all on Arc.
3. **Report only real settled numbers** (tx hashes on testnet.arcscan.app) in TRACTION.md + the video + `arc-canteen push`.
4. Target RFB6 metrics explicitly on the dashboard: creators earning, total payouts, avg payment/piece, reader→payer conversion.

> Other attachable platforms if we want more surface (all org-listed): Ghost (paid memberships), Jellyfin (pay-per-view), Mastodon (donation campaigns API merged 2026), Navidrome (per-listen), Owncast (per-second), Immich (per-resolve), PeerTube (per-view, issue #1586 = 7yr open demand), Discourse. RSSHub is the best fit for citation tolls.

## Next actions (priority order)
1. **Go live for real settlement** — fund wallet (faucet) + LLM key (DeepSeek) + `KERYX_FORCE_OFFLINE=0`. (needs user creds)
2. **Onboard real RSS feeds** via `/register` / `npm run ingest` → real creator registry.
3. **Run the volume engine** → real settled USDC volume during the window.
4. **Record the <3-min video** + deploy live URL (Cloudflare Tunnel) → **submit v1 on the form early.**
5. **Enhancements** for Innovation/Circle scores: A2A mode (RFB3), onchain PaymentSplitter (Circle Contracts), external x402 discovery, ERC-8004 identity.
6. **`circle feedback submit`** (FEEDBACK.md) → free $500.
7. Resubmit as we improve.

## Working rules locked in
- Commit per phase (conventional commits). Push to public GitHub once stable. (git was held until kickoff; kickoff started 2026-06-15.)
- Report ONLY real, settled transactions as traction. Label simulated clearly.
- Don't rebuild — Keryx is on-thesis. Sharpen agency visibility + real traction.
