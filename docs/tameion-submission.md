# Tameion submission pack — working evidence

Prepared October 2, 2026 from repository `2c59c07`. This is a preparation pack,
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
in this pack yet. Mainnet migration is being prepared separately; a target of later
October 2 or October 3 is a target, not completion or unlimited spend permission.

The [official event guidance](https://tameion.thecanteenapp.com/) requires a public
repository and a recorded demo **under three minutes**, encourages a live link,
and allows repeated submissions before the deadline. Submit via the
[official form](https://forms.gle/BBWrdfuircrKiG2i6) by October 10, 23:59 ET
(October 11, 10:59 Vietnam). Repository: [tang-vu/keryx](https://github.com/tang-vu/keryx).
Live service: [keryx.cc](https://keryx.cc). Video URL: **pending**.
Product and evidence-backed traction updates in Canteen, and showcase participation,
are separate from submitting this form. This document does not authorize posting,
contacting businesses, recording participants or submitting on their behalf.

## Event-period product delta

Compare against `2291753cc4fff2135d546227d5aafda287cbed7d` (September 25), the
pre-event main baseline; no intervening September 26/27 main commit replaces it.
The September 27–October 10 window is still in progress. These are implemented
changes through October 2, not forecasts for the remainder or evidence of adoption.

| Change | Source evidence | What it establishes and limits |
| --- | --- | --- |
| Durable local task CLI and Windows desktop | `44c8660`, `e7e82c5`, [task alpha](operator-task-alpha.md) | Local create/status/resume/export; deliberate buyer handoff, not autonomous purchasing. |
| Saved results, Rust task creation, Tauri shell | `dfcc1b3`, [PR #21](https://github.com/tang-vu/keryx/pull/21), [PR #22](https://github.com/tang-vu/keryx/pull/22), [desktop](desktop-alpha.md) | Reopen/export private results and GET-only recovery; TypeScript remains payment authority. |
| Public original-document and scholarly research | [PR #101](https://github.com/tang-vu/keryx/pull/101), [PR #109](https://github.com/tang-vu/keryx/pull/109), [PR #130](https://github.com/tang-vu/keryx/pull/130) | Bounded search, HTML/PDF reads and DOI/arXiv metadata; unavailable/oversized documents and answer quality remain limits. Public references alone confer no creator payout rights. |
| Chat-first reading and portable evidence | [PR #105](https://github.com/tang-vu/keryx/pull/105), [PR #106](https://github.com/tang-vu/keryx/pull/106), [PR #111](https://github.com/tang-vu/keryx/pull/111), [surface parity](surface-parity.md) | Cited reports, Markdown/BibTeX/RIS/evidence CSV and classified payment states; not proof of a customer accepting the result. |
| Bounded Research Monthly | [PR #125](https://github.com/tang-vu/keryx/pull/125), [terms](research-monthly.md) | Four manual Deep requests over 30 days, current default 0.36 testnet USDC versus 0.40 separately. No automatic renewal; failed/pending requests retain slots. Owner live purchase/redemption evidence is pending. |
| Custody, signing, recovery and storage preparation | [PR #113](https://github.com/tang-vu/keryx/pull/113), [PR #129](https://github.com/tang-vu/keryx/pull/129), [PR #126](https://github.com/tang-vu/keryx/pull/126), [PR #133](https://github.com/tang-vu/keryx/pull/133) | Narrow validated boundaries and fresh release identities; synthetic/mainnet preparation checks do not demonstrate mainnet activation. Full-product cutover [PR #131](https://github.com/tang-vu/keryx/pull/131) is open at this checkpoint. |

## Observed delivery and supported surfaces

Read-only public health at `2026-10-02T15:30:27.546Z` reported `f563d9c`,
`arcTestnet`, real settlement mode and operational database. It also reported
reasoning degradation (18/24 recent dispatches used some fallback) and one retained
pending payment; healthy HTTP does not establish perfect research or reconciliation.
These operational observations are not independent-customer traction.

[Release v0.25.1](https://github.com/tang-vu/keryx/releases/tag/v0.25.1) points to
`f563d9c13cab61b44f8f49773131ce8f773dd6dc` and exposes MCP 0.3.2 plus desktop
installer/ZIP/source manifest/checksums. Public `npm view keryx-mcp version`
returned 0.3.2 on October 2. Version discovery and downloadable assets alone are
not independent verification of all package bytes or fresh installer acceptance;
retain their exact release evidence before claiming synchronized delivery.

| Surface | Current role | Boundary / remaining evidence |
| --- | --- | --- |
| Web | Chat, decisions, wallet/session funding, creator registration, Monthly checkout/manual requests | Arc testnet observed; full mainnet release and live Monthly purchase/redemption pending. |
| API / A2A / OpenAI-compatible | Shared research, jobs, receipts, paid packages and Monthly API | Public research and separately scoped private contract; no full Operator ledger. |
| Remote MCP | Hosted research and read-only Monthly discovery/handoff | Remote protocol identity 0.2.0; no local custody or entitlement writer. |
| Stdio MCP | Caller-funded research, retained payment journal, GET-only recovery; Monthly handoff | Package 0.3.2; caller-provisioned wallet and merchant policy, no automatic wallet creation. |
| CLI | Buyer research and Monthly status/manual redemption; local Operator tasks/results/export | Shared API/handoff boundaries, no background scheduler. |
| Windows desktop | Tauri local task alpha, bounded helper, private references/results/exports | 0.3.2 release assets; deliberate purchase and Monthly web handoff, no renderer wallet/signer. |
| Browser extension | Thin OpenAI-compatible client, source-registration handoff | Separate 0.1.1 identity; unpacked release, store publication unverified; Monthly web handoff. |
| Discord / Telegram / Slack | Hosted research adapters and dispatch links | Sponsored service role, no customer-owned Operator ledger or Monthly writer; independent business-use evidence pending. |

## Public addresses

Only public API/configuration values are reproduced. All rows are **Arc testnet,
eip155:5042002**. Pending mainnet identities are deliberately not deployment evidence.
Creator `payTo` and session addresses vary per source/user and must be captured for
the actual workflow rather than inferred from this table.

| Role | Full public address | Public source / explorer |
| --- | --- | --- |
| SourceRegistry | `0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536` | [Health](https://keryx.cc/api/health), [explorer](https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536) |
| Settlement treasury balance identity | `0x29028Fe1122E17Fe7863A22701e863FE4DaE1aFB` | [Treasury API](https://keryx.cc/api/treasury), [explorer](https://testnet.arcscan.app/address/0x29028Fe1122E17Fe7863A22701e863FE4DaE1aFB) |
| Research Monthly quote merchant/payee | `0xC5965E3175Ef063FaeB8BCd3abe2d25b5D27D586` | [Public quote](https://keryx.cc/api/research/monthly?quote=1), [explorer](https://testnet.arcscan.app/address/0xC5965E3175Ef063FaeB8BCd3abe2d25b5D27D586) |
| USDC token | `0x3600000000000000000000000000000000000000` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| Circle Gateway wallet contract | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) |
| Circle Gateway minter contract | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | [Public network profile](../lib/arc-network-profile.ts), [explorer](https://testnet.arcscan.app/address/0x0022222ABE238Cc2C7Bb1f21003F0a260052475B) |

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

## Pilot intake and evidence record — unfilled

Prepare all three intake tracks without implying that a participant is selected:

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
