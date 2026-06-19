# Keryx — Lepton Hackathon Winning Playbook

> Source of truth for how to WIN. Read this every session before deciding what to build next.
> Verified against the live site (lepton.thecanteenapp.com) + the Canteen "Distribution Bootstrap"
> article on **2026-06-20**. **Keryx is dead-center in the winning lane — sharpen, don't rebuild.**

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
4. **Form:** https://forms.gle/SMqLaw2pMGDe58LFA — "submit as many times as you like." Submit a v1 EARLY, then resubmit as we improve. Form asks **user count + problem statement** — have real numbers ready (settled tx on testnet.arcscan.app).
5. **CLI traction:** `arc-canteen push` product/traction updates each phase ("daily tasks") — feeds visibility/traction. Login via `arc-canteen login` (GitHub OAuth, interactive — user runs it).

## Why Keryx wins — alignment proof
**The name is the thesis.** The org's **Prior Art #1 is literally the "Herald model (kēryx / praeco)" — "content cited, paid per citation."** Keryx (κῆρυξ = *herald*) is named after the sponsor's own canonical entry for this exact prompt. The codebase already wears it (the hero `HeraldSeal`: "★ KERYX ★ THE HERALD IS PAID ★ ΚΗΡΥΞ").

- **RFB 6: Creator & Publisher Monetization is THE focus round** ("monetize a single article, photo, or song without forcing readers into a monthly commitment"). Its traction metrics — *creators earning · total payouts · avg payment/piece · reader→payer conversion* — **are exactly Keryx's dashboard.**
- The Distribution Bootstrap article lists **"LLM citation-toll layer"** as one of its 8 ship-order projects ("when an LLM crawler grounds an answer in the item's URL, the crawler sends an x402 microsettlement to the address in the token") — **Keryx IS that project**, built crawler-side so no upstream repo needs modifying.

### The org's 8 Prior-Art models (Keryx hits #1 head-on; #4/#5 are adjacent)
1. **Herald (kēryx/praeco)** — content cited, paid per citation ← **Keryx core**
2. Maecenas — transferable patronage claims (resellable backer positions)
3. Quadratic funding — breadth over depth ("widow's two mites")
4. **Workshop** — recursive royalties, splits follow lineage graphs ← *our multi-author splits; extend to lineage*
5. **Rhapsode** — user-centric royalties: pay the artists you actually consumed ← *our contribution-weighted per-use split echoes this*
6. Quinaria — per-second streaming rates (continuous authorization)
7. City Dionysia — retroactive funding (post-fact reward pools)
8. Trapezitai/argentarii — reputation as collateral (bonded brokers)

### The 6 RFB tracks (Keryx spans 1, 3, 6)
1. **Autonomous Paying Agents** — discover/evaluate/pay paywalled APIs on a budget ← *Keryx's fetch loop*
2. Selling Agent Services via Nanopayments — pay-per-call, no subscription
3. **Agent-to-Agent Nanopayment Networks** — agents paying agents in real time ← *Keryx A2A mode*
4. Streaming & Continuous Payments — pay-per-second; start/pause/stop value
5. Nanopayment Infrastructure & Tooling — SDKs, dashboards, simulators
6. **Creator & Publisher Monetization** — *primary focus this round* ← **Keryx core**

## TRACTION strategy (the 30% that's still open — top priority after going live)
The Distribution Bootstrap thesis: **attach permissionlessly to open-source creator communities that already emit clean, settlement-grade event streams; the moat is the creator→wallet registry, not the code.**

For Keryx the play is:
1. **Onboard REAL creators fast via RSSHub.** RSSHub (44k⭐, org-listed for "paid feeds and citation tolls") turns almost any site/blog/publication into an RSS feed. Ingest 10–30 real feeds → each becomes a registered source with a wallet. This is the registry moat.
2. **Generate REAL settled volume** with the volume engine: fund the agent wallet, `KERYX_FORCE_OFFLINE=0`, run `npm run seed -- --loop --limit <cap>`. The agent autonomously reads & pays per citation continuously → genuine autonomous payment volume to real creator wallets, all on Arc.
3. **Report only real settled numbers** (tx hashes on testnet.arcscan.app) in TRACTION.md + the video + `arc-canteen push`.
4. Target RFB6 metrics explicitly on the dashboard: creators earning, total payouts, avg payment/piece, reader→payer conversion.

> **The org's 10 listed OSS distribution targets** — attach permissionlessly (plugin / sidecar / reverse-proxy / federation peer / client fork), never modify upstream. Stars per the live site:
>
> | Project | ⭐ | Payment unlock | Keryx fit |
> |---|---|---|---|
> | **RSSHub** | 44k | **paid feeds, citation tolls** | ★ best fit — ingest feeds → registered sources |
> | Ghost | 54k | memberships, subscriptions, newsletters | strong (written content) |
> | Immich | 103k | photo licensing & tips to photographer | later (media sources) |
> | Jellyfin | 53k | pay-per-view, rentals | — |
> | Mastodon | 50k | patronage, quadratic funding (donation API merged 2026) | adjacent |
> | Discourse | 47k | paid groups, gated categories | adjacent (forum cites) |
> | Navidrome | 21k | royalties by actual play history | — |
> | PeerTube | 15k | per-view/per-second (issue #1586 = 7yr open demand) | — |
> | Owncast | 11k | live tips, pay-to-watch streams | — |
> | Kavita | 11k | pay-per-book, rentals | adjacent (book cites) |
>
> RSSHub is THE fit for citation tolls; the rest are surface for later. ("Dozens more across music, video, photos, writing, and the fediverse.")

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

## Facts to cite (video / form / README)
- Arc = Circle's L1: **<500ms** finality, **USDC-native gas** (not a volatile token), **$0.000001** Gateway floor, gasless batched txns. Testnet is Canteen-hosted (bundled with ARC CLI).
- Circle tooling in play: **Wallets · Gateway/Nanopayments · x402 · Contracts · USDC** (App Kit available, unused so far).

## Post-event (why continuing past Jun 29 matters to judges)
The site says **"the building is the easy part"** and rewards genuine usage + long-run sustainability over polished demos. **Long-term commitment is expected.** Teams that continue get **funding for prototype scaling, grant support during early traction, and partnership intros** (Canteen / Circle / Arc). **Agora-carryover projects are eligible** if they show real progress (traction + product delta judged equally). Keryx is built to keep running — VPS + real registry, not a demo throwaway.

## Source links (verified 2026-06-20)
- Hackathon site: https://lepton.thecanteenapp.com/ · Submission form: https://forms.gle/SMqLaw2pMGDe58LFA · Luma: https://luma.com/5xcrazms
- Distribution Bootstrap thesis: https://thecanteenapp.com/analysis/2026/05/28/distribution-bootstrap-payments-founders.html
- Arc docs: https://docs.arc.network · Circle Agent Stack (x402): https://developers.circle.com/agent-stack · Nanopayments / Gateway: https://developers.circle.com/gateway/nanopayments
- Starter repo: https://github.com/circlefin/arc-nanopayments · Canteen Discord: https://discord.gg/rsVfYutFZg · Arc builder Discord: https://discord.com/invite/buildonarc
