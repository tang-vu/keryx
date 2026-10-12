# Specialist research: outcomes, pricing and repeat demand

Owner-approved direction, October 12, 2026: develop paid specialist research across
all three tracks below and measure accepted outcomes, independently funded repeat
orders and contribution after full direct costs. The owner selected all three;
none is an established market. This advances the existing research pilot rather
than replacing the citation-toll agent with a general assistant or another ledger.

## Three bounded outcomes

| Track | Customer hypothesis | First task scope | Buyer review |
| --- | --- | --- | --- |
| `api-platform` | Freelancers and small engineering teams | One integration decision, at most two named APIs/platforms | Constraints, source-backed trade-offs, dated prices/versions/limits, conditional recommendation and next integration check |
| `saas-competition` | Founders and small product teams | One audience/positioning question, at most two named competitors | Published facts separated from niche hypotheses; no invented revenue/demand; a specific customer experiment |
| `scholarly-literature` | Researchers and students | One narrow question, at most three papers within existing reading limits | Exact paper identities/read scopes, cited findings/limitations, conflicts, unavailable text and next search; no systematic-review claim |

`/briefs` prepares these requests and checklists in page memory. Editing a field
invalidates the prepared result and its copy confirmation. A pending copy must
finish before another copy can start; downloads retain the original request text.
Copy/download are explicit user actions. There is no automatic submission, saved
customer profile or question in a handoff URL.
The page keeps public-research privacy visible. Prepared requests can be used in
existing web, API, CLI and MCP research inputs. Local preparation is also available:

```sh
npm run research:brief -- --input brief.json
```

An input contains `track`, `decision`, `context` and `sourceLeads`, for example:

```json
{
  "track": "api-platform",
  "decision": "Compare two APIs named in our task for one integration decision.",
  "context": "Include our stack and material constraints here.",
  "sourceLeads": []
}
```

The JSON output contains a `request` for the existing Deep 1.0.0 contract and a
separate human review checklist. Submit only `request` through an existing buyer
after reviewing its quote and deliberately selecting a creator budget. The
template requests a format; it grants no richer-synthesis capability, price,
source-read evidence, spend authority, acceptance or completeness guarantee.
Current delivery/evidence gates can still return partial coverage or excerpts.
Questions retain the existing 2,000-character boundary; there is no truncation.
Starting URLs are unread leads, subject to the ordinary transport/evidence gates.

## Price from a useful outcome and complete costs

Current Quick/Deep/Monthly quotes and immutable original terms remain authoritative.
This increment does not raise their fees, create a specialist checkout, promise a
refund or silently enroll an existing buyer in new terms. The prospective
[delivery/remedy policy](research-delivery-remedy-policy.md) retains its separate
implementation and authorization gates. Paid usefulness and reconciled cost data
are needed before selecting a new offer, rather than extrapolating profit from a
token tariff, free quota or unused creator reserve.

For each track, include AI/search, infrastructure, gas/payment, human assistance,
acquisition, failures, sponsored work and other direct costs. Count collection and
refund evidence separately from creator money and protected pending obligations.
Do not reuse creator proceeds to make service-fee contribution look positive.

The local `research:pilot` evaluator reads owner-maintained private JSON. It uses
operator-entered evidence declarations, not independent invoice or receipt
verification. Its counts must be labelled as reported observations. No import
from public aggregate metrics or shared production database occurs. It does not
contact customers, suppliers, wallets or payment APIs. Start with the explicitly
illustrative empty [input template](research-pilot-template.json):

```sh
npm run research:pilot -- --input private-cohort.json
```

[A fictitious pending row](research-pilot-example.json) shows the complete job
shape; it has no payment, customer acceptance or known costs. Copy it into a
private file and replace its placeholders with audited observations. Set `basis`
to `operator-entered` for actual records. `jobCoverage:complete` needs a full
period inventory, not only rows with successful or priced output. Each job's
`directCosts` and each track's `unassignedDirectCosts` require all seven categories:
`ai`, `discovery`, `infrastructure`, `paymentAndGas`, `support`, `acquisition`,
and `other`. Use documented zero with evidence only for an actually zero cost;
leave unavailable amounts unknown. Allocate each shared expense once.

`payment` records only the service-fee component, with separate network,
settlement and funding declarations. `refunds` covers that service component;
`creatorFunds` holds the separate source/creator reserve. `origin` distinguishes
buyer-initiated work from prompted or sponsored activity. `outcome` requires
customer acceptance evidence beyond technical completion. Evidence IDs are opaque
references to records retained privately; do not put questions or identities in them.

Retain full receipts/invoices/customer identities privately for human audit.
Opaque evidence IDs alone do not certify them. Unknown costs, incomplete periods,
uncertain refunds and missing currency conversion stay unknown. Failed/cancelled
paid originals with unrefunded service money keep their delivery/remedy liability
and block contribution/planning; their costs remain in the cohort. The fee floor
is the required **retained** service fee after refunds: rounded-up cohort direct
costs per retained completed independent paid job, plus the operator's contribution
target. Gross-charge pricing remains unavailable until prospective refund/loss
assumptions and terms are chosen. This is not a live quote or realized profit. Actual USD costs and USDC
receipts need an explicit conversion basis; no exchange rate is assumed.

## Validation and next decision

1. Prepare three real, permissioned tasks per track. Confirm source suitability,
   scope, buyer's baseline method and review checklist before a purchase. These
   nine tasks are targets; no participants, funds or supplier allowance are
   provisioned by this document.
2. Review every delivered task against its agreed checklist. Record incomplete,
   rejected, revised and accepted outcomes separately, including human help and
   failures. Viewing a report or model coverage score is not acceptance.
3. Ask whether the result informed the intended decision and whether a next task
   exists. Record actual independently initiated and funded mainnet orders
   separately from sponsorship, willingness to pay, testnet and owner use.
4. Evaluate each track on its own. A buyer trying a second track does not prove
   return demand for the first; aggregate activity cannot hide a failing niche.
5. Select a value-based prospective offer only when source coverage, buyer
   acceptance, full costs and observed willingness support it. Bind explicit
   versioned scope, total fee, creator reserve, delivery/remedy terms and buyer
   consent to checkout across applicable clients before any new-price payment.

The longer-term gate remains 3–5 independent recurring buyer teams over four
weeks, useful independently controlled sources and positive service-fee-only
contribution after all relevant costs. Taxes, financing and fixed operating costs
still require separate reconciliation before an operating-profit claim. Hold or
reduce a track when evidence, quality or contribution is inadequate. No paid
experiment, outreach, subscription renewal or background schedule is authorized
by these implementation instructions; obtain the applicable participant/owner
authorization at the point of execution.

## Supported surfaces and release boundaries

| Surface | This increment |
| --- | --- |
| Web | Indexed `/briefs`, home/pricing entry links, local draft and download; existing checkout remains the payment authority |
| Source CLI | `research:brief` prepares the same request; `research:pilot` evaluates private local files; both run without loading environments or making requests |
| API | Prepared `request` fits existing Deep inputs; no route, schema, price, acceptance writer or budget change |
| Remote and stdio MCP | Existing research tools accept the prepared question; no new tool or packaged dependency; copy/request checklist is caller context |
| Desktop | Existing hosted web handoff and research task roles; no native helper, renderer bridge, custody or installer change |
| Extension and bots | Existing question/hosted handoffs; no new permissions, commands, customer contact or distributed payment authority |
| Storage, settlement, contracts | No DDL, migration, registry, merchant, nonce, reserve, signer, payout or schedule change |

App/OpenAPI candidate 0.27.62. Source CLI is delivered with this repository; a new
npm/installer version is not inferred from these web or source-CLI changes.
Verify compiled-client graph boundaries, actual required CI/review, coordinated
production deployment and deployed commit before claiming release. Synthetic
tests establish preparation and arithmetic behavior, not live research quality,
independent demand or sustainable profit.
