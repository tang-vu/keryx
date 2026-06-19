# Easter Eggs & Side-Prize Leads

The live site confirms a **$2k Easter-egg pool**, officially three categories: **code challenges ·
Discord puzzles · side quests** (no separately-named "code-golf" track). Leads below — honest status
per item; none confirmed-won yet.

## Leads

1. **Scaffold "treasure hunt" endpoint.**
   `circlefin/arc-nanopayments` ships `/api/premium/agent-task` ($0.03) that returns a "treasure hunt
   clue" string. Strongly implies a Canteen/Lepton content challenge or puzzle chain behind it.
   **TODO:** pay that endpoint on the Canteen-hosted demo (or read the clue text) and follow it.

2. **Code-golf: smallest x402 paying agent.**
   The minimal real paying loop is tiny — `new GatewayClient({chain,privateKey}).pay(url)` after a
   deposit. Fits the official **"code challenges"** category (the site lists no separate "code-golf"
   track). **TODO:** watch Discord/announcements for a posted code challenge to enter this in.

3. **Discord puzzles (Lepton + Agora roles).**
   Site-confirmed invites: **Canteen Discord** https://discord.gg/rsVfYutFZg and **Arc builder Discord**
   https://discord.com/invite/buildonarc (mention "Canteen + Lepton"). Returning-builder Luma passcode
   noted at kickoff (`AGORA_RETURNx1313`). Role-gated channels often hide bonus challenges.
   **TODO (human):** join both, read pinned/announcement channels for puzzles.

4. **`circle feedback submit` as a prize channel.**
   The dev-feedback prize ($500) is literally a CLI command — `FEEDBACK.md` is ready to submit. Low
   effort, high certainty. **TODO:** run `circle feedback submit` with the FEEDBACK.md highlights.

5. **`arc-canteen` hidden commands.**
   The CLI exposes `status`, `ls`, `history`, `push` — possibly a leaderboard/score mechanic for the
   hackathon. Generating real traction via `npm run seed -- --push` may rank on a public board.
   **TODO:** run `arc-canteen status` after login to see if there's a scoreboard.

## Notes
- None of the above are confirmed prizes yet — they're patterns worth 30 minutes each. The surest
  free win is #4 (feedback submission).
- If a content/puzzle challenge requires reading clue text behind an x402 wall, Keryx itself can pay
  for and read it — a nice self-referential demo moment.
