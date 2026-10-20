# Backlog scope decision — October 20, 2026

The owner requested one small PR to reconcile the open backlog, with discretion
to reduce the original issue scope. This decision covers the **26 open issues**
captured against main `a7cb767b788f97460117d2b53e9b8e22b9b11032`.

Retire the outstanding proposals below from the active backlog. Close them as
**not planned**, after this PR merges. None is being certified as fully implemented
or accepted against its original checklist. The existing implementation remains
available within its current admission and rollout boundaries; staged or disabled
features retain that status. A future request can reopen the original issue with
a bounded outcome and the required authority and evidence.

This decision supersedes older instructions to keep these particular GitHub
issues open. It does not supersede their technical safety conditions, actual
failed results, retained evidence, active implementation claims or release holds.
In particular, closing a ticket neither releases another owner's claim nor
admits that owner's unfinished candidate.

| Issue | Existing baseline or evidence | Scope retired from this batch |
| --- | --- | --- |
| [#158](https://github.com/tang-vu/keryx/issues/158) — reasoning fallback | [Resilient engine](../../lib/llm/resilient-engine.ts), [regressions](../../lib/llm/resilient-engine.test.ts) and per-step telemetry provide source-level repairs. | Reconstructing the unavailable historical exception and a new paid live resilience trial. No historical root cause or fresh live acceptance is claimed. |
| [#164](https://github.com/tang-vu/keryx/issues/164) — shorter maintenance | [Immutable staging](../immutable-release-staging.md) and [hosted preparation](../hosted-immutable-preparation.md) describe the reviewed preparation path. | Treating this broad ticket as an availability commitment. Every actual cutover still needs its exact cohort, positive drain, compatibility, retained rollback and health evidence. |
| [#211](https://github.com/tang-vu/keryx/issues/211) — teacher lesson | [Teaching proposal boundaries](teaching-proposals-core-2026-10-08.md) and the issue retain the offline NASA reproduction and its limitations. | Activating the staged teaching feature or claiming a successful ordinary Vietnamese lesson. The original useful-output gap remains a known limitation; factual and attribution gates stay intact. |
| [#250](https://github.com/tang-vu/keryx/issues/250) — deliverable acceptance | [Customer acceptance journal](deliverable-acceptance-250.md) records customer opinions separately from financial actions. | Automatic revision execution, refunds, silence-as-acceptance, or escrow. An opinion remains an opinion and grants no payment authority. |
| [#252](https://github.com/tang-vu/keryx/issues/252) — contract spending limits | Existing session caps and reservations remain authoritative; the [integration ledger](circle-arc-integration-ledger.md) distinguishes planned contract work. | Deploying a PolicyVault or changing custody. Application limits must not be advertised as contract-enforced limits. |
| [#253](https://github.com/tang-vu/keryx/issues/253) — decision verdicts | [Decision review](decision-review-253.md) defines verdict capture and review-first boundaries. | New funded before-effect trials or claims of independent-user agreement. Existing activation, expiry and normal payment-path checks remain required. |
| [#256](https://github.com/tang-vu/keryx/issues/256) — wallet-free funding | [Onramp documentation](../arc-card-onramp.md) retains configured methods and provider/rollout constraints. | New live bank/card purchases, cross-chain execution, KYB or custody changes. No purchase or available funding is inferred from session creation. |
| [#258](https://github.com/tang-vu/keryx/issues/258) — float management | [Evaluation](../operator-treasury-float-evaluation.md) and [read-only obligations](operator-obligation-projection-258.md) are the bounded baseline. | Investing float, cross-chain sweeps and funded reserve/redemption tests. Incomplete obligations continue to mean unknown availability and zero advisory spend. |
| [#262](https://github.com/tang-vu/keryx/issues/262) — anonymous claims | [Anonymous claims](../anonymous-run-claims.md) documents staged, single-use ownership handoffs and default-off admission. | New schema/production activation and a promise of live claim links on every surface. No fallback, reissue or research replay is authorized. |
| [#265](https://github.com/tang-vu/keryx/issues/265) — verified profiles | [Verified identity UI](verified-identity-ui-265.md) distinguishes stored verification from typed links. | New provider credentials, live OAuth qualification and public verification rollout. A typed link or return hint remains insufficient proof. |
| [#273](https://github.com/tang-vu/keryx/issues/273) — trust glossary | [Translation instructions](../translation-instructions.md) describe draft glossaries and digest-bound review checks. | Claiming named human approval or enabling unreviewed financial/legal translations. Drafts remain drafts; existing release checks still apply. |
| [#279](https://github.com/tang-vu/keryx/issues/279) — group budgets | Individual authorization and atomic session caps remain the supported baseline. | Shared custody, memberships, approver workflows and group vaults. Individual limits do not establish a group-budget contract. |
| [#280](https://github.com/tang-vu/keryx/issues/280) — paper royalties | [Source claims](../public-source-claims.md) retain their existing site/feed rights and registry authority. | ORCID-work claims, declared coauthor splits and disputes. A public paper reference or generic feed claim creates no new payout rights. |
| [#284](https://github.com/tang-vu/keryx/issues/284) — topic watches | [Manual metadata-only watches](topic-watch284-native-manual-product-20261015.md) describe the bounded source implementation. | Scheduled discovery, standing spending and email/bot delivery. The local curated-catalog check is not discovery of newly published works. |
| [#286](https://github.com/tang-vu/keryx/issues/286) — public finances | [Observed-transfer ledger](operator-job-ledger-286.md) exposes bounded transfers with explicit accounting limitations. | Complete business books, revenue, obligations and per-job profit. Unknown margin stays unknown; a balanced transfer export is not a complete business ledger. |
| [#288](https://github.com/tang-vu/keryx/issues/288) — three paid pilots | Existing outside references and owner QA retain their original provenance. | The three-group, ten-acceptance and returning-wallet targets. No group participation, consent, outside funding or accepted deliverable is fabricated. |
| [#289](https://github.com/tang-vu/keryx/issues/289) — ERC-8004 identity | The [integration ledger](circle-arc-integration-ledger.md) distinguishes planned identity work from implemented integrations. | Registry transactions, new registration-key custody and on-chain reputation. Local citation history is not ERC-8004 registration. |
| [#290](https://github.com/tang-vu/keryx/issues/290) — ERC-8183 escrow | [Prepaid research packages](../a2a-research-packages.md) and [receipts](../research-receipts.md) remain the existing contract. | A new escrow/evaluator/refund contract. The issue's proposed external synthetic review remains a proposal; closure certifies no submitted review or escrow result. |
| [#291](https://github.com/tang-vu/keryx/issues/291) — memos and batches | Existing payment references, journals and Gateway reconciliation retain their current roles. | Memo contracts, decision-hash verification and sender-preserving multicall payouts. Gateway batching is not evidence of those features. |
| [#292](https://github.com/tang-vu/keryx/issues/292) — Agent Marketplace | Existing x402 endpoints and discovery metadata remain available under their current contracts. | Marketplace submission/approval, paid third-party trials and new discovery-driven purchases. No catalogue listing is claimed. |
| [#293](https://github.com/tang-vu/keryx/issues/293) — settlement events | Existing authoritative reconciliation remains the settlement path. | New hooks, webhook subscriptions and event ingestion. Pending/uncertain payments cannot become settled from an unconfirmed signal. |
| [#294](https://github.com/tang-vu/keryx/issues/294) — other currencies | [Currency evaluation](../currency-support-evaluation.md) is the completed research baseline. | Exchange-rate display, swaps, EURC funding and payouts. Binding caps and accounting remain exact integer micro-USDC. |
| [#295](https://github.com/tang-vu/keryx/issues/295) — bank cash-out | Existing owner-wallet USDC withdrawal/recovery remains distinct from a bank withdrawal. | A bank off-ramp prototype and unverified exchange-support guidance. No bank eligibility, conversion or final cash-out is asserted. |
| [#299](https://github.com/tang-vu/keryx/issues/299) — source learning | [Bounded source outcomes](source-learning-299.md) provides observational records and controlled offline planner evidence. | Live learned selection, prospective exploration and claims of production purchase-rate improvement. Live exploration remains zero; owner exclusion and hard payment limits remain required. |
| [#303](https://github.com/tang-vu/keryx/issues/303) — funded bounties | Existing wanted/gap records describe unmet needs. | Funding escrowed offers, automated evaluation/payout and fill-rate claims. Recording a gap creates no funded obligation. |
| [#306](https://github.com/tang-vu/keryx/issues/306) — unattended Operator | Existing bounded workers and journals retain their authorized roles. | An unattended business cycle or new schedule. Current stops, budgets and held scheduler policy remain in force. |

The [October 10 audit](issue-closure-audit-2026-10-10.md) remains historical
evidence of the original gaps. Its technical findings are not converted into
passes by this scope decision. Existing tests and required CI remain unchanged.

This is a documentation and backlog change only. Web, desktop, CLI, API,
remote/stdio MCP, extension and bots receive no runtime or protocol changes.
It needs the normal docs-only PR acceptance and serialized source merge, with
no version allocation, deployment, publication or product announcement. The
existing ROOT/Circle release owner and financial/custody holds are unchanged.
