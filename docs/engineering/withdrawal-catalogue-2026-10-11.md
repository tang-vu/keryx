# English withdrawal catalogue — issue272 area

This area moves 171 meaning-based English messages from eight withdrawal
presentation files into `locales/en/withdrawal.ts`. It covers preparation, review,
local recovery, server history/progress, legacy testnet earnings withdrawal,
ordinary mainnet creator cash-out and the private withdrawals page metadata.
Existing account/session catalogues are reused. English remains selected
explicitly; glossary approval and locale activation stay held.

Complete messages use named interpolation and existing React links/time nodes.
Count messages select one/other arms while preserving original `request(s)`
wording. `lib/i18n/withdrawal-recovery-status.ts` resolves each complete transfer
and mint status combination, preserving the original request fallback and empty
unknown mint output. It changes presentation only. Protocol states, original IDs,
reviewed amount/fee integers, signing terms, one-use submission, recovery-file
bytes/filename, owner isolation, aborts, transaction URLs and finality criteria
remain unchanged. Raw request/state/hash/address data is not extracted.

The scoped audit retires exactly 143 original guard occurrences. Five current
network/currency occurrences remain inline (`Arc Testnet · USDC` and four `USDC`
labels). Toast identities and recovery filename remain unchanged. Other areas'
allowances are preserved. A scoped regression extends the existing guard tests;
the guard's detection rules are unchanged.

Evidence retained in the assigned worker's `withdrawal/` folder:

- 338 exact before/after HTML and metadata comparisons across both Arc profiles,
  including original/foreign wallets, finite/infinite expiry, imported originals,
  all transfer/mint message combinations and unavailable/empty/busy states.
- Existing Chromium journal fixture passes: IndexedDB reservation, cross-tab
  single submission, lost response, owner isolation, abort, exact recovery bytes
  and recovery-only imports. Its worker-only copy pins the intended legacy
  testnet browser profile and resolves imports from the worker directory. The
  tracked fixture and all production helpers remain unchanged.
- Existing history/progress browser fixture passes: exact pagination, failed and
  foreign reports, reported mint link, revocation/account-switch cancellation and
  empty IndexedDB. No credentials or payments are used.
- Twelve mainnet creator control assertions and nine legacy testnet assertions
  at each 320px/1366px viewport verify keyboard focus, precision refusal, exact
  reviewed callback arguments, original-state action availability, signing/send
  separation, pending recovery, mint/hash/finality messages, logout notice,
  signature refusal and balance retry. Owner/payment helper callbacks are
  intercepted; these checks do not claim live payment integration.
- TypeScript, scoped ESLint, 24 existing/scoped guard tests and 12 existing
  message/rich-message tests pass. Retained accepted CSS is reused, with inspected
  screenshots; no fresh local production build is claimed.

Narrow-width overflow is pre-existing and remains open for root's separate layout
decision. The before/after composite is width320/scrollWidth356/height3871 and
width1366/scrollWidth1366/height2826. Mainnet creator action renders likewise
overflow to356 at320; the sampled legacy testnet control fits320. Extraction
preserves the exact markup and dimensions rather than claiming full narrow-width
usability. API/helper-supplied diagnostics remain root's helper qualification.

Standalone this area leaves 2302 allowances in 148 files, with 2299 current
findings. Across the eight staged worker areas, 2188 keys and 1924 original
retirements leave 521 allowances in 67 files (519 current findings by the scoped
retirement union). Source/creator/registration/withdrawal has 168 allowances in
25 files left; native119 and deliberate data remain included. Counts do not
substitute for the outstanding non-JSX helper census.

Original272 remains open. Root owns independent review, combined integration,
actual successful `build-and-test` and applicable domain/platform gates, build,
versions/distribution and serialized runtime delivery. The worker neither merges
nor deploys this area, changes payment/auth/database semantics, nor activates
held locale/glossary work.
