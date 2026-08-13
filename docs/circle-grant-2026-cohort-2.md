# Circle 2026 Cohort 2 — Keryx proposal (copy/paste version)

Prepared: 2026-08-13

Each form field below has one `text` block. Use the copy button on that block and paste it directly into Questbook. Lines inside a block are intentional; there is no hard-wrapped prose to join manually.

## Complete these owner-only fields first

- Professional email address
- Legal entity name or `N/A`
- Founder and business location
- Incorporation status
- Funding status
- Conflict-of-interest answer
- Unlisted demo video URL
- Investor deck URL
- Confirm that `@tangvu_dev` is the X handle to submit

## 1. Applicant Details

### Primary contact first name

```text
Vu
```

### Primary contact last name

```text
Tang
```

### Email address

```text
[ENTER PROFESSIONAL EMAIL ADDRESS]
```

### Company Legal Entity Name

```text
[ENTER EXACT LEGAL ENTITY NAME, OR N/A IF UNINCORPORATED]
```

### Company Doing-Business-As (DBA) name

```text
Keryx
```

### Founder names, roles, bios

```text
Tang Vu — Founder and Lead Engineer. Vu is the solo technical lead responsible for Keryx's product, architecture, smart contracts, Circle Gateway integration, security model, deployment, and creator/agent developer experience. Since launching Keryx, Vu has shipped the system from an x402 prototype into a continuously operated Arc application with non-custodial browser spending, on-chain payout authority, encrypted paid content, settlement reconciliation, public evidence, and 661 application tests plus 16 smart-contract tests.
```

### Project website

```text
https://keryx.cc
```

### Project X handle

```text
@tangvu_dev
```

### Project GitHub URL

```text
https://github.com/tang-vu/keryx
```

Standalone reusable Arc primitives, if the form allows an additional link:

```text
https://github.com/tang-vu/keryx-arc-primitives
```

### Where are you and your founders located?

Replace only the bracketed location, then copy the complete line.

```text
Tang Vu, Founder and Lead Engineer, [CITY, STATE/PROVINCE, COUNTRY]
```

### Where is your business located?

Portal selection:

```text
[SELECT COUNTRY]
```

### Is your business incorporated?

Portal selection:

```text
[SELECT YES OR NO]
```

If the answer is No, enter `N/A` for Company Legal Entity Name and retain `Keryx` as the DBA/project name.

## 2. Project Abstract

### Project Name

```text
Keryx
```

### One-line description (117/200 characters)

```text
Keryx is an autonomous reading agent that pays every creator it cites in USDC on Arc through x402 and Circle Gateway.
```

### What problem are you solving and why is it important?

```text
AI agents increasingly consume publishers' reporting, research, and technical writing, but the economic relationship is broken. A creator may supply the evidence that makes an answer useful without receiving either reliable attribution or payment. Subscriptions and advertising are poor fits for autonomous software: agents need to buy one exact resource, at machine speed, under a hard budget, without opening an account with every publisher. Standard card and on-chain payment rails also make sub-cent, per-request rewards uneconomical. This matters because high-quality open knowledge is expensive to produce. If AI usage cannot return value to the people who create the underlying evidence, publishers are pushed toward closed archives, indiscriminate licensing, or content optimized for attention rather than accuracy. The internet needs a payment primitive where an agent can decide what evidence is worth buying and where the creators whose work actually supports the answer are paid automatically.
```

### What is your solution to that problem?

```text
Keryx turns a citation into a programmable USDC settlement. Given a question and a budget, the agent decomposes the question into claims, discovers exact article versions, and exposes a visible BUY/SKIP/CACHE decision for every candidate. It pays a small x402 access toll only for selected content, stops when the evidence is sufficient, synthesizes a cited answer, and distributes a second reward pool to the cited creators in exact proportion to their contribution. Circle Gateway Nanopayments makes both payment moments economical: buyers sign gas-free EIP-3009 authorizations and Gateway batches settlement. Arc hosts the SourceRegistry that controls source ownership, active state, list-price ceiling, payout wallet, and multi-author splits. The browser uses a user-funded ephemeral session account, so the funded balance is the hard economic cap and Keryx never holds the user's key. Paid article bodies are encrypted at rest and released only after x402 settlement. Keryx is accessible through the web, MCP, an OpenAI-compatible API, an agent-to-agent x402 endpoint, Discord, Telegram, and Slack.
```

### Why hasn't this problem been solved yet? What are the barriers?

```text
Several systems have to become trustworthy at the same time. First, card fees and one-transaction-per-payment gas costs are larger than the sub-cent value of a single read or citation; Gateway's batched Nanopayments remove that economic barrier. Second, an off-chain database cannot be allowed to redirect creator rewards, so ownership, payout wallets, price ceilings, and author splits need an independent authority. Third, an autonomous agent must not receive an unlimited wallet key; spend reservation, signer custody, expiry, revocation, and retry behavior must be bounded. Fourth, a payment must follow evidence that actually supports the answer, not a generated citation or an article that was purchased but unused. Fifth, a lost settlement response can hide a real debit: retrying blindly risks a duplicate charge, while treating it as failed understates creator earnings. Sixth, public discovery and IPFS cannot expose paid content before settlement. Finally, operating with real funds requires security review, compliance policies, jurisdiction analysis, and incident procedures in addition to working code. Keryx addresses the technical barriers on Arc testnet today and keeps the remaining mainnet and compliance work explicit rather than claiming testnet readiness is equivalent to a regulated commercial launch.
```

### Why are you and your team uniquely suited to solve this problem?

```text
Keryx is already a working end-to-end system, not a proposal for a future integration. The same founder owns the agent reasoning, browser signer, x402 buyer and seller paths, Gateway settlement, Arc registry and indexer, encrypted content, creator cash-out, metrics, and operations. That end-to-end ownership has made it possible to find and fix failure cases that are invisible in a happy-path demo: atomic session-cap reservation, single-use nonces, stale article versions, post-settlement delivery failures, ambiguous Circle responses, and false settlement findings when an evidence provider is unavailable. The project has shipped 13 public versions, is live continuously at keryx.cc, and publishes the exact commit running in production. Its CI and release gates include 661 application tests, 16 SourceRegistry contract tests, TypeScript, ESLint, and a full production build. The public https://keryx.cc/proof dossier maps every claim to its source of truth and states what that evidence cannot prove. This combination of shipping speed, payment-path rigor, transparent limitations, and an already-running creator economy is the team's core advantage.
```

## 3. Product Alignment Track

### Recommended primary track

Select:

```text
Agentic economic activity
```

If the portal provides a track explanation field, paste:

```text
Keryx enables autonomous agents to discover paid knowledge, make bounded purchasing decisions, settle sub-cent USDC payments in real time, and compensate the creators whose evidence the agent uses. This directly matches Circle's focus on agents that coordinate and settle value using programmable stablecoin infrastructure.
```

### Is your project currently live in production?

Select `Yes`. If an explanation field appears, paste:

```text
Yes. Keryx is a publicly accessible, continuously operated production web/API service at https://keryx.cc. Its financial settlement currently uses Arc testnet USDC, so it is not yet an Arc mainnet financial product.
```

### Are you live on Arc?

Select `Yes`. If an explanation field appears, paste:

```text
Yes — Arc testnet (eip155:5042002). SourceRegistry: https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536. Public chain, registry, and settlement evidence: https://keryx.cc/proof.
```

### Which other chain(s) are you currently live on?

```text
None. Keryx's payment, registry, and creator cash-out flows are deliberately restricted to Arc testnet. The agent may discover public x402 services on other chains, but those candidates are discovery-only and cannot be purchased by the current orchestrator.
```

### Which Circle products are currently integrated?

Select the closest matching checkboxes:

```text
USDC
Circle Gateway
Nanopayments / Agent Nanopayments
x402
Circle App Kit / Unified Balance Kit
```

Do not select these as current integrations:

```text
Circle Wallets / Agent Wallets
CCTP
Circle Contracts / Smart Contract Platform
Paymaster
StableFX
Circle Mint
Circle Payments Network (CPN)
```

Reason for the exclusions: current wallets are self-managed; Keryx does not directly call CCTP TokenMessenger/MessageTransmitter; and SourceRegistry is a custom Hardhat/viem contract rather than a Circle Contracts deployment.

### Which Circle products do you plan to integrate?

Select the closest matching checkboxes:

```text
CCTP V2
Forwarding Service
Circle Agent Wallets / Circle Wallets
Circle Gateway and Nanopayments on Arc mainnet
USDC on Arc mainnet
```

If an explanation field appears, paste:

```text
Keryx plans to add CCTP V2 and Forwarding Service so agents and creators can fund Arc sessions from native USDC on Ethereum or Base without manually bridging. An optional Circle Agent Wallets path will support programmatic and enterprise callers while preserving the existing user-held browser signer. After security review and product availability, the proven Gateway Nanopayments, x402 settlement, creator payout, and withdrawal flows will move to Arc mainnet USDC.
```

## 4. Milestones and Timelines

Add four milestones. Each title and details block is ready for its corresponding portal field.

### Milestone 1

Title (61/1024 characters):

```text
Security review and Arc mainnet release candidate (Weeks 1–6)
```

Details (single paragraph, below 2048 characters):

```text
Commission an independent review of the browser co-sign path, x402 buyer/seller verification, session-cap reservation, SourceRegistry payout authority, encrypted paid-content release, and Circle settlement reconciliation. Close all critical/high findings and publish the non-sensitive report and remediation map. Produce a mainnet release candidate with explicit network configuration, contract deployment runbook, key rotation, treasury limits, monitoring, rollback, and incident response. Keep mainnet spending disabled until the audit, Circle/Arc endpoint availability, and a founder go/no-go checklist all pass. Acceptance evidence: public audit/remediation summary; zero open critical/high findings; CI and contract suite green; testnet failure drills for RPC outage, duplicate or replayed authorization, Circle timeout, and post-settlement delivery failure; reproducible deployment runbook.
```

### Milestone 2

Title (39/1024 characters):

```text
CCTP-funded agent sessions (Weeks 5–12)
```

Details (single paragraph, below 2048 characters):

```text
Integrate CCTP V2 Standard Transfer plus Forwarding Service for funding Keryx sessions from native USDC on Ethereum and Base into Arc. Bind each funding request to destination session address, source domain, amount, expiry, and a durable idempotency key; expose pending and final states without crediting spend capacity early. Add an optional Circle Agent Wallets path for programmatic agent callers while preserving the browser's user-held signer and funded hard cap. Add public integration docs and end-to-end tests for success, timeout, replacement, and refund or recovery paths. Acceptance evidence: two source-chain testnet flows into Arc; at least 100 test transfers with no duplicate credits or stranded session capacity; public status telemetry; sample code in the standalone primitives repository.
```

### Milestone 3

Title (45/1024 characters):

```text
External creator and agent pilot (Weeks 9–18)
```

Details (single paragraph, below 2048 characters):

```text
Recruit and verify at least 10 independently controlled creator/source wallets; help each publish one payable article or feed and complete one real end-to-end citation payout. Integrate at least five external agent/developer clients through MCP, A2A x402, or the OpenAI-compatible API. Reach 500 independently initiated paid queries and 2,500 external settled payments while keeping first-party load traffic reported separately. Maintain at least 99% settlement success across measured external settlement attempts, with zero unresolved payout-authority mismatches. Acceptance evidence: public provenance-separated dashboard; creator testimonials and case studies; settled-only query/payment records; Arc/Circle parity reports; issue and remediation log.
```

### Milestone 4

Title (63/1024 characters):

```text
Arc mainnet launch and reusable ecosystem package (Weeks 16–24)
```

Details (single paragraph, below 2048 characters):

```text
Launch the audited product on Arc mainnet with USDC, Gateway Nanopayments, x402 access/citation settlement, SourceRegistry payout authority, CCTP-funded sessions, and creator withdrawals. If required Circle/Arc mainnet services are not generally available, deliver a mainnet-ready release candidate and keep funds on testnet rather than simulating a launch. Publish versioned packages and reference integrations for two-toll settlement, non-custodial session caps, registry payee verification, exact integer reward splitting, and ambiguous-payment reconciliation. Grow to 25 independently controlled creators, 10 external agent/developer integrations, and 1,000 independently initiated paid queries; secure at least three design partners for paid API or enterprise pilots. Acceptance evidence: mainnet deployment and explorer links or an explicit availability-blocked release candidate; tagged open-source release; integration documentation; public usage dashboard; three partner confirmations.
```

## 5. Project Traction and Roadmap

### Tell us about your current traction and success already achieved

```text
Production snapshot captured 2026-08-13 UTC: Keryx has processed 1,853 total queries and 9,522 real settled testnet nanopayments, representing $45.113314 testnet USDC in total volume and $39.193314 paid to creator/source wallets. Twenty source wallets have earned, and all 20 SourceRegistry records are continuously checked against Arc; this is not a claim of 20 independent publisher businesses because several sources are curated or first-party samples. Independently initiated usage accounts for 141 queries, 131 paid queries, 611 external payments, and $2.635999 testnet USDC in creator payouts. All four identified external actors returned, external feedback is 9/9 positive, and all 66 measured external settlement attempts succeeded, with zero pending confirmations and zero failed attempts in the snapshot. Creators completed 12 self-service cash-outs totaling $0.753304 testnet USDC, each with an ArcScan-resolvable transaction. Separately, 1,712 first-party autonomous-agent queries generated 8,911 payments; this is real settlement and load activity but is explicitly excluded from external adoption claims. One independently owner-verified creator has claimed its registry record, been cited, paid, and cashed out end to end. Keryx has shipped 13 public releases since June 2026 and remains live between releases. The current production commit, CI, Arc registry parity, Circle balance parity, provenance-separated usage, and creator withdrawal evidence are linked at https://keryx.cc/proof. The current testnet service does not claim platform revenue.
```

### Public analytics dashboard

```text
https://keryx.cc/proof
```

Optional supporting links:

```text
https://keryx.cc/dashboard
https://keryx.cc/status
https://github.com/tang-vu/keryx/releases/latest
```

### Are you funded?

Select the truthful option:

```text
[SELECT YES OR NO]
```

If accurate, use this explanation:

```text
No — Keryx is founder-funded and bootstrapped and has not raised institutional capital.
```

### Technical Roadmap

```text
Months 0–2: complete a third-party security review; harden the browser signer, payment evidence, registry authority, encryption, and production incident runbooks; and produce an Arc mainnet release candidate. Existing Circle integrations remain USDC, Gateway Nanopayments, x402, and Unified Balance Kit. Months 2–4: add CCTP V2 and Forwarding Service to fund Arc sessions from Ethereum and Base; add an optional Circle Agent Wallets path for programmatic callers; preserve non-custodial browser sessions as a distinct authority boundary; and run a verified external creator/agent pilot. Months 4–6: move audited flows to Arc mainnet when required Circle/Arc services are available; release reusable SDK modules and operating docs; and scale external creators, agent integrations, independently initiated paid queries, and paid design partnerships. The payment source of truth remains explicit: SourceRegistry authorizes payees and splits; the browser or approved agent wallet owns the signing key; the funded session balance is the economic cap; Circle settlement evidence determines settled state; the database is an operational ledger/cache; and unavailable verification remains unknown rather than invented success or failure.
```

### How will this grant support your technical roadmap?

```text
Grant funding will convert a proven testnet product into an audited, externally adopted Arc mainnet service. We plan to allocate 45% to engineering and Circle integrations, including CCTP/Forwarding funding, Agent Wallets support, Arc mainnet migration, SDK extraction, and recovery tooling; 20% to an independent security review of browser signer/session authority, x402/Gateway settlement, registry payout controls, smart contracts, and encrypted content delivery; 20% to creator and agent pilots, including onboarding, integration engineering, documentation, structured feedback, testimonials, and design-partner case studies; 10% to production infrastructure and observability, including redundant RPC, encrypted backups, settlement/registry parity, alerting, uptime, and incident response; and 5% to open-source ecosystem work, examples, technical writing, and Arc community workshops. This funding accelerates work that cannot responsibly be skipped—security review, mainnet operations, and real external pilots—rather than subsidizing cosmetic features or first-party transaction volume.
```

## 6. Deck and Demo

### Video demo of the product

```text
[PASTE UNLISTED VIDEO URL — MAXIMUM 5 MINUTES]
```

### Recording script (not a form answer)

1. **0:00–0:25 — Problem and proof:** open https://keryx.cc/proof; state that Keryx lets an agent buy exact evidence and pay every cited creator in USDC; briefly show the deployed commit, external/first-party split, registry parity, Circle backing, and ArcScan cash-outs.
2. **0:25–1:55 — Codebase walkthrough:** show `lib/agent/run-agent.ts`, `lib/payments/browser-cosign-gateway.ts`, `lib/x402-server.ts`, the paid source and citation routes, `lib/gateway/x402-transfer-reconciliation.ts`, and `contracts/SourceRegistry.sol`. Explain the hard budget, browser-held signer, two-toll model, settlement evidence, and on-chain payout authority.
3. **1:55–3:25 — Live integration:** ask one question with a small budget; show at least one BUY and one SKIP/CACHE; show the x402 access payment, cited answer, contribution weights, and citation reward receipt; open the dispatch and creator earnings page.
4. **3:25–4:20 — Circle and Arc verification:** show Canteen Arc RPC, SourceRegistry zero mismatches, Circle settlement parity, and a creator withdrawal on ArcScan. Explain that Gateway payments have Circle settlement IDs because settlement is batched, while cash-outs are individual EVM transactions.
5. **4:20–5:00 — Roadmap:** state current integrations—USDC, Gateway Nanopayments, x402, Unified Balance Kit—and planned integrations—CCTP V2/Forwarding Service, optional Circle Agent Wallets, audited Arc mainnet launch, and external creator/agent pilots.

### Investor deck

```text
[PASTE VIEWER-ACCESSIBLE DECK URL]
```

### Recommended deck outline (not a form answer)

1. Keryx — every citation pays its creator.
2. Problem — AI agents consume evidence; creators receive neither programmable demand nor payment.
3. Product — question + budget → visible decisions → paid evidence → cited answer → rewards.
4. Why now — Arc + USDC + Gateway Nanopayments make sub-cent agent commerce viable.
5. Architecture — browser session authority, x402/Gateway, SourceRegistry, encrypted content.
6. Traction — aggregate settlement and external/first-party provenance shown side by side.
7. Users and go-to-market — publishers, research/data providers, agent developers, MCP/OpenAI/A2A distribution.
8. Business model — paid agent/API plans and enterprise integrations; creator rewards remain a pass-through pool.
9. Six-month milestones — audit, CCTP/Agent Wallets, external pilot, Arc mainnet launch.
10. Team and ask — Tang Vu, shipped evidence, Circle technical/co-marketing support, and milestone-based funding.

## 7. Conflict of Interest

### Conflict of interest

Select the truthful option:

```text
[SELECT YES OR NO]
```

If `No` is accurate and the portal requests an explanation, paste:

```text
Neither I, Keryx, nor any key individual involved in this application has an actual, potential, or perceived financial, business, advisory, family, personal, or close relationship with Circle or its employees, officers, directors, subsidiaries, or contractors that could influence this application.
```

Do not use that statement unless it is fully true. Disclose any relationship that Circle's policy treats as an actual, potential, or perceived conflict.

## 8. Final submission checklist

- [ ] Enter the professional email, legal entity, location, incorporation, funding, and conflict answers.
- [ ] Confirm `@tangvu_dev` is the intended X handle.
- [ ] Record and upload a video no longer than five minutes.
- [ ] Upload the deck and confirm both links work in a logged-out/private browser.
- [ ] Do not mark Circle Wallets or CCTP as current integrations.
- [ ] Refresh the traction block from https://keryx.cc/proof immediately before submission if the numbers have materially changed.
- [ ] Confirm the website, repository, latest release, proof dashboard, and ArcScan links open while logged out.
- [ ] Save a PDF or screenshots of the final proposal and submission confirmation.

## 9. Evidence and official references

### Keryx evidence

- Live product: https://keryx.cc
- Public proof: https://keryx.cc/proof
- Main repository: https://github.com/tang-vu/keryx
- Latest release: https://github.com/tang-vu/keryx/releases/latest
- Reusable primitives: https://github.com/tang-vu/keryx-arc-primitives
- SourceRegistry: https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536
- Architecture: https://github.com/tang-vu/keryx/blob/main/docs/system-architecture.md
- Security model: https://github.com/tang-vu/keryx/blob/main/docs/security-threat-model.md

### Official Circle references

- Grant criteria and focus areas: https://www.circle.com/grant
- Agent Nanopayments: https://developers.circle.com/agent-stack/agent-nanopayments
- Gateway Nanopayments: https://developers.circle.com/gateway/nanopayments
- x402 and Gateway: https://developers.circle.com/gateway/nanopayments/concepts/x402
- CCTP chains and domains: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- Unified Balance quickstart: https://developers.circle.com/gateway/quickstarts/unified-balance-evm
