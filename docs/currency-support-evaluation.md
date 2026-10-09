# Local-currency display and EURC evaluation

Issue [#294](https://github.com/tang-vu/keryx/issues/294), evaluated October 9,
2026 against source `890b222cad6b386f067c2bd7eebe35e70d86b307`. Official
documentation was checked October 9, 2026 UTC. This completes the written
evaluation stage only; demand validation, implementation, executable quotes,
testnet transactions and production acceptance remain open.

## Recommendation and demand evidence

Stage optional local-currency **estimates** first, keeping the exact USDC amount
visible and binding. Keep EURC conversion outside research and citation settlement:
the smallest future payout experiment is a creator converting already received,
withdrawable USDC in their own wallet. Funding is a separate owner-approved
EURC-to-USDC swap followed by the existing USDC deposit and consent. Defer
merchant-managed conversion, pooled rewards and automatic swaps.

The [submission pack](tameion-submission.md#other-outside-users) records international
and Vietnamese research users, but records no currency preference, EURC-owning
buyer, euro-area creator request, failed purchase caused by denomination, or
willingness to pay a conversion fee. Geography and interface language do not
establish currency demand. #294 is a product hypothesis, not a customer survey.
The [roadmap](project-roadmap.md) prioritizes useful paid research and observed
costs; neither currency breadth nor a vendor feature count proves those outcomes.

Before transactional implementation, collect consented feedback separately from
buyers and creators: preferred display/holding currency, typical amount and
frequency, willingness to keep USDC, maximum total fee, and whether they want
wallet conversion or bank cash-out. Record the sample and missing answers; do
not publish identities/questions without consent. No outreach is performed here.
Advance a transaction pilot only with a concrete consenting participant/use case,
measured route cost and owner-approved limits. No demand threshold or commercial
price has been accepted. [Cash-out #295](https://github.com/tang-vu/keryx/issues/295)
and the [on-ramp](arc-card-onramp.md) remain distinct work.

## What current Keryx contracts allow

| Boundary | Current source authority | Currency consequence |
| --- | --- | --- |
| Selected network | [Arc profiles](../lib/arc-network-profile.ts) pin chain, USDC, Gateway contracts and 6-decimal ERC-20 / 18-decimal native gas units. | No EURC asset/profile is configured. Mainnet and historical testnet custody cannot be exchanged or relabeled. |
| Source access and rewards | [Seller](../lib/x402-server.ts) builds USDC requirements; [pinned signer](../lib/payments/pinned-arc-batch-signer.ts) rejects a foreign asset. [Citation route](../app/api/cite/[id]/route.ts) validates the source's authorized recipients and reward ceiling. | Do not substitute EURC in challenges, signatures, source prices, payees or existing receipt fields. |
| Split and exposure | [Split allocation](../lib/payments/split-allocation.ts) allocates integer micro-USDC; [session consent](research-budget-onboarding.md#signed-policy-and-compatibility) and hosted originals retain independent caps/nonces. | A display rate does not change an allocation, fund a grant, release a hold or authorize a swap. |
| Earned money and receipts | [Receipts](research-receipts.md#settlement-semantics) distinguish planned rewards from actual settled/pending/failed/simulated rows. [Withdrawal](mainnet-server-runtime.md#session-cashout-and-original-outcomes) has separate original-bound authority. | Reward settlement, Gateway withdrawal, wallet conversion and bank payout are different outcomes, each with its own proof. |
| Operator funding | [Composition](../lib/operator/gateway-funding-composition.ts) explicitly refuses execution pending enrollment/cutover. | Adding a Swap SDK cannot enable funding or become a new treasury authority. |

## Verified vendor capabilities and remaining uncertainty

These are documentary capabilities, not Keryx integration or observed liquidity.
No authenticated API, executable quote, wallet, approval, faucet, RPC or swap was
called. Revalidate contracts and installed SDK types before selecting a route.

| Capability | Official evidence checked | Implication |
| --- | --- | --- |
| EURC on Arc | [Contract reference](https://docs.arc.io/arc/references/contract-addresses) lists 6-decimal EURC: mainnet `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`; testnet `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`. | Pin token, chain and decimals independently; these addresses were not verified by a code/decimals RPC read here. USDC gas remains separate from EURC input/output. |
| App Kit Swap | [Overview](https://docs.arc.io/app-kit/swap) documents USDC/EURC on Arc, mainnet support plus the Arc-testnet exception, standalone `@circle-fin/swap-kit`, and environment-specific optional API keys/shared limits. | Candidate route for a later same-chain testnet trial. Neither Swap Kit nor App Kit is a root dependency in this baseline; installed Viem/Unified Balance adapters do not establish Swap compatibility. |
| Gateway balance | [Capability/token matrix](https://docs.arc.io/app-kit/references/supported-blockchains) identifies Unified Balance as USDC-only. | Convert outside Gateway; EURC cannot directly back a USDC research cap or current nanopayment. Other documented Bridge tokens do not change Keryx's selected Gateway contract. |
| Quote and limits | [Estimate](https://docs.arc.io/app-kit/tutorials/swap/estimate-swap-rate) returns estimated output; [slippage guide](https://docs.arc.io/app-kit/tutorials/swap/set-slippage-tolerance-or-stop-limit) documents `slippageBps`, a 300-bps default, and exact `stopLimit` taking precedence. | Never accept that default silently. Explicit minimum output, finite quote age and total-debit limits need validation against actual SDK/contract enforcement; an estimate is not a reserved rate. |
| Custody and recipient | [Same-chain quickstart](https://docs.arc.io/app-kit/quickstarts/swap-tokens-same-chain) describes server-side use and SCA approval limitations. [Recipient guide](https://docs.arc.io/app-kit/tutorials/swap/specify-recipient-address) says the signing wallet funds the swap and output can go to another same-chain address. | SDK capability does not give Keryx the creator's key or signing rights. The existing browser worker accepts research payments, not arbitrary swap transactions. No browser-supported custody solution is established here. |
| StableFX | [Circle overview](https://developers.circle.com/stablefx) describes permissioned institutional RFQ/escrow and representative-issued access. | Do not treat institutional StableFX as an anonymous retail Swap endpoint. Keryx eligibility, onboarding, prices, minimum sizes and production access are unverified; defer this route. |
| Informational rates | [Token rates](https://docs.arc.io/app-kit/tutorials/swap/get-token-rates) provides cached decimal USD prices, refresh time and omission when unavailable. [ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) are working-day informational EUR rates and discourage transaction use; its displayed currency set does not include VND. | Cached/reference rates can support labeled estimates, never settlement prices. No VND provider, commercial redistribution terms, cache policy or availability SLA has been selected. |

## Cost and amount feasibility

[Swap fees](https://docs.arc.io/app-kit/concepts/swap-fees) currently describe a
2-bps provider fee and optional custom fees. The page's introductory payer wording
and its worked deduction example are insufficient to bind Keryx's exact wallet
debit: obtain and retain actual route terms. Add no custom fee in the proposed
pilot. A rate spread, approval, gas, optional withdrawal/deposit, API/provider
plan and failed-operation recovery may add cost. Missing estimates mean unknown
cost, not zero. No all-in price, minimum swap size or successful tiny swap is
established by this evaluation.

Calculate the comparison in exact units before obtaining transaction authority:

```text
cost_usdc = provider/custom fees + spread cost against a disclosed benchmark
            + gas + required withdrawal/deposit costs + bounded recovery costs
fraction  = cost_usdc / input_usdc
```

Use only non-overlapping components: if fees/spread are already reflected in net
output, retain their breakdown but do not subtract them again. EURC fees require
their own exact units and a disclosed valuation when comparing USDC costs. A
benchmark valuation is an estimate, not an additional wallet charge.

Synthetic sensitivity, **not a quote or Keryx balance**: 2 bps of 25,000 micro-USDC
is 5 micros. If fixed gas/approval/recovery costs were 1,000 micros, those costs
alone would be 4% of a 0.025-USDC conversion. For a hypothetical 1% fixed-cost
ceiling, input would need to be at least 100,000 micros, excluding provider fees
and spread. The fee cap and actual fixed cost remain undecided. Provider rounding
and minimum size can make a one-micro reward unswappable; retain it exactly in
USDC rather than report a zero or successful EURC payout.

Converting after USDC receipt avoids changing per-citation authority and lets a
creator choose timing/amount. It does not prove conversion is economical. Pooling
creators' rewards to reduce fees would introduce custody, consent, cross-owner
accounting and withdrawal obligations; it needs a separate design and is deferred.

## Proposed contracts for later stages

**Display.** Keep USDC and a local estimate side by side. An explicit currency
preference does not infer location, identity or payout consent. Record currency
code, positive rational/decimal rate, base/quote direction, provider/link,
provider observation time, retrieval time, expiry policy and rounding. If assuming
USDC equals USD for a fiat reference, disclose that assumption; alternatively
retain the observed USDC/USD price. Neither approach guarantees redemption value.
Reject malformed, absent, future-dated or stale rates; show USDC with “estimate
unavailable,” without blocking research or hiding its binding amount. Weekend
reference rates require a disclosed calendar-aware freshness rule. Do not refresh
old receipt values in place or imply a current estimate was known at settlement.

**Creator conversion.** First settle the existing evidence-eligible reward to its
source-authorized USDC recipient. Only the verified owner of that wallet can
request a later conversion of observed available funds; planned/uncertain rewards
are ineligible. If Gateway withdrawal is needed, reconcile that original before
swapping. Prefer separate owner-wallet conversion, with no retained server key.
Selecting a browser-compatible route or explicit local signing adapter is a
prerequisite, not a promise that the server-oriented Swap SDK already supplies it.
Direct merchant EURC fulfillment in lieu of the source's USDC reward is deferred.

**Buyer conversion.** The owner reviews EURC input, minimum USDC output, total
fees/gas, expiry and destination before signing. Finalized exact output precedes
any USDC Gateway deposit; confirmed original deposit and existing consent precede
research admission. Converted funds do not expand a signed lifetime ceiling or
automatically create/renew a research budget. Refused research does not undo a
completed independent swap or create an automatic reverse conversion.

Any eventual transaction writer needs a durable owner/role/storage/network/asset
binding and original operation ID before signature exposure; exact input, maximum
debit, minimum output, fee/gas ceilings, quote/expiry, spender/allowance and recipient
must be consent-bound. Preserve transaction/signature identifiers through crashes
and lost responses. No generic SDK retry may replace an uncertain original.
Reconcile approval, swap, output delivery and deposit separately. A reverted swap
can consume gas and leave approval; a successful swap with an uncertain later step
retains actual output and the outstanding step. A balance delta alone cannot match
one swap amid concurrent activity; require finalized receipt/event provenance.

Keep integer micro-USDC as existing accounting authority and integer micro-EURC
as separate asset units. Arc's native 18-decimal gas and 6-decimal ERC-20 USDC
share one wallet balance; reserve their costs once with explicit upward unit
conversion, never by summing them as different assets. Use exact rational
arithmetic for quotes; round a required
input/fee reservation up and a guaranteed output down. Retain quotient/remainder
and actual asset deltas. Do not absorb dust, gas or FX gain/loss into citation
weights, report EURC as `settledUsdc`, or mark a creator paid twice. Proposed
conversion states and receipts need a versioned separate contract; existing
portable receipts, hashes, nonces and pending-payment recovery stay on their
original schema and rail.

## Surface audit and release gates

| Surface | Applicable later work / present boundary |
| --- | --- |
| Web | Shared optional display estimate; separate owner conversion consent and receipt. Existing research wallet worker gains no arbitrary signing scope. |
| API, A2A and OpenAI-compatible | Existing exact USDC fields remain binding. Optional estimate metadata needs an explicit additive contract; swaps must not occur as a side effect of research, polling or exports. |
| Remote and stdio MCP | Hosted role stays read-only/handoff for conversion; caller-funded stdio keeps caller custody. Quote metadata/tool-schema changes need coordinated package and compatibility checks. |
| CLI and Windows desktop | Explicit owner action through a reviewed signing boundary, or hosted handoff. Existing Operator funding remains disabled; desktop renderer gains no keys or signing rights. |
| Extension, Telegram, Discord and Slack | Optional human estimates from the shared contract only. Bot/account links and a displayed currency do not establish wallet ownership or transactional consent. |
| Contracts, adapters and distributions | Existing SourceRegistry/x402 USDC authority remains. Any conversion ledger needs both storage adapters, protected-domain enrollment, receipt/schema compatibility and applicable package/installer publication. |

No surface changes in this documentation-only outcome. The next stages are:

1. **Estimate-only candidate:** select permitted rate providers (VND remains
   open), define freshness/fallback/rounding and preference policy; test reversed
   pairs, token depeg assumption, missing/stale/weekend data, one-micro precision
   and unchanged signed/payment/receipt bytes. Validate phone-width labels and
   shared API/MCP/bot formatting; publish no automatic conversion.
2. **Offline transaction design:** select one same-chain route and owner custody
   adapter; pin audited SDK/dependency/contracts; define fee payer, minimum size,
   exact-input/output semantics, allowances, quote lifetime, slippage and recovery
   ceilings. Test foreign owner/asset/chain/recipient, expired quote, insufficient
   USDC gas, allowance overreach, output below minimum, concurrent/duplicate
   requests, crash after signing, unknown receipt and refused deposit. Require
   focused payment/auth/storage review, TypeScript/build and relevant CI.
3. **Bounded Arc-testnet proof:** separately authorize exact participant/wallet,
   operation count, test-USDC/test-EURC/gas/fee limits, expiry and stop conditions.
   Creator conversion requires one real reward and its separately owner-confirmed
   conversion to EURC, retaining original reward, withdrawal if needed, swap and
   delivered-output evidence. Buyer funding requires a separate bounded reverse
   EURC-to-USDC swap, finalized output, confirmed original Gateway deposit and
   unchanged existing-consent/cap admission, including refusal and recovery paths.
   Success in either direction does not qualify the other. Test adverse outcomes
   without reusing mainnet custody. Uncertainty stops new financial actions and
   preserves original recovery. No trial is run here.
4. **Mainnet decision:** establish participant demand, measured all-in costs and
   accepted output for each flow to be enabled, including that flow's separate
   testnet evidence; complete protected storage/custody enrollment, supported
   surface/distribution checks and separately scoped mainnet authorization. A
   testnet example or documentary mainnet support cannot satisfy these gates.

Issue294 remains open. Its written demand/cost evaluation and documentary
network-capability assessment are available; no display, swap, EURC funding or
EURC reward acceptance criterion is represented as shipped.
