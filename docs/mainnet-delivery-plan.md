# Keryx: complete product and mainnet delivery

Active objective, September 9, 2026: a complete buyer/creator/developer ecosystem,
explicit revenue and profit formulas, and evidence-backed readiness for mainnet.
ETHOnline is an intermediate delivery milestone. Completing its demo does not finish
this objective. This plan is the maintained acceptance map; old aspirational TVL,
multi-chain and enterprise checklists are historical, not proof of readiness.

Across active delivery plans, reduce or stage scope when deadlines press; do not
weaken quality, security, reliability, maintainability, or the evidence required by
the acceptance gates. A working demo or an easier implementation is not a release
decision. The [Tameion plan](./tameion-2026.md) applies this rule to its Operator and
desktop work while this document remains the complete-product and mainnet gate map.
The [shared Rust engine migration plan](./rust-engine-migration.md) adds domain parity,
rollback and platform gates. Passing a read-only local slice cannot satisfy signer,
spend, settlement, recovery or mainnet gates here.

Mainnet readiness and permission to launch are separate. The existing testnet
restrictions remain until the final owner go/no-go decision. No mainnet keys,
addresses or service availability will be inferred from testnet configuration.

October 2 corrected direction: migrate the complete public Keryx product to mainnet
on `keryx.cc`, including normal wallet login, buyer funding/grants, creator registration
and payout, public research and applicable API/CLI/MCP/desktop/extension/bot surfaces.
An invited audience and permanently tiny pilot caps are not the intended product.
The earlier [pilot proposal](mainnet-pilot-candidate.md), dormant isolated server and
invited worker PRs are retained as superseded preparation evidence; reusable profile,
custody, nonce/cap, registry attestation and recovery pieces may inform the general
cutover. They do not establish full-product readiness or authorize mainnet activation.

The shared source contract accepts canonical `arc` and `arcTestnet` profiles. Existing
deployments with both network labels unset retain testnet. A mainnet release must set
matching `KERYX_NETWORK=arc` and public build `NEXT_PUBLIC_KERYX_NETWORK=arc`; standalone
commands also declare both labels, where the public value is only the deployment
profile label. Mainnet server/public registry addresses must match a reviewed nonzero
address, including any explicitly configured read-address pair. Private RPC overrides
remain trusted operator configuration and need selected-chain attestation. Mainnet has
no assumed WebSocket endpoint and uses HTTP indexer polling unless one is explicitly
reviewed. Request bodies, payment requirements and server-returned network fields
cannot select browser signing authority: browser workers capture the public profile
from their build independently.

Selecting a source profile is not activation. All financial domains must pass coordinated
storage/custody identity, normal user consent and funding, registry/content authority,
single-use nonce and integer cap reservations, settlement/recovery, withdrawal and
operational acceptance before the final owner launch/funds decision. Testnet state and
funded session identities remain retained; never silently import them as mainnet state.
Full-product adoption/profitability evidence remains separate from financial migration
and cannot be inferred from synthetic mainnet checks.

The [normal browser custody checkpoint](./mainnet-browser-custody.md) documents retained original
same-device recovery, owner funding, dual consent/possession proofs, cumulative signed capacity,
and actual Chromium/Next worker evidence. Full authenticated server research composition and
owner-only session cashout remain release gates; this source checkpoint does not activate mainnet.

## Current baseline and gaps

Current [October 2 preparation](#october-2-preparation) records guarded backend
acceptance and the focused treasury custody/signing fixes with their remaining
release and cutover gates. The historical
[October 1 evidence](./engineering/mainnet-readiness-2026-10-01.md)
pins deployed testnet source `368b278`, its canonical dependency lock and exact
integrated CI. It records public funding fallback, default-closed funding source,
actual isolated PostgreSQL four-leg acceptance and Linux provenance containment,
with their limits. It does not establish runtime enrollment or mainnet readiness.
The [September 30 evidence](./engineering/mainnet-readiness-2026-09-30.md)
retains the earlier `5bf9aea` admission-foundation checkpoint and adds the funded
original-withdrawal recovery and outside-host alert/responder acceptance below.
These advance bounded testnet evidence; M1–M8 remain open. The
[independent pilot runbook](./research-pilot-program.md) defines
the initial audience and acceptance evidence. Mainnet and profitable repeat use
remain unproven; older baseline observations below are historical.

Additional September 30 evidence: the [owner-operated funded withdrawal rehearsal](./engineering/creator-funded-withdrawal-drill.md)
passed one original Circle submission, discarded application/mint responses, exact
mint receipt matching and two new keyless recovery processes with one cash-out row
and zero payment rows. It advances the tested C2/M4 boundary only. Independent creator
and browser acceptance, unknown-UUID Circle-response recovery, release-wide outage/
restore/security evidence and mainnet authorization remain open. Its provisioning
incident also leaves durable host time synchronization as an explicit O1/M5 item.

The original 2,000-micro-USDC source payment also reached an exact matched Circle
`completed` record. Independent Arc RPC inspection found a successful receipt for
its reported batch transaction with matching block hash and 13,978 confirmations
at observation. This proves the matched Circle record and reported batch receipt;
it does not independently decode this authorization nonce from aggregated calldata.

The [outside-host monitor](./outside-host-ops-monitor.md) is deployed on Workers Free
with a dedicated durable journal and five-minute Cron. Its real fixed-404 diagnostic
confirmed both Telegram drill deliveries on their first attempts; the owner confirmed
both messages and accepted response ownership. Diagnostic notifications were then
disabled. This closes that bounded external alert/responder acceptance item. An
actual healthy five-minute production Cron sample was separately observed at
`2026-09-30T16:00:43.993Z` after the initial manual probe. Real VPS outage, failover, restore/rollback/rotation and sustained-operation drills
remain separate O1/M5 requirements.

Repository baseline: `ddcc520`. The buyer CLI, private journals, receipt verification,
redacted reports and `/research` preparation/inspection are implemented. Existing
owner-operated pilots demonstrate testnet payment and recovery on a narrow first-party
corpus. They do not establish an externally profitable service or broad research quality.

Historical testnet telemetry has incomplete usage and pricing coverage. It cannot
establish monthly profit or mainnet revenue. Usage-derived cost estimates and margins
are internal operational data; the former public snapshot is retired in v0.22.59.
Fixed operating costs, billing reconciliation and independent customer cohorts have
not been verified for this baseline.

Historical check, September 9: official documentation then listed Arc as testnet-only in
[Circle Gateway supported blockchains](https://developers.circle.com/gateway/references/supported-blockchains).
[Arc RPC documentation](https://docs.arc.io/arc/references/rpc-endpoints) then separated
testnet parameters from future mainnet parameters. It published `.arc.io` RPC
hosts at that check; the repository's older `.arc.network` configuration must be explicitly
revalidated before a network configuration change. These observations are dependency
evidence, not an announcement of a mainnet launch date.

Historical recheck, September 11: the same official Circle table still listed Arc as testnet-only
for Gateway (domain 26, no mainnet identifier), and Arc's RPC reference published
testnet parameters while reserving mainnet parameters for separate publication. M1
was therefore unproven then. No mainnet constants or service availability were inferred.

Rechecked September 28: [Arc's current connection guide](https://docs.arc.io/arc/references/connect-to-arc)
publishes mainnet chain ID `5042`, mainnet RPCs and explorer alongside testnet
`5042002`. [Circle's current Gateway table](https://developers.circle.com/gateway/references/supported-blockchains)
lists Arc domain `26` with mainnet name `arc` and testnet name `arcTestnet`; it says
nanopayments are supported except on Solana. Read-only `eth_chainId` calls to the
published Blockdaemon, dRPC, and QuickNode Arc mainnet RPCs each returned `0x13b2`
(`5042`) from the development host; the primary RPC returned HTTP 403 from that host.
This advanced external availability evidence only. Repository code and signer domains
remained pinned to testnet. The [September 29 readiness evidence](./engineering/mainnet-readiness-2026-09-29.md)
updates the published token and Gateway address evidence and records narrow read-only
code-presence observations. PR #26 (`a79e882`) subsequently upgraded the seller
SDK and pinned its testnet facilitator URL; one reported live testnet toll settled.
Mainnet contract identity, mainnet SDK behavior, Keryx registry deployment, Gateway
settlement and release acceptance remain unverified. M1 remains open.

## Product acceptance map

Each row requires code, meaningful tests and observed runtime behavior. A code path
existing is insufficient to mark the complete journey accepted.

| ID | Participant and complete journey | Current evidence | Work and acceptance still required |
| --- | --- | --- | --- |
| B1 | Buyer discovers an offer, understands price/quality limits, funds a wallet, buys and follows a research job | `/research`, shared buyer engine, [fresh owner-operated browser funding/purchase/recovery pilot](./engineering/browser-pilot-2026-09-09.md), [portable browser/CLI recovery](./engineering/portable-recovery-2026-09-09.md), and replacement-inspection code/tests (`lib/buyer/funding-replacement.ts`) | Independent wallet/mobile acceptance and real replaced/cancelled transaction and lost-funding-storage drills. Preserve caps, private identifiers and uncertainty across those paths. |
| B2 | Buyer reads answer, source decisions, evidence, spend and history; exports or deletes private local state deliberately | Buyer workspace, source-decision display, owner-scoped private history (`app/api/me/asks/route.ts`), browser receipt-integrity code/tests (`lib/browser-receipt-integrity.ts`) and redacted CLI reports | Independent fresh-session UX and portability acceptance; review private history/content access, privacy and retention limits across desktop/mobile. |
| C1 | Creator proves ownership, publishes priced/versioned content, updates/deactivates it and receives earned rewards | Registration, RSS verification, registry-authorized listing management, source/citation routes and encrypted content modules; creator and payout wallets may differ. PR #27 (`b04a9f0`) separately exposes registry-owned listing links with public fields, bounded to 12 rows per page and four concurrent timed live reads. The original `/me/sources` private alert/earnings portfolio retains cached payout/author ownership. | Fresh independent creator onboarding and an end-to-end pilot remain open. Stale nonempty URL metadata can hide a valid listing, while metadata-free large corpora need pagination across many candidates. Exercise ownership/payout updates, version changes and unavailable content; review rights/terms and retention. |
| C2 | Creator sees settled/pending earnings, receives notifications and withdraws without duplicate payment | Creator pages, withdrawal endpoints/intents, Gateway proof and notification paths; [September 30 funded operator EOA rehearsal](./engineering/creator-funded-withdrawal-drill.md) verifies original attestation/mint recovery and one cash-out ledger row | Independent creator/browser journey, unknown-UUID Circle response loss and broader withdrawal/reconciliation failure drills; key/account recovery guidance, clear costs and support ownership. No use of a transfer ID as invented chain finality. |
| D1 | External developer integrates quote/buy/resume/report and operates with bounded funds | Buyer CLI, API docs, MCP and A2A routes | Clean-machine integration by independent teams, API/version change policy, per-client limits/usage reporting and actionable support diagnostics. |
| O1 | Operator reconciles jobs, monitors quality/economics, restores service and responds to incidents | Worker, order review commands, health/proof, backups and reconciliation scripts; [off-host fixed-route alert/responder acceptance](./outside-host-ops-monitor.md) passed | Real VPS outage/failover, timed restore/rollback, sustained monitor operation, durable host time synchronization, rotation procedures and operator access review. |
| E1 | Ecosystem has repeat buyers and independently controlled useful sources | Internal sources and first-party pilot evidence | Retain the existing roadmap target of 3–5 independent buyer teams repeatedly using one valuable outcome; independently controlled creator participation and four weeks of cohort evidence. Do not substitute owner-operated volume. |

## Economics acceptance

Actual operating bills, provider invoices and realized internal profit are private.
Reconciliation below is an internal acceptance activity, not a public reporting requirement.
Do not publish those figures on the website, GitHub or Canteen without separate owner
permission. Public formulas and explicitly illustrative scenarios may remain public;
missing private cost figures remain unknown and do not block unrelated product work.

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

The [September 11 English boundary diagnostic](./engineering/research-boundaries-2026-09-11.md)
adds four fictional cases outside the Engineering corpus and two live model rounds.
The inspected prose preserved uncertainty and ignored a source instruction, but coverage
varied substantially for an unresolved conflict. This is model-only evidence, not
end-to-end research acceptance, independent review or a new confidence guarantee.

## Mainnet release gates

| Gate | Required evidence | Baseline status |
| --- | --- | --- |
| M1 Network/services | Official Arc mainnet chain/token/RPC/explorer values, Gateway nanopayment support, deployed code and SDK support verified against the intended environment | [September 29 evidence](./engineering/mainnet-readiness-2026-09-29.md): official network, token and Gateway addresses published; narrow RPC code presence observed. PR #26 (`a79e882`) upgraded SDK 3.5.0 and pinned the testnet seller facilitator URL; one live testnet toll reportedly settled. Mainnet contract identity, Keryx registry deployment, mainnet SDK and end-to-end settlement checks remain open |
| M2 Authority/isolation | Separate production configuration, deployments and keys; no cross-environment signatures/nonces/DB records; bounded user and treasury funds | Testnet authority retained; guarded SQLite/PostgreSQL factories have native candidate acceptance but remain dormant. Runtime caller integration, trusted custody history, deployment enrollment and drained cutover remain open. |
| M3 Security | Independent review of signer/session authority, contracts, x402/Gateway, registry, encrypted delivery and auth; remediated critical/high findings and documented residuals | D-272 atomic admission and retained original-epoch/signer accounting have repository code/test evidence. The [independent review packet](./independent-security-review.md) defines the candidate handoff; independent mainnet review and remediation acceptance are not demonstrated |
| M4 Settlement/recovery | Lost response, replay/concurrency, Circle/RPC outage, settled-but-undelivered and reconciliation drills; no silent pending-to-failed transitions | Focused tests and owner pilots exist; [funded withdrawal original/receipt recovery](./engineering/creator-funded-withdrawal-drill.md) passed two new keyless processes and idempotent accounting. Unknown-UUID Circle response loss and release-wide drill evidence remain open |
| M5 Operations | Restore/rollback/rotation drills, realistic capacity/load test, alert routing, funding limits and an incident owner | [Outside-host fixed-404 diagnostic](./outside-host-ops-monitor.md) passed real reads, both first-attempt Telegram deliveries and owner response acceptance; a real healthy production Cron sample was separately observed. Real VPS outage/failover, restore/rollback/rotation, sustained scheduling and durable NTP synchronization remain open |
| M6 Product/data policy | Buyer/creator journeys above accepted, private history/content access reviewed, clear pricing/refund/retention/support terms | Partial; owner-scoped private history, browser receipt-integrity code/tests and separate registry-owned listing discovery exist. Creator discovery limits and independent creator pilot, wallet UX, portability/recovery drills, privacy/retention and policy review remain open |
| M7 Economics/adoption | Cost coverage, independently initiated repeated use, measured quality and positive unit contribution with no unpriced-cost assumptions | Not established |
| M8 Launch decision | Owner reviews the concrete release, evidence dossier, funds/limits and remaining risks, then explicitly approves mainnet deployment/spend | Not requested or granted |

If external Arc services remain unavailable, build and verify the release candidate
on supported testnet rails and keep M1 open. Do not relabel that state as mainnet-ready
or silently migrate the product to another chain. Missing external evidence does not
prevent independent product, measurement or reliability work from continuing.

## Delivery sequence

### October 2 preparation

October 2 preparation baseline: `241c721f1c1930dabb97cec0260d3220c2b5e87c`
includes the reviewed guarded SQLite and PostgreSQL backend implementations from
[PR107](https://github.com/tang-vu/keryx/pull/107) and
[PR108](https://github.com/tang-vu/keryx/pull/108). Their native acceptance advances
the [closed factory boundary](enrolled-runtime-backends.md); ordinary `getDb()` and
deployed adapters still retain authority. Complete guarded caller workflows under
existing payment/observation deadlines, production provenance, paused enrollment,
backup/restore lineage and rollback rehearsal remain required before cutover.
There is no automatic migration or mainnet profile activation.

The [existing treasury custody fix](treasury-wallet-custody.md) removes runtime
generation/replacement on missing or invalid wallet state and preserves valid
legacy identity. Synthetic constructor/process evidence does not establish
exclusive key history, funded recovery, external security acceptance or M2 closure.
Its exact-head review, CI and deployed health verification remain release gates;
this dated preparation note does not claim deployment.

[Treasury transaction isolation](treasury-transaction-isolation.md) also addresses
a reproduced provider-preparation signing bypass across the server gateway,
caller-funded stdio MCP and local maintenance/demo callers, and retires the
unrestricted legacy live withdrawal lane. Existing owner-provisioned custody and
an explicit trusted merchant policy are prerequisites for the breaking MCP 0.3.0
setup; [distribution acceptance](mcp-distribution.md) remains separate from npm
publication. Synthetic keys prove refusal and retained uncertainty; they do not prove
durable cross-process funding admission, custody history, funded settlement or
independent audit. M2/M4 and the owner launch decision remain open.

Read-only production observation, October 2 at approximately 01:43 UTC: public
health reported `94cb7cc`, operational/database OK and `arcTestnet`.
`timedatectl` reported NTP enabled and synchronized; `chrony.service` was loaded,
active and enabled, with a KVM stratum-1 reference, zero reported system offset
and normal leap status. This advances current enabled-provider evidence. It does
not independently corroborate external NTP, exercise reboot/failover, change
service configuration or close M5 recovery/operations acceptance. This deployment
observation precedes the treasury-fix candidate and does not claim that fix is live.

Credential-free availability recheck, October 2 at `01:54:53.680Z`, used the
existing [read-only Arc probe](arc-mainnet-readonly-probe.md). All four RPCs
reported chain `5042` and agreed at block `0x16b3a88`, hash
`0xd4adcacc1b8bc7003ac73790e3237a52a5ce0770b706b14aa15de24f70d943cc`;
USDC reported six decimals, observed proxy/code digests matched the prior evidence
and static SDK 3.5 metadata matched. The report retained `M1_PARTIAL`,
`mainnetReady: false` and `settlementAccepted: false`. Output was observed in the
operator session, not retained as a new artifact file. This proves neither audit
identity, private registry deployment nor settlement, and accessed no wallet key
or signer. Official Arc/Circle network references were also rechecked that day;
the deployed signing profile remains testnet.

[Creator cash-out recovery](./creator-withdrawal-recovery.md) has a shared signed-request
identity and a private immutable single-admission journal in SQLite/PostgreSQL. The
September 30 [funded operator rehearsal](./engineering/creator-funded-withdrawal-drill.md)
accepted retained attestation/mint recovery and idempotent cash-out accounting. Production
withdrawal activation, independent creator/browser acceptance, unknown-UUID Circle loss
and broader release recovery remain open; C2/M4 are not complete.

Linux process acceptance now covers [active synthetic prepaid-job SIGTERM and SIGKILL](./engineering/private-worker-active-drain-2026-09-10.md)
through the production worker entrypoint, real SQLite/spool and blocked transports.
Cooperative stop preserves the queued job; crash preserves the original interrupted
claim and allocation. This advances M4/M5 without claiming live creator-payment or
systemd-under-load acceptance. Version 0.22.50 adds [operator interruption resolution](./private-interruption-resolution.md):
restore the original backup first, otherwise record a permanent new-payment fence and
an explicit owner-visible outcome. Only never-committed capacity is released. Refund/support
policy, off-site recovery and independent paid crash acceptance remain open.

Version 0.22.49 adds [sealed private-job capacity reuse](./engineering/private-treasury-release-2026-09-10.md):
return only never-committed creator budget, retaining every admitted authorization and
original execution/payment barrier. SQLite and PostgreSQL contention/recovery checks
advance O1/M4; lifetime capital replenishment and broader operational acceptance remain open.
Actual operating bills and realized profit evidence are owner-private; public formulas
and illustrative economics do not require publishing those records.

Operational evidence update (September 9): a [local SQLite snapshot restore check](./engineering/restore-drill-2026-09-09.md)
passed checksum, gzip, integrity and required-column checks. Scheduled off-site backup,
complete service/key recovery and payment-reconciliation drills remain unverified;
O1/M5 are still open.

Withdrawal operations update (September 11): the
[Linux backup/recovered-copy CLI drill](./engineering/withdrawal-backup-copy-drill-2026-09-11.md)
preserves an exact signed synthetic mint and a second pending gas admission through
WAL backup, source-path isolation, copying to a new directory and separate-process
inspection against a retained digest. A modified manifest is rejected. The real
commands and repeatable CI script exist; off-host retention, application pairing,
newer-signature reconciliation and funded restore/resume acceptance remain open.

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
did not complete and must not be recorded as accepted. A later
[v0.22.47 live owner-operated check](./engineering/private-paid-pilot-2026-09-10.md)
completed deletion, reload and recovery-only re-import without payment. Earlier
intermittent reload stalls remain undiagnosed; one pass does not close browser
reliability or independent wallet acceptance.

The [controlled reload investigation](./engineering/private-browser-reload-investigation-2026-09-10.md)
adds signed-out, signed-in, local-journal and full-Chromium comparisons. Completed series
passed, while a separate headless-shell import stalled. A successful-run trace identifies
JavaScript startup work but does not capture or explain a stalled interval. Keep the
reliability gate open; no payment/recovery code fix is inferred from these diagnostics.

Wallet startup update (v0.22.48): remote SDKs initialize for remembered connectors or
explicit wallet selection. New visitors keep injected wallet discovery without probing
every remote provider. Tests using actual wagmi actions cover manual connection, remembered
non-current connections, capability forwarding, account/disconnect events, failed setup
and retry. Saved IDs remain startup hints, never payment authorization. This is a startup
change, not evidence that earlier renderer stalls are fixed or independent wallets accepted.

1. Establish this acceptance map and the executable economics model; obtain actual
   fixed costs and provider billing data without inventing zeros.
2. Complete usable browser quote/buy/recover under the buyer's own wallet authority,
   retaining the existing CLI as an integration path. Design and review this boundary
   before introducing signing or browser persistence changes.
3. Complete creator and developer onboarding/support journeys, private history and
   economic/quality reporting. Exercise them with independent participants.
4. Reconcile measured cohort economics; improve research quality and pricing from
   those results. Report combined usage and settled payments, retaining each run's
   origin in the ledger for audit.
5. Complete security/operational drills and the mainnet configuration/deployment
   candidate. Revalidate vendor support, then present the final launch decision.

Every completed product update is tested, committed, pushed, deployed and health-
verified according to `AGENTS.md`. Completion of the
overall objective requires evidence for every acceptance area above; shipping the
calculator, a demo, or a green CI run alone is not completion.
