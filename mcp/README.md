# Keryx MCP

## Sponsored public research (source candidate)

`ask_keryx_sponsored` runs hosted sponsored research with **no API key, buyer
wallet or funding setup**. First build the source checkout:

```sh
npm install
npm --prefix mcp run build
```

Configure your MCP client to start the resulting bundle using its absolute path:

```json
{
  "mcpServers": {
    "keryx": {
      "command": "node",
      "args": ["/absolute/path/to/keryx/mcp/dist/keryx-mcp.mjs"]
    }
  }
}
```

This configuration also works when the MCP client starts from another directory.
Explicitly consent to a public question and trial report when calling the tool:

```js
ask_keryx_sponsored({
  question: "What evidence supports sodium-ion batteries for grid storage?",
  publicReport: true,
  mode: "quick",
  budget: 0
})
```

Questions are bounded to 2,000 characters; mode is `quick` or `deep`. The optional
source budget accepts **0–0.08 USDC**, including zero, independently of model/search
operating costs. Server quotas, caps and pauses apply. No private task fields are
accepted. A timeout or disconnect may leave server work running: there are no
automatic retries or automatic paid fallbacks. Quota refusals require waiting
before a deliberate new submission. Returned payment evidence keeps planned,
pending and settled states distinct.

The separate `ask_keryx` tool remains the paid buyer path and retains its own
wallet, merchant policy and recovery requirements. This addition is a source
candidate; package publication and installed availability belong to the parent
release and are not claimed here.

The ORIGINAL268 **NEXT source candidate** adds `history_private_jobs_list`,
`history_private_jobs_detail` and `history_private_jobs_export` to both MCP
registrations. **Current published 0.4.20 does not contain these tools.** No new
package/version, artifact URL, installed availability or production delivery is
claimed. Parent review, focused checks, required CI and exact-source packed MCP
acceptance/publication remain required.

In this source checkout, the stdio registration uses an explicit `KERYX_API_KEY`
whose live server key has `history:read`. It calls only the existing HTTPS POST
`/api/me/private-jobs`, `/detail` and `/export` JSON contracts. No wallet private
key, buyer wallet, cookie, chat/client label or expected-wallet precondition grants
history ownership. The expected wallet can only refuse a mismatch. The remote
registration uses the verified request actor and original request-local history
revalidator before Db acquisition, after it and after private reading.

These are owner-private responses; an MCP desktop/agent client may retain tool
messages. List is a finite exact-payer completed-job scan; detail is an explicit
private answer read without public report/share links or automatic research/model
submission; export returns bounded JSON metadata with `complete`, `truncated`
and continuation. Own settled spend, creator rewards and paid creators remain
NULL, and missing recorded provenance stays unknown. No research, source fetch,
signer, purchase, database mutation, retry or alternate credential is used by these
tools. Existing paid tools retain their separate roles.

The source-only CLI adapter is available at `scripts/private-job-history.mts`:

```sh
node --import tsx scripts/private-job-history.mts --help
node --import tsx scripts/private-job-history.mts list --limit 25
node --import tsx scripts/private-job-history.mts detail --id 'prv_<64-lowercase-hex>'
node --import tsx scripts/private-job-history.mts export --format csv
```

The last three commands print private data for the authenticated caller. Supply
the history key through the caller's existing private environment; never paste it
into flags, URLs or a model prompt. The CLI loads no envfile and uses fixed
`https://keryx.cc`; metadata CSV protects formula-leading text. See [source roles,
UNRUN fixtures and original268 remaining gates](../docs/engineering/private-job-history268-client-surfaces-2026-10-14.md).

`evidence_procurement` prepares private missing-evidence requests, compares signed
provider quotations within an integer quote budget, checks separately signed
delivered bytes and retains explicit supporting/refuting reviews. Exported packets
can be restored and reassessed on web, API and CLI using the same contract.
This proposal tool does not contact providers, fetch sources, execute benchmarks,
purchase or reward anyone. Signed quotations confer no payout or source ownership
authority; coverage/reviews remain declarations and payment is unobserved. See
[the workflow and remaining hosted/funded gates](../docs/evidence-procurement.md).

The #276 source candidate adds optional `language: en|vi|pt|pt-BR|es` to `ask_keryx` for
human-readable presentation only. It is consumed locally after the buyer returns: it is not
added to the paid request/body/hash or forwarded as a model-language directive. Omission uses
the original question's finite selector; explicit overrides disclose that actual answer language
is unrecorded. Serving/output-limit notices share the API/remote MCP catalogue. The original
answer/excerpts, structured result, custody/recovery path, payment/settlement authority text,
canonical USDC amount and receipts stay unchanged. Package build/publication and actual delivery
remain root-owned gates; no live call is required or executed by these source checks. See
[the exact shared contract and coordinator inputs](../docs/engineering/research-presentation-language-276-2026-10-12.md).

App **0.27.60** is the next coordinated candidate for bounded ordinary optimizer
replay, presentation-only research/bot labels and default-OFF deadline observation.
The read-only idle signing correction joins this cohort after its own CI gates.
Candidate identities are stdio/package/Registry **0.4.19**, hosted MCP **0.3.17**
and Desktop **0.4.17**. The unchanged extension payload retains **0.1.4.2**.
Exact final-source CI, compiled package vectors, artifacts, publication and
deployed readback remain required; these numbers are not publication or install proof.

Production app **0.27.59 /513c6fa6** was actually delivered on October12, with
hosted MCP **0.3.16** and published npm/Registry **0.4.18**. Its compiled idle
signing fixture refused unrelated traffic and supplied no four-case acceptance;
#274 stays open until the corrected source is delivered and observed. Zotero,
privacy and deadline-observer activation retain their explicit holds. No new
schema/backfill, schedule, payment or custody authority is granted. Dated notes
below retain their original source and delivery evidence.

App0.27.58's iPhone header repair is scoped to the hosted web UI. It retains
hosted MCP0.3.15 and stdio/package/Registry0.4.17 tool contracts and identities;
existing artifacts keep their original source provenance. No new MCP package is
required by this increment. See the [surface audit and acceptance
record](../docs/engineering/iphone-header-2026-10-12.md).

The app0.27.57 coordinated candidate selects stdio/package and official Registry
**0.4.17**, with hosted MCP **0.3.15**. Current main adds local `draft_check` and
updates `evidence_draft` retained excerpts and author-written statements. Their
actual runtime inputs changed, so published0.4.16 retains its earlier delivered
source rather than representing this candidate. Both tools process caller text;
they fetch no source, call no research/provider/storage/payment path, and confer
no signing or private-history authority. Imported origin remains unverified.

Exact combined source/CI/build, the actual release bundle bound to the existing
private-tool package fixture, initialized identity, clean-consumer buyer/recovery
checks, npm/Registry integrity and actual hosted/published readback remain gates.
Desktop0.4.15 and extension0.1.4.1 retain unchanged source inputs and identities;
any fresh Desktop assets require separate readback. Candidate versions claim no
publication, installation or rollout. See the current
[surface parity](../docs/surface-parity.md) and
[distribution record](../docs/mcp-distribution.md); dated blocks below remain
historical and teaching/researcher/walkthrough holds remain explicit.

The app0.27.56 English catalogue candidate selects stdio/package and official
Registry **0.4.16**, with hosted MCP **0.3.14**. The shared reasoning, evidence
matrix and literature-workspace runtime inputs changed, requiring coordinated
package builds and publication. Existing research, payment, receipt and recovery
authority remains unchanged. Accepted combined source/CI, npm and Registry
integrity, and actual hosted/published readback are remaining delivery gates;
these candidate versions do not claim publication or deployment.

The combined app0.27.50 source candidate selects package/official Registry
**0.4.15** and hosted MCP **0.3.11** for the changed READ checkpoint graph.
Ordinary ask/recovery returns only a bounded public assertion packet with its
separately retained digest, or explicit unavailable evidence. Download/Verify on
the hosted report is entirely offline; repository CLI verification requires the
expected digest separately. Replay proves neither source facts nor payment or
settlement, and grants no read, retry, funding or signing authority. Private,
original and unsupported native records are not reconstructed or disclosed.
Full issue301, source/payment anchoring291, exact-source CI and packaged-consumer
acceptance, npm/Registry integrity and deployed/installed readback remain gates.
See [the milestone boundary](../docs/engineering/actual-read-checkpoints-301.md).

Interactive review-first research is available only in the authenticated live web
browser. `ask_keryx` refuses `reviewFirst: true` and review-mode aliases before the
buyer path; an MCP verdict cannot sign, resume, refund or spend. Private decision
reasons use the original owner's cookie-only web API, never default API-key rights.
Public aggregate counts are documented at `/api/decision-reviews/metrics` and
`/decision-reviews`; unclassified activity stays unknown and missing history is not
reconstructed. Existing paid-job/receipt recovery remains unchanged.

The coordinated app0.27.47 candidate selects package **0.4.14** and the same
official Registry descriptor, alongside hosted MCP **0.3.10** after final tool
integration. `operator_obligations_read` uses a bounded HTTPS read with explicit
`operator:read` on `KERYX_API_KEY` and exact server reader/role delegation.
It initializes no wallet and adds no research, custody or spending permission;
native history remains partial/unknown with zero safe/advisory surplus.
Existing buyer, original recovery and account-tool gates remain unchanged.
Publication, installed-client acceptance and hosted availability are separate;
see the [distribution record](https://github.com/tang-vu/keryx/blob/main/docs/mcp-distribution.md).

The issue 299 source candidate adds keyless `keryx_source_learning` with only a
registered source ID. It returns the same bounded observational source/topic
sample as the creator page and `/api/source/{id}/learning`, excluding unknown,
owner and private traffic from estimates. It does not activate live learned
selection or exploration and cannot read, sign or pay. Public tags, counts,
recorded contribution, exact rational price, descriptive uncertainty and shift
flags are explained in [the source and release gates](../docs/engineering/source-learning-299.md).

The issue 298 source candidate adds keyless `keryx_purchase_outcomes` with only
`dispatchId`. It reads a public retained report's exact-version BUY/citation/trace
payment sample; no paid read, private review, current-source backfill or learning
is executed. Recorded settlement is not revalidated. Sample/exclusion counts stay
visible; cohort, missed value and cost per supported claim remain unknown or
unmeasured. See [the source and release gates](../docs/engineering/purchase-outcomes-298.md).

The October 11 pooled purchase-outcome candidate uses the public page and GET
`/api/purchase-outcomes`; this MCP tool keeps its original per-dispatch contract.
Pooled cohorts come only from write-time records, never from the client channel.
No evaluation reader, user-budget debit or creator reward is added by that view.

The issue 286 source candidate adds keyless `keryx_public_job_ledger` (`days: 1..31`, default
7). It reads a bounded public web-dispatch transfer ledger with separate browser/treasury/
unknown/offline funding and balanced exact integer vouchers. It omits questions, customers,
private invoices and original authority. It cannot inspect private obligations, spend,
refund or calculate full profit. Shared settlement batch references remain unattributed
unless original per-leg evidence exists. Hosted availability, versioned package publication
and installation are separate release gates; this note does not claim installed delivery.

## Prior release46 distribution candidate

Release46 source candidate selects package **0.4.13** with the official Registry
descriptor at the same version. It adds local `evidence_draft`, explicit
`history:read` summaries and `profile:read` verified-identity snapshots. Account
reads remain unavailable on unsupported or sealed hosted stores; verification is
not login, payment or payout authority. Existing buyer, funding and original
recovery contracts remain unchanged. Publication, installed-client acceptance and
hosted activation are separate gates; see the
[distribution record](https://github.com/tang-vu/keryx/blob/main/docs/mcp-distribution.md).

Source candidate: `operator_obligations_read()` uses an explicit `operator:read`
`KERYX_API_KEY` belonging to the exact server-delegated reader. Server configuration
selects custody role; the caller cannot choose owner, signer or snapshot. It makes
one HTTPS private inspection call without wallet initialization/research/payment.
Native history remains partial/unknown with zero safe/advisory surplus. This does
not establish installed/published delivery or permission to move funds. See the
[contract and gates](../docs/engineering/operator-obligation-projection-258.md).

Source candidate: `history_read` reads bounded ordinary current-store summaries for
the verified `KERYX_API_KEY` wallet with explicit `history:read`. It needs no payment
signer and accepts no wallet or network selector. Search is literal and case sensitive;
cursor/filter binding and recorded funding remain explicit. Sealed storage and
unapplied RPC return unavailable. See the
[scope and release gates](https://github.com/tang-vu/keryx/blob/main/docs/engineering/personal-history-read-2026-10-09.md).
This note does not claim publication or deployed support.

Source candidate adds `deliverable_acceptance_read({id})` and
`deliverable_acceptance_submit({id,submission})` for completed ordinary prepaid
A2A originals. Configure an explicit `deliverable:read` / `deliverable:write`
`KERYX_API_KEY` for the original paying wallet and an HTTPS `KERYX_BASE_URL`.
Read first; retain `originalFingerprint`, `deliveredDigest`, current revision and
one `idempotencyKey` for the exact submission. `choice` is `accept`, `revise` or
`reject`; `reason` is optional/private and `publishState` defaults false. One
bounded bearer HTTP request records a choice or owner-review request, with no
automatic retry, signer, second charge, revision or refund execution. Following a
lost acknowledgement, read current state or replay the identical key/body. Later
explicit choices supersede current state while history remains immutable; a new
choice with `publishState:false` withdraws public consent. MCP clients may retain
messages independently. Browser-only, Monthly/private-v2 and enrolled native
originals remain unavailable. These tools grant no additional research quota,
payment, recovery or custody authority; publication and hosted activation remain
separate gates. See [the contract and limits](../docs/engineering/deliverable-acceptance-250.md).

Candidate 0.4.9 validates paid questions against the shared API's 2000-character
limit before loading custody or entering funding. `ask_keryx` advertises 3–2000
characters after trimming, using the server's JavaScript string-length convention.
Within the buyer handler, payment journals, pending funding journals and crash locks require
recovery first; MCP argument validation occurs before the handler. Recovery observes
the retained original query or transaction, without a new question or replacement
funding/payment. Publication and hosted deployment require separate verification.

Candidate0.4.8 adds keyless free `paper_lookup` before paid research. Retained
catalog is the default; repository lookup requires explicit opt-in. Exact version,
observation time and unknown metadata remain visible. See **Free paper metadata**
below. Published package and hosted deployment require separate verification.

Candidate 0.4.7 preserves explicit model output-limit diagnostics and bounded
guidance in research/recovery results. Historical 503s and token counters alone
do not establish truncation. It keeps existing paid-original polling/recovery and
spending authority. See [diagnostic scope and release gates](https://github.com/tang-vu/keryx/blob/main/docs/engineering/model-output-limits.md).

Candidate0.4.6 adds read-only `keryx_operator_status` with the shared public
business contract. Mainnet purchases explicitly request async execution and poll
only their original result for at most 90 seconds; pending/review/error outcomes
retain the existing journal for `keryx_recover`,never another debit. Existing
reasoning provenance and conservative fallback-input limits remain unchanged.
Verify release/npm acceptance for this archive before installation; publication
is separate from hosted deployment. The observations below are dated.


Keryx buys selected sources under a budget and returns a cited answer with creator-payment state.
The local stdio buyer pays the inbound x402 toll from a configured caller wallet on the independently configured Arc network.
Public production uses Arc mainnet (`eip155:5042`). Set BOTH `KERYX_NETWORK=arc`
and `NEXT_PUBLIC_KERYX_NETWORK=arc` in the MCP client's private environment before
connecting to `https://keryx.cc`; unset profiles retain the local testnet default.
See [current deployment and distribution evidence](../docs/mainnet-status.md).
A Circle settlement identifier is batching evidence, not an individual EVM transaction hash.
Testnet calls and owner-operated tests do not establish external traction or mainnet readiness.

Version 0.4.4 corrects Monthly discovery metadata for the configured Arc network.
It forwards the retained hosted answer and structured evidence. After an
accepted hosted deployment of the claim-grounding repair, evidence-bearing answers
contain qualified literal source excerpts and explicitly labelled quoted research
targets/gaps; arbitrary synthesis is withheld because marker-level support cannot prove
each assertion. High target coverage does not establish per-assertion entailment or a
complete useful synthesis: the answer retains an explicit Low/incomplete boundary.
Accepted excerpt citations remain eligible for creator rewards; paid-fetch debits,
source/version bindings and original settlement/receipt identities remain unchanged.
The coordinated economic repair accepts exact quoted micro-USDC budgets in hosted
async A2A. Remote sponsored research shares wallet/IP/global admission; creating more
keys adds no quota. The stdio caller still pays its own x402 toll and retains its own
original custody/recovery contract. Exact-source packed acceptance and publication
integrity are independent artifact gates. Check release manifests, npm integrity and
the hosted `/api/health` commit separately; a package does not switch the hosted server.

Hosted results can include `reasoningAttempts`, `reasoning.steps` and `reasoning.telemetry`.
New ordinary hosted results may also carry bounded `readCheckpoints` assertion
sidecars. The stdio buyer projects the closed packet before ask/recovery output;
unknown or private payload fields become unavailable. This projection cannot sign,
fund, pay or retry. Report Verify and `research-audit verify-actual` run offline
against a digest retained separately from the submitted sidecar. Integrity and
predicate agreement do not prove source authenticity or payment anchoring. Private,
original and native runs are not reconstructed. This source milestone has separate
coordinated publication/installer/deployment gates; existing published identities
are not evidence of its delivery.
The package forwards them and includes the recorded per-step serving summary in tool text.
For example, `decide: heuristic (degraded)` identifies local source selection even when other
steps used a model. The aggregate engine label alone does not identify each serving tier.
Older hosted responses without this metadata explicitly have unavailable per-step telemetry;
the package makes no extra inference request to reconstruct it. These fields do not change
caller funding, original payment recovery, source selection authority or evidence qualification.
Check hosted deployment and package publication separately before expecting this contract live.

## Research Monthly

Stdio 0.4.6 and the remote service expose read-only `research_monthly` discovery.
The four-request, 30-day package uses manual renewal and a 10% total-price
discount with unchanged creator caps. Failed and pending jobs retain slots.
Buy/redeem through the caller-wallet [web checkout](https://keryx.cc/research#monthly)
or shared API/Monthly CLI; existing MCP research tools remain separate jobs.
See the [Monthly guide](../docs/research-monthly.md).

## Remote MCP

The separately operated, treasury-funded remote service is `https://keryx.cc/mcp`.
It exposes `research` and `keryx_status`, applies server-side budget limits, and supports
ask-scoped API keys. The local package below has a separate caller-custody role.

```bash
codex mcp add keryx --url https://keryx.cc/mcp
```

See the repository's `docs/remote-mcp.md` for the remote trust model.

## Local stdio tools

Source candidate: `evidence_draft(draft)` assembles private manual claim assessments
and related-work quotation themes from caller-retained report excerpts and saved
Include paper records. Optional author-written theme statements are exported only
with a citation and a selected retained excerpt for every paper they name;
incomplete ones are returned as withheld. This is a local transformation: no HTTP/model/wallet/DB call,
research purchase or reward. Imported report origin and semantic support remain
unverified; names/timestamps identify user assertions only. MCP clients may retain
private tool messages. Use the [shared contract and boundaries](../docs/evidence-drafts.md).
Coordinated source/version, packaging and publication gates remain open; this
paragraph does not claim that installed clients already have the tool.

Source candidate: `draft_check(check)` compares each cited sentence of a private
passage with source text you supply and returns, per citation, a verbatim excerpt or
an explicit "no supporting passage found". It is a local deterministic wording
comparison: no HTTP/model/wallet/DB call, reference lookup, purchase or reward, and
no semantic review. A source without supplied text is reported unavailable, never
unsupported. MCP clients may retain private tool messages. Use the
[shared contract, measurements and open gates](../docs/draft-check.md). This
paragraph does not claim that installed clients already have the tool.

The issue265 source candidate adds `profile_identities_read()` for an explicit
`profile:read` key. It reads private dated ORCID/GitHub account-control links only;
it does not start OAuth, unlink an individual identity, research or pay. Complete
provider consent/individual unlink in the signed-in hosted profile page. Current
sealed production remains unavailable; combined package publication, hosted
activation and installed-client acceptance are separate gates.

Source capability: `profile_read()` and `profile_update(profile)` use an explicitly
profile-scoped `KERYX_API_KEY` to the selected HTTPS deployment. Profile ownership
comes from that key, independently of the buyer wallet; no wallet/signer is loaded
and no payment or research is submitted. `profile:write` does not imply read.
The current sealed/native production profile domain remains unavailable pending
its separate migration/acceptance. Verify coordinated package publication before
claiming these source tools are installed. See
[profile boundaries](../docs/engineering/private-profiles-2026-10-09.md).

| Tool | Behavior |
| --- | --- |
| `ask_keryx` | Buy research with an exact service fee plus creator-spend cap. Default deep mode is 0.05 + 0.05 = 0.10 USDC. Checks the independently configured seller, exact total, token and signing domain before signing. |
| `keryx_wallet_status` | Report configured caller custody and balances, or missing-custody/merchant-policy guidance. Never creates or replaces a wallet. |
| `keryx_recover` | Inspect the original saved payment or funding attempt. Performs reads; never submits another payment, approval or deposit. |

Version **0.4.0** changes local setup. Use a patched Node.js **22.23.4+ in the 22 LTS line,
24.22.1+ in the 24 LTS line, or 26.12.1 and later**.
Builds use the repository's pinned npm 11.19.0 installer. Critical consumer dependencies are
pinned to Circle x402 batching 3.5.0 and viem 2.55.19.

On October 4, 2026, public npm readback confirmed `keryx-mcp` **0.4.3** and GitHub
release `v0.26.8` provided the matching tarball from `1297d43`. For this release
target, verify 0.4.6 publication and its exact source before installing. [Distribution evidence](../docs/mainnet-status.md)
records artifact identity separately from hosted health and payment availability.

```bash
npm install keryx-mcp@0.4.6
```

Configure your MCP client to run `node /absolute/path/node_modules/keryx-mcp/dist/keryx-mcp.mjs`.
Set caller custody and the reviewed public merchant address through your client's secure local
environment configuration; do not put private keys in command-line arguments or chat.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KERYX_NETWORK` and `NEXT_PUBLIC_KERYX_NETWORK` | both unset: `arcTestnet` | Set BOTH to `arc` for a reviewed mainnet deployment, or BOTH to `arcTestnet`. Mismatched/partial configuration refuses startup; challenges and journals never select a network. |
| `KERYX_BUYER_PRIVATE_KEY` | unset | Explicit caller-owned key for the selected network; a supplied invalid key refuses operation. |
| `KERYX_WALLET_FILE` | Testnet `~/.keryx/buyer-wallet.json`; mainnet `~/.keryx/arc/buyer-wallet.json` | Alternative existing legacy JSON wallet with exactly `privateKey` and matching `address`. Missing, malformed, linked or inconsistent files refuse custody; none is repaired or overwritten. |
| `KERYX_BUYER_PAYEE` | unset | Required independently reviewed seller payout address. Obtain it from an owner-reviewed trusted record; the received 402 challenge does not supply this authority. |
| `KERYX_BASE_URL` | `https://keryx.cc` | Reviewed Keryx deployment. |
| `KERYX_PAYMENT_JOURNAL` | Beside the selected wallet: `buyer-payment.json` | Private original payment barrier; its sibling `.funding.json` tracks funding separately. |
| `KERYX_GATEWAY_DEPOSIT` | `0.5` | Bounded deposit of existing caller USDC, at most 1 USDC. |
| `KERYX_MAX_TOTAL_USDC` | `1` | Caller quote ceiling; exact fee/budget amounts require six or fewer decimal places. |
| `KERYX_RPC_URL` | Selected profile: mainnet `https://rpc.blockdaemon.mainnet.arc.io`; testnet `https://rpc.testnet.arc.network` | Endpoint attested as the selected Arc network by shared signing/funding guards. An operator-configured RPC failover is allowed; per-operation chain attestation cannot be replaced by the endpoint label. |

Call `keryx_wallet_status` first. Without a configured key/file, initialization and tool discovery
still work and status explains what is missing. Without merchant policy, status reports the caller
address and keeps readiness false. Fund that caller address with owner-authorized ERC20 USDC and native USDC gas on the selected network. The faucet is available only on testnet. There is no automatic faucet or server-treasury fallback.
A paid request can settle even if delivery fails. The creator cap is prepaid capacity, not a
promise that every cent is paid to creators; assess the returned settled and pending evidence.

## Upgrade and recovery

The mainnet default custody directory is new. Do not copy testnet funding/payment
journals into it or rename historical receipts as mainnet settlement. New v2 journals
bind the selected network; payment journals also bind the original server origin.
Unlabelled payment originals and funding v1 files remain testnet records and are
refused on mainnet before recovery I/O. Recover them with BOTH labels set to
`arcTestnet`, using their original endpoint and files. A mainnet journal is likewise
refused by a testnet process. Preserve the original bytes and custody for owner recovery.


Before upgrading from the previous 0.2.0 tarball or older 0.1.1 npm package, stop the old buyer
processes and preserve the original wallet and payment journal. Keep the same caller key and
journal paths, configure the independently reviewed merchant address, and recover original
attempts before making a new purchase. Do not replace or delete old custody to fix an error.

Each local journal admits one attempt under an exclusive filesystem lock. Payment recovery
checks the original query ID; a foreign completed response cannot clear the barrier. A retained
funding hash must match the exact caller, chain, destination, calldata, value and successful or
reverted receipt. Current Circle credit alone never proves the original transaction. An interrupted
approval or hashless attempt stays held for owner review. Completed/reverted funding history,
including original hashes, is retained before a distinct new funding admission.

Recovery may inspect an original attempt while a lock is held, but cannot overwrite that journal.
After a crash, it never steals a lock: stop all buyer processes, inspect the original transaction or
query, and have the owner determine whether the lock is stale before removing it. Do not issue a
new purchase/deposit to recover missing output. An old legacy journal can support original
GET-only inspection without a new key or merchant policy; it is not proof of environment origin.

This is local-process/restart protection, not global nonce exclusion across copied keys, alternate
journal paths or old packages that ignore the locks. Keep one authority over these private files.
Host ACLs and protection against a malicious local owner remain required. Journal readers are
bounded schema checks, not custody-file provenance proofs. File contents are flushed before
payment I/O; POSIX parent directories are flushed where supported. Windows namespace durability,
recursive-directory power-loss behavior and real host recovery still need operational acceptance.
RPC/provider honesty and independent security review remain separate gates. Mainnet
code selection grants no spending authority. Public production uses mainnet; choose
the same network explicitly in the caller profile and verify `/api/health` before use.

## Build and verify from source

```bash
npm exec -- vitest run --config mcp/vitest.config.mts
cd mcp
npm ci
npm run build
npm pack
```

The package bundles shared Keryx custody and signer guards into its executable while keeping
pinned consumer dependencies external. `mcp/scripts/test-packed.mjs` installs the tarball into an
isolated consumer and exercises actual stdio initialization, tool listing, status and synthetic
purchase/original-attempt recovery. Test transports block live payments and never use funded keys.
After the independent MCP install, also run `npm exec -- tsc --noEmit -p mcp/tsconfig.json`
from the repository root. This checks MCP and imported shared source against the MCP package's
installed viem/Circle declarations, matching the single external dependency closure used by the
bundled consumer. Run the packed acceptance with
`node mcp/scripts/test-packed.mjs /absolute/path/keryx-mcp-0.4.6.tgz /absolute/path/to/pinned/npm-cli.js`.

Mainnet purchase and original recovery require HTTPS without URL credentials or fragments. This is transport protection, not a seller host allowlist. Plain HTTP remains available for deliberate testnet local development.


### Recover residual Gateway funds

Ordinary buyer deposits belong to the configured caller EOA. Stop new purchases,
retain its original payment/funding journals and inspect any unknown attempt. If
your existing browser/hardware wallet controls that same EOA, sign in with it and
open `https://keryx.cc/me/withdrawals` on the selected deployment. The reviewed owner
withdrawal flow also accepts ordinary buyer EOAs; creator registration is not a
prerequisite. Original owner burn/mint and native gas remain explicit wallet actions.
A different wallet cannot recover the balance, and the package does not expose a
separate key-only cashout command. Keep custody protected locally; do not paste or
export private keys into chat or a web form. Preserve unknown originals rather than
repeating a burn or payment.

## Free paper metadata

`paper_lookup({query: "2005.11401v4"})` returns retained catalog bibliography with
its observation time. It works without a configured wallet, makes one GET to
Keryx's public `/api/papers` endpoint, and never runs research, reads a paper,
signs, funds or pays. Exact DOI and versioned arXiv ID/official URLs are supported.
Title/topic queries are bounded to 120 characters, exact DOI to 200.

Set `searchRepositories: true` only to explicitly send the query through Keryx
to arXiv/Crossref metadata services. This admits at most two provider requests;
there is no pagination or retry. A failed provider may leave a retained catalog
snapshot in the result; each record's observation time remains visible. Missing
DOI, peer review and withdrawal/replacement status stay unknown. Incomplete
contributor names do not establish the first author. These metadata records grant
no read, citation, payout or reward authority.

The text response includes a bibliography card, field provenance, a short reference,
and reusable BibTeX/RIS. Set `language: "fr"` or `language: "vi"` for those labels;
original titles, contributor names, identifiers and venue names keep their recorded
form. For example, `paper_lookup({query: "10.1038/s41586-021-03819-2",
searchRepositories: true, language: "fr"})` requests the exact Crossref record.
It does not fetch Nature's article or require full text to return recorded metadata.
First-author and first-three claims require a complete recorded contributor list;
missing positions, year, venue, DOI and page status remain explicit gaps. Both exports
retain metadata provenance and the exact DOI/arXiv version, and remain separate from
research citations and research evidence exports. The public HTTP JSON remains v1.
See [issue #218 scope and remaining gates](../docs/issue-218-metadata.md).

The app0.27.42 coordinated candidate also supports exact original bibliography
requests on ordinary hosted research and manual CLI surfaces, with separate
`bibliography`/`bibliographyExports` roles. This is distinct from this stdio
client's prepaid `ask_keryx` package and its free `paper_lookup` tool. Stdio0.4.11
retains optional recorded metadata/proposal/feed roles in structured responses;
they never authorize a purchase or establish scientific evidence or settlement.
Published package/Registry and hosted versions require release readbacks.

Candidate0.4.8 adds this tool; publication and hosted availability require separate
verification. Existing paid tools keep their own custody and recovery requirements.
