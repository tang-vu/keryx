# Public source claims English catalogue — 2026-10-11

This focused original #272 area moves 119 inspected English messages from the
claim page, ownership form, policy panel, freshness status, saved-claim list and
request helper into `locales/en/source-claims.ts`. Metadata, accessible labels,
proof instructions, clipboard notices, fallback errors and complete policy
variants are included. The interface remains English; no glossary approval,
translation activation or locale flag changes.

Named interpolation preserves dates, links, emphasis, source names, wallets and
network labels. File/token proof instructions and policy-price/freshness notices
are whole messages. Source URLs, proof JSON/token bytes, filenames, claim IDs,
network/contract identities and user data remain unchanged. All proof matching,
generation fences, current-wallet checks, expiry rules, request methods/bodies,
registration hrefs, saved permissions and separate activation conditions retain
their existing behavior. No ownership, payment or database semantics change.

Exactly 103 migrated guard occurrences are retired from the five JSX files.
The original URL example retains its data allowance; the non-JSX request helper's
fallback is also catalogued. A scoped guard regression protects the retirement
without weakening detection or changing other area allowances.

Pinned Node 24.21 and read-only dependencies qualify this source:

- TypeScript, scoped lint, 24 guard tests and 12 existing catalogue/interpolation/
  escaping tests pass.
- 58 exact before/after HTML and metadata cases cover authentication and network
  mismatches, website/RSS proofs, expiry, saved-claim empty/loading states, current
  and expired control, all policies, listing availability and price mismatches.
- Retained production CSS is visually checked at 320/1366. Before/after dimensions
  match, with no overflow in the qualified composite. This is retained CSS reuse,
  not a fresh local production-build or deployed acceptance claim.
- The existing intercepted public-source claim browser fixture covers testnet and
  mainnet at 320/1366: signed-in resume, proof failure/conflict/expiry, manual control
  renewal with preserved policy, exact deadlines, stale wallet/network/list refusal,
  zero-price registration and separate rights/policy activation. Its worker copy
  changes only module paths, retained CSS, artifact paths, the narrow width and
  UTF8 response declaration. Added checks exercise labelled keyboard buttons,
  exact clipboard and JSON download bytes/filename, clipboard refusal and focus.

All browser transport and wallet data are synthetic and intercepted. Evidence in
the assigned worker output `issue272/source-claims/` contains no secrets or private
financial originals. No real model, source, wallet, payment, shared database or
production request occurs; dependencies, ENV, custody and lifecycle are untouched.

Together with the four preserved area candidates, this adds 1,524 keys and retires
1,363 allowances. The combined inventory remains **1,082 allowances in 84 files**
(1,079 current findings; three untouched old allowances elsewhere). Source/creator/
registration/withdrawal still accounts for 729 allowances in 42 files. Remaining
landing/integrations, retained data and root-owned helper/native qualification mean
original #272 remains open.

Root owns independent source review, conflict-preserving combined integration,
actual aggregate/domain/platform CI on the accepted final tree, versions,
distribution, production health/commit readback, issue closure and cleanup. Earlier
area branches and evidence remain preserved; an open conflicting area PR is not
described as merged. Workers neither merge during the freeze nor deploy separately.
