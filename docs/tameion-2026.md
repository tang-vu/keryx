# Keryx at Tameion 2026 — planned direction

**Status (September 28, 2026): plan, not a shipped Operator or desktop release.** Keryx
keeps its name, repository, citation-toll reading agent, and existing complete-product
and [mainnet release gates](./mainnet-delivery-plan.md). The event work must be measured
against the pre-event repository baseline `2291753cc4fff2135d546227d5aafda287cbed7d`
(September 25). Baseline users, revenue, and event-period growth are unknown until
reconstructed from actual evidence. [Decision history](../DECISIONS.md) describes
implemented architecture; this document proposes work and does not claim a decision shipped.

## Product and customer hypothesis

Keryx Operator would manage the business behind paid research. It would track verified
incoming receipts, creator and service obligations separately from spendable operating
funds, bounded purchases, creator payments, reconciliation, and human escalation for
policy exceptions. The reading agent still discovers sources, shows BUY/SKIP/CACHE
reasons, pays selected source-owned `payTo` addresses, cites actual evidence, and settles
weighted creator rewards. Payment state and agency stay visible to the user. A timeout
remains uncertain until reconciled; an obligation does not disappear because a plan
changes. Preserve journal-before-signature/resume, single-use nonces, atomic reservations,
and exact integer micro-USDC accounting in any new surface.

The first customer segment is a **hypothesis**, not established demand: founders or
small teams in the Arc ecosystem who need recurring API, product, or competitor research
briefs. Sell a concrete, priced research outcome first; consider subscriptions only after
repeat demand. During the first 48 hours, contact roughly ten relevant candidates and
seek two or three real tasks or pilots. Targets for the event are two or three
independent teams, ten real jobs, and two returning customers; none is an achieved count.
Keryx's own business may be an initial Operator pilot, but its volume must be reported
separately from independently initiated use. Owner-generated jobs or synthetic activity
are never independent traction. Existing package prices and terms require explicit,
versioned buyer-visible changes; this plan does not change them.

## One working system, staged delivery

Long term, Keryx should expose one TypeScript task engine across the web, Windows
desktop, CLI, and MCP/API. It needs workspace and task memory with provenance and access
scope, a controlled tool catalog, permissions, durable jobs, and inspectable receipts.
Extract cohesive shared pieces gradually from the current app; avoid a monolith rewrite.
An ERP, payroll, yield engine, multichain launch, and plugin marketplace are outside
this two-week scope.

- [ ] Design Operator authority: receipt verification, obligations versus available
  funds, category and job limits, approvals, immutable events, reconciliation, and
  exception escalation. Identify the trusted authority for every state change.
- [ ] Deliver a testnet Operator cycle with real jobs and persisted evidence: receive,
  decide, purchase within bounds, pay cited creators, reconcile, and recover ambiguous
  or interrupted work. Keep failures isolated where a completed answer can survive.
- [ ] Build a Windows-first Electron + React alpha: permissioned local document import,
  task progress/history, notifications, and human approvals. Keep keys and Node access
  out of the renderer and restrict IPC. Local-file work requires an authorized local
  companion online; remote jobs can continue on the existing VPS while the app is closed.
  Do not promise universal offline or cloud execution.
- [ ] Provide CLI `create`, `status`, `resume`, and `export --json` over that same task
  engine, reusing existing buyer CLI and MCP integrations where appropriate.
- [ ] Pilot the specific research outcome with real users; capture feedback, return
  usage, source quality, delivery, pending versus settled payment, and obligations by
  period, network, and owner versus independent origin.

An on-chain budget policy wallet is **not implemented**. The current repository uses
Arc testnet configuration (`eip155:5042002`), a buyer EOA authorization signature,
and application/database spend-cap controls. Its `contracts/` registry is source
authority, not a general per-category spending wallet. Depositing funds into Gateway
under an EOA signer would expose the combined economic envelope of both contract
releases and the existing Gateway balance; do not describe database limits as on-chain
enforcement. Any new authorization design requires explicit threat analysis, actual
contract/SDK integration, tests, and observed settlement before claiming hard chain
limits. The [buyer documentation](./buyer-agent.md) and
[release gates](./mainnet-delivery-plan.md) remain the external acceptance references.

## Event sequence and release gates

The [official Tameion page](https://tameion.thecanteenapp.com/) lists September 27–
October 10, 2026. Its five RFBs are prompts, not separate tracks; RFB 04, Autonomous
Business Operator, is the closest fit. Published judging guidance is 30% agency,
30% traction, 20% Circle usage, and 20% innovation. Genuine testnet use is accepted;
real customers using real mainnet USDC may be favored. A genuine own-business or
open-source use case can count, but only product and traction change during the event
should be presented as new for this existing project.

| Dates | Planned checkpoint; all work remains open |
| --- | --- |
| Sep 28–29 | Record pre-event baseline, discover first candidates, design Operator authority and evidence model. |
| Sep 30–Oct 1 | Complete and verify a bounded testnet Operator cycle, CLI, and recovery path. |
| Oct 2–4 | Run Windows alpha and real pilots; use the [Oct 2 showcase preparation](./tameion-showcase-and-fireside.md) to present verified state only. |
| Oct 5–7 | Consider a bounded mainnet pilot only if release gates and explicit owner launch/funds authorization are satisfied. |
| Oct 8–9 | Collect feedback and evidence, prepare a public repo and video under three minutes. |
| Oct 10 | Submit early; schedule slippage never waives a release gate. |

The website deadline is October 10 at 23:59 America/New_York (October 11 at
10:59 Asia/Ho_Chi_Minh). A Luma listing showed October 11 at 10:30 local time, so
the internal target is October 10. Submission requires a public repository and a
video shorter than three minutes; a deployed link is encouraged. Use the
[official submission form](https://forms.gle/BBWrdfuircrKiG2i6). Canteen updates are
progress reports, not the submission.

As of September 28, [Arc](https://docs.arc.io/arc/references/connect-to-arc) publishes
mainnet chain `5042`, and [Circle Gateway](https://developers.circle.com/gateway/references/supported-blockchains)
lists Arc mainnet/domain `26` and nanopayments. This is external availability evidence,
not a mainnet-ready Keryx release. The pinned testnet code, deployed addresses,
SDK/settlement behavior, security, recovery, operations, product, and economic gates
in the [delivery plan](./mainnet-delivery-plan.md) still require validation. Mainnet
deployment or real-fund spend requires explicit owner authorization.

After a verified shipped milestone, publish a concise Canteen **product** update
(for example, healthy web deployment or a runnable desktop/CLI release). A traction
update needs period-specific, real, settled evidence and must label owner versus
independent activity and testnet versus mainnet. Do not repackage historical totals as
new event growth, treat pending as settled, or publish private operating economics.
