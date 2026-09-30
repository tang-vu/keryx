# Independent security review handoff

Status: prepared handoff, September 30, 2026. No independent audit is claimed.
This packet supports [M3 in the maintained gate map](./mainnet-delivery-plan.md).

## Candidate and reviewer

The release owner records an immutable candidate commit SHA, repository URL,
lockfile digest, deployed commit (if different), relevant configuration shape and
CI run URLs before review. The reviewer checks out that exact SHA and records the
same identifiers in the report. Any subsequent critical-path change requires a
recorded delta review before release acceptance.

Select a reviewer independent of the implementation and its internal approval.
Provide source and sanitized evidence; do not provide production keys, environment
files, bearer signatures, private journals, customer data or private chat records.

## Scope and reproducible evidence

Review SIWE/JWT and API authorization; browser co-sign/session authority, atomic
admission, original nonces and retained epoch/signer capacity; x402/Gateway exact
matching and ambiguous settlement; creator withdrawal journal, original mint and
keyless receipt recovery; SourceRegistry payout authority/contracts; encrypted
paid-content delivery, receipts and IPFS boundaries. Include failure/restart and
concurrency behavior, secret handling, accounting and migration compatibility.

Use the candidate's documented `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npm run build` and `npm run test:contracts` gates with its required Node version.
Record actual command results and candidate-pinned CI links. Existing passing
[full CI](https://github.com/tang-vu/keryx/actions/runs/36739064692) and
[Linux monitor CI](https://github.com/tang-vu/keryx/actions/runs/36739064902)
are historical supporting evidence; rerun required gates for the selected candidate.
The [funded withdrawal runbook](./engineering/creator-funded-withdrawal-drill.md)
and [outside-host acceptance](./outside-host-ops-monitor.md) state tested boundaries
and remaining unknown-UUID, clock and full-operations gaps.

Review is read-only by default. Any authorized live exercise uses isolated testnet
state, exact recipient/amount and bounded fees/gas approved before signing. Never
replay an ambiguous original authorization, retry a Circle creation POST or infer
terminal failure from absence/expiry. Mainnet and production fault injection are
outside this handoff authorization.

## Acceptance and remediation

The report gives reproducible evidence, affected SHA/files, impact, severity and
recommended remediation for each finding, plus untested assumptions and residuals.
Critical/high findings require fixes, required CI and independent verification
against the new immutable candidate; unresolved findings prevent M3 acceptance.
The owner reads back the reviewed SHA, scope, results, remediation evidence and
explicit residual decisions in the maintained gate map. Independent review does
not itself authorize mainnet launch or close other M1-M8 gates.
