# Keryx: complete product and mainnet delivery

Active objective, September 9, 2026: a complete buyer/creator/developer ecosystem,
explicit revenue and profit formulas, and evidence-backed readiness for mainnet.
ETHOnline is an intermediate delivery milestone. Completing its demo does not finish
this objective. This plan is the maintained acceptance map; old aspirational TVL,
multi-chain and enterprise checklists are historical, not proof of readiness.

Mainnet readiness and permission to launch are separate. The existing testnet
restrictions remain until the final owner go/no-go decision. No mainnet keys,
addresses or service availability will be inferred from testnet configuration.

## Current baseline and gaps

Repository baseline: `ddcc520`. The buyer CLI, private journals, receipt verification,
redacted reports and `/research` preparation/inspection are implemented. Existing
owner-operated pilots demonstrate testnet payment and recovery on a narrow first-party
corpus. They do not establish an externally profitable service or broad research quality.

The public economics snapshot at `2026-09-09T05:47:18.440Z` reported 306 sampled runs,
16 priced runs and 290 unpriced runs, with `mimo-v2.5` unpriced. Its estimated LLM cost
of 0.033683 USD covers only priced runs. Its 2.82-USDC A2A service-fee total is testnet
ledger activity, not mainnet revenue. Neither this aggregate nor the shadow margin
can establish monthly profit. Fixed operating costs, billing reconciliation and
independent customer cohorts have not been verified for this baseline.

Live official documentation checked September 9 lists Arc as testnet-only in
[Circle Gateway supported blockchains](https://developers.circle.com/gateway/references/supported-blockchains).
[Arc RPC documentation](https://docs.arc.io/arc/references/rpc-endpoints) also separates
testnet parameters from future mainnet parameters. It now publishes `.arc.io` RPC
hosts; the repository's older `.arc.network` configuration must be explicitly
revalidated before a network configuration change. These observations are dependency
evidence, not an announcement of a mainnet launch date.

## Product acceptance map

Each row requires code, meaningful tests and observed runtime behavior. A code path
existing is insufficient to mark the complete journey accepted.

| ID | Participant and complete journey | Current evidence | Work and acceptance still required |
| --- | --- | --- | --- |
| B1 | Buyer discovers an offer, understands price/quality limits, funds a wallet, buys and follows a research job | `/research`, shared buyer engine, [fresh owner-operated browser funding/purchase/recovery pilot](./engineering/browser-pilot-2026-09-09.md), [portable browser/CLI recovery](./engineering/portable-recovery-2026-09-09.md) | Independent wallet/mobile acceptance, replaced/cancelled transactions and recovery of lost funding storage. Preserve caps, private identifiers and uncertainty across those paths. |
| B2 | Buyer reads answer, source decisions, evidence, spend and history; exports or deletes private local state deliberately | Buyer workspace, source-decision display, receipt archives and redacted CLI reports | Account/private history and privacy controls with ownership checks; browser receipt integrity checks where claimed. Usability review across desktop/mobile and fresh buyer sessions. |
| C1 | Creator proves ownership, publishes priced/versioned content, updates/deactivates it and receives earned rewards | Registration, RSS verification, registry, source/citation routes and encrypted content modules | Fresh independent creator onboarding; ownership/payout updates, version changes and unavailable content exercised end to end. Rights/terms and retention behavior explicitly reviewed. |
| C2 | Creator sees settled/pending earnings, receives notifications and withdraws without duplicate payment | Creator pages, withdrawal endpoints/intents, Gateway proof and notification paths | Current-release withdrawal/reconciliation failure drills, key/account recovery guidance, clear costs and support ownership. No use of a transfer ID as invented chain finality. |
| D1 | External developer integrates quote/buy/resume/report and operates with bounded funds | Buyer CLI, API docs, MCP and A2A routes | Clean-machine integration by independent teams, API/version change policy, per-client limits/usage reporting and actionable support diagnostics. |
| O1 | Operator reconciles jobs, monitors quality/economics, restores service and responds to incidents | Worker, order review commands, health/proof, backups and reconciliation scripts | Timed restore/rollback drills on the intended release, alert delivery checks, rotation procedures, operator access review and documented incident ownership. |
| E1 | Ecosystem has repeat buyers and independently controlled useful sources | Internal sources and first-party pilot evidence | Retain the existing roadmap target of 3–5 independent buyer teams repeatedly using one valuable outcome; independently controlled creator participation and four weeks of cohort evidence. Do not substitute owner-operated volume. |

## Economics acceptance

1. **Explicit model:** compute service-fee contribution, fixed-package retained reserve,
   variable costs, fixed/acquisition costs and break-even separately. Unknown inputs
   remain unknown. [Business model and calculator](./business-model.md).
2. **Complete measurement:** join each billable job to exact provider/model usage,
   price effective date, failures/retries and settled payment records. Match sampled
   costs to invoices; preserve unpriced/historical gaps instead of retroactively
   inventing provider charges. Record operating and acquisition costs separately.
3. **Independent cohorts:** separate internal automation, owner pilots and independent
   buyers. Measure repeat use, accepted outcomes, latency, completion, actual receipt
   collections, creator obligations, support load and refunds/losses by period/package.
4. **Viable pricing:** positive contribution must not depend on skipping useful paid
   sources, paying creators incorrectly or declaring pending spend unused. Evaluate
   service-fee-only and retained-reserve cases separately. Price changes require
   versioned offers and buyer-visible terms; a calculator never changes quotes.
5. **Operating result:** reconcile modeled operating surplus with observed receipts,
   obligations and all relevant costs before claiming profit. Taxes, financing and
   accounting recognition require separate treatment; testnet tokens are not revenue.

## Research quality acceptance

Expand beyond the two Engineering articles. Maintain English held-out cases with
supported answers, absent evidence, conflicting sources, ambiguous questions and
paid-but-undelivered content. Preserve target identity and source-owned payout authority.
Judge quoted support and answer usefulness, not merely model-generated coverage scores.
Run repeated end-to-end checks including discovery, cache, paid delivery and failure
handling. Record negative outcomes and evaluation/model versions. Package SLOs remain
provisional until independent cohorts substantiate a promise.

## Mainnet release gates

| Gate | Required evidence | Baseline status |
| --- | --- | --- |
| M1 Network/services | Official Arc mainnet chain/token/RPC/explorer values, Gateway nanopayment support, deployed code and SDK support verified against the intended environment | External availability not established; Gateway docs currently say testnet-only |
| M2 Authority/isolation | Separate production configuration, deployments and keys; no cross-environment signatures/nonces/DB records; bounded user and treasury funds | Testnet-only implementation; migration design and tests required |
| M3 Security | Independent review of signer/session authority, contracts, x402/Gateway, registry, encrypted delivery and auth; remediated critical/high findings and documented residuals | Repository tests/threat model exist; independent mainnet review not demonstrated |
| M4 Settlement/recovery | Lost response, replay/concurrency, Circle/RPC outage, settled-but-undelivered and reconciliation drills; no silent pending-to-failed transitions | Focused tests and owner pilots exist; release-wide drill evidence incomplete |
| M5 Operations | Restore/rollback/rotation drills, realistic capacity/load test, alert routing, funding limits and an incident owner | Operational tooling exists; release acceptance not yet proven |
| M6 Product/data policy | Buyer/creator journeys above accepted, private history/content access reviewed, clear pricing/refund/retention/support terms | Partial; independent wallet UX, authenticated private history, recovery completeness and policy review remain open |
| M7 Economics/adoption | Cost coverage, independently initiated repeated use, measured quality and positive unit contribution with no unpriced-cost assumptions | Not established |
| M8 Launch decision | Owner reviews the concrete release, evidence dossier, funds/limits and remaining risks, then explicitly approves mainnet deployment/spend | Not requested or granted |

If external Arc services remain unavailable, build and verify the release candidate
on supported testnet rails and keep M1 open. Do not relabel that state as mainnet-ready
or silently migrate the product to another chain. Missing external evidence does not
prevent independent product, measurement or reliability work from continuing.

## Delivery sequence

Operational evidence update (September 9): a [local SQLite snapshot restore check](./engineering/restore-drill-2026-09-09.md)
passed checksum, gzip, integrity and required-column checks. Scheduled off-site backup,
complete service/key recovery and payment-reconciliation drills remain unverified;
O1/M5 are still open.

Private recovery evidence update (September 10): a [local buyer/backend integration drill](./engineering/private-checkout-integration-2026-09-10.md)
connects quote acceptance, EOA signing, durable journals, SQLite payment admission and
recovery after response loss and database reopen. Both persisted synthetic success and
ambiguous settlement retain single-attempt behavior. The drill now also exercises the
private executor with blocked provider traffic, an injected result-write failure,
encrypted backup preservation and restoration through a separate operator process.
Real HTTP checkout, Circle and paid creator delivery remain untested by that drill;
B1/M4 remain open.

Private worker operations update (September 10): the
[process crash-lock drill](./engineering/private-worker-crash-lock-2026-09-10.md)
verifies real-process exclusion and retained locks after forced termination on the
local Windows filesystem. Cleanup happens only after the holder's close event. This
does not prove production supervisor recovery, power-loss durability or readiness to
accept payments; M5 remains open. Private checkout client composition and encrypted
result recovery shipped in v0.22.38; private purchasing was disabled at that drill.

Private paid acceptance update (September 10): the [first owner-operated private pilot](./engineering/private-paid-pilot-2026-09-10.md)
completed through the CLI, managed worker and owner browser recovery on Arc testnet.
Purchasing is restricted to one configured pilot account. Creator legs totaling 0.017 USDC
were facilitator-confirmed; a foreign account could not read the result and no public run
or payment rows were found for it. Billing coverage remains unknown because six served
reasoning attempts produced seven usage records. This does not close independent buyer,
complete cost accounting, paid-job crash recovery or mainnet acceptance gates.

Private browser integration update: the [private browser journal](./private-browser-checkout.md)
now has Chromium evidence for exclusive reservation, cross-tab submission claims, reload,
recovery-only imports and storage failure. v0.22.45 connects quote/provider review, local
consent, current wallet/account/balance checks, one-attempt purchase and recovery in `/research`.
The actual React/client/IndexedDB path passes synthetic response-loss and reload checks;
v0.22.46 adds explicit local question/signature deletion with a minimal replay barrier
and recovery-only re-import. Chromium checks cover deletion transaction failure, competing
claim/deletion, pagination past deleted entries and UI confirmation/cancellation/reload.
Live private browser payment, independent wallet/mobile acceptance, server retention
and portable private receipt verification remain open.

Privacy disclosure update (v0.22.47): `/privacy` distinguishes public publishing from
the restricted private pilot, explains provider access, plaintext browser/export data,
local deletion limits and the absence of automatic server expiry. It also corrects the
old no-third-party-analytics claim after observing Cloudflare and WalletConnect requests.
This describes current behavior; it does not close independent privacy review or retention
implementation. The v0.22.46 local deletion flow passed Chromium/CI; its initial live probe
did not complete and must not be recorded as accepted.

1. Establish this acceptance map and the executable economics model; obtain actual
   fixed costs and provider billing data without inventing zeros.
2. Complete usable browser quote/buy/recover under the buyer's own wallet authority,
   retaining the existing CLI as an integration path. Design and review this boundary
   before introducing signing or browser persistence changes.
3. Complete creator and developer onboarding/support journeys, private history and
   economic/quality reporting. Exercise them with independent participants.
4. Reconcile measured cohort economics; improve research quality and pricing from
   those results. Keep first-party runs and assumptions visibly separate.
5. Complete security/operational drills and the mainnet configuration/deployment
   candidate. Revalidate vendor support, then present the final launch decision.

Every completed product update is tested, committed, pushed, deployed and health-
verified according to `AGENTS.md`, with an honest Canteen update. Completion of the
overall objective requires evidence for every acceptance area above; shipping the
calculator, a demo, or a green CI run alone is not completion.
