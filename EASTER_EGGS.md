# Easter Eggs & Side-Prize Leads

Opportunities spotted for the separate side-prize pools (code-golf / Discord puzzles / content
challenges). Leads to investigate — not yet solved. Honest status noted per item.

## Leads

1. **Scaffold "treasure hunt" endpoint.**
   `circlefin/arc-nanopayments` ships `/api/premium/agent-task` ($0.03) that returns a "treasure hunt
   clue" string. Strongly implies a Canteen/Lepton content challenge or puzzle chain behind it.
   **TODO:** pay that endpoint on the Canteen-hosted demo (or read the clue text) and follow it.

2. **Code-golf: smallest x402 paying agent.**
   The minimal real paying loop is tiny — `new GatewayClient({chain,privateKey}).pay(url)` after a
   deposit. A code-golf entry for "fewest bytes to autonomously pay an x402 resource on Arc" is
   plausible. **TODO:** confirm a code-golf track exists in the Lepton rules.

3. **Discord puzzles (Lepton + Agora roles).**
   The kickoff mentions rejoining Discord via a specific invite to get BOTH Lepton + Agora roles, and
   a returning-builder Luma passcode (`AGORA_RETURNx1313`). Server-side puzzles / role-gated channels
   often hide bonus challenges. **TODO (human):** join, read pinned/announcement channels for puzzles.

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
