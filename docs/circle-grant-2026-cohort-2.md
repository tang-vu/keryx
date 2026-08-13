# Circle 2026 Cohort 2 — Keryx grant proposal draft

**Status:** Copy-ready draft with required owner fields marked `[ACTION REQUIRED]`

**Prepared:** 2026-08-13

**Recommended track:** Agentic economic activity

**Live product:** <https://keryx.cc>

**Public evidence dashboard:** <https://keryx.cc/proof>

> Before submitting, replace every `[ACTION REQUIRED]` value and remove all editor notes. Do not
> submit a placeholder. Metrics below are an honest production snapshot: settled money only, with
> independently initiated usage separated from Keryx's first-party autonomous agents.

## 1. Applicant Details

### Primary contact first name

Vũ

### Primary contact last name

Tăng

### Email address

`[ACTION REQUIRED: enter a professional email address; do not use the GitHub noreply address]`

### Company Legal Entity Name

`[ACTION REQUIRED: enter the exact registered entity name, or N/A if no entity exists]`

### Company Doing-Business-As (DBA) name

Keryx

### Founder names, roles, bios

Tăng Vũ — Founder and Lead Engineer. Vũ is the solo technical lead responsible for Keryx's
product, architecture, smart contracts, Circle Gateway integration, security model, deployment,
and creator/agent developer experience. Since launching Keryx, Vũ has shipped the system from an
x402 prototype into a continuously operated Arc application with non-custodial browser spending,
on-chain payout authority, encrypted paid content, settlement reconciliation, public evidence, and
661 application tests plus 16 smart-contract tests.

### Project website

<https://keryx.cc>

### Project X handle

`@tangvu_dev` — `[CONFIRM this is the handle you want Circle to use]`

### Project GitHub URL

<https://github.com/tang-vu/keryx>

Standalone reusable Arc primitives: <https://github.com/tang-vu/keryx-arc-primitives>

### Where are you and your founders located?

`Tăng Vũ, Founder and Lead Engineer, [ACTION REQUIRED: City, State/Province, Country]`

### Where is your business located?

`[ACTION REQUIRED: select the business's country, or the founder's operating country if the project is unincorporated]`

### Is your business incorporated?

`[ACTION REQUIRED: Yes / No]`

If no, use `N/A` for Company Legal Entity Name and keep `Keryx` as the DBA/project name.

## 2. Project Abstract

### Project Name

Keryx

### One-line description

Keryx is an autonomous reading agent that pays every creator it cites in USDC on Arc through x402
and Circle Gateway.

<!-- 117 characters including spaces; safely below the 200-character limit. -->

### What problem are you solving and why is it important?

AI agents increasingly consume publishers' reporting, research, and technical writing, but the
economic relationship is broken. A creator may supply the evidence that makes an answer useful
without receiving either reliable attribution or payment. Subscriptions and advertising are poor
fits for autonomous software: agents need to buy one exact resource, at machine speed, under a
hard budget, without opening an account with every publisher. Standard card and on-chain payment
rails also make sub-cent, per-request rewards uneconomical.

This matters because high-quality open knowledge is expensive to produce. If AI usage cannot return
value to the people who create the underlying evidence, publishers are pushed toward closed
archives, indiscriminate licensing, or content optimized for attention rather than accuracy. The
internet needs a payment primitive where an agent can decide what evidence is worth buying and
where the creators whose work actually supports the answer are paid automatically.

### What is your solution to that problem?

Keryx turns a citation into a programmable USDC settlement. Given a question and a budget, the
agent decomposes the question into claims, discovers exact article versions, and exposes a visible
BUY/SKIP/CACHE decision for every candidate. It pays a small x402 access toll only for selected
content, stops when the evidence is sufficient, synthesizes a cited answer, and distributes a
second reward pool to the cited creators in exact proportion to their contribution.

Circle Gateway Nanopayments makes both payment moments economical: buyers sign gas-free EIP-3009
authorizations and Gateway batches settlement. Arc hosts the SourceRegistry that controls source
ownership, active state, list-price ceiling, payout wallet, and multi-author splits. The browser
uses a user-funded ephemeral session account, so the funded balance is the hard economic cap and
Keryx never holds the user's key. Paid article bodies are encrypted at rest and released only after
x402 settlement. Keryx is accessible through the web, MCP, an OpenAI-compatible API, an agent-to-
agent x402 endpoint, Discord, Telegram, and Slack.

### Why hasn't this problem been solved yet? What are the barriers?

Several systems have to become trustworthy at the same time:

1. **Payment economics:** card fees and one-transaction-per-payment gas costs are larger than the
   sub-cent value of a single read or citation. Gateway's batched Nanopayments remove that barrier.
2. **Payment authority:** an off-chain database cannot be allowed to redirect creator rewards.
   Ownership, payout wallets, price ceilings, and author splits need an independent authority.
3. **Agent custody and budgets:** an autonomous agent must not receive an unlimited wallet key.
   Spend reservation, signer custody, expiry, revocation, and retry behavior must be bounded.
4. **Attribution quality:** a payment must follow evidence that actually supports the answer, not a
   generated citation or an article that was purchased but unused.
5. **Settlement ambiguity:** a lost HTTP response can hide a real debit. Retrying blindly risks a
   duplicate charge, while treating the request as failed understates creator earnings.
6. **Paid-content confidentiality:** public discovery and IPFS cannot expose the article body before
   payment; key release must remain coupled to verified settlement.
7. **Mainnet and regulatory readiness:** operating with real funds requires security review,
   sanctions/compliance policies, jurisdiction analysis, and production incident procedures in
   addition to working code.

Keryx addresses the technical barriers on Arc testnet today and keeps the remaining mainnet and
compliance work explicit rather than claiming testnet readiness is equivalent to a regulated
commercial launch.

### Why are you and your team uniquely suited to solve this problem?

Keryx is already a working end-to-end system, not a proposal for a future integration. The same
founder owns the agent reasoning, browser signer, x402 buyer and seller paths, Gateway settlement,
Arc registry and indexer, encrypted content, creator cash-out, metrics, and operations. That
end-to-end ownership has made it possible to find and fix failure cases that are invisible in a
happy-path demo: atomic session-cap reservation, single-use nonces, stale article versions,
post-settlement delivery failures, ambiguous Circle responses, and false settlement findings when
an evidence provider is unavailable.

The project has shipped 13 public versions, is live continuously at keryx.cc, and publishes the
exact commit running in production. Its CI and release gates include 661 application tests, 16
SourceRegistry contract tests, TypeScript, ESLint, and a full production build. The public `/proof`
dossier maps every claim to its source of truth and states what that evidence cannot prove. This
combination of shipping speed, payment-path rigor, transparent limitations, and an already-running
creator economy is the team's core advantage.

## 3. Product Alignment Track

### Recommended primary track

**Agentic economic activity**

Keryx enables autonomous agents to discover paid knowledge, make bounded purchasing decisions,
settle sub-cent USDC payments in real time, and compensate the creators whose evidence the agent
uses. This directly matches Circle's stated focus on agents that coordinate and settle value using
programmable stablecoin infrastructure.

### Is your project currently live in production?

**Yes — with an important qualification.** Keryx is a publicly accessible, continuously operated
production web/API service at <https://keryx.cc>, but its financial settlement currently uses Arc
testnet USDC. It is not yet an Arc mainnet financial product.

### Are you live on Arc?

**Yes — Arc testnet (`eip155:5042002`).**

- SourceRegistry: <https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536>
- Public chain/registry/settlement evidence: <https://keryx.cc/proof>

### Which other chain(s) are you currently live on?

**None.** Keryx's payment, registry, and creator cash-out flows are deliberately restricted to Arc
testnet. The agent may discover public x402 services on other chains, but those candidates are
discovery-only and cannot be purchased by the current orchestrator.

### Which Circle products are currently integrated?

Select the closest matching portal checkboxes for:

- **USDC** — settlement asset and Arc gas asset.
- **Circle Gateway** — buyer balances, batched settlement, creator balances, and self-service
  creator withdrawals.
- **Nanopayments / Agent Nanopayments** — gas-free, sub-cent USDC payments backed by Gateway.
- **x402** — HTTP-native negotiation for both paid article access and weighted citation rewards.
- **Circle App Kit / Unified Balance Kit** — read-only, chain-abstracted treasury visibility.

Do **not** select these as current integrations:

- **Circle Wallets / Agent Wallets:** current wallets are self-managed browser or server wallets.
- **CCTP:** Keryx uses Gateway transfer/burn-intent fields and Arc domain 26 for withdrawals, but it
  does not yet directly integrate TokenMessenger/MessageTransmitter crosschain transfers.
- **Circle Contracts / Smart Contract Platform:** SourceRegistry is a custom Hardhat/viem contract,
  not deployed through Circle Contracts.
- **Paymaster, StableFX, Circle Mint, or CPN:** not currently integrated.

### Which Circle products do you plan to integrate?

Select the closest matching portal checkboxes for:

- **CCTP V2 and Forwarding Service** — let an agent or creator fund an Arc session from native USDC
  on Ethereum/Base without manually bridging or changing the payout rail.
- **Circle Agent Wallets / Circle Wallets** — an optional managed wallet path for third-party agents
  and enterprise API users; it will complement, not replace, the existing non-custodial browser
  session path.
- **Gateway and Nanopayments on Arc mainnet** — migrate the proven buyer, seller, payout, and
  withdrawal flows after security review and product availability.
- **USDC on Arc mainnet** — real creator rewards and transparent platform billing.

## 4. Milestones and Timelines

The following is a proposed six-month milestone plan. Dates should be converted to calendar dates
when the grant start date is known.

### Milestone 1 — Security review and Arc mainnet release candidate (Weeks 1–6)

**Details**

- Commission an independent review of the browser co-sign path, x402 buyer/seller verification,
  session-cap reservation, SourceRegistry payout authority, encrypted paid-content release, and
  Circle settlement reconciliation.
- Close all critical/high findings and publish the non-sensitive report and remediation map.
- Produce a mainnet release candidate with explicit network configuration, contract deployment
  runbook, key rotation, treasury limits, monitoring, rollback, and incident response.
- Keep mainnet spending disabled until the audit, Circle/Arc endpoint availability, and a founder
  go/no-go checklist all pass.

**Acceptance evidence:** public audit/remediation summary; zero open critical/high findings; CI and
contract suite green; testnet failure drills for RPC outage, duplicate/replayed authorization,
Circle timeout, and post-settlement delivery failure; reproducible deployment runbook.

### Milestone 2 — CCTP-funded agent sessions (Weeks 5–12)

**Details**

- Integrate CCTP V2 Standard Transfer plus Forwarding Service for funding Keryx sessions from
  native USDC on Ethereum and Base into Arc.
- Bind each funding request to destination session address, source domain, amount, expiry, and a
  durable idempotency key; expose pending/final states without crediting spend capacity early.
- Add an optional Circle Agent Wallets path for programmatic agent callers while preserving the
  browser's user-held signer and funded hard cap.
- Add public integration docs and end-to-end tests for success, timeout, replacement, and refund or
  recovery paths.

**Acceptance evidence:** two source-chain testnet flows into Arc; at least 100 test transfers with
no duplicate credits or stranded session capacity; public status telemetry; sample code in the
standalone primitives repository.

### Milestone 3 — External creator and agent pilot (Weeks 9–18)

**Details**

- Recruit and verify at least 10 independently controlled creator/source wallets; help each publish
  one payable article or feed and complete one real end-to-end citation payout.
- Integrate at least five external agent/developer clients through MCP, A2A x402, or the OpenAI-
  compatible API.
- Reach 500 independently initiated paid queries and 2,500 external settled payments while keeping
  first-party load traffic reported separately.
- Maintain at least 99% settlement success across measured external settlement attempts, with zero
  unresolved payout-authority mismatches.

**Acceptance evidence:** public provenance-separated dashboard; creator testimonials/case studies;
settled-only query/payment records; Arc/Circle parity reports; issue and remediation log.

### Milestone 4 — Arc mainnet launch and reusable ecosystem package (Weeks 16–24)

**Details**

- Launch the audited product on Arc mainnet with USDC, Gateway Nanopayments, x402 access/citation
  settlement, SourceRegistry payout authority, CCTP-funded sessions, and creator withdrawals. If
  required Circle/Arc mainnet services are not generally available, deliver a mainnet-ready release
  candidate and keep funds on testnet rather than simulating a launch.
- Publish versioned packages and reference integrations for two-toll settlement, non-custodial
  session caps, registry payee verification, exact integer reward splitting, and ambiguous-payment
  reconciliation.
- Grow to 25 independently controlled creators, 10 external agent/developer integrations, and 1,000
  independently initiated paid queries; secure at least three design partners for paid API or
  enterprise pilots.

**Acceptance evidence:** mainnet deployment and explorer links or an explicit availability-blocked
release candidate; tagged open-source release; integration documentation; public usage dashboard;
three partner confirmations.

## 5. Project Traction and Roadmap

### Current traction and success

Production snapshot captured 2026-08-13 UTC:

- **1,853 total queries** and **9,522 real settled testnet nanopayments**.
- **$45.113314 testnet USDC** settled in total; **$39.193314** paid to creator/source wallets.
- **20 earning source wallets** and **20/20 SourceRegistry records** continuously checked against
  the Arc chain. This is not a claim of 20 independent publisher businesses: several sources are
  curated or first-party samples, and the dashboard labels that limitation.
- **141 independently initiated queries**, 131 of them paid, producing **611 external payments**
  and **$2.635999 testnet USDC** in creator payouts.
- **4 identified external actors; all 4 returned.** External feedback is 9/9 positive.
- **66/66 measured external settlement attempts succeeded**, with zero pending confirmations and
  zero failed payment attempts in the current snapshot.
- **12 self-service creator cash-outs totaling $0.753304 testnet USDC**, each with an ArcScan-
  resolvable transaction hash.
- **1,712 first-party autonomous-agent queries and 8,911 payments** are real settlement/load
  activity, but are explicitly separated from external adoption.
- One independently owner-verified creator has claimed its registry record, been cited, paid, and
  cashed out end to end. Expanding this verified external creator cohort is the next milestone.

Keryx has shipped 13 public releases since June 2026 and remains live between releases. The current
production commit, CI, registry parity, Circle balance parity, provenance-separated usage, and
creator withdrawal evidence are independently linked at <https://keryx.cc/proof>.

The commercial path is paid API/agent plans and enterprise integrations, with orchestration fees
priced separately from creator rewards so 100% of the citation reward can continue to reach the
creator. The current testnet service does not claim platform revenue.

### Public analytics dashboard

<https://keryx.cc/proof>

Supporting surfaces:

- <https://keryx.cc/dashboard>
- <https://keryx.cc/status>
- <https://github.com/tang-vu/keryx/releases/latest>

### Are you funded?

`[ACTION REQUIRED: select Yes or No]`

Suggested answer if accurate: **No — Keryx is founder-funded/bootstrapped and has not raised
institutional capital.** Do not use this sentence unless confirmed.

### Technical Roadmap

**Months 0–2:** complete third-party security review; harden the browser signer, payment evidence,
registry authority, encryption, and production incident runbooks; produce an Arc mainnet release
candidate. Circle integrations: existing USDC + Gateway Nanopayments + x402 + Unified Balance Kit.

**Months 2–4:** add CCTP V2 and Forwarding Service to fund Arc sessions from Ethereum/Base; add an
optional Circle Agent Wallets path for programmatic callers; maintain non-custodial browser sessions
as a distinct authority boundary. Run a verified external creator/agent pilot.

**Months 4–6:** move audited flows to Arc mainnet when required Circle/Arc services are available;
release reusable SDK modules and operating docs; scale external creators, agent integrations,
independent paid queries, and paid design partnerships. Preserve public settled-only provenance and
Circle/Arc parity throughout the launch.

The payment source of truth remains explicit at every step: SourceRegistry authorizes payees and
splits; the browser or approved agent wallet owns the signing key; the funded session balance is the
economic cap; Circle settlement evidence determines `settled`; the database is an operational
ledger/cache; and unavailable verification remains `unknown`, never invented success or failure.

### How will this grant support the technical roadmap?

Grant funding will convert a proven testnet product into an audited, externally adopted Arc
mainnet service:

- **45% — engineering and Circle integrations:** CCTP/Forwarding funding, Agent Wallets support,
  Arc mainnet migration, SDK extraction, and recovery tooling.
- **20% — independent security review:** browser signer/session authority, x402/Gateway settlement,
  registry payout controls, smart contracts, and encrypted content delivery.
- **20% — creator and agent pilots:** onboarding support, integration engineering, documentation,
  structured feedback, testimonials, and design-partner case studies. This is not payment-volume
  fabrication; activity will be reported only when initiated and settled.
- **10% — production infrastructure and observability:** redundant RPC, encrypted backups,
  settlement/registry parity, alerting, uptime, and incident response.
- **5% — open-source ecosystem work:** maintained primitives repo, examples, technical writing, and
  Arc community workshops.

The grant accelerates the work that cannot responsibly be skipped—security review, mainnet
operations, and real external pilots—rather than subsidizing cosmetic features or first-party
transaction volume.

## 6. Deck and Demo

### Video demo of the product

`[ACTION REQUIRED: upload an unlisted video no longer than 5 minutes and paste the URL]`

#### Recommended 5-minute recording script

**0:00–0:25 — Problem and proof**

- Open <https://keryx.cc/proof>.
- State: “Keryx lets an agent buy exact evidence and pay every cited creator in USDC.”
- Show the deployed commit, external-vs-first-party split, registry parity, Circle backing, and
  ArcScan cash-outs. Do not read every metric.

**0:25–1:55 — Required codebase walkthrough**

- `lib/agent/run-agent.ts`: point out the visible
  decompose → discover → BUY/SKIP/CACHE → fetch → sufficiency → synthesize → attribute → settle
  pipeline and the hard question budget.
- `lib/payments/browser-cosign-gateway.ts`: show server-side atomic spend reservation and challenge
  binding while the session key remains in the browser.
- `lib/x402-server.ts`: show `402 Payment Required`, Circle facilitator settlement, and the rule
  that plaintext is produced only after settlement.
- `app/api/source/[id]/route.ts` and `app/api/cite/[id]/route.ts`: show the two-toll model—access
  toll plus weighted citation reward.
- `lib/gateway/x402-transfer-reconciliation.ts`: show exact EIP-3009 nonce and economic-tuple
  matching for ambiguous responses.
- `contracts/SourceRegistry.sol`: show creator, payout wallet, price, active status, and author
  splits as on-chain authority.

**1:55–3:25 — Required live integration demonstration**

- Ask one question with a small budget on the web app or `/playground`.
- Show at least one BUY and one SKIP/CACHE explanation.
- Show the x402 access payment, cited answer, contribution weights, and citation reward receipt.
- Open the resulting dispatch/answer page and one creator earnings page.

**3:25–4:20 — Circle and Arc verification**

- Return to `/proof` or `/status`; show “Canteen Arc RPC,” SourceRegistry 0 mismatches, Circle
  settlement parity, and a real creator withdrawal link on ArcScan.
- Explain that Gateway payment rows use Circle settlement IDs because settlement is batched; cash-
  outs are the EVM transactions that resolve individually on ArcScan.

**4:20–5:00 — Roadmap and grant ask**

- Show the architecture diagram in the README.
- State current integrations: USDC, Gateway Nanopayments, x402, Unified Balance Kit.
- State planned integrations: CCTP V2/Forwarding Service, optional Circle Agent Wallets, audited Arc
  mainnet launch, and external creator/agent pilots.

### Investor deck

`[ACTION REQUIRED: upload the deck and paste a Google Drive/Dropbox URL]`

#### Recommended 10-slide deck

1. **Title:** Keryx — every citation pays its creator.
2. **Problem:** AI agents consume evidence; creators receive neither programmable demand nor pay.
3. **Product:** question + budget → visible decisions → paid evidence → cited answer → rewards.
4. **Why now:** Arc + USDC + Gateway Nanopayments make sub-cent agent commerce viable.
5. **Architecture:** browser session authority, x402/Gateway, SourceRegistry, encrypted content.
6. **Traction:** show aggregate settlement and the external/first-party provenance split side by
   side; never present autonomous load as independent adoption.
7. **Users and go-to-market:** independent publishers, research/data providers, agent developers,
   MCP/OpenAI/A2A distribution, targeted creator demand board.
8. **Business model:** paid agent/API plans and enterprise integrations; creator rewards remain a
   pass-through pool.
9. **Six-month milestones:** audit, CCTP/Agent Wallets, external pilot, Arc mainnet launch.
10. **Team and ask:** Tăng Vũ, shipped evidence, requested Circle technical/marketing support and
    milestone-based funding.

## 7. Conflict of Interest

### Conflict of interest

`[ACTION REQUIRED: select the truthful option]`

Suggested answer if accurate: **No.**

If “No” is accurate and a text explanation is required:

> Neither I, Keryx, nor any key individual involved in this application has an actual, potential,
> or perceived financial, business, advisory, family, personal, or close relationship with Circle
> or its employees, officers, directors, subsidiaries, or contractors that could influence this
> application.

Do not use that statement unless it is fully true. Disclose any hackathon/grant relationship if the
portal or Circle's policy treats ordinary program participation as a potential conflict.

## 8. Final submission checklist

- [ ] Replace every `[ACTION REQUIRED]` field.
- [ ] Confirm `Tang` / `Vu`, X handle, founder bio, and founder location.
- [ ] Enter the correct legal entity/incorporation/funding status; use `N/A` where required.
- [ ] Confirm there is no conflict of interest or provide a complete disclosure.
- [ ] Record a **≤5-minute** video showing actual Circle integration code and one live flow.
- [ ] Upload the investor deck and set both links to viewer-accessible/private-unlisted mode.
- [ ] Match Circle-product checkbox labels exactly; do not mark Wallets or CCTP as current.
- [ ] Refresh traction numbers from <https://keryx.cc/proof> immediately before submission.
- [ ] Check that the live site, GitHub repo, latest release, and all ArcScan links open logged out.
- [ ] Save a PDF/screenshot of the final submitted proposal and the Questbook confirmation.

## 9. Evidence and reference links

### Keryx evidence

- Live product: <https://keryx.cc>
- Public proof: <https://keryx.cc/proof>
- Main repository: <https://github.com/tang-vu/keryx>
- Latest release: <https://github.com/tang-vu/keryx/releases/latest>
- Reusable primitives: <https://github.com/tang-vu/keryx-arc-primitives>
- SourceRegistry: <https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536>
- Architecture: <https://github.com/tang-vu/keryx/blob/main/docs/system-architecture.md>
- Security model: <https://github.com/tang-vu/keryx/blob/main/docs/security-threat-model.md>

### Official Circle references used to prepare this draft

- Grant criteria and focus areas: <https://www.circle.com/grant>
- Agent Nanopayments: <https://developers.circle.com/agent-stack/agent-nanopayments>
- Gateway Nanopayments: <https://developers.circle.com/gateway/nanopayments>
- x402 and Gateway: <https://developers.circle.com/gateway/nanopayments/concepts/x402>
- CCTP chains/domains: <https://developers.circle.com/cctp/concepts/supported-chains-and-domains>
- Unified Balance quickstart: <https://developers.circle.com/gateway/quickstarts/unified-balance-evm>
