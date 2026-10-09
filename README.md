# Keryx 🏛️

[![npm: keryx-mcp](https://img.shields.io/npm/v/keryx-mcp?logo=npm&label=keryx-mcp&color=CB3837)](https://www.npmjs.com/package/keryx-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.tang--vu%2Fkeryx-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=keryx)
[![live: keryx.cc](https://img.shields.io/badge/live-keryx.cc-1aa251)](https://keryx.cc)
[![settles on Arc mainnet](https://img.shields.io/badge/settles_on-Arc_mainnet-1f1f1f)](https://docs.arc.io)
[![payments: Circle x402](https://img.shields.io/badge/payments-Circle_x402-2775CA)](https://github.com/circlefin/arc-nanopayments)
[![CI](https://github.com/tang-vu/keryx/actions/workflows/ci.yml/badge.svg)](https://github.com/tang-vu/keryx/actions/workflows/ci.yml)

Keryx is a citation-toll reading agent for researchers and builders: a question and
budget lead to a cited report, visible BUY/SKIP/CACHE decisions, and payment receipts
for eligible creator rewards.

**[Live app](https://keryx.cc)** · **[Public proof](https://keryx.cc/proof)** ·
**[Archived QA walkthrough (2m40s, app 0.27.43, recorded Oct 8)](https://github.com/tang-vu/keryx/releases/download/v0.27.43/keryx-current-release-6e591603-archived-qa-05.mp4)**.
Reopens an archived first-party report and receipt; no new research was submitted.
See the [recording scope and public checks](docs/reviewer-start.md#recording-gate).

## Try it in two minutes — no wallet

1. Open this [existing English cited report](https://keryx.cc/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913)
   about how source-access tolls differ from citation rewards. Read the summary
   and its `[S1]` source excerpts, including the Low confidence boundary.
2. Expand **Decision log** below the answer. Inspect why Keryx reused the cached
   first-party article and skipped unrelated candidates. This run has CACHE/SKIP
   decisions; it did not pay a new access toll.
3. Open **View JSON** in **Portable research receipt**, or use the
   [direct receipt](https://keryx.cc/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt).
   Under `payload.settlement`, check `mode: real`, `ledgerCompleteness: complete`,
   **0 USDC access / 0.025 USDC citation**, and the mainnet Circle reference.
   [Receipt verification and the retained digest](docs/reviewer-start.md#verify-the-example)
   explain what these records prove.

This is an archived owner-operated QA result using **Keryx Engineering (first-party)**,
not a fresh answer or an outside customer's task. The location/job in its prompt is
a test persona. It supports the three core payment facts but omits the requested
document revision, so the original deliverable remains partial. Opening the report
or receipt makes no research or payment request.

**Next, ask your own question:** open [keryx.cc](https://keryx.cc), choose Quick,
and submit a shareable question. The public sponsored trial needs no wallet or
sign-up; the composer shows the payer and budget. Admission depends on current
quota, available capacity and spend caps, so a new answer within two minutes is
not guaranteed. Submitted questions become public reports. See
[sponsored trial limits](docs/sponsored-research-trial.md).

## Usage so far

Read-only snapshot of [public metrics](https://keryx.cc/api/metrics),
**October 8, 2026, 16:24 UTC**, with [public health](https://keryx.cc/api/health)
reporting Arc mainnet / real settlement at `3b839ccd`.

| Measure | Observed value | Counting boundary |
| --- | --- | --- |
| Recorded research runs | 50 | All caller origins, including team and QA; not accepted deliverables |
| Settled payment records | 7 | All payment kinds; pending, failed and simulated excluded |
| Settled volume | 0.095 USDC | Gross payment volume, not net revenue |
| Creator access + citation payouts | 0.065 USDC to 2 earning creators | Includes first-party recipients; not independent creator adoption |
| Settled operating fees | 0 USDC | Reported separately from creator rewards |
| Outside users / team / QA | Separate counts unavailable | The endpoint does not partition these groups; guest questions are not unique outside users |
| Historical Arc testnet | Separate evidence only | Not included in these mainnet totals; see the [event-period record](docs/tameion-submission.md#event-period-usage-testnet-week-then-mainnet) |

These are dated database projections. [Live Ledger](https://keryx.cc/dashboard)
and [Public Proof](https://keryx.cc/proof) expose the current records and their limits.
The [submission pack](docs/tameion-submission.md#named-external-user-hoàng-freelance-developer)
separately documents sponsored outside use on testnet and unmatched participant
stories; none is inferred from these aggregate counts. [Snapshot hashes](docs/reviewer-start.md#public-checkpoint)
retain the exact observation.

## What is real and what is scripted

- **The two-minute path reopens a stored run.** Its model-written answer, decision
  trace and receipt are recorded artifacts. It is a curated QA example, not a live
  rerun or evidence of customer acceptance.
- **The example's payment is recorded as real Arc mainnet settlement:** one
  0.025 USDC citation reward to the first-party Engineering source. Its cached read
  cost zero. The Circle transfer reference is not a per-citation Arc transaction hash.
- **First-party and public sources are distinct.** Keryx Engineering and Keryx owner
  release notes are first-party validation sources. Public web/paper references
  alone grant no creator payout rights. Historical seeded sample sources have
  Keryx-controlled authority; they do not establish independent seller adoption.
- **CLI demo, seed and benchmark commands are scripts.** Offline development uses
  labelled simulated payments. Invoking a real-mode script can make actual paid
  requests; it is not required for the wallet-free review path.
- **Production research is caller-driven.** The local desktop alpha is not an
  autonomous scheduler. Monitoring/reconciliation jobs are operational checks,
  not independent users or fresh research. This public checkpoint does not verify
  the host's current schedule inventory.
- **Settlement is checked per receipt.** Pending, failed, simulated and planned
  amounts are separate from settled value. A cited answer, healthy API or script
  completion alone does not prove a payment settled.

## What happened during Tameion

The pre-event main baseline is
[`2291753` (September 25)](https://github.com/tang-vu/keryx/tree/2291753cc4fff2135d546227d5aafda287cbed7d).
During the event Keryx added original-document and scholarly discovery, portable
cited-report exports, a local CLI/Windows task workspace, bounded manual Research
Monthly, and prepaid Operator recovery/observation. Production moved from Arc
testnet to mainnet on October 4. The
[event-period product delta](docs/tameion-submission.md#event-period-product-delta)
links source evidence and the limits of each change.

The usage record separates the event's testnet phase from mainnet; the mainnet
snapshot above includes internal activity. Sponsored outside use is documented,
but independent paid demand, repeat use and general deliverable usefulness remain
separate evidence gates. Source candidates beyond the observed deployment are
not claimed live. The dated archived-QA walkthrough above reopens existing artifacts; it is not a
live-Ask or complete current-feature demonstration.

---

## The problem

The web's economics assume a human reader: you write, people visit, attention becomes ads,
subscriptions, tips. AI agents broke that contract. They read everything and send back nothing —
no click, no view, no cent. Every answer an assistant gives is built on someone's work, and that
someone is invisible at the exact moment their work proves its value.

Keryx (κῆρυξ — *herald*) exists to fix that one moment. It makes **citation itself the payment
event**: the instant an agent relies on your writing to answer a question, you are paid,
proportional to how much you helped, settled sub-cent in USDC on [Arc](https://docs.arc.network).
No accounts, no invoices, no ad tech. A creator onboards by pasting an RSS URL. An agent pays
because paying is cheaper than not knowing.

## What Keryx is

Keryx is a **citation-toll reading agent** — an autonomous reader with a wallet, and the payment
rail underneath it. Give it a question and a budget:

1. It **decomposes** the question into sub-claims and **discovers** exact article candidates from free previews and the signed offer book.
2. It **decides**, per article version: *buy / skip / cache* — expected value vs effective price vs remaining budget,
   with a human-readable rationale for every choice.
3. It **pays the x402 toll** only for what it buys, checks **sufficiency** after each read, and
   stops early when it has enough.
4. It returns a **summary cited sentence by sentence**: each sentence is written from one
   verbatim source excerpt, checked against it, and shown beside it, with explicitly
   labelled research targets/gaps. Uncited prose is withheld; the answer
   retains a **Low/incomplete** boundary, and allocates bounded citation rewards only
   to eligible accepted sources. Creator payouts are settled only when recorded
   payment evidence confirms settlement; multi-author rewards follow their payout split.

Ordinary short-bullet requests can retain their requested count and supported
output language when every target, reviewed sentence and qualifying excerpt fits
the same grounded layout. Otherwise the answer keeps inspectable target sections
and explains the unmet format. See [candidate scope and acceptance](docs/engineering/research-deliverable-quality-2026-10-08.md).
Unsupported output-language requests use English scaffold labels without forcing
statement translation; [language-selection scope](docs/engineering/output-language-2026-10-09.md)
records the finite parser and remaining localization gates.

The result is a working micro-economy: readers that pay by default, and writers that earn by
being *useful* — not by being clicked.

## An agent that genuinely decides

Most "payment agents" are scripts with a wallet. Keryx's differentiator is **visible agency** —
the model reasons about money and shows its work, streamed live to the UI:

- **Buy / skip / cache with rationale** — every spend decision names the exact article version and explains why.
- **Open article market** — [`/market`](https://keryx.cc/market) and `GET /api/offers` publish exact payable versions, registry list prices, x402 paths, and verifiable EIP-712 discounts signed by publishers.
- **Source comparisons**: recorded exact excerpts let readers inspect differing sources.
  The current claim-grounding candidate does not certify an independent synthesized
  conclusion about which source is correct.
- **Confidence boundary**: the answer is labelled Low/incomplete.
  Qualified source excerpts provide recorded support; target coverage estimates do not
  verify each assertion or establish complete useful synthesis.
- **Sentence-cited summaries**: each summary sentence is written from one qualified literal
  source excerpt, scored against that excerpt by a separate model review, and rendered
  beside the verbatim source text. Sentences without a qualifying excerpt or review are
  removed, and the answer falls back to excerpts alone when none survives. The review is
  a model judgment, not proof; cross-source conclusions are not written. Accepted excerpt
  citations still support rewards, with original paid-fetch debits, article bindings and
  settlement identities. Production now uses Arc mainnet; see the
  [current deployment and evidence limits](docs/mainnet-status.md).
  Deployment does not establish complete useful synthesis or independent acceptance.
- **Evidence ledger** — every rewarded citation carries a claim-indexed exact quote. The
  orchestrator verifies that quote against content it actually read before the marker can receive
  a citation reward; rejected markers are removed from the answer.
- **Living answer receipts** — archived conclusions never silently change. Keryx flags when an
  exact paid SHA-256/IPFS article version has been superseded, exposes a metadata-only freshness API,
  and itemizes the source/evidence/coverage/settled-payment delta after a reader explicitly re-asks.
- **Researcher exports** — import recorded cited-article references as BibTeX or RIS into Zotero,
  and compare claim-level excerpts in a research evidence matrix with spreadsheet CSV.
  Observed scholarly records include supplied authors/DOI/journal metadata and read limits;
  missing fields stay explicit. See [researcher exports](docs/researcher-exports.md).
- **DOI and scholarly discovery** — resolve up to two exact Crossref DOIs from a question,
  or opt into Crossref/arXiv searches. Read selected original publisher pages and bounded
  versioned arXiv PDFs, with explicit abstract-only fallback. Metadata and public papers
  carry no creator payout authority. See [scholarly research](docs/scholarly-research.md)
  and the separate [proposed author opt-in payment plan](docs/paid-scholarly-papers.md).
- **Portable research receipts** — every permalink exports one deterministic JSON bundle containing
  its answer hash, BUY/SKIP/CACHE decisions, exact article versions, claim evidence and sanitized
  Circle settlement snapshot. Retain its SHA-256 to detect later changes; the self-check does not
  pretend to be a Keryx, publisher, or on-chain signature.
- **Claim-aware evidence portfolios** — Keryx chooses a non-redundant set of positive source
  proposals under separate attention and fetch-USDC caps. CACHE correctly costs zero fetch USDC but
  one context slot; the receipt compares preview-predicted coverage with evidence yield after read.
- **Cross-query memory** — sources that proved useful (or useless) in past runs *on the same
  subject* shift future buy/skip decisions. A source is scored against the runs that actually read
  it, so a skip never becomes evidence against the source it skipped.
- **Semantic discovery** — candidate matching by embedding similarity, not keyword luck.
- **Emergent frugality** — it stops early, reuses its cache, and correctly spends *nothing* when
  nothing is worth buying.

Money safety is enforced in code, not by the model: the LLM proposes value; the orchestrator
enforces the hard budget cap, so a hallucinated number can never overspend. An economic-invariant
test suite (spend ≤ budget, payouts = weights, splits sum exactly) runs in CI on every push.

The [controlled offline paying-source study](docs/studies/paying-for-sources-2026-10-09.md)
runs the actual Keryx heuristic pipeline on four published fictional questions across
four budgets and three catalogue prices. Retained bodies, actual synthetic outputs,
literal/read-bound scoring and exact simulated ledger amounts are reproducible with
`npm run eval:paying-source-study -- --check`. It measures this closed fixture only;
live model behavior, semantic correctness, real spending and exploration's causal
effect remain unmeasured.

Historical testnet trace (recorded output; not current mainnet traction):

```
[decide]  BUY Agent Economy Weekly — strong match on x402, autonomous, commerce; worth the $0.004 toll
[decide]  SKIP Garden & Soil Monthly — weak match (no key terms); not worth $0.002
[fetch]   Paid $0.004 to Agent Economy Weekly — S1
[sufficiency] Read 2 sources covering all sub-claims; stopping early to save budget
[settle]  Settled $0.015 → Mara Okoye · $0.010 → Devin Park   (60/40 author split)
📊 $0.032 spent → 100% to creators · 3 bought / 3 skipped
```

## Research tools and desktop

Windows local Operator alpha: `npm run desktop:install` then `npm run desktop:start`.
See the [desktop guide](docs/desktop-alpha.md) for the unpacked app build, offline
saved results, private Markdown briefs, and limits.

[Research-paper library](docs/paper-library.md): browse 40 observed paper records
from arXiv, OpenReview, PMLR and ACL Anthology, filter by author/year/DOI, or explicitly
search live arXiv/Crossref metadata. `/api/papers` and `npm run papers` share the
bibliography-only contract. Links remain unread until a separate research run.

[Literature workspace](docs/literature-workspace.md): save exact paper records on
this browser, screen against a review question, keep personal notes, export CSV/JSON/RIS
and prepare an editable two-paper comparison. No account, cloud sync or automatic ask.

[Research Monthly](docs/research-monthly.md): a bounded plan for four Deep
requests over 30 days, 10% below four separate packages with unchanged creator
caps. Manual renewal; no scheduling or unlimited use. Failed/pending jobs use a
slot. Web/API own the entitlement; Monthly CLI and MCP handoffs share that contract.

## For creators

- **Claim proven demand** — [keryx.cc/wanted](https://keryx.cc/wanted) shows claims paid
  dispatches left under-covered. A new creator can check and list an RSS feed; an existing registry
  creator can offer the exact indexed article directly and optionally sign a temporary discount.
  Keryx guarantees that version a candidate slot, not a purchase, then queues one bounded retry
  after refreshing creator authority. Fulfillment is public only when
  that source passes the evidence gate and its citation reward really settles. Every claim has a
  canonical shareable brief and social card, so the specific gap can reach the writer who covers it.
- **Onboard from your own wallet** — paste an RSS feed at [keryx.cc/register](https://keryx.cc/register)
  and publish your source to the on-chain registry. Keryx sets up the x402-priced endpoint and
  free preview; it never holds your key. On mainnet your wallet supplies native USDC
  gas; the faucet is available only on testnet.
- **Own your payout** — your registered source pays the wallet you signed in with.
  The first historically owner-verified testnet creator ([conzit.com](https://conzit.com)) proved feed ownership,
  set its address, was cited &
  paid end-to-end — and has since claimed its registry record from its own wallet, so its on-chain
  `creator` is the creator, not Keryx. We've also proposed this as an opt-in convention upstream in
  [RSSHub](https://github.com/DIYgod/RSSHub/discussions/22315).
  Seeded sample sources have Keryx-controlled registry authority; live authority and payout
  checks are available on [`/proof`](https://keryx.cc/proof).
- **Know the moment you're cited** — opt into a plain **email alert** (no webhook server needed,
  rate-capped, one-click unsubscribe) and/or signed webhooks that fire the instant a citation
  settles; every payout on your public earnings page shows the actual *question* your work helped
  answer.
- **Show it off** — an embeddable **"Cited by Keryx" badge** (live SVG at `/api/creator/<id>/badge.svg`)
  displays your real citation count + USDC earned on your own site, with copy-paste Markdown/HTML on
  each creator page. Payouts become portable, verifiable proof.
- **Cash out yourself** — your wallet signs a Gateway burn intent in the browser and
  submits the reviewed mainnet mint with native USDC gas. Optional gas-relay operation
  is a separate role; historical testnet cash-outs do not prove a mainnet withdrawal.
- **Keep everything** — 100% of every citation reward goes to creator wallets. 0% platform fee.
- **Squat-proof identity** — sources live in an on-chain SourceRegistry
  ([`0x42a64061b6cd84067bb660b2a9b8aa881fd225bb`](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb))
  with creator-scoped IDs and on-chain multi-author splits.

### Public sources and owner claims

Public web discovery finds supported websites, feeds and PDFs for the question at
hand and reads available content for free. `/sources` shows retained feeds and creator
listings, rather than a bulk index of the internet. A publisher can choose **This is
my source** or open `/claim-source`, sign in with its wallet, and prove control using
a dedicated website file or publisher-controlled RSS/Atom channel token.

Verification earns nothing by itself. Connect the exact owner-created registry listing
and explicitly choose free reads with no rewards, zero-price reads with qualified
citation rewards, or positive-price paid reads. Earning activation requires separate
distribution-rights consent and fresh control proof; registry registration is an
owner-reviewed network transaction with possible native gas, using no agent funds.
Control expires after 24 hours and earning eligibility pauses until explicitly refreshed.
Old public reference identities and free receipts remain free, and no activation bills
past uses. Zero-price reads require no x402 access authorization or settlement receipt.

The shared reading pipeline applies the same policy and evidence gates across web,
API and agent clients. Claim management uses the web and its authenticated API;
scholarly-rights enrollment remains separately gated. See the
[public-source claim guide](docs/public-source-claims.md) for proof, listing, policy
and recovery steps and deployment capability requirements.

## For developers & agents

- **Free, no-wallet trial** — [keryx.cc](https://keryx.cc) answers without any setup, with a
  graceful upgrade path when you outgrow the free budget.
- **Browser extension** ([`extension/`](extension/)) — highlight text on any page and ask Keryx
  from a toolbar popup, or right-click to list a page you own as a paid source. A thin,
  no-key client over the OpenAI-compatible endpoint; load unpacked on any Chromium browser.
- **Remote MCP** — connect an MCP client directly to [`https://keryx.cc/mcp`](https://keryx.cc/mcp)
  over Streamable HTTP: no package or local wallet process. The `research` tool has an anonymous,
  IP-limited trial; an ask-scoped `kx_live_…` Bearer key raises the cap and attributes usage to its
  verified wallet. Creator rewards still settle in USDC on Arc. Quick connect:
  `codex mcp add keryx --url "https://keryx.cc/mcp?client=codex"` or
  `claude mcp add --transport http keryx "https://keryx.cc/mcp?client=claude"`.
  The interactive setup guide is at [`/integrations/mcp`](https://keryx.cc/integrations/mcp).
- **Local x402 MCP** — the caller-funded package uses its local Arc wallet to pay
  Keryx's x402 toll before Keryx researches and pays creators. Version 0.3.2 requires
  existing owner-provisioned custody, a trusted merchant policy and supported Node.
  Use [verified package distribution](docs/mcp-distribution.md). October 3 discovery found
  npm latest 0.4.1 and
  GitHub v0.26.1 assets from `f9dca8d` are the previous immutable release. Application
  0.26.2, caller MCP 0.4.2 and desktop 0.4.2 are coordinated claim-grounding candidates;
  packed acceptance, exact-source installer checks and publication are separate gates.
  Check verified release assets and npm integrity/provenance for current artifact status;
  publication does not establish hosted deployment.
- **Discord slash command** — [install the Keryx app](https://discord.com/oauth2/authorize?client_id=1527619548809924678)
  in any server and type `/ask`: the reply embed carries the grounded answer, every creator paid,
  and a link to the dispatch trace. No bot process — signed interactions POST straight to the API
  ([`docs/discord-bot-setup.md`](./docs/discord-bot-setup.md)).
- **Telegram bot** — DM [@keryxai_bot](https://t.me/keryxai_bot) any question (or `/ask …` in a
  group): same full reasoning loop, same real creator payouts, answered in-chat with a
  dispatch-trace link. Webhook-only, no polling process
  ([`docs/telegram-bot-setup.md`](./docs/telegram-bot-setup.md)).
- **Slack slash command** — a `/keryx …` command for any workspace: signed requests POST straight
  to `/api/slack/commands`, the same full reasoning loop and real creator payouts answered in-channel
  with a dispatch-trace link. No bot token or scopes — replies ride the command's `response_url`.
  Setup + app manifest in ([`docs/slack-bot-setup.md`](./docs/slack-bot-setup.md)).
- **Agent-to-agent API** — `POST /api/agent/ask` lets other agents buy Keryx's research over x402:
  an agent paying an agent that pays creators, end to end. Versioned Quick/Deep packages pin the
  execution contract and return provisional-SLO latency plus deterministic evidence-quality
  receipts; see [`docs/a2a-research-packages.md`](./docs/a2a-research-packages.md).
- **OpenAI-compatible endpoint** — point any OpenAI SDK or tool (LangChain, LlamaIndex, OpenWebUI,
  LibreChat, Continue) at `https://keryx.cc/api/v1` with model `keryx`: a drop-in Chat Completions
  API. Free with no key, or pass a `kx_live_…` key as the Bearer token for higher limits. Every
  cited creator is still paid downstream in USDC on Arc; with `stream:true`, the agent's live
  buy/skip/trust reasoning streams as `reasoning_content` deltas. Try it with no install in the
  [browser playground](https://keryx.cc/playground) — it also hands you the exact curl/Python/JS call.
- **Public API with wallet-issued keys** — SIWE-authenticated key minting (hashed, show-once,
  rate-limited) and OpenAPI docs at [`/api/docs`](https://keryx.cc/api/docs).
- **Receipt export + local verification** — `GET /api/dispatch/<id>/receipt` returns the portable
  research receipt; download it from any permalink and run
  `npm run verify:receipt -- ./keryx-receipt-<id>.json` to recompute its payload digest. See the
  [receipt format and trust boundary](./docs/research-receipts.md).
- **Non-custodial by design** — interactive spend uses a session EOA the *user* funds from their
  own wallet; the browser co-signs each x402 authorization in-tab. The funded amount is the hard
  cap. Keryx never holds your key or your funds.
- **The chain decides who gets paid** — before anything signs or settles, every payee is checked
  against the on-chain SourceRegistry, not against Keryx's database. Editing the database cannot
  reroute a single citation reward, on any path — browser or A2A.
- **Transparent treasury** — [`/api/treasury`](https://keryx.cc/api/treasury) publishes the
  settlement wallet's chain-abstracted Gateway balance (via Circle App Kit), so anyone can audit
  what backs the payouts.
- **Live activity feed** — [`/api/activity`](https://keryx.cc/api/activity) streams the most recent
  real settled citations (source, question, reward) — a proof-of-life surface and a zero-prior-knowledge
  way for tooling to see what Keryx is citing right now; it also drives the live ticker on the landing.
- **Answer archive as an Atom feed** — subscribe to [`/answers/feed.xml`](https://keryx.cc/answers/feed.xml)
  and see every new paid answer as it settles. Keryx onboards creators by reading their RSS feeds;
  this is the same door pointed the other way — Keryx itself becomes a source any reader or agent
  can follow.

## The money rails

Live settled totals require Circle settlement evidence. Offline development runs are
labeled `SIMULATED`.

- **x402 pay-per-request** (`@circle-fin/x402-batching`) — a two-toll design: a small fixed
  *access* toll to read, plus a dynamic *citation* reward priced by contribution weight. Fetched
  but uncited earns the toll; cited earns proportionally more only after its evidence passes the
  deterministic grounding gate.
- **Circle Gateway nanopayments** — batched sub-cent settlement (floor $0.000001). Historical testnet average
  payment: ~$0.0044 — a true nanopayment, uneconomical on any card rail.
- **Treasury observation** — mainnet reads the sealed public role's Circle Gateway balance;
  historical testnet used Circle App Kit (Unified Balance Kit). Current observation is published on
  [`/status`](https://keryx.cc/status) and [`/api/treasury`](https://keryx.cc/api/treasury).
- **SourceRegistry contract on Arc** — source identity, IPFS CIDs, multi-author splits; on-chain
  events drive the off-chain indexer.
- **Encrypted content on IPFS** — AES-256-GCM ciphertext pinned publicly; plaintext is released
  only after x402 settlement verifies. Free previews stay plaintext.
- **USDC-native chain** — Arc settles in <500ms with USDC as gas, which is what makes per-citation
  economics physically possible.

## Architecture

The [Circle and Arc integration ledger](docs/engineering/circle-arc-integration-ledger.md)
maps each integration to code, network, status and public proof. It also records the
gasless user-action evaluation and the sponsored testnet proof still required by #304.

Production uses **Arc mainnet (`eip155:5042`)**, observed October 4, 2026 through
[/api/health](https://keryx.cc/api/health). Full constants, release identities and
the separation from historical testnet evidence are in [mainnet status](docs/mainnet-status.md).

| Role | Full public address | Explorer |
| --- | --- | --- |
| SourceRegistry | `0x42a64061b6cd84067bb660b2a9b8aa881fd225bb` | [Arc mainnet](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb) |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | [Arc mainnet](https://explorer.arc.io/address/0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE) |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | [Arc mainnet](https://explorer.arc.io/address/0x2222222d7164433c4C09B0b0D809a9b52C04C205) |

Creator and user session addresses vary by workflow. The
[submission pack](docs/tameion-submission.md#public-addresses) also records public
USDC and Gateway contract references and the evidence required for actual payments.

```
BROWSER (Web App)                    IPFS + Arc Smart Contracts              Circle Gateway + Arc Mainnet
─────────────────                    ─────────────────────────               ──────────────────────────────
┌──────────────────┐                 [SourceRegistry]
│ /ask page        │ (SIWE           on Arc 0x42a640...                       USDC on Arc
│ + wallet connect │  auth)           • sources[]                             (ERC-20, 6 decimals)
│                  │                   • emit Registry events
└────────┬─────────┘                   • indexed by off-chain DB
         │ session-grant
         │ (user funds session EOA)     [IPFS Content]
         │ MetaMask tx → session       • AES-256-GCM encrypted                [Circle Gateway]
         │ deposits in Gateway          • plaintext released only post-settle  • batch settlement
         │                                                                      • x402 EIP-712 verify
         │                             [Keryx API]
         │ co-sign loop (fetch+POST):  • auth: SIWE JWT (browser + API key)   [Arc RPC]
    /api/ask (SSE) ──────────────────▶ /api/session/*   (grant, credit)       selected Arc mainnet RPC
    browser streams                     /api/ask         (agent asks, gets
    sign-requests                       /api/ask/sign    sign-requests back)
    ◀────────────────────────────────  /api/source/[id]/item/[itemId]?version=…
    client-side session key             /api/offers      (signed article price book)
                                        /api/cite        (citation reward)
    signs EIP-712                       /api/keys        (API key mint/verify)
    auto-signs (NO prompt)              /api/agent/ask   (A2A, x402-priced)
                                        /api/treasury    (App Kit unified balance)
                                        /api/docs        (OpenAPI)

    Agent brain (lib/agent/run-agent.ts):
    decompose→discover→decide→fetch→sufficiency→synthesize→attribute→settle
```

## Run it

For project development, [the OSS AI adoption record](docs/engineering/oss-ai-adoption-2026-10-05.md)
documents checked upstream patterns and their Keryx acceptance gates. Use
[`$keryx-oss-adoption`](.agents/skills/keryx-oss-adoption/SKILL.md) for future
OSS learning and adaptation tasks in supporting development agents.

**One command — the full cycle (~90s).** Decide → pay the x402 toll → read → synthesize → settle
weighted citation rewards, then report payments on the explicitly configured network.
The checked-in environment example is for isolated testnet development; mainnet
operations require the reviewed configuration and a finite authorized budget:

```bash
npm run demo -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
```

With `ANTHROPIC_API_KEY` + `AGENT_FUNDER_PRIVATE_KEY` + `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS` it
settles for real and prints on-chain proof; without them the same flow runs offline, clearly
labeled `SIMULATED` — a mock is never presented as settled.

```bash
# 1. Install (Node 22 LTS v22.19.0+ or Node 24+; CI and production use Node 24)
npm install --global npm@11.19.0
npm install

# 2. Configure (optional — runs offline with zero keys)
cp .env.example .env.local

# 3. Demo sources (offline development needs no wallet keys)
npm run seed-sources

# 4a. One question, full reasoning trace in the terminal
npm run ask -- "How do x402 and stablecoins enable autonomous AI agent commerce?" --budget 0.05

# 4b. Or the full web app (SIWE auth, session grants, browser co-sign)
npm run dev          # http://localhost:3939

# 5. Live metrics
npm run metrics
```

The legacy `generate-wallets` command is retired because it printed private keys
and replaced existing environment custody. For real operations, provision
secrets privately under the current role-specific labels and preserve existing
wallets and backups. Follow [treasury custody](docs/treasury-wallet-custody.md) or
[caller-owned buyer setup](docs/buyer-agent.md); starting a demo does not create or
recover a wallet.

| Mode | Reasoning | Payments | When |
|------|-----------|----------|------|
| **Offline dev** | heuristic, no LLM key | simulated, labeled | laptop, zero setup |
| **Server treasury** | Claude / DeepSeek | real Arc mainnet, dedicated sealed-policy custody | admitted hosted research and paid A2A |
| **User interactive** | Claude / DeepSeek | real Arc mainnet, user-funded session signer | production web app |
| **Isolated integration tests** | configured provider or fixtures | Arc testnet, separate keys/state | payment drills and development |

## Built to stay up

Keryx runs as a real service, not a demo that dies after the video:

- **Public [`/status`](https://keryx.cc/status) + [`/api/health`](https://keryx.cc/api/health)** —
  uptime, deployed commit, settlement mode, live traction, treasury balance.
- **Low-downtime deploys** — new builds compile beside the live one, swap atomically, health-gate,
  and auto-roll-back if the new build doesn't come up (`npm run redeploy`).
- **Treasury watchdog** — hourly cron checks settlement-wallet USDC + gas against thresholds and
  alerts before settlements can stall; failed settlements alert immediately.
- **Rotating off-box backups** of the traction datastore, hourly.
- **CI** — typecheck + the economic-invariant suite on every push.

## Security

The interactive path is non-custodial. Its key security boundaries are:

1. **Circle facilitator** — x402 settlement batches through Circle's facilitator (no on-chain
   alternative in the current Arc payment path).
2. **Server holds the IPFS decryption key** — content is encrypted at rest, but key release is
   server-side (Lit Protocol planned once Arc is supported).
3. **Session key lives in a Web Worker** — derived there, never returned; the tab holds only
   AES-GCM ciphertext under a non-extractable key. The worker signs payment authorizations to
   registry-authorised payees only, and transactions only to USDC/Gateway — so page-level XSS can
   neither steal the key nor name itself as payee. Residual: the derivation signature is produced
   on the main thread, a one-call window at setup.
4. **Treasury gas wallet** — holds gas only, rotated; a compromise cannot touch creator funds.

Full threat matrix and verification results: [`docs/security-threat-model.md`](./docs/security-threat-model.md).

## Fork the primitives

The MIT-licensed [standalone Arc primitives](https://github.com/tang-vu/keryx-arc-primitives)
now have a reviewed **0.3 safety and packaging refresh**, also pinned at
[`arc-primitives/`](./arc-primitives) (clone with `--recurse-submodules`).

- Exact micro-USDC parsing and weighted allocation, plus fixed/dynamic x402 settlement
  with durable host admission and retained ambiguous outcomes.
- Creator-bound registry helpers and ordered, deduplicable indexing; the original
  registry contract remains separate from current upstream v2 work.
- Atomic integer budget reservations as an explicitly **in-memory reference**, and
  browser-signed, treasury-relayed withdrawal with finite authorization height,
  exact attestation binding and journaled mint transaction identity.
- Additive discovery metadata, pinned Circle SDK/x402 dependencies, generated ESM/types,
  a no-network demo and a clean packed-consumer check.

The 81 tests and offline demo are synthetic; funded acceptance, durable storage,
browser custody, reconciliation and mainnet review remain host-owned gates. This
library release does not change Keryx's payment runtime, MCP package or desktop installer.
See the [standalone migration guide](https://github.com/tang-vu/keryx-arc-primitives/blob/fea33574e106a91013e52fad9e99bd4db9df1206/docs/migration-0.3.md)
and [maintenance and surface boundaries](docs/arc-primitives-maintenance.md).

## Project docs

- [`docs/engineering/source-catalog-2026-10-06.md`](./docs/engineering/source-catalog-2026-10-06.md) — expanded source library, publisher links, feed audit and discovery filters
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch, pull request, validation and payment-safety workflow
- [`docs/rust-engine-migration.md`](./docs/rust-engine-migration.md) — staged shared Rust engine and acceptance gates
- [`docs/openai-compatible-api.md`](./docs/openai-compatible-api.md) — drop-in recipes for OpenAI SDK, LangChain, LlamaIndex, Open WebUI, LibreChat, Continue
- [`docs/system-architecture.md`](./docs/system-architecture.md) — data/money flow + on-chain components
- [`docs/security-threat-model.md`](./docs/security-threat-model.md) — threat matrix, audits, residuals
- [`docs/engineering/source-money-adversarial-2026-10-09.md`](./docs/engineering/source-money-adversarial-2026-10-09.md) — eight malicious-source classes, paid delivery checks and remaining live proof gates
- [`docs/codebase-summary.md`](./docs/codebase-summary.md) — module map
- [`docs/mainnet-delivery-plan.md`](./docs/mainnet-delivery-plan.md) — current product and release gates
- [`docs/project-roadmap.md`](./docs/project-roadmap.md) — near-term priorities
- [`TRACTION.md`](./TRACTION.md) — live usage and settlement links
- [`FEEDBACK.md`](./FEEDBACK.md) — Circle/Arc dev-tool feedback we filed while building
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision log

## Origin & where it's going

Keryx started at the **Lepton Agents Hackathon** (Canteen × Circle, on Arc, June 2026) as the
canonical build of the "herald" model — *content cited, paid per citation* — and never stopped
running. The service at [keryx.cc](https://keryx.cc) runs caller-driven research with
Arc mainnet payment authority; it has no hourly research or payout guarantee.
Current work adds broad-web and scholarly evidence, chat-first cited reports, local
Windows/CLI task recovery, and a bounded Research Monthly pilot. The full Operator
and autonomous scheduler remain planned. Production mainnet is live; independent
usefulness, audit, adoption and profitability retain their
[explicit acceptance gates](docs/mainnet-delivery-plan.md). See the [Tameion submission evidence](docs/tameion-submission.md)
for dated releases, public contract/wallet addresses, product delta and pending pilot proof.

## Stack

Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · viem/wagmi · `@circle-fin/x402-batching` ·
`@circle-fin/unified-balance-kit` · `@x402/fetch` · Node `node:sqlite` / Supabase ·
Anthropic / DeepSeek. Built on the verified
[`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments) x402/Gateway plumbing.
