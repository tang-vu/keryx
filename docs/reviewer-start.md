# Keryx reviewer guide

Keryx is a research service for developers, researchers and small teams. A question
and budget lead to visible BUY/SKIP/CACHE decisions, retained source excerpts,
a cited report and USDC rewards for eligible creators. Production has run on
Arc mainnet since October 4, 2026, using Circle Gateway and x402.

**[Product demo — 2:49, English narration and subtitles](https://youtu.be/4uHylKXcv5Y)** ·
**[Live product](https://keryx.cc)** · **[Windows / integrations](https://keryx.cc/download)** ·
**[Event build and evidence](tameion-submission.md)**

## Review in three steps

1. **See the product and a return task.** Watch the demo above. For the longer
   user artifact, open [0xacee's VoiceReady recording — 2:23](https://github.com/tang-vu/keryx/releases/download/v0.27.63/0xacee-voiceready-keryx-return-20261015.mp4).
   On October 15, this returning builder used retained MDN passages to inform
   review of browser object-URL cleanup. The [case study](case-studies/voiceready-2026-10-15.md)
   records the useful evidence, unsuccessful FFmpeg research and separate assistant
   implementation checks. The research was sponsored with a zero source cap.
2. **Follow the decisions and money.** The [recorded walkthrough](https://keryx.cc/walkthrough)
   reopens a stored job: exact excerpts, CACHE/SKIP reasons and a mainnet citation
   receipt. It starts no research or payment. The example is a partial owner-QA
   result with zero access toll and a 0.025 USDC reward to a first-party creator.
   Its [receipt checks](#read-only-receipt-inspection) distinguish integrity,
   Circle settlement and registry authority.
3. **Inspect use and progress.** Read the [current evidence summary](tameion-submission.md#october-17-current-evidence)
   and [Tameion build delta](tameion-submission.md#event-period-product-delta).
   Direct [user videos and the working paper](tameion-closeout-2026-10-17.md#public-media-backups)
   remain available as GitHub release assets if a live application page stalls.

To try a new question, open [Keryx](https://keryx.cc), choose Quick and check the
current availability, payer, budget and report visibility. Sponsored admission
can be capped or paused. A fresh request has a different execution path from
opening a retained report.

## Current evidence at a glance

All figures below retain their own unit and reporting period. The
[full summary](tameion-submission.md#october-17-current-evidence) supplies the sources
and counting details.

| Evidence | October 17 submission snapshot |
| --- | --- |
| Mainnet service use | **216 recorded questions, 16 recorded accounts; 174 guest questions included in the 216.** These are service records, not a deduplicated human count. |
| Contactable users | **Four case-study participants**, covering freelance app development, SaaS discovery and academic research. They are a contactable subset of service use. |
| Return use and outputs | 0xacee's October 15 VoiceReady task; Hiếu's user-led working paper using **65 retained reports and 202 research targets**. These artifacts are not extra users or extra totals. |
| Mainnet payment activity | **116 settled records, 2.170250 USDC gross volume**, September 27–October 17, including owner/QA and incoming/outgoing records. Source/citation payouts are **1.272750 USDC**; Keryx operating fees are **0.867500 USDC**. |
| Event testnet activity | **258 completed runs, 304 settled source/citation payments, 2.086750 test USDC**, September 27–October 2, including internal activity. |
| Historical testnet creator base | **23 paid creator wallets**, June 15–October 2. The current mainnet creator-payout view has two first-party source records; these scopes are separate. |
| Distribution | **2,711 event-window npm downloads**; **580 website visits**; **12 extension installs**. [The distribution table](tameion-submission.md#october-17-distribution-refresh) records their different windows and other channels. |

The network-filtered usage API attributes 159 of the 216 service questions to
stored mainnet tags; 57 legacy questions lack those tags. Funding/cohort
classifications remain unknown. Recorded payment volume and reachable-user stories
do not establish outside-customer revenue. The next business validation goals are
participant-funded repeat demand and independent acceptance of a complete paid result.

## What changed during Tameion

Keryx has been developed continuously since June 2026. The earlier citation-toll
agent, web/MCP access and testnet settlement are prior work. The event continuation
connects those foundations to practical research and business operation:

- **Usable clients and continuity:** Windows Tauri app and task CLI, private
  workspaces, pinned seller/network/caps, original-job recovery and offline exports.
- **Research and writing:** original HTML/PDF reading, DOI/arXiv discovery, paper
  screening/comparison, retained-excerpt drafting, cited-sentence checks and
  bibliography/evidence exports.
- **Mainnet and commerce:** October 4 production cutover, creator-signed registration,
  source/version payout checks and a prepaid Operator with obligation, capacity,
  liquidity and original-order reconciliation checks.
- **Inspection and reuse:** Decision Lab, signed offline exports, economic replay,
  supplied-review/cost analysis, a missing-evidence procurement prototype and the
  separate **[MIT Arc primitives 0.4.0 library](https://github.com/tang-vu/keryx-arc-primitives)**.
  Funded provider execution remains a future stage of the procurement prototype.

The business direction is research deliverables for developers, researchers and
small teams. Continued client releases, mainnet operation, user research artifacts
and a returning builder provide dated progress beyond the original hackathon.
See [continuity and business direction](tameion-submission.md#continuity-and-business-direction).

## Evidence by judging criterion

The [official event guidance](https://tameion.thecanteenapp.com/) suggests these
weights; judges retain the final decision.

| Criterion | Inspect | What it establishes |
| --- | --- | --- |
| Agentic sophistication — 30% | [Walkthrough](https://keryx.cc/walkthrough), [Decision Lab](https://keryx.cc/operator/decisions), [Operator](operator-business.md) | Inspect model proposals, budget/attention rules, executed source choices and observed payments; the stored walkthrough shows CACHE/SKIP. |
| Traction — 30% | [Current use](tameion-submission.md#october-17-current-evidence), [Hoàng's task](tameion-submission.md#named-external-user-hoàng-freelance-developer), [return task](case-studies/voiceready-2026-10-15.md), [working paper](tameion-submission.md#research-artifact-trần-minh-hiếu) | Recorded mainnet activity plus directly contactable participants, practical outputs and return use, with sponsorship and payment scope disclosed. |
| Circle tool usage — 20% | [Integration ledger](engineering/circle-arc-integration-ledger.md), [receipt](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt) | Circle Gateway/x402 and Arc source/payout authority, with inspectable settlement references and recovery behavior. |
| Innovation — 20% | [Two-toll receipts](research-receipts.md), [Arc primitives](arc-primitives-maintenance.md), [procurement prototype](evidence-procurement.md) | Separate access purchases from qualifying-evidence rewards; exact allocation and recoverable paid delivery; reusable components with explicit host duties. |

## Source, submission and delivery

The owner confirmed final form resubmission on **October 17 at 23:43 GMT+7**.
The final prepared code comparison is fixed at
**[September 25 baseline → October 17 source 6fc96424](https://github.com/tang-vu/keryx/compare/2291753cc4fff2135d546227d5aafda287cbed7d...6fc964247673fc8f6b7e24f47ad731f9e3771fc2)**.
The final form payload was not independently read back. The October 13 entry and
older comparison are preserved in the [submission history](tameion-submission.md).

A dated October 17 health read observed web **0.27.75**, source **50ad8e0e**, on
Arc mainnet. The fixed comparison includes later merged wallet-recovery and
public-source performance fixes. Source, deployed web, published clients and
installed clients have distinct identities; [surface roles](surface-parity.md)
and [mainnet status](mainnet-status.md) record delivery. Intermittent live-page
latency was observed on October 17. The [review card](tameion-closeout-2026-10-17.md)
keeps those dated observations and direct media backups.

## Read-only receipt inspection

### Verify the example

The [stored report](https://keryx.cc/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913)
was created October 8. Its first-party Engineering source was cached; the answer
retains a Low/incomplete label and omits a requested revision. The
[receipt](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt)
records one 0.025 USDC citation reward, network `eip155:5042`, and Circle transfer
`f2751e74-754b-48a7-b416-6e682410ac9f`.

The retained canonical payload digest is
`sha256:97803e69c805d4c5ce4fa1470ed2336571799697f0a7ec90d59e33d4674553b6`.
The October 16 readback matched it and Circle's completed transfer. The payout
control reads retained SourceRegistry V1, rather than the current V3 registry.
Integrity, Circle status and a payout-authority read answer separate questions;
a checksum does not prove factual truth, and a Circle reference is not an
individual Arc transaction hash. [Verification scope](engineering/recorded-walkthrough-305.md)
and [receipt trust boundary](research-receipts.md#trust-boundary) explain the controls.

[Historical reviewer checkpoints](reviewer-checkpoints-2026-10.md) retain the
October 8–16 hashes, release identities, readbacks and archived recording scope.
They describe those checkpoints; the current summary above describes the final
October 17 preparation and owner-confirmed resubmission.
