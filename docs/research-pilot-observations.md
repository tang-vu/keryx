# Record usefulness and second-week research pilots

The existing offline `research:pilot` evaluator can now take an optional
`requesterObservation` on each completed job. Old v1 inputs remain valid. Absence
means unmeasured, never a useful answer, rejection or zero model cost. The empty
[pilot template](research-pilot-template.json) remains illustrative with no jobs,
people, consent or paid-pilot evidence.

## Collect genuine records

The owner first identifies participants and obtains consent for private pilot
evaluation. Existing consent for a public case study does not automatically cover
a new experiment. Record consent scope/time and keep its actual original under a
private evidence reference. Recruitment text in the existing
[pilot runbook](research-pilot-program.md) is unsent; this tool does not contact
anyone, create a budget, renew an allowance or run research.

For each genuine task, record the original job, the actual network/funding and
receipt evidence, costs, failure/refund state and formal deliverable acceptance in
the existing fields. Keep sponsored, team, testnet and simulation work separate
from independently funded mainnet activity. An outside wallet is not a verified
human or a research group. Record a group association/classification only when
there is actual evidence and consent; use opaque identifiers without names/email.

After delivery, the original requester may explicitly choose Useful, Needs
revision or Unusable through the existing private feedback channel. A missing
response stays `choice: null`; payment, acceptance, a login and silence cannot
supply an opinion. Copy the original recorded `observations` object unchanged.
If it is unavailable, use `observations: null`. Duration is orchestrator completion
time, not first-token/browser latency. Model-cost bounds are partial captured-policy
USD estimates; missing usage/unpriced calls and excluded search/infrastructure/gas
remain explicit. They are never invoices or added to direct financial costs.

Do not put capability tokens, private feedback reasons, original questions, wallet
keys or full response envelopes into this input. Keep those originals under the
existing authorized private retention/access policy. This evaluator cannot recover
feedback capabilities from public report IDs or query the private opinion journal.

## Optional packet

The following shape is illustrative, not recorded consent or an actual result.
Every `ev-*` value must refer to a real owner-retained original before it is used
in an operator-entered cohort. The packet is omitted entirely without consent.

```json
{
  "requesterObservation": {
    "format": "keryx-pilot-requester-observation-v1",
    "consent": {
      "scope": "private-pilot-evaluation",
      "evidenceId": "ev-consentExample01",
      "recordedAt": "2026-11-03T09:00:00Z"
    },
    "observedAt": "2026-11-03T10:00:00Z",
    "evidenceId": "ev-observationExample01",
    "choice": null,
    "observations": null,
    "group": null,
    "fundingWallet": null
  }
}
```

For a genuine group, `group` contains `groupId` (an opaque `group-*` identifier),
`classification` (`outside`, `team` or `unknown`) and its association `evidenceId`.
All evidence references use the existing bounded `ev-*` convention. Observation
proofs cannot represent several distinct jobs. Consent must precede the observation,
which must follow the task and fall within the declared reporting period. The
schema refuses unknown private fields and contradictory known group classes.
`fundingWallet`, when established, contains an opaque `walletId` and its separate
association `evidenceId`; otherwise it is null. Buyer accounts and group IDs never
stand in for distinct funding wallets. These associations are entered evidence,
not cryptographic ownership verification, and their identifiers are not emitted.

## Run and read the private scorecard

Use a private regular UTF-8 JSON file of at most 2 MiB, under the canonical local
data root for this checkout. The command reads only that file and prints aggregate
JSON; it does not load project ENV, database, network, model or payment services.

```text
npm run research:pilot -- --input .local/private-pilot/cohort.json
```

The existing fee, refund, direct-cost, creator-reserve and contribution predicates
are unchanged. The new `requesterObservations` section reports:

- Consented observations, explicit responses, silence and jobs without observations;
  response rate and usefulness among actual responses use separate denominators.
- Recorded duration sample size, median/p95 and missing coverage. No samples give
  null statistics, not zero latency.
- Partial USD model-cost bounds, missing coverage and failed/pending/unpriced usage;
  absent or out-of-range aggregate bounds remain unavailable.
- Declared independent-buyer/sponsored/team/unknown funding slices, their network
  counts, and a separately qualified independent-mainnet slice using the original
  evaluator's funding/evidence conditions.
- Distinct reported outside groups, independently funded groups/wallets, accepted paid
  deliverables and second-week group returns. Groups are not unique people.

The original #288 targets remain three outside-funded groups, three outside
mainnet funding wallets, ten accepted deliverables and at least one group returning
in a second week. A second-week
return requires another accepted, retained independently funded task, a separately
evidenced buyer-initiated request from seven days up to (but excluding) fourteen
days after that group's first eligible listed task, and a prior acceptance before
the return request. Sponsored,
prompted, testnet, fully refunded and unclassified records cannot establish it.

Illustrative input always remains `illustrative-no-real-pilot-evidence`. Even
complete operator-entered targets are explicitly unverified assertions, not proof
of human identity, demand, realized profit or independently certified paid pilots.
Keep the input and aggregate output private; publication and participant consent
need their own authority. The November 3 owner clarification authorizes routine
reviewed/check-passing source merges. Deployment and release/publication wait for
the user's explicit command; new funding and autonomous operation retain their
existing separate authority gates. No actual pilot participants or evaluation
consent have been provided for this source work.
