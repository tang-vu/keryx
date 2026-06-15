# Demo — under 3 minutes

**One-line:** *Every time an AI cites a creator's work, the creator gets paid — instantly, in USDC on Arc.*

Target length: 2:45. Record at `http://localhost:3939` (or the Cloudflare Tunnel URL) with a funded
wallet + `KERYX_FORCE_OFFLINE=0` so settlement is real. Pre-seed sources and pre-warm the dev server.

## Storyboard

**[0:00–0:20] Hook.**
On the Ask page. "The web's economy breaks when the reader is an AI — agents consume creators' work
and send nothing back. Keryx fixes that: it pays creators every time it cites them." Show the tagline.

**[0:20–1:25] The agent decides — live (the money shot).**
Type: *"How do x402 and stablecoin micropayments enable autonomous AI agent commerce?"*, budget $0.05,
hit **Ask Keryx**. Narrate the reasoning console as it streams:
- "It breaks the question into sub-claims…"
- "It discovers 6 sources and **decides** — buys the 3 relevant ones, **skips gardening and retro
  gaming** because they're not worth the toll. Every choice has a rationale."
- "It pays the x402 toll only for what it buys… then checks: *have I read enough?* — and **stops
  early** to save budget."
Emphasize: **this is a real decision, not automation** — re-run with a different question to show
different buy/skip choices.

**[1:25–2:05] Grounded answer + creators paid.**
- Show the answer with clickable **[S1]/[S2] citations**.
- Show the **"Creators Paid"** panel: each cited source's weighted reward; for the multi-author
  source, the **60/40 split** to two wallets. "Heavily-cited sources earn more. Multi-author works
  split automatically. 100% goes to creators."
- Click a tx hash → Arc testnet explorer showing the real settlement.

**[2:05–2:35] Traction + onboarding.**
- Open **/dashboard**: total payments, USDC to creators, creators earning, reader→payer conversion,
  the live payments feed ticking, the creator leaderboard. Mention the **volume engine** runs the
  agent continuously to generate real autonomous volume.
- Flash **/register**: "Creators onboard in one click — paste an RSS feed, get a wallet, start earning."

**[2:35–2:45] Close.**
"Keryx — citation becomes a payment. Built on Circle x402 + Gateway nanopayments, USDC on Arc."

## Pre-flight checklist
- [ ] `.env.local`: LLM key set, wallet funded, `KERYX_FORCE_OFFLINE=0`
- [ ] `npm run seed-sources` done; `npm run dev` up on :3939
- [ ] (optional) `npm run seed -- --count 15` beforehand so the dashboard already shows volume
- [ ] (optional) `npm run tunnel` for a public URL
- [ ] One question pre-tested end-to-end; explorer tab open

## If recording offline (no funding yet)
The flow is identical; the "Creators Paid" panel shows "simulated" instead of tx hashes and a badge
reads "offline preview." State clearly in the video that settlement is simulated pending funding.
