# Tameion submission pack — working evidence

## Event-period usage: testnet week, then mainnet

Tameion began on September 27. Keryx ran on Arc testnet for the first week of the
event and moved production to Arc mainnet on October 4. Both phases are event-period
usage and are reported separately, never added together.

| Phase | Window (UTC) | Research runs | Settled payments | USDC | Counting rule |
| --- | --- | --- | --- | --- | --- |
| Arc testnet | Sep 27 00:00 – Oct 2 17:01 | 258 completed | 304 source-access and citation-reward payments | 2.086750 | One read-only production snapshot; all caller origins, internal activity included. No pending, failed or simulated payments in the window. |
| Arc mainnet | Oct 4 – Oct 8 15:05 | 50 recorded | 7 | 0.095, of which 0.065 to 2 creators | [Public metrics](https://keryx.cc/api/metrics) and [run history](https://keryx.cc/api/runs); all caller origins. |

Testnet activity between October 2 17:01 and the October 4 cutover is not in the
snapshot and is not counted. Cumulative lifetime figures include activity before
the event and are not event traction.

On mainnet, [Operator status](https://keryx.cc/api/operator/status) at
`2026-10-08T15:05:07Z` reported one completed and zero failed jobs over 24 hours,
with two registered creator sources.

### Named external user: Hoàng, freelance developer

Hoàng is a freelance developer building the Face Marker app. On October 2 he used
Keryx through the MCP server inside Devin CLI to research questions for that app:
facial-analysis methods, privacy and app-platform policies, and MediaPipe Face
Landmarker. He is outside the Keryx team. His identity and workflow were published
by the owner with a screen recording on X ([@tangvu_dev](https://x.com/tangvu_dev),
October 2) and in the October 3 Canteen traction update.

| Field | Value |
| --- | --- |
| Participant | Hoàng — [GitHub](https://github.com/Hoang130203), [LinkedIn](https://linkedin.com/in/ho%C3%A0ng-mai-minh-93a5852aa/) |
| Origin | Independent freelancer; his own app and his own questions |
| Surface | Keryx MCP in Devin CLI, Arc testnet |
| Runs | Three research runs: `3a43c6c2-fddf-40ce-98a1-701a2a58b439`, `fe7c06fd-65da-41a6-867c-0597a63304df`, `2405a2ea-7ee3-4f0d-88b9-f221df791070` |
| Payment | One source-access payment of 0.002 USDC to the Conzit Labs source; the other two runs bought nothing |
| Payer | Keryx treasury. The run was sponsored; Hoàng did not fund a wallet |
| Circle record | Transfer `09ab0e57-bb5e-43a0-90e4-194e181de1be`, completed, exact match on payer, payee, network, asset, amount and nonce |
| Chain record | Batch `0x565dd6fbdaec636e8528dd8a0f72eb6fe6c68513c8e60b2993805f7756929b60`, finalized in Arc testnet block 65095204 |
| Result quality | Real workflow with visible evidence gaps, as stated in the public post |

Limits of this record:

- The database row does not carry Hoàng's name or the Devin client; that attribution
  comes from the owner's public account of the session and the recording.
- The payment was sponsored, so it shows real use by an outside person, not an
  outside wallet paying.
- The three run pages were served from testnet storage and are not available on the
  mainnet deployment. The Circle and chain records above remain checkable.
- No repeat use by Hoàng after October 2 is recorded here.

Other people have contacted the owner through X, LinkedIn and Product Hunt. Each is
added here only once there is a named person, their own task and a matching run.

## October 8 current evidence and deliverable gate

At `2026-10-08T09:02:01.625Z`, [public health](https://keryx.cc/api/health)
reported operational/db ok, Arc real settlement at `ab2195d6`/app0.27.35.
At `2026-10-08T09:09:06.126Z`, [public metrics](https://keryx.cc/api/metrics)
projected47 queries, six settled payment records totaling0.07USDC, creator
payouts0.04USDC, two earning creators, zero settled operating fees and12 recorded
accounts. These are database projections, not independent-customer counts or a
new settlement performed by this review. Two feedback records cannot establish
general satisfaction; aggregate factual grounding remains unavailable.

The [four owner-operated real-client tasks](https://github.com/tang-vu/keryx/issues/128#issuecomment-6053576966)
reported two partial results and two no-answer results, with no complete accepted
deliverable. They are QA, not four external customers or a population failure rate.
The [app0.27.39 deliverable candidate](engineering/research-deliverable-quality-2026-10-08.md)
repairs the retained MDN evidence omission and stages bounded ordinary presentation.
A separate three-call retained-body model trial recovered all four requested MDN
facts in Portuguese, but initially failed the three-item format. Its unchanged
reviewed output is used for a deterministic presentation regression; this is not a
new full research/production acceptance trial or independent adoption. The candidate
does not establish original Operator fulfillment or deployment.
PR240 retains its separate owner, financial continuation and admitted source window.

Before recording the competitive demo, require useful original-task delivery,
inspectable BUY/SKIP/CACHE reasoning, exact settlement receipts and honest event
delta. Then collect accepted real use and repeat use from a narrow relevant user
group. Do not turn simulations, own-business QA or historical feature counts into
independent traction. Historical checkpoints below remain unchanged.

## October 7 read-only evidence checkpoint

At `2026-10-07T02:04:31.538Z`, [public health](https://keryx.cc/api/health)
reported operational/database ok, Arc mainnet and real settlement mode at
`c1cb8626`. [Public metrics](https://keryx.cc/api/metrics) subsequently reported
one settled payment totaling **0.03 USDC**, zero creator payouts and 28 stored
queries. The retained original is an owner-operated paid trial with unresolved
delivery; these figures establish neither independent business demand nor a
completed useful workflow. [Operator status](https://keryx.cc/api/operator/status)
at `2026-10-07T02:05:06.516Z` reported held/acceptance-paused, zero registered
creator sources and, over 24 hours, zero completed/one failed job. Recheck these
dated projections before recording or submission.

The organizer's three entry priorities are actual USDC flow on Arc through the
Circle stack, a project the builder intends to continue, and genuine business
use. [The official FAQ](https://tameion.thecanteenapp.com/) accepts an own-business
or maintained open-source use case; RFBs are prompts, not mandatory tracks.
That permits a genuine own-business research pilot, but does not make an internal
trial an accepted business outcome or independent traction. The immediate gate
remains delivery of the original paid task, owner acceptance against its actual
business decision, exact receipt/recovery evidence and a short recorded workflow.
All missing pilot proof fields below remain open; do not fill them from counts.

The 0.27.12 [failure-reporting candidate](engineering/synthesis-failure-2026-10-07.md)
makes unavailable synthesis distinguishable from missing document evidence. Its
code checks are not original fulfillment, a new settlement or usefulness proof.

October 6 candidate increment: [hosted business Operator](operator-business.md)
adds the prepaid revenue-to-delivery guard, audit and public observation. A real
complete business workflow, accepted deliverable and contract-enforced general
policy wallet still need evidence. Historical identities below are not candidate
deployment/publication proof; update them from fresh release readbacks.

The [finite canary](operator-canary.md) adds original-bound financial/provider
admission and recovery. Its internal owner run, funding and useful result are
still acceptance gates, not independent traction or a general on-chain wallet.

Updated October 4, 2026 against deployed source `1297d43`. This is a preparation pack,
not a submitted entry or a completed customer pilot. Update the dated observations
before recording or submitting. [Active direction](tameion-2026.md),
[release gates](mainnet-delivery-plan.md), and [public changelog](project-changelog.md)
remain authoritative for scope and limitations.

## Entry and evidence boundary

Keryx is an agent-operated paid research service: a question and source budget lead
to visible BUY/SKIP/CACHE decisions, selected x402 reads, a cited deliverable, and
weighted USDC rewards for eligible creators actually cited. The Tameion goal is
one complete business workflow with payment, logs, delivered outcome and recovery.
The full Operator, general business ledger, onchain policy wallet and autonomous
scheduler are not shipped. No complete independent-business workflow is supplied
in this pack yet. Production is now Arc mainnet, observed through public health.
[Current status](mainnet-status.md) records the network/contracts and release identities;
launch does not prove an accepted business outcome or grant unlimited spending.

The [official event guidance](https://tameion.thecanteenapp.com/) requires a public
repository and a recorded demo **under three minutes**, encourages a live link,
and allows repeated submissions before the deadline. Submit via the
[official form](https://forms.gle/BBWrdfuircrKiG2i6) by October 17, 23:59 ET
(October 18, 10:59 Vietnam; extended from October 10, observed October 5). Repository: [tang-vu/keryx](https://github.com/tang-vu/keryx).
Live service: [keryx.cc](https://keryx.cc). Video URL: **pending**.
Product and evidence-backed traction updates in Canteen, and showcase participation,
are separate from submitting this form. This document does not authorize posting,
contacting businesses, recording participants or submitting on their behalf.

## Event-period product delta

Compare against `2291753cc4fff2135d546227d5aafda287cbed7d` (September 25), the
pre-event main baseline; no intervening September 26/27 main commit replaces it.
The September 27–October 17 window is still in progress. These are implemented
changes through October 4, not forecasts for the remainder or evidence of adoption.

| Change | Source evidence | What it establishes and limits |
| --- | --- | --- |
| Durable local task CLI and Windows desktop | `44c8660`, `e7e82c5`, [task alpha](operator-task-alpha.md) | Local create/status/resume/export; deliberate buyer handoff, not autonomous purchasing. |
| Saved results, Rust task creation, Tauri shell | `dfcc1b3`, [PR #21](https://github.com/tang-vu/keryx/pull/21), [PR #22](https://github.com/tang-vu/keryx/pull/22), [desktop](desktop-alpha.md) | Reopen/export private results and GET-only recovery; TypeScript remains payment authority. |
| Public original-document and scholarly research | [PR #101](https://github.com/tang-vu/keryx/pull/101), [PR #109](https://github.com/tang-vu/keryx/pull/109), [PR #130](https://github.com/tang-vu/keryx/pull/130) | Bounded search, HTML/PDF reads and DOI/arXiv metadata; unavailable/oversized documents and answer quality remain limits. Public references alone confer no creator payout rights. |
| Chat-first reading and portable evidence | [PR #105](https://github.com/tang-vu/keryx/pull/105), [PR #106](https://github.com/tang-vu/keryx/pull/106), [PR #111](https://github.com/tang-vu/keryx/pull/111), [surface parity](surface-parity.md) | Cited reports, Markdown/BibTeX/RIS/evidence CSV and classified payment states; not proof of a customer accepting the result. |
| Bounded Research Monthly | [PR #125](https://github.com/tang-vu/keryx/pull/125), [terms](research-monthly.md) | Four manual Deep requests over 30 days, a 10% discount against four separate packages. Current quote/readiness returned HTTP 503 during this documentation check; old testnet prices are historical. No automatic renewal; failed/pending requests retain slots. Owner live purchase/redemption evidence is pending. |
| Custody, signing, recovery and storage preparation | [PR #113](https://github.com/tang-vu/keryx/pull/113), [PR #129](https://github.com/tang-vu/keryx/pull/129), [PR #126](https://github.com/tang-vu/keryx/pull/126), [PR #133](https://github.com/tang-vu/keryx/pull/133) | Narrow validated boundaries and fresh release identities; synthetic/mainnet preparation checks do not demonstrate mainnet activation. Full-product cutover [PR #131](https://github.com/tang-vu/keryx/pull/131) has merged; current production is mainnet. Funded acceptance, independent audit and adoption remain distinct. |

## Observed delivery and supported surfaces

Read-only public health at `2026-10-04T16:42:30.685Z` reported `1297d43`,
`arc`, real settlement mode and operational database. The current ledger projection
reported zero payments/creator payouts; this is a dated observation, not independent
customer traction. The October 2 `f563d9c`/`arcTestnet` observation and its degraded
reasoning/pending-payment state belong to the earlier deployment. Healthy HTTP
does not establish perfect research, per-role purchase readiness or reconciliation.

[Release v0.26.8](https://github.com/tang-vu/keryx/releases/tag/v0.26.8) points to
`1297d43f7c1a8356ceccac061b1cba65b93d2819` and exposes MCP 0.4.3 plus desktop
0.4.3 installer/ZIP/source manifest/checksums. Public `npm view keryx-mcp version`
returned 0.4.3 on October 4. Version discovery and downloadable assets alone are
not independent verification of all package bytes or fresh installer acceptance;
retain their exact release evidence before claiming synchronized delivery.

| Surface | Current role | Boundary / remaining evidence |
| --- | --- | --- |
| Web | Chat, decisions, wallet/session funding, creator registration, Monthly checkout/manual requests | Arc mainnet observed; live Monthly purchase/redemption and accepted outcome evidence remain separate. |
| API / A2A / OpenAI-compatible | Shared research, jobs, receipts, paid packages and Monthly API | Public research and separately scoped private contract; no full Operator ledger. |
| Remote MCP | Hosted research and read-only Monthly discovery/handoff | Remote protocol identity 0.2.0; no local custody or entitlement writer. |
| Stdio MCP | Caller-funded research, retained payment journal, GET-only recovery; Monthly handoff | Published package 0.4.3; caller-provisioned wallet and merchant policy, no automatic wallet creation. |
| CLI | Buyer research and Monthly status/manual redemption; local Operator tasks/results/export | Shared API/handoff boundaries, no background scheduler. |
| Windows desktop | Tauri local task alpha, bounded helper, private references/results/exports | 0.4.3 release assets; deliberate purchase and Monthly web handoff, no renderer wallet/signer. |
| Browser extension | Thin OpenAI-compatible client, source-registration handoff | Separate 0.1.1 identity; unpacked release, store publication unverified; Monthly web handoff. |
| Discord / Telegram / Slack | Hosted research adapters and dispatch links | Sponsored service role, no customer-owned Operator ledger or Monthly writer; independent business-use evidence pending. |

## Public addresses

Only public API/configuration values are reproduced. Rows below describe the
**current Arc mainnet, eip155:5042** deployment/profile. The former October 2 testnet
address table remains in Git history, on its original rail. Merchant and treasury
identities are read from current selected-role responses rather than imported from
that table; Monthly returned HTTP 503 during this check and its current payee is unverified.
Creator `payTo` and session addresses vary per source/user and must be captured for
the actual workflow rather than inferred from this table.

| Role | Full public address | Public source / explorer |
| --- | --- | --- |
| SourceRegistry | `0x42a64061b6cd84067bb660b2a9b8aa881fd225bb` | [Health](https://keryx.cc/api/health), [explorer](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb) |
| Settlement treasury balance identity | Read the current selected-role public projection | [Treasury API](https://keryx.cc/api/treasury); availability is separate from health |
| Research Monthly quote merchant/payee | Current quote unavailable at this check | [Public quote](https://keryx.cc/api/research/monthly?quote=1); do not reuse the historical testnet payee |
| USDC token | `0x3600000000000000000000000000000000000000` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |
| Circle Gateway wallet contract | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://explorer.arc.io/address/0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE) |
| Circle Gateway minter contract | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://explorer.arc.io/address/0x2222222d7164433c4C09B0b0D809a9b52C04C205) |

## Record one actual workflow in 2:45

This is the recording plan; the completed recording and business acceptance are
pending. Use an actual consented business task and its original artifacts. If the
first run needs longer, record the genuine steps and disclose elapsed time/cuts.

| Time | Show | Required evidence |
| --- | --- | --- |
| 0:00–0:20 | Business, recurring problem and exact research question | Public identity and consent; classify own-business, sponsored or independent. |
| 0:20–0:45 | Quote, payer, network, source budget and approved limits | Actual authorization and payment source; separate service/search/model costs. |
| 0:45–1:25 | Agent choices and purchases | Real BUY/SKIP/CACHE trace, eligible creator identities, original order/dispatch IDs. |
| 1:25–1:55 | Useful cited result and business decision it informs | Delivered report and participant's accepted outcome, or explicitly pending acceptance. |
| 1:55–2:25 | Receipt, creator settlement and original recovery | Exact Circle references, settled/pending legs and GET-only recovery without repeat debit. |
| 2:25–2:45 | What changed during Tameion and remaining gates | Baseline comparison; honest network/Operator/Monthly/mainnet limitations. |

## Pilot intake and evidence record

The freelancer track has one recorded participant: Hoàng, in
[Event-period usage](#event-period-usage-testnet-week-then-mainnet) above. The
own-business and small-team tracks, and the blank record below for the next
participant, remain open.

Prepare the remaining intake tracks without implying that a participant is selected:

- Own-business: use a genuine Keryx operational or product research decision with
  an owner-accepted deliverable. Report it as own-business activity.
- Freelancer: obtain a consented client-work research task with a concrete deadline
  and acceptance criterion; disclose sponsorship or reimbursement.
- Small team: obtain a genuine API/vendor/competitor comparison that supports a
  business decision; record the participant's acceptance and repeat need.

These are candidate use cases. Participant selection, actual questions, outreach
channel/consent and payment evidence remain pending for each track. No outreach is
performed by preparing this pack.

Use one record per genuine task. Store sensitive details privately with consent;
put only approved public identifiers and redacted proof links here. Do not paste
private handoff notes, customer questions/documents or keys into the public repo.
Keep raw signed payment headers, authorizations and bearer signatures private,
along with full private receipts and journals. Public fields below must contain
opaque or sanitized reference IDs and deliberately redacted evidence links, never
reusable credentials or complete signed payloads. Participant consent does not
turn payment authorization material into safe public evidence.

| Field | Value to supply |
| --- | --- |
| Business public name / URL; authorized participant role | **Pending** |
| Consent for task, recording and public evidence; date/scope | **Pending** |
| Origin: own-business / independent / sponsored; relationship and subsidy | **Pending** |
| Problem, exact approved task, expected decision and success criterion | **Pending** |
| Task time, product/release commit and supported surface | **Pending** |
| Approved payer address, funding source, network, asset, cap and quote/version | **Pending** |
| Order/dispatch/request IDs; original authorization reference | **Pending** |
| Delivered report and business acceptance/feedback with timestamp | **Pending** |
| Incoming payment, source tolls and creator rewards: separate exact micro-USDC amounts | **Pending** |
| Circle payment/transfer reference and exact matched status for each leg | **Pending** |
| Chain hash, explorer, receipt/block and what it independently proves | **Pending** |
| Pending/failed/unknown obligations; recovery result with original IDs and no repeat spend | **Pending** |
| Return usage and event-period totals with counting rule | **Pending** |

For Circle nanopayments, an exact matched Circle record supports the individual
authorization. An Arc batch transaction receipt supports that batch; it does not
independently prove one nonce/recipient/amount unless decoded evidence establishes
the mapping. Do not relabel every facilitator reference as an onchain transaction.
See [receipt trust boundary](research-receipts.md) and
[withdrawal rehearsal evidence](engineering/creator-funded-withdrawal-drill.md).

Before submission, reconcile incoming payments, outgoing source/creator legs and
remaining obligations separately. Pending, failed, simulated and prepaid allocations
are not new settled value. Historical public totals are not event-period growth;
owner/sponsored activity is not independent demand. Baseline business/customer
counts, independent onboarded businesses, accepted jobs, return customers,
event-period settled value and mainnet revenue are **not established here**.
One real complete workflow is the immediate target; wider pilot targets remain goals.
