# Operator float evaluation

Issue [#258](https://github.com/tang-vu/keryx/issues/258), evaluated against source
`6e591603d2842e4ad5ce5327daaa4c7b6a318caa` on October 9, 2026 (Asia/Saigon).
Official documentation was read on October 8, 2026 UTC. This is an evaluation,
not an enabled treasury feature, a funded trial, or a record of current balances.

## Decision

Build a read-only, ownership-scoped obligation projection next. Reuse the existing
Operator inventory and original payment/funding journals rather than replacing
them. Stage deterministic accounting and refusal scenarios before introducing any
transaction adapter. Defer Earn deposits, USYC subscriptions, CCTP sweeps and any
new recurring executor until separate authorization and acceptance.

No demonstrated surplus, net return, eligible treasury entity, selected vault
liquidity or cross-chain revenue inventory has been established here. Useful paid
research and recovery remain the product priority in the
[roadmap](project-roadmap.md). A larger Circle integration count is not a reason
to put service obligations at risk.

## What the current source already does

| Boundary | Current authority and limit | Consequence for a projection |
| --- | --- | --- |
| Public prepaid work | [Inventory](../lib/business-operator/inventory.ts) aggregates all running orders and unexpired unused Monthly slots, retains full creator caps, and counts redeemed unfinished jobs once. [Decision](../lib/business-operator/decision.ts) checks fresh inventory, original query/lifetime caps and Gateway availability less unconfirmed exposure. | Reuse this worst-case forecast. It is not a complete balance sheet or global cross-host reservation. |
| Hosted spending | [Hosted journal](../lib/db/hosted-treasury-journal.ts) retains original signer/nonce/context and cumulative authorization exposure; only matching settlement evidence contributes to confirmed debits. Failed originals do not refund lifetime capacity. | Preserve `retained - confirmed` holds and immutable policy limits independently of observed cash. |
| Private capacity | [Capacity](../lib/db/private-treasury-capacity.ts), [summary](../lib/db/private-treasury-summary.ts) and [backing inspection](../lib/a2a/private-treasury-backing.ts) distinguish lifetime allocation, committed exposure and confirmed outflow. | Capacity is an authorization ceiling, not withdrawable money. Only sealed never-committed budget release creates reusable allocation; uncertain exposure stays held. These historical testnet contracts do not enroll mainnet authority. |
| Withdrawals | [Mainnet runtime](mainnet-server-runtime.md#session-cashout-and-original-outcomes) binds fresh availability, confirmed debits, payment liabilities, withdrawal holds and exact fees atomically. Lost responses retain original burns and unknown liabilities. | A withdrawal or exposed burn is not idle float. Preserve owner custody and exact original recovery. |
| Funding | [Funding ledger](gateway-funding-ledger.md#authority-and-immutable-terms) reserves movement and gas ceilings with one-shot crypto/send claims and original nonces/hashes. [Composition](../lib/operator/gateway-funding-composition.ts) is disabled. | Include historical funding journals in provenance and unknown exposure; do not activate the staged writer or invent enrollment. |
| Paid service and supplier holds | [Business Operator](operator-business.md) records the historical failed paid-delivery obligation; [original fulfillment](operator-original-fulfillment.md) requires distinct native completion/delivery evidence. [Finite canary](operator-canary.md) and continuation journals retain supplier allowance/exposure. | Read the actual original closure before classifying a remedy as still due. An execution-window closure alone is not proof of delivery, refund, released money or a fresh provider allowance. |

[Monthly checkout](research-monthly.md) checks one-run execution capacity; it does
not escrow every future slot or guarantee operator prefunding. The existing worker
does account for unused active slots before execution. Neither fact establishes a
reserve available for investment. Preserve source-owned payouts, creator eligibility,
paid-body commitments, original pending/settled evidence and citation reward gates.
Forecasting a creator budget does not create earned creator debt or authorize a reward.

## Ownership, buckets and a conservative forecast

Every input must bind owner, custody role, storage identity, chain/environment,
asset/address, original operation ID, observation time and evidence quality. Keep
public/private hosted signers, buyer/session deposits, creator balances and external
customer money separate. An inbound receipt is not cash in the spender's Gateway
account. Customer revenue can still back an outstanding service obligation; it is
not all profit. No pooled view transfers rights between owners or custody roles.

The proposed projection keeps the following parallel buckets. They classify claims
on cash; they do not create wallets or authorize movements.

| Bucket | Required contents | Availability rule |
| --- | --- | --- |
| Obligations | Remaining full caps for accepted queued/unfinished work and unused valid prepaid slots; admitted source/reward originals; recognized unpaid creator rewards; unresolved failed paid-delivery remedies; policy-backed refunds/withdrawals; provider commitments and unknown billing. | Protected until the governing original contract establishes completion or a valid release. No timeout, expiry, empty lookup or failed answer manufactures a refund or cancellation. |
| Operating | Owner-selected finite new-work budget, server/provider expenses due, and bounded normal transaction/recovery gas. | Spend only within current owner authority and atomic signer caps after obligations/reserve coverage. A forecast is advisory. |
| Liquid reserve floor | A separately reviewed owner policy in exact asset units, plus contingency/recovery coverage. | Immediately usable in the required payment compartment. The agent cannot lower it, roll its lifetime limit, borrow against it or count vault shares as liquid reserve. Missing policy means no investment allocation. |
| Invested / in transit / disputed | Vault shares with cost basis, quoted redemption value and separately observed withdrawal capacity; source burns awaiting destination mint; ambiguous sends, missing history or contested revenue. | Display separately. Zero contribution to immediately spendable funds until the exact original outcome and cash location are verified. |

Before calling an amount surplus, reconcile each original into one liability graph.
A prepaid creator cap may already contain its admitted source/reward legs; a Monthly
redemption becomes a job rather than a second slot. Confirmed debits are historical
outflows, not another unpaid liability. Require explicit inclusion evidence before
deducting overlapping holds from a budget. Where membership is unresolved, retain
the existing conservative full cap and holds, label possible over-reservation and
refuse investment. Never resolve uncertainty by subtracting less.

For each independently spendable compartment `c`, proposed integer arithmetic is:

```text
liquid_c       = observed finalized/available cash actually usable by this owner/role
protected_c    = deduplicated obligations + unresolved exposure + bounded gas/fees
surplus_c      = max(0, liquid_c - protected_c - reserveFloor_c - operatingBudget_c)
safeNewSpend_c = min(max(0, liquid_c - protected_c - reserveFloor_c),
                    remaining original policy capacity, reviewed new-work budget)
```

Do not subtract confirmed outflows again from a fresh cash balance. Current Gateway
availability can already reflect an uncertain debit; the current conservative
`retained - confirmed` deduction remains until original reconciliation proves its
classification. Do not count pending incoming deposits, unminted bridges, estimated
yield or marked share value in `liquid_c`. Summing cash across chains or signers does
not make it available to pay an Arc obligation today.

Use micro-USDC integers for ERC-20/payment amounts and native 18-decimal integers
for Arc gas. Native and ERC-20 USDC are views of the **same wallet balance**, not
two assets. Convert a native gas ceiling to micro-USDC by rounding up, retain its
original units, and reserve it against that same wallet cash exactly once. Other
chains' native gas and supplier micro-USD budgets remain separate currencies;
an absent bounded conversion/fee source is unknown, not zero.

The forecast should show now, before each contractual due time, and an
owner-selected finite horizon, with worst-case coverage and reason codes. Expected
arrival dates and yield belong in a separate scenario, never the solvency proof.
Missing due times are protected now. Snapshot all relevant journals and policies
consistently; stale, partial, malformed, foreign, changed or restored-unverified
history returns `unknown` and no investable surplus. A future writer needs a native
atomic reservation shared with every active writer; before/after read equality
alone is not an atomic admission fence.

Illustration only: liquid cash 1,000,000 micros, obligations/exposure 500,000,
gas/fees 10,000, reserve 200,000 and operating budget 100,000 leaves at most
190,000 micros as a candidate surplus. A 400,000-micro pending mint or vault quote
does not increase it. Unknown fees or an unreconciled old funding original make
investment refused, not a larger estimate. These are synthetic numbers, not Keryx
holdings or an accepted reserve policy.

## Current official vendor constraints

The links below establish documented interfaces and restrictions as of the UTC
reading date. No vault, wallet eligibility, fee quote, position, liquidity or
transaction was queried. Documentation examples are not runtime evidence.

| Product | Verified documentation | Evaluation |
| --- | --- | --- |
| App Kit Earn | [Earn overview](https://docs.arc.io/app-kit/earn) covers non-custodial USDC/EURC lending vault discovery/share conversion; [supported capabilities](https://docs.arc.io/app-kit/references/supported-blockchains) lists Earn on Arc with compatible adapters. [Withdrawal quickstart](https://docs.arc.io/app-kit/quickstarts/earn-withdraw) uses Arc Testnet, a selected vault, and can require share approval before redemption. | Suitable for a later bounded testnet experiment. No selected production vault, reviewed contract/curator, compatible installed SDK or successful Keryx redemption has been established. EURC does not directly cover USDC liabilities. |
| Earn preview and costs | [Preview guide](https://docs.arc.io/app-kit/tutorials/earn/preview-operations) returns share amounts, `maxWithdrawable`, fees, gas estimates and possible reduced-liquidity warnings. First-use approval can leave a later gas estimate null. [Fee guide](https://docs.arc.io/app-kit/concepts/earn-fees) describes variable vault fees, currently zero same-chain deposit/Circle withdrawal fee, withdrawal fee subject to change, and possible principal loss. | Preview expected values are not a guarantee of redemption. A missing gas estimate requires a separately validated conservative bound or refusal; a documented UI fallback is not treasury admission. Do not infer a zero total cost from a missing field. |
| USYC eligibility | [USYC overview](https://developers.circle.com/tokenized/usyc/overview) restricts access to eligible non-U.S. entities. [Circle product page](https://www.circle.com/usyc) states a $100,000 entry threshold and instant-redemption capacity. [Arc contract reference](https://docs.arc.io/arc/references/contract-addresses) explicitly requires wallet allowlisting, including Arc Testnet via Circle Support. | Defer. No entity onboarding, eligibility, allowlist role or capital authorization exists in this evaluation. Do not request onboarding or create a wallet as part of this issue. |
| USYC redemption | [Circle Help Center](https://help.circle.com/support/en/usyc-subscription-redemption-and-functionality-explained?id=kb_article_view&sysparm_article=KB0010561) documents permissioned redemption, entitlement-wide halts and finite Teller liquidity. [Pricing](https://help.circle.com/support/en/understand-usyc-pricing?id=kb_article_view&sysparm_article=KB0010576) describes business-day Oracle updates and potentially different subscription/redemption prices. | A 24/7 interface and latest reported price do not guarantee sufficient USDC at the deadline. Approval, account/receiver roles, current price age, paused state and exact Teller payout capacity must all pass; support-arranged liquidity is not present onchain cash. |
| Bridge over CCTP | [Estimate guide](https://docs.arc.io/app-kit/tutorials/bridge/estimate-costs) exposes `estimateBridge`; [Bridge fees](https://docs.arc.io/app-kit/concepts/bridge-fees) distinguishes protocol, forwarding and optional custom fees, including source-paid exact-receive routes. [CCTP fee reference](https://developers.circle.com/cctp/concepts/fees) says current Standard fee tables are zero but describes a deployment-dependent Standard fee switch. | A zero current protocol fee is not a zero-cost sweep. Pin route, supported version, source/destination contracts, speed and fee mode; refresh all terms before any future reservation. This evaluation adds no custom fee. |
| Forwarding and recovery | [Forwarding Service](https://developers.circle.com/cctp/concepts/forwarding-service) charges destination gas/service fees, requires `maxFee` to cover applicable charges and does not generally refund excess gas. [Recovery](https://docs.arc.io/app-kit/references/bridge-error-recovery) exposes approve/burn/attestation/mint step evidence and retry helpers. | Forwarding removes a normal destination signing step, not costs or recovery risk. Never treat a generic SDK retry as permission to replace an uncertain original. |
| Unified Balance | [Overview](https://docs.arc.io/app-kit/unified-balance) describes Gateway-deposited funds; [balance guide](https://docs.arc.io/app-kit/tutorials/unified-balance/check-unified-balance) returns confirmed/pending and per-depositor/per-chain details for selected sources. | Useful read-only Gateway inventory input. It is not all Operator property: EOA cash outside Gateway, vault shares, burns in transit, other owners and liabilities require separate records. Do not sum this total with the same Gateway balance again. |

Official [Arc connection details](https://docs.arc.io/arc/references/connect-to-arc)
identify mainnet chain 5042 and isolated testnet 5042002. The
[USYC address reference](https://developers.circle.com/tokenized/usyc/smart-contracts)
currently lists Arc USYC `0x8a5D989Bbb96929F689B0200f435f53dA42bF490`,
Teller `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b`, Entitlements
`0xb69ecb156Dc0028198028c501340d5367845ca72`; Arc Testnet USYC
`0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`, Teller
`0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`, Entitlements
`0xcc205224862c7641930c87679e98999d23c26113`. These are documentary references,
not configured integrations or independently observed contract code/permissions.
Reverify selected chain, asset, deployment and runtime before a future trial.
Existing Keryx profile endpoints and historical testnet receipts remain unchanged.

### Liquidity and economics admission for a future reserve trial

Keep obligations and the entire liquid floor covered even if the investment loses
all value or cannot be redeemed. Bound principal, duration, loss tolerance and
redemption lead time by owner policy. Before parking a candidate surplus, verify
the exact selected vault/Teller code and underlying route, asset/decimals, owner
share accounting, effective caller/receiver permissions, pauses, deposit limits,
actual currently accessible USDC and amount-specific withdrawal limits. Compare
the SDK quote with fresh same-block onchain reads and an exact-call simulation.
A share conversion or contract token balance alone need not reflect the liquidity
reachable through a lending vault's underlying markets.

Check deposit and the intended redemption path, including approval and gas. Refuse
if a payout limit is below the required amount, price/quote is stale, role is
unknown, the method is unsupported, liquidity warning is unresolved, or any fee is
unbounded. A successful simulation is conditional on current state; it is not a
promise about a later deadline. Schedule no investment-dependent obligation. Any
future redemption plan needs bounded lead time, escalation and independently
available recovery liquidity, with separate schedule authorization.

Compare a conservative expected return over the permitted holding period against
the **whole** round trip: approvals, deposit, redemption, any Gateway withdrawal
and redeposit needed to reach the venue/payment rail, bridges, vault fees not already
included in the rate, operational costs and a risk margin. Reject double-counted
fees and optimistic APY assumptions. Require positive net benefit above an explicit
owner threshold; no current APY or net-profit claim is made here. Economic estimates
do not relax custody, reserve or solvency gates.

### Cross-chain sweep, in-transit accounting and recovery

Sweep only finalized receipts belonging to the Operator after local obligations,
gas and reserve coverage on the source chain. The amount must be worth moving and
meet separately selected maximum absolute cost and cost/principal ratio, after
source approval/burn gas, protocol fee, forwarding or destination mint gas, later
Gateway deposit/gas and bounded recovery cost. Preserve native-token units and a
dated bounded conversion when comparing costs. Refresh the route-specific
[CCTP fee API](https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees):
`minimumFee` is basis points, whereas `forwardFee` is USDC minor units. Missing,
expired, inconsistent or unsupported fee/route terms refuse before signing.

Persist the quote/version, owner policy, exact endpoints/contracts/assets/domains,
recipient, fee payment mode, speed, gas ceilings, immutable original and lifetime
exposure before signing. `maxFee` bounds the applicable protocol/forwarding charge;
it is not a cap on every source gas transaction or the whole business cost. A
source-paid fee is an extra source debit; a destination-deducted fee reduces the
expected mint. Reserve both cases without counting a forwarded mint's gas twice.

| Proposed accounting state | Evidence and rule |
| --- | --- |
| Observed inbound cash | Finalized exact original receipt and ownership; no seller UUID alone becomes a chain transaction or deposited spender balance. |
| Prepared / uncertain submission | Reserve full original debit and fees; retain nonce, signed-hash/claim and original funding history. Unknown response cannot release cash or create a second burn. |
| Source burn finalized | Reduce source cash; book a separate in-transit claim at conservative expected net amount, retaining original burn/message/domain/recipient. Zero Arc operating capacity. |
| Attestation available / mint pending | Match the exact original message and authorized recipient. Attestation is not cash. Retain the same claim and liability holds. |
| Destination mint finalized | Match original message consumption and exact actual token/recipient/net amount and finalized receipt; move the claim to destination cash once. A later Gateway deposit is a different cash-location transition, not new revenue. |
| Partial failure / missing history | Keep immutable originals and unknown amounts protected. Keyless observation first; replacement signing, rebroadcast or re-attestation requires a separately reviewed original-bound recovery contract and applicable authority. |

The [CCTP technical guide](https://developers.circle.com/cctp/references/technical-guide)
documents message nonces, actual `feeExecuted`, attestation expiration and original
re-attestation. Expiration is not a refund or new burn authorization. Record actual
fees only after matching outcome evidence; unused estimated fee buffers are not
realized revenue. Terminal reverts retain consumed gas and lifetime exposure;
release any never-exposed cash only through the governing journal's reviewed rule.
Backups, restore fencing, historical namespace coverage and old-writer drain must
cover the new claims before any execution cutover.

## Buildable acceptance and funding gates

First implementation: a pure integer projection plus an authenticated read-only
Operator inspection. Reuse complete native inventory methods and keyless original
journal reads. It must read no private key, create no signer, approve no allowance,
make no model/search request or financial vendor write, and enable no funding
composition. Incomplete domains
remain visible as unknown; they must not be converted into a false complete total.

Deterministic acceptance should cover all of these with supplied immutable fixtures:

1. Queued source/reward caps, unused Monthly slots and redeemed jobs counted once;
   confirmed debits, original pending/failed exposure and policy ceilings retained.
2. Private allocations, failed paid-delivery remedies, valid refunds/withdrawals,
   original funding claims, supplier commitments and Arc gas fully protected.
   Owner, role, network and asset mismatches refuse aggregation.
3. Unknown/stale/changing observations, missing history, unavailable fees and reserve
   policy refuse surplus; expiry and a zero/empty vendor response release nothing.
4. Same Arc native/ERC-20 cash counted once; integer rounding conservatively covers
   gas; unsupported FX remains separate; quote/position/in-transit values never pay
   immediate liabilities.
5. Illiquid/paused/unallowlisted venue, null gas estimate and adverse quote refuse;
   total-loss/delayed-mint scenarios preserve the independently liquid floor and
   every due obligation. Restart/response-loss observes the original without effects.

These are proposed tests, not tests performed by this documentation change. Review
the exact projection and existing authority contracts before adding any writer.
The first slice is shared inspection for authenticated API, CLI and remote/stdio MCP;
web/desktop may later display the same result. Extensions and bots keep their hosted
research role and receive no treasury authority. Public Operator status must retain
its existing privacy contract. No supported surface gains a scheduler or signer here.

Before a funded testnet experiment, obtain a new finite owner authorization naming
fresh isolated custody, exact chain/asset, principal, immutable floor/obligations,
gas/fee/loss/lifetime ceilings, approved venue/contracts/recipient, deadline, recovery
authority and any schedule. Complete SDK compatibility and vendor eligibility/
allowlist checks, admitted storage/history coverage and native concurrency gates.
Do not reuse old grants, testnet keys as mainnet authority or production balances.

Then retain exact-source public/owner-reviewable evidence for an actual testnet
reserve deposit, redemption **ahead of** an admitted obligation, and refusal when
the venue cannot pay. Demonstrate complete obligations/floor coverage before and
after, actual fees, exact original receipts and restart/partial-bridge recovery;
simulations and invented transactions cannot satisfy this gate. CCTP execution is
a separate optional drill only if justified, authorized and fully accounted for.
Mainnet eligibility, custody/funding, staged funding enrollment, deployment and
scheduling each retain their separate review/authorization gates. Issue #258 remains
open; this evaluation does not claim funded acceptance or enable treasury actions.
