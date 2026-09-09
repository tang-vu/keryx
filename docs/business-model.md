# Keryx business model and scenario calculator

The browser calculator at `/economics` uses the same arithmetic and validation as the
CLI. It offers editable assumptions, side-by-side contribution/break-even views and
local input/report JSON exports. Import the inputs file to continue a saved scenario;
the report also includes the results. Values are held in page memory, not sent to an
API or persisted automatically. Invalid edits hide previous results; blank optional
inputs remain unknown. Fees in the initial template are illustrative, not live offers.

The current product sells a fixed-price research package: a service fee plus a
creator budget. Source access and citation rewards consume that budget; they are
not a second service fee. The existing fixed-price policy retains unused reserve
without an automatic refund. A viable business must still deliver useful research
and pay eligible creators; withholding useful reads is not a pricing strategy.

The calculator is an executable planning model, separate from the
[testnet economics observer](./testnet-economics.md). It does not import testnet
volume, fetch exchange rates, change offers or authorize payments. Every amount is
a user-supplied USD estimate. Convert any USDC-denominated inputs explicitly before
using it; parity must not be mistaken for a measured exchange rate.

## Formulas

Let `N` be paid jobs per month, `F` the service fee per job, `B` the creator budget,
`C` expected creator spend, `V` variable operating cost per job, and `K` fixed plus
customer-acquisition costs per month. All monetary inputs use the same USD basis.

| Quantity | Formula |
| --- | --- |
| Modeled package receipts | `N × (F + B)` |
| Service-fee component | `N × F` |
| Creator payments | `N × C` |
| Unused creator budget | `N × (B − C)` |
| Service-fee-only contribution per job | `F − V` |
| Service-fee-only operating result before tax | `N × (F − V) − K` |
| Fixed-package retention contribution per job | `F + B − C − V` |
| Fixed-package retention operating result before tax | `N × (F + B − C − V) − K` |
| Break-even jobs, for positive contribution `M` | `ceil(K / M)` |

`V` includes LLM calls, variable infrastructure, payment/gas, support and expected
refund/loss costs. Include retries, unsuccessful paid work and sponsored usage in
the appropriate costs rather than calculating only successful jobs. `K` includes
fixed operating costs and acquisition spend. Do not count the same cost in both.
The outputs exclude taxes and financing and do not determine accounting recognition.
Package receipts are not automatically recognized revenue or realized profit.

The two contribution cases are shown separately so retained creator reserve cannot
hide an unviable service fee. They are alternative views, not numbers to add together.
Creator spend is subtracted only once in the fixed-package view. Pending obligations
must not be entered as available unused reserve.

## Run locally

```bash
npm run economics:plan -- --input docs/business-scenario-template.json
```

For machine-readable JSON without npm's command banner, call
`node --import tsx scripts/plan-business.mts --input scenario.json` directly.

The template intentionally leaves demand, spend and costs unknown. It is illustrative,
not a forecast. Replace inputs with your own estimates and set `basis` to
`operator-estimate`. Decimal strings allow at most six places; enter an explicit
`"0"` only for a genuinely zero cost and `null` for an unknown cost. All cost fields
are required. Output money is an exact six-place decimal string, computed using
integer micro-dollars, and break-even volume is rounded upward without floating-point
money arithmetic. Invalid/negative amounts, fractional job counts and creator spend
over the creator budget are refused.

An unknown variable cost makes contribution and operating result unknown. Missing
fixed costs still allow a known per-job contribution but not monthly profit or
break-even. Unknown creator spend prevents the retention scenario while leaving
the service-fee-only case computable. Missing volume prevents monthly receipts/results;
it does not prevent calculating a break-even volume from otherwise complete inputs.
Zero/negative contribution has no positive-contribution break-even calculation.

## From scenario to measured business

Do not populate this model with the average of only priced runs when other provider
calls are unpriced. The September 9 observer baseline had 290 unpriced runs out of
306 sampled runs, primarily `mimo-v2.5`. Model billing identity, effective prices and
invoice reconciliation are required before treating that corpus as complete costs.
Fixed operating costs have been requested from the owner and remain unknown.

Next measurement work is per-period/per-package independent cohorts, exact service
fee collections versus creator obligations, complete model/support costs and repeat
buyer outcomes. See [the full delivery and mainnet acceptance plan](./mainnet-delivery-plan.md).

## Browser verification (September 9, 2026)

The 13 pure-model tests pass. `npm run test:business-calculator` renders the actual
React component in Chromium and checks the two alternative margins, exact break-even,
unknown demand/costs, invalid edits suppressing stale results, input/report downloads,
validated import, failed import preserving existing values and reset. Its HTTP is
intercepted; the component makes no data or payment request. The same check passes
with production CSS at 390px and 1440px without horizontal overflow.

A local Next production build and browser smoke check passed hydration, scenario
editing, report download and those viewport widths. The desktop rendering was
visually inspected. These checks validate the tool, not the supplied economic
assumptions or a measured profitable business.
