# Browser receipt verification — September 9, 2026

The `/research` source-decision panel previously checked schema and displayed job/answer
matching but directed users to the CLI for integrity verification. It now verifies the
canonical payload hash using browser Web Crypto and matches the response digest header,
displayed job/answer and recorded answer hash before rendering decisions.

`canonical-json.ts` preserves the existing canonicalization byte rules. The pure
`receipt-integrity-core.ts` prepares the same envelope for synchronous Node and async
browser hashing. The Node API and `keryx-json-v1` receipt format remain unchanged.
`read-bounded-json.ts` enforces the same 2 MB ceiling in browser receipt loading and
CLI recovery, including streamed responses without a content-length header.

The displayed result is still supplied by Keryx. This check does not prove that it
matches an original paid request unless the buyer also supplies their journal; it
does not independently verify Circle settlement or research quality. The UI states
those limits. Failure affects the decision panel and offers GET retry while preserving
the answer. No signing, funding or purchase path is introduced.

Validation before release:

- 63 tests passed across seven files: receipt construction/routes, buyer client,
  decision validation, browser/Node digest parity and byte-limit failures.
- TypeScript passed. Focused ESLint reported no errors and one existing
  `set-state-in-effect` warning in the decision component.
- An esbuild browser bundle compiled with 29 modules and no Node polyfill. Chromium
  executed the real component with synthetic GET fixtures in an intercepted HTTPS
  context: valid data displayed decisions; tampering withheld decisions; the answer
  remained visible; no POST requests or page errors occurred.
- Fixtures are explicit local simulations of HTTP data, with no paid transactions or
  customer-traction claim. CI production build and public deployment validation remain
  separate release checks.

Full browser checkout still needs portable authorization/package checks, transactional
local journals, wallet/deposit controls and lost-response recovery acceptance.

Release verification: CI passed for `605c30e` and the documentation follow-up
`a6fdd80`. Production health reported `a6fdd80` and `operational`. Chromium opened the
saved owner-operated pilot-7 job on the public workspace and observed the browser
integrity confirmation. The 390-pixel mobile viewport had no horizontal overflow;
the job ID stayed out of the address bar, with no paid POSTs or page errors.
Separately, all three archived pilot-6/7 receipt snapshots produced identical Node
and Chromium verification results. This reused existing research, not a new purchase
or an independent customer test. The product update was saved to Canteen after deploy.
