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

## Next deliverables

1. A bounded buyer-agent client using its own funded wallet, validating the exact x402
   challenge before signing, preserving uncertain payment/recovery evidence and verifying
   the returned portable receipt. The old self-funded demo client is not independent demand.
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
