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

Full issue 298 remains open: prospective durable decision/budget/alternative
snapshots across all adapters; trustworthy write-time cohort classification;
expert supported-claim evaluation; bounded separately authorized counterfactual
allowances; any learning changes; complete private/legacy coverage; coordinated
distribution, hosted CI and production acceptance. This slice neither fabricates
missing history nor interprets unavailable records as zero-cost successes.

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
