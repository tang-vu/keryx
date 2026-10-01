# Opt-in scholarly payments

October 1, 2026. This is a proposed staged extension, not an implemented paper-claim
system or a funded-pilot result. The user supports developing payments to research
authors who choose to join. DOI discovery does not enroll authors or assign money.
The [product acceptance map](mainnet-delivery-plan.md) remains authoritative.

## Authority boundaries

Keep four decisions separate: bibliographic identity, the participant's identity,
permission to distribute this exact version, and permission to receive payment.

| Evidence | What it establishes | What it cannot establish |
| --- | --- | --- |
| DOI/repository metadata | A provider's record of a work, contributors and locations | Wallet ownership, entitlement to earnings or permission to sell a PDF |
| Authenticated ORCID connection | Control of the linked ORCID account at authentication time | Independently verified authorship, all coauthor consent or distribution rights |
| SIWE and feed-control token | Wallet control and ability to publish to that feed | Copyright ownership or publisher authorization |
| Reviewed version-specific license/authorization | Documented scope of the participant's distribution permission | Authority to modify another creator's registry record |
| Creator-signed SourceRegistry record | Source payment recipients, price ceiling and active state | Legal rights or scholarly quality |
| Creator-signed content manifest | Signer and exact body, URL, bytes and version | Payout authority, license rights or peer review |
| Valid body evidence and Circle settlement | Supported citation and independently recorded payment state | That metadata-only discovery incurred a creator payment |

[Crossref documents its API as deposited scholarly metadata](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
[ORCID documents authenticated account linking through OAuth](https://info.orcid.org/documentation/integration-guide/orcid-oauth-sign-in-guidelines/).
Treating those records as identity context rather than legal or payment authority is
Keryx's proposed trust policy. Never infer a wallet from a name, affiliation, DOI,
ORCID record or a publisher domain. Never claim the publisher's PDF solely because
the claimant is named on the corresponding DOI.

## Existing reusable implementation and residuals

`/register` prepares registration through `POST /api/sources`; with the configured
registry the creator's browser submits the on-chain transaction and the indexer
projects it into the database. The wallet comes from SIWE. Existing-row adoption in
`lib/sources/pre-registry-adoption.ts` binds only a row already owned by the same
payout wallet and URL; it is not a DOI claim or ownership-transfer mechanism.

`POST /api/sources/verify` checks the wallet-bound `keryx-verify:<wallet>` token in
the source's feed. The agent excludes explicitly unverified sources. Historical
grandfathering of curated rows is not a scholarly verification policy.
`POST /api/creator/[id]/content` requires the live registry creator for registered
sources, rejects unavailable/stale content authority, verifies the signed full-text
manifest and stores encrypted content. Uploads refer to an existing ingested item.
Paper-specific rights attestations and adjudication are not implemented there.

Existing access tolls use `/api/source/[id]`; evidence-qualified citation legs use
`/api/cite/[id]`. `lib/payments/split-allocation.ts` allocates integer micro-USDC
without cumulative rounding drift. Registry allowlists constrain payment recipients;
the orchestrator currently takes split weights from the database projection.
Membership is not a proof of the correct share. A multi-author scholarly release
must verify fresh registry basis-point splits and bind the allocation snapshot, not
merely add wallets to the allowed set.

`lib/registry/payto-guard.ts` may return cached/stale authority; the citation server
retains documented database fallbacks on unavailable/unregistered authority. These
are residual trust, not scholarly guarantees. New scholarly admissions must not
inherit the legacy fallback. Fresh registered authority, active state and a matching
rights approval must be checked before every new payable intent; implementing that
gate is required before a public paid-scholarly release. The locally tested V2
revision contract is a candidate, not the deployed registry; see
[registry candidate gates](engineering/registry-v2-candidate.md).

Existing tests provide reusable coverage in `lib/sources/article-content-manifest.test.ts`,
`lib/sources/pre-registry-adoption.test.ts`, `lib/registry/payto-guard.test.ts`,
`lib/payments/split-allocation.test.ts`, `lib/agent/evidence-ledger.test.ts` and the
registry contract suites. Their presence does not demonstrate a scholarly pilot.

## Stages and concrete acceptance

### 1. Discover and cite metadata without enrollment

Keep DOI/repository observations provenance-tagged and separate from Keryx source
authority. A work can be discovered without having any payable creator. Public
discovery and metadata enrichment do not schedule rewards, create unclaimed balances
or promise retroactive payments. Open-access availability does not automatically
make a paid endpoint preferable. Metadata-only records never satisfy full-text
evidence or authorize a citation reward.

Acceptance: malicious or mistaken DOI/name/ORCID associations cannot change `payTo`,
verification or payment terms; missing metadata stays missing; distinct manuscript,
accepted-manuscript and published versions remain distinct.

### 2. Manually reviewed author/publisher opt-in

Start with an author-controlled manuscript and feed, or a publisher with documented
authority. Require a signed declaration identifying the exact manuscript version,
content hash, canonical location, role, license/permission evidence, commercial and
redistribution scope, attribution conditions, embargo dates, effective dates and
revocation contact. Record reviewer, evidence provenance, decision, rationale and
policy revision privately. Publish only a safe approval summary and applicable
license, never private agreements or OAuth tokens. A bare checkbox is insufficient
for a conflicting or ambiguous grant. Exclude unresolved cases instead of assuming
the author can distribute the version of record.

Use one registry-owned source per agreed payout policy. Register/claim only through
the existing creator-controlled path, wait for the actual indexed record, verify
feed control and upload the exact signed full text through the existing content
endpoint. Independently compare hash, manifest signer, registry creator, price and
payee. The first pilot should use one authorized recipient; multi-author splits
remain closed until participants' agreed shares and registry snapshot binding are
validated. A publisher's consent to distribute does not imply consent to bypass its
payout agreement in favor of the listed authors.

No new automatic claim UI is required for a supervised pilot. Until a persisted
rights gate is implemented, use a dedicated restricted pilot corpus/instance with
only reviewed items; pause its new paid runs before handling revocation. Do not
advertise an enforcement mechanism the current source routes do not have.

Acceptance: a reviewer can reproduce the right-to-distribute decision for the exact
bytes; participant controls enrollment and payout signing; registry projection and
content manifest match; disputed identities cannot enroll by copying metadata or
verification tokens. Complete independent security review before public exposure.

### 3. Existing-rail Arc-testnet pilot

Record a pilot sheet before running: selected manuscript versions, consenting
participants, registry identity (chain + contract + source ID), prices, payer,
per-run budget, total testnet spend ceiling, execution window, stop owner and
recovery procedure. Revalidate configured vendor/network details at execution.
Keep testnet and simulation clearly labeled. This plan authorizes no mainnet or
real-fund spend, and does not require a new custody or escrow mechanism.

Use the current access-toll plus weighted citation-reward model. Show BUY/SKIP/CACHE
rationale, cost and the selected delivery version before signing. A free public copy
remains free at its public location: an opted-in offer must not imply exclusive
access or silently convert public citation into a paid purchase. For identical
bodies available publicly and through a paid offer, preserve reader budget/choice,
record the selected access route and count evidence once. Do not grant duplicate
rewards for alias URLs or a DOI shared by multiple offers. Explicit funding for an
optional open-access citation reward is an economic-policy extension, not an implied
permission to spend the reader's budget; keep it closed until reviewed and approved.

Acceptance evidence must include a complete existing-path enrollment, signed exact
version upload, budgeted purchase, supported cited answer, durable Circle-backed
payment rows and exported [research receipt](research-receipts.md). Check payee and
amount against the admitted intent. Circle transfer IDs are not Arc transaction
hashes. Exercise wrong wallet, wrong version, changed body, no evidence, cache,
duplicate submission, insufficient balance, RPC failure, post-submit response loss,
disconnect/restart, revoked admission and one failed citation leg. Verify that answer
delivery survives an individual reward failure and that pending spend remains
reserved. Define expected traces and stop conditions before execution; record actual
results afterward rather than hardcoding achieved participant or payment counts.

### 4. Public onboarding and later economics

Build versioned rights approvals, server-side admission checks, audit retention,
dispute workflow and fresh registry policy binding before opening self-service
scholarly earnings. ORCID login is optional identity context and requires its own
OAuth security/privacy review; it must never redirect a payout wallet. New wallet
or split changes require the existing registry creator's explicit transaction and
fresh review of payment terms. Do not deploy the V2 candidate merely to satisfy this
plan without its separate integration/migration gates.

The owner must approve concrete proposed economics before introducing platform fees,
minimum payouts, optional rewards for free copies, subsidies, refunds or promises
about coauthor entitlements. Present amounts, funder, caps, failure treatment and
settlement evidence first. No unclaimed author accounts, escrow, pooled obligations
or platform custody may be added without a separately reviewed authority design.
Mainnet remains a separate release and explicit real-fund go/no-go decision.

## Proposed state, disputes and recovery

Maintain separate identity, rights and registry states. Proposed rights transitions
are `draft -> submitted -> review -> approved`, with `rejected`, `suspended`,
`expired` and `revoked` outcomes. An authenticated submitter proposes a declaration;
an authorized reviewer signs the decision; only registry-owner transactions change
registry payment authority. Effective payable status is the conjunction of approved
exact-version rights, active verified source, fresh compatible registry terms and
an admissible buyer-funded intent. Approval is not settlement.

Use immutable approval revisions and content hashes; corrections create new versions.
Bind operation IDs to participant + registry identity + item/version + declaration
revision. Repeated identical submissions return the same decision; reused IDs with
different bytes fail. Serialize approval/revocation against new intent admission.
Persist which approval and registry snapshot each admitted intent used. DOI duplicates
are review signals, not grounds for taking over another namespace or moving funds.

A credible dispute immediately suspends new paid reads/reward admissions for the
affected pilot/version while evidence is reviewed. Preserve existing receipts,
settled rows and the rights decision history. Revocation is prospective: it cannot
undo Circle settlement or cancel an authorization already exposed. Previously
admitted unknown/pending legs keep their nonce and reservation; never issue a second
authorization to replace an unresolved payment. Reconcile exact transfer evidence;
absence, expiry and timeout are not proof of failure. Only a confirmed terminal
failure releases capacity according to the existing journal policy. Any refund is
a separate explicitly authorized payment, never a fabricated reversal.

Distinguish settled-but-undelivered access from usable evidence: the debit remains
real, but the unavailable body cannot support citation rewards. Historical runs do
not acquire fabricated payouts when an author enrolls later. The application holds
the encryption master key under the existing documented testnet trust model; no
decentralized key custody is implied.

## Open release decisions

The rights-evidence standard, reviewer authority and appeal process require a concrete
policy review before public onboarding. Duplicate public/paid offer arbitration,
version-scoped suspension enforcement, fresh split snapshots, receipt approval
references and readmission after revocation require implementation and focused tests.
Existing legacy registry fallbacks and mutable V1 update races remain explicit
residuals. Keep these gates open until evidence exists; reduce pilot scope instead
of weakening authority, privacy, spend caps or validation.
