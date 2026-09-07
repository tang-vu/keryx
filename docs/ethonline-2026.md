# ETHOnline 2026 — Keryx continuity build log

Event window: September 4–16, 2026. Baseline: `5e83d45` (September 2), the
repository HEAD inspected on September 5 before any ETHOnline work. This log does
not assert that a track selection or submission has been completed in ETHGlobal.

## Existing before the event

Citation-toll research, browser co-signing, SourceRegistry payout authority, encrypted
paid content, evidence-gated creator rewards, paid A2A v2, durable async jobs, operator
recovery, Quick/Deep package v1 and portable/service receipts already existed.
See `PLAN.md` for historical context and `docs/a2a-paid-research-v2.md` for the
existing economic contract. None of these is claimed as new ETHOnline work.

## September 7 — Owner-operated pilot and research-quality follow-up (v0.22.2)

- A separate owner-controlled EOA funded through the Arc testnet faucet deposited 0.05
  USDC and made one Quick purchase. Approval/deposit receipts succeeded, Circle Gateway
  available balance moved from 0.05 to zero after purchase, and the seller relayed a Circle
  transfer reference. GET-only recovery retrieved the job and verified receipt integrity
  and request binding. Private job journals are excluded from this public log.
- The job completed in 52.656 seconds but produced no supported answer or creator payments.
  Its planner interpreted the ambiguous question as patent-citation settlement and the
  preview gate rejected every source. The unused 0.03 creator reserve is part of the
  non-refundable package, not a refund. This is internal validation, not customer traction.
- Changed planning to research questions with scope/ambiguity guidance and validated
  provider output. Empty evidence now records zero support; pending and settled source
  payments keep distinct explanations. The buyer workspace makes zero/unknown quality visible.
- A bounded live DeepSeek v4 Flash planning check kept the citation-payment question in
  Keryx context and preserved explicit patent and gardening questions. This checks planning
  only, not a second paid end-to-end pilot or a guarantee against interpretation errors.
- Validation: 131 focused LLM/orchestrator/A2A/buyer tests, TypeScript, focused lint and
  production build passed. Mobile browser checks with intercepted fixtures confirmed distinct
  zero-support and unavailable-quality messages and no paid POST.

## September 5 — Buyer workspace (v0.21.0)

- Added `/research`: server-priced Quick/Deep packages using the same quote function as
  the paid endpoint; exact six-decimal creator-cap validation; visible fee, cap, total,
  package version, network, payee and non-refundable provisional service terms.
- Added copyable async request JSON for an external funded x402 client. This surface
  does not sign, fund a wallet, submit paid requests, or start research.
- Added explicit job-ID lookup using the existing endpoint: bounded sequential polling,
  cancellation on switch/unmount, terminal/review stop, manual refresh and clear.
- Added answer, claim evidence, measured quality/latency, settled/pending creator amounts,
  unknown/incomplete accounting and a portable receipt link. A receipt link is not an
  independent receipt-verification result.
- Job IDs remain bearer access to the existing API. The workspace stores them only in
  component memory, never localStorage or page query parameters; it adds no job directory.
- Validation: 29 focused workspace/existing A2A tests passed; TypeScript and lint passed;
  production build passed. Browser smoke checks use explicit intercepted test fixtures
  for queued/completed and failed jobs, pending/unknown amounts, terminal polling stop,
  memory clearing, invalid caps and mobile overflow. No paid POST is made by these checks.

## Release dependency follow-up

Release follow-up: the first CI run passed functional tests but its unchanged dependency
tree failed the high-severity audit gate. Pin transitive `toml` to 4.3.0, retaining
Anchor's CommonJS `parse(Buffer)` contract, and refresh compatible `fast-uri`/`qs`
versions. Add parser compatibility and pollution/depth regression checks. The audit
gate remains enabled; this dependency remediation is part of the release validation.

Advisories: https://github.com/advisories/GHSA-v5mp-jgw5-2x6j,
https://github.com/advisories/GHSA-82x6-q7mm-w9cf,
https://github.com/advisories/GHSA-f65p-4m7j-42xc.

## September 7 — Independent buyer client (v0.22.0)

Added `npm run buyer -- quote|buy|resume`, with caller-provided key/payee/price cap,
exclusive pre-submission journals, GET-only recovery, seller-relayed payment evidence
retained independently of delivery, and receipt integrity/request binding checks.
The workspace now downloads request JSON and links to `docs/buyer-agent.md`.
Fault-injection tests use a deterministic unfunded signer and mocked HTTP; they are
not settled transactions or external demand. Live paid pilot validation still requires
an independently funded buyer and is not claimed by these tests.

The unsigned client was also checked against production: the Quick request with a
0.03-USDC creator cap returned a 0.05-USDC total challenge, accepted without signing
or paying. This validates live challenge compatibility, not paid delivery.
An all-in limit below that quote was refused before signing. Local validation passed:
31 focused buyer/order/receipt tests, TypeScript, focused lint, production build and
a browser check of the exact request download on mobile. Production dependency audit
had zero high/critical findings; low/moderate transitive findings remain.

Post-review patch v0.22.1 makes receipt archival atomic: re-download repairs a partial
same-digest file without overwriting older receipt versions or submitting a payment.
The fault test corrupts the local archive and verifies recovery via GET requests only.

## Next deliverables

1. Validate the new buyer client with an independently funded testnet pilot, including
   reconnecting to an existing paid job. The old self-funded demo client is not independent demand.
2. Pilot onboarding and repeat usage from 3–5 external teams (target, not achieved traction).
3. Before/after demo, architecture diagram, integration guide and submission by September 16.
4. Separate mainnet-readiness assessment for September 30. No mainnet enablement or real
   funds are authorized by this hackathon plan.

## Prize and eligibility notes

The Arc page checked September 5 lists Continuity prizes of $1,666 for Best DeFi or
Agentic Application and $1,500 for Launch on Arc Testnet & Push to Mainnet. The latter
says deployed or deployment-ready by September 30. Confirm eligibility for a project
already using Arc, the meaning of deployment-ready, deadline time zone and track
selection with organizers. These are unresolved questions, not assumed qualifications.

Source: https://ethglobal.com/events/ethonline2026/prizes/arc

The Lepton rubric, volume goals and submission form in `docs/hackathon-playbook.md`
are historical and do not govern this event. Report externally initiated use separately
from internal drivers; report testnet settlement separately from mainnet revenue.
