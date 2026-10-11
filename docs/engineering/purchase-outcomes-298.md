# Recorded purchase outcomes — issue 298

## Source design and authority

This independently reviewable slice projects a public dispatch's retained BUY
decisions, exact item/version citations, and payment observations stored in its
trace. It reuses the pure research-audit scorer. The original query, answer,
receipt, payment ledger, private decision-review sidecars, and current source
catalogue are not rewritten or joined. No provider, paid read, signing, learning,
counterfactual execution, or new storage capability is introduced.

The existing permalink's public-by-design role and `publicQueryRun` redaction
remain authoritative. `resolveDispatch` selects current or archived records;
it does not attest public provenance or participant identity. Current-storage
failures remain terminal, with archive fallback only for an actually missing
current record. A frozen archive keeps its original network, capture timestamp,
source commit and database digest. Recorded settled rows are bookkeeping
observations, not a new Circle/chain verification or proof of independent use.
The output omits customer questions, reasons, wallets, authorizations and nonces.

One real public retained testnet dispatch supplies the positive input contract:
`fe7c06fd-65da-41a6-867c-0597a63304df`, captured on October 3, 2026. A bounded,
unauthenticated October 9 read had SHA-256
`2dd22294582fde9de0f70db23f2e60d95e28b4e80e877b83663bd5c75766d0b0`.
Its trace contains an exact item/version access payment for a BUY with predicted
value 0.136 and 2,000 micro-USDC recorded settled access; it has no exact-version
citation. The successful pure-score feasibility receipt is retained outside Git.
A minimized fixture will retain only scorer inputs, with this provenance.

## Product and surface ownership

The shared bounded projector/validator feeds a report panel, public read-only
API, offline JSON-file CLI and hosted/stdio public-read MCP tool. Tool inventories
and OpenAPI additions preserve existing role contracts. Desktop and browser
extension consumers use the hosted public report; bots keep their answer role.
Private, queued and A2A jobs gain no new public visibility or review action.

Coverage is explicitly a partial retained trace sample, not a complete ledger;
absence of a payment observation does not prove no payment happened. The report
counts unique exact-version BUYs with matching recorded settled
access payments. It shows scored, unscored and excluded counts, citation hit
rate and calibration sample sizes. Citation occurrence is an observed outcome,
not expert-supported value or a validated probability. Uncited access cost is
descriptive, not causal regret. Missing historical participant classification
stays unknown. Cost per supported claim, missed value and alternative/budget
comparisons remain unmeasured.

Issue 250 owns an additive deliverable-acceptance control in the dispatch page.
The outcome panel is integrated after its actual merge at `a2b2b204`, preserving
that control, all additive tools/scopes and coordinated version identities.
No other active worktree, root handoff, release or identity source is edited.

## Acceptance and remaining gates

Source qualification requires meaningful projection/privacy/failure and adapter
tests, both TypeScript graphs, scoped lint, the literal-copy guard, an exact-source
physical-dependency default Next build, actual built API/UI evidence, independent
review and a coherent PR. Reuse unchanged pinned dependency inputs with recorded
provenance; preserve the shared physical backing. No version or deployment claim
follows from source checks. The explicit Keryx October 4 workflow pilot applies;
quality and release gates remain authoritative, savings are not measured.

The original retained-report slice left prospective planning inputs and public
pooled scores open. The October 11 increment below implements those parts; full
issue 298 remains open for the explicitly stated remaining gates. Neither slice
fabricates missing history or interprets unavailable records as zero-cost success.

## Use the bounded read-only view

Open an existing public report and expand its scored observations. The JSON view
is `GET /api/dispatch/{id}/purchase-outcomes`, with optional `?download=1`.
Hosted and packaged MCP expose `keryx_purchase_outcomes` with only `dispatchId`;
it is a keyless public read, without a private journal or paid-read fallback.
The hosted API enforces the existing public permalink/redaction role; local JSON
validation alone does not authenticate an imported file or prove its origin.

For a saved public dispatch JSON response (not a receipt-only export):

```sh
npm run inspect:purchase-outcomes -- report.json --network eip155:5042
```

The offline-file CLI makes no HTTP requests and loads no environment files.
An archive's recorded network takes precedence; the flag selects only unarchived
inputs. Collections are bounded to 512 decisions/citations/trace rows, input to
1 MiB and the shared portable traversal limits. Unsupported/malformed or
conflicting exact identities refuse; legacy BUYs without complete item/version
identity are unscored. A reused source/asset ID with ambiguous exact versions
refuses rather than attaching the wrong version. No current catalogue repairs it.

## October 11 prospective planning and pooled scores

Every row in the ordinary runner's initial finalized planning ledger now has a
versioned `Decision.basis`: planned action, closed deciding rule, exact quoted
micro-USDC price, fetch cap, remaining planned fetch budget, and the strongest
candidate on the opposite side of the portfolio boundary (or null). Expected
value and the readable reason remain the existing structured decision fields.
Only positive proposals rejected by the portfolio count as an alternative to a
selected read; discovery-only external listings cannot become that alternative.
This is a code-selected comparison, not a claim about an unrecorded model thought.
The remaining budget subtracts earlier planned BUYs in ledger order; it is not
actual settled spend. CACHE does not reserve an access toll. Unrepresentable
quotes stay null, and a later unknown reservation makes the planned balance null.
Funding, review or sufficiency SKIPs keep the original plan unchanged.

Both actual adapters already retain the decision JSON. An isolated round-trip
fixture exercises SQLite and the installed Supabase adapter with intercepted
synthetic transport, including unchanged legacy records. No schema migration,
shared DDL, new signer or payment-authority cutover is introduced. Existing
reevaluation recommendations remain separate trace/private-review events: this
field does not pretend their new budget, alternative or predicted value was
recorded. A gap read whose original row stays SKIP is outside the settled-BUY
scorer. Complete dynamic replanning capture and scoring remain an acceptance gap.

`/purchase-outcomes` and `GET /api/purchase-outcomes` pool the existing exact-version
scorer over the newest 100 runs per recorded cohort in one network and UTC
interval. The page states each measure's rule, interval, complete-window run
count, sampled count, actual sample span and unscorable count. It separates
outside, team, scripted and unknown without inferring an actor from the channel.
The existing bounded public-usage store supplies classification and history;
unavailable profiles withhold every figure. A five-minute in-process cache shares
a build between viewers, with its original `until` timestamp visible. The API
remains no-store. Private questions, wallets, source IDs and reasons are absent
from the aggregate. Unanswered/malformed runs count as unscorable; pending,
simulated, failed and legacy unmatchable payments cannot become settled purchases.

Five equal predicted-value bands retain purchase/citation counts, mean prediction
and citation rate. The pooled gap is the sample-weighted mean absolute difference
between each nonempty band's prediction and citation rate. It describes recorded
use; it is neither expert usefulness nor a validated probability. Missed value,
cost per supported claim and question-type splits remain explicitly null. No
question taxonomy or semantic review is inferred from private prose.

## Evaluation scaffold and release comparison

The detached `bounded-skip-sample-v1` helper deterministically samples at most
eight unread exact-version SKIPs under a caller-supplied fixed evaluation pool.
It snapshots and checks all declared rows, duplicate identities, allowance and
planned totals before invoking a reader. Hash ordering avoids selection by model
score; a binding allowance favors affordable candidates, and the omission count
is retained. Single-use reservations conserve exact micro-USDC; unknown failed
reads consume their reservations and cannot fall back to user money.

This is an accounting scaffold with synthetic transport tests, not a deployed
evaluation payment rail. Its frozen reservation is not a signature or a funded
wallet. The helper has no user-budget, Gateway, provider or creator-reward imports
and supplies none to the callback; an authorized real reader must separately
prove that it holds only evaluation funding. That transport, fixed authorized
funding, retained outcomes and missed-value assessment remain gated. It is not
called by research, a background process or a schedule, and it issues no rewards.

The offline command compares saved aggregate files for one selected cohort and
network. Every margin and minimum sample is explicit:

```sh
npm run check:purchase-regression -- baseline.json candidate.json --cohort outside --max-hit-rate-drop 0.05 --max-calibration-gap-rise 0.05 --min-scored 20
```

The values above illustrate syntax, not accepted release margins. Exit 0 means
pass under the supplied policy, 1 flags a worsening beyond that policy, 2 means
the sample cannot be evaluated and 3 refuses malformed inputs. Local file reads
are bounded to 1 MiB; no environment, HTTP, DB, agent, provider or wallet graph is
reachable. Files need separately trusted provenance and comparable workload;
schema/derived-figure checks do not authenticate an imported aggregate. Agreed
baseline/corpus, margins and integration into the pre-deployment gate remain open.

## Coordinated surfaces and qualification

| Surface | Increment and intentional boundary |
| --- | --- |
| Web/public API | Report links the pooled page; validated public GET shares its scorer and OpenAPI contract. |
| Ordinary CLI/HTTP/MCP/bots | Calls into the shared ordinary runner retain the new initial basis. They gain no counterfactual read or ranking change. |
| Remote and packaged stdio MCP | Existing `keryx_purchase_outcomes` stays a bounded per-dispatch public read; pooled observation uses the public page/API, with no new private capability. |
| Desktop/extensions | Hosted report consumers follow its pooled link; native payer-bound tasks keep their existing private role and never expose a private original in the aggregate. |
| Private workers/Operator | Initial ordinary-engine decisions can retain the basis in their private original; no new public enumeration, signer or settlement authority. |

Focused qualification covers plan preservation across the existing runner corpus,
malformed amounts, both adapter round trips, exact-version pooled score/privacy
and failure paths, explicit comparator exit codes, sample-total validation and
asynchronous sample mutation. Rendering checks cover counting rules, selected
network units, GET-only controls and withheld error figures. The local default
build is blocked before compilation by the existing external dependency junction;
required hosted default production build, independent review, actual built-browser
qualification and coordinated distribution/delivery stay release gates. No source
test establishes production acceptance or synchronized installed versions.
