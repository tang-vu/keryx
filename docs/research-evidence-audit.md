# Research evidence audit

Use `/research-audit`, linked from Decision Lab, to check local JSON in browser
memory, or use the repository command:

```sh
npm run audit:evidence -- ./private-audit-input.json
npm run audit:evidence -- ./private-audit-input.json --trust ./separately-retained-digests.json
```

The observer makes no provider, payment, database or HTTP calls. Browser inputs
are not uploaded, saved to browser storage or put in the URL. Clear data removes
the current input, trust material and result. Editing either input immediately
invalidates the result, including a delayed check. Downloads and CLI stdout can
contain private cost references; retain them in an owner-controlled local file.

The [example](research-evidence-audit-example.json) is explicitly synthetic and
offline. Its simulated payment never counts as settled source cost, and absent
provider bills remain unknown. Loading it does not run research or pay anyone.

## Prepare input from one exact report

Use `schema: keryx-evidence-audit-input-v1`, the explicit Arc network, a portable
[research receipt](research-receipts.md), optional supplied human review, cost
records and an array of captured decision-review records. Input is bounded to
1 MiB of UTF-8 JSON. Only regular filesystem files are accepted by the CLI; URL,
UNC/Win32/NT device forms and DOS device aliases refuse before open. Use an
owner-controlled local directory: the CLI does not attest OS-mounted drives or
administrator-managed filesystem redirections as local. Its help
and failures do not echo input contents, paths or credentials. Exit 0 means an
observation was produced, including unknown or mismatched comparisons; exit 1
refuses invalid input. It is not a payment certification command.

`review: null` leaves all claims unreviewed. A review binds `receiptDigest`,
`answerSha256`, `reviewerRef`, canonical UTC `reviewedAt`, and unique `claims`.
Each row contains `claimIndex`, a verdict (`supported`, `unsupported` or
`unreviewed`) and exact evidence references. A supported row must name at least
one `{sourceId, itemId, contentVersion, marker}` present in that claim's recorded
eligible excerpt and in the report's citations. Missing review rows stay
unreviewed. Coverage, model confidence and the existence of a citation cannot
replace the human verdict. A supported verdict is a supplied assessment, not an
independently authenticated expert judgment, factual guarantee or customer acceptance.

`costs` binds the same receipt digest and requires all three components: `llm`,
`search` and `other`. Each is either `{"status":"unknown"}` or, for example:

```json
{"status":"invoice-reconciled","amountMicroUsd":"1250","reference":"private-invoice-allocation-REF"}
```

`estimated` is also accepted and visibly labels the provider-cost result an
estimate. Use exact nonnegative integer **micro-USD** strings, including explicit
zero with its reference. Include every attributable provider call, search and
other operating allocation; absent coverage must stay unknown. The observer
checks declarations, not invoices or allocation completeness. One unknown
component withholds the combined provider-cost ratio; it never imputes zero.

## Counting rules

- Supported claims are unique reviewed claim indices with matching exact evidence.
  The full report claim population and every reviewed/unreviewed status remain visible.
- Source cost uses all receipt-recorded settled access and citation payments on
  the selected network. It includes uncited purchases; it does not credit a
  source just because it appeared in the answer. Operating service fees are
  excluded from creator cost and retained separately in the original receipt.
- A source-cost ratio requires a real-mode complete receipt window with its
  expected payment count matching the recorded creator plus operating rows,
  no simulation and no pending row. Legacy, incomplete and offline windows
  withhold the ratio. Settled rows need a nonempty Circle reference; duplicate
  references and mixed-network inputs refuse. Failed terminal rows are not spend.
- Each ratio is `{numeratorMicros, denominatorSupportedClaims}`. No division
  rounding is introduced. A zero denominator yields null. USD provider costs
  and USDC source costs remain distinct; testnet USDC stays testnet. No FX rate,
  gross-price margin, realized profit or per-source causal value is inferred.

The existing automatic per-report/public pooled purchase scorer still leaves
`costPerSupportedClaim` unavailable: it has no human reviews or reconciled bills.
This local observer supplies the explicitly reviewed measurement without silently
relabeling pooled data or changing source selection, pricing or rewards.

## Decision to receipt comparison

Supply existing private [captured decision-review records](engineering/decision-review-253.md)
only when you are their authorized reader. Empty `decisions` is valid for
historical receipts; missing sidecars are not reconstructed. The observer derives
a domain-separated canonical SHA-256 commitment of the immutable capture: id,
capture timestamp, engine/model, run/round/ordinal, initial model/code action,
rule, source terms, network/payee, micro-USDC terms and recorded cohort basis.
Later code projections, verdicts and payment outcomes are excluded. It never
turns that digest into admission, a signature or spending authority.

For each exact source/item/version, compare the receipt's access network/payee,
exact access amount and recorded chronology; citation amounts must remain within
the captured pool cap. A receipt-recorded settled match is separate from pending,
failed and simulated. Wrong terms are `terms-mismatch`. Repeated decisions or
multiple payment legs, external/legacy identities and missing item versions are
`ambiguous`; the portable receipt lacks payment IDs/nonces for a stronger join.
Unmatched payment rows remain counted. Neither a match nor its stated dates
independently authenticates a Circle transfer or proves pre-spend timing.

Trust is supplied **outside** the input:

```json
{
  "expectedReceiptDigest": "sha256:RETAINED_64_HEX_DIGEST",
  "expectedDecisionDigests": [{"id":"DECISION_UUID","digest":"sha256:RETAINED_64_HEX_DIGEST"}]
}
```

Replace the placeholders with independently retained values. Unknown/duplicate
decision IDs, changed captures and differing receipt digests refuse. Otherwise
the output is `self-check-only`. Independently retained digests can detect later
changes; they still do not establish an independent timestamp or authenticity.
The existing [signed export](../scripts/decision-bundle.mts) retains its separate
export-snapshot role and public-key verification. This audit adds no on-chain
anchor, continuous signed ledger or production audit key. Stronger temporal
attestation and full payment-ID linkage require a separately designed capture
and trusted retention path before claiming those properties.
