# Supervised scholarly pilot review

October 2, 2026. This procedure governs the implemented Arc-testnet pilot in
[paid scholarly papers](paid-scholarly-papers.md). It is a distribution-permission
review, not legal advice, peer review, identity certification or a settlement claim.
Broader public/mainnet onboarding and a live funded scholarly pilot remain unaccepted.

Ordinary SQLite startup preserves the pinned enrolled/native schema. The first
authenticated scholarly enrollment installs its capability tables, retained source
marker and journal fences in the same writer transaction. A corpus with this
capability cannot enter enrolled/native storage until a separately reviewed parity
migration; unrelated ordinary corpora retain their existing intake compatibility.

Reproduce software checks with `npx vitest run lib/db/scholarly-rights.test.ts
lib/api/scholarly-rights-route.test.ts`, `npm run test:browser-scholarly-rights`
and `npm run test:browser-research-ux`. The dedicated creator browser fixture also
runs in the existing CI browser stage. Fixtures use synthetic HTTP/wallets and never
reach creator settlement routes.

## Explicit operator authority

`KERYX_SCHOLARLY_REVIEWERS` is a comma-separated public wallet allowlist, separate
from `KERYX_DEV_WALLETS`. Empty/malformed configuration blocks approval and paid
activation. A reviewer wallet cannot approve a declaration by that same wallet.
The assigned human operator must independently evaluate the claimant's evidence;
different wallet addresses alone do not prove independent people or copyright rights.
No SIWE role, name, DOI or feed token assigns this authority.

The user authorized creation of a separate local reviewer wallet. Its private key
belongs only in the operator machine's ignored `.env.local` as
`KERYX_SCHOLARLY_REVIEWER_PRIVATE_KEY`. Production receives only the public allowlist.
Never upload the private key, put it in `NEXT_PUBLIC_*`, commit it, display it in logs
or fund it automatically. Review signatures are off-chain and require no USDC.
This key cannot alter a creator's SourceRegistry record or sign reader payments.

Every decision is an explicit artifact signed over the declaration ID, previous
decision ID, reviewer, outcome, evidence provenance, rationale, public summary,
policy revision, review time and nonce. The declaration ID binds the creator's
deployment/chain/registry/source/item/version/body/manifest and permission statement.
There is no public administrative endpoint. The CLI does not approve by default.

## Evidence standard: supervised-testnet-v1

Inspect the creator's exact signed declaration and independently supplied exact UTF-8
manuscript bytes. Compare SHA-256 and byte count with the uploaded manifest/declaration;
compare canonical location and manuscript version. Do not substitute bibliographic
metadata, an abstract or a different PDF. Resolve the participant's distribution role
and permission grant for that exact version, including commercial access, redistribution
scope, attribution, embargo, effective/expiry dates and any coauthor/publisher restrictions.

Use an identifiable license/authorization record with provenance, scope and date;
record what was actually inspected and why it supports the decision. A checkbox or
author name alone is insufficient. Resolve conflicts independently; reject ambiguous
permission, unclear commercial grants, mismatched bytes, missing consent or disputed
identity instead of assuming ownership. Publisher authorization to distribute does
not itself authorize paying someone outside the agreed payout policy. Private evidence
references are never fetched automatically by Keryx or logged by the CLI.

The public license field and safe summary must be suitable for disclosure. Keep private
agreements, permission references and revocation contact out of the public summary.
Fresh registry creator/recipient/list-price and exact single-author policy are separately
verified on application and every new payment admission. An approval cannot rewrite them.
Duplicate DOI/body/location submissions are review signals; only another effective
approved offer blocks duplicate paid activation. A DOI claim cannot occupy a namespace.

Four effective approvals bound this supervised pilot. Unreviewed drafts/submissions do
not occupy approval slots. Suspend an existing approval before admitting a fifth; reject
or resolve conflicting paid versions without taking over another source or moving funds.

## Inspect, sign, apply

From the repository that holds the application SQLite database:

```powershell
npm run scholarly:review -- inspect <source-id> data/scholarly-review/private-report.json
```

The report is private, contains the signed creator declaration and latest review, and
must remain in ignored operator storage. Output files are created exclusively, so an
existing file is never silently overwritten. Inspecting may initialize the ordinary
SQLite adapter's existing startup schema; it never signs, pays or fetches evidence.

Prepare an unsigned JSON object using the exact `declarationId` and
`previousDecisionId` from that report:

```json
{
  "protocol": "keryx-scholarly-review-v1",
  "declarationId": "<0x plus 64 hex digits>",
  "previousDecisionId": null,
  "reviewer": "<public reviewer address>",
  "outcome": "approved",
  "policyRevision": "supervised-testnet-v1",
  "evidence": "<private evidence provenance and records actually inspected>",
  "rationale": "<reason exact-version commercial distribution is or is not authorized>",
  "publicSummary": "<safe version-specific decision summary>",
  "reviewedAt": "<current ISO-8601 timestamp>",
  "nonce": "<new cryptographically random 32-byte hex operation ID>"
}
```

Choose `approved`, `rejected`, `suspended` or `revoked` after review. Revisions must
include the latest decision ID, rather than resetting it to null. Never insert secret
values into evidence/rationale. The signing machine has the local key and allowlist:

```powershell
npm run scholarly:review -- sign data/scholarly-review/unsigned.json data/scholarly-review/signed.json <declaration-id>
```

Signing confirms the explicit artifact and exact declaration ID; it does not apply it.
Transfer only the signed decision artifact to the application host, then apply with its
public allowlist configured:

```powershell
npm run scholarly:review -- apply data/scholarly-review/signed.json <declaration-id>
```

Artifacts must be applied within 24 hours of signing. Identical accepted operations
are read-only replays even after that import window; changed data under the same nonce
is refused. Concurrent decisions based on superseded history are refused. All stored
rights revisions, decisions and admissions are append-only. A revoked declaration
requires a new signed creator revision and fresh review before reactivation.

`npm run scholarly:review` explicitly loads that repository's ignored `.env.local`.
For an operator machine signing an artifact from a remote database, use the sign
command there and run apply on the host; do not copy the local environment or key.
Supabase and enrolled native backends refuse scholarly operations. Complete rights
history must accompany a whole-database backup/restore; standalone source import is
refused for marked scholarly sources.

## Dispute and live-pilot gates

On a credible dispute, sign/apply `suspended` immediately, preserve the original
evidence and receipts, then investigate and record a new decision. Revocation blocks
new admissions prospectively; already exposed authorizations retain their original
snapshot/nonce and reservation. Unchanged content and fresh compatible registry terms
remain necessary for seller settlement. Unknown Circle outcomes remain pending. Do not
issue replacement authorizations or infer failure from expiry, silence or an empty search.
Any refund requires separately authorized payment; this procedure provides no reversal.

Before a live pilot, record consenting participants and exact versions, registry identity,
prices, independently funded payer, per-query and total testnet ceilings, window, stop
owner and recovery procedure. Run enrollment/upload/review, purchase, supported cited
answer, exact Circle-backed payment records and receipt export, then exercise the
failure/recovery cases in the paper plan. The software's synthetic signatures, SQLite
concurrency tests and browser fixtures do not establish participants, real settlement,
research quality or completed live recovery. Mainnet/real funds remain separately gated.
