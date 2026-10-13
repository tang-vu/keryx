# Tameion adoption: reviewed claim economics and decision/receipt comparison

Owner-authorized October 12, 2026 following the Tameion comparison and two
source-backed proposals. This is a native read-only observer, not a new payment
rail, autonomous semantic judge or monetary policy.

## Sources checked October 12

| Primary source | Exact checked pin | Pattern and boundary |
| --- | --- | --- |
| [Dr. Nib README](https://github.com/fortunesayspump/nibgate/blob/202b0d337b0bd7ba5dda692dd4fce6b8dc2b85a3/dr-nib/README.md) | `202b0d337b0bd7ba5dda692dd4fce6b8dc2b85a3` | Cost per supported claim; reverify report revisions and leave absent verification unavailable. Upstream describes its live end-to-end run as partial. GitHub license endpoint returned 404: no code/assets copied or dependency adopted. |
| [SettleKit decision log](https://github.com/caelum0x/settlekit/blob/61afc2c827f2560fdd1103d0cfa558496e762cc2/packages/operator/src/decision-log.ts) and [MIT license](https://github.com/caelum0x/settlekit/blob/61afc2c827f2560fdd1103d0cfa558496e762cc2/LICENSE) | `61afc2c827f2560fdd1103d0cfa558496e762cc2` | Separate the decided inputs from post-execution outcome/transaction fields. No source code copied. Its vault anchoring is not transferred or claimed for Keryx. |

Earlier comparison pins (`324ec22b` and `a2e15ddc`) are historical. Current pins
were refreshed before adaptation. Upstream claims, popularity and recent commits
do not establish Keryx runtime acceptance.

## Observed gap and design

Keryx already has receipt checksums, a claim-source matrix, recorded purchase
outcomes, immutable private initial captures and the Decision Lab's offline
signed export snapshots. None supplies human claim assessments or reconciled
LLM/search bills to the automatic pooled scorer. Signed snapshots also do not
provide a payment-linked continuous ledger or independently attested execution time.

Use the existing portable receipt and private capture contracts in one pure
observer. Users explicitly supply report-bound reviews and costs. SHA-256 and
exact integer accounting run identically in Node and browser Web Crypto. Use
bounded local JSON, not a new model, dependency, optional database schema or
invoice integration. Preserve source/version/network/payee identity and expose
missing/ambiguous joins. A ratio remains an integer numerator and claim count;
USDC and USD are never added. This avoids fabricated automatic support counts,
fee-policy changes and framework maintenance while giving actual reviewed
reports a reproducible measurement now.

The commitment covers initial captured input and excludes later verdict, code
projection and receipts. Separately retained expected digests detect changes;
without them the result stays self-check-only. Existing capture timestamps are
recorded assertions. This increment does not claim independent temporal proof,
permission, settlement or stronger authenticity than its inputs provide. A
pre-execution digest publication/anchor or full nonce-bound receipt join would
need its own payment-sensitive design, persistence and rollout gates.

## Authority and failure containment

The input receipt remains byte/checksum-bound and unmodified. SourceRegistry
and Circle retain payout and settlement authority. No config/env loader, DB,
agent/provider, Gateway, session/signature or source plaintext reader is imported.
There is no funding, debit, reservation, nonce, retry, refund, scheduler, shared
DDL or activation. Browser data stays local and editing inputs invalidates
delayed crypto results. Malformed inputs emit a generic error; no file/secret
context is echoed. Output can contain user-supplied private billing references,
so explicit download/stdout retention is an owner-controlled operation.

## Supported surfaces

| Surface | Role in this increment |
| --- | --- |
| Web | `/research-audit`, discoverable from Decision Lab; local inputs, digest checks, costs, payment comparisons, clear and download. |
| Repository CLI | `audit:evidence`, bounded regular files and separate trust file; same pure observer, no application/network imports. |
| API | Existing portable receipt and owner-only capture readers remain the export sources. No new upload/public private-data endpoint or OpenAPI capability. |
| Remote/stdio MCP | Existing report/receipt handoffs; no private capture enumeration, billing upload, judge, signer or tool added. The public web workspace/source CLI handles this optional owner analysis. |
| Desktop | Hosted public analysis is available through the web handoff. Native/private originals keep their existing ownership/export gates; this does not expose or rewrite them. |
| Extension and bots | Existing report/receipt handoff can be inspected locally. No input collection, background analysis, payment or distribution change. |

No package/installer/extension version is allocated by this worker. The existing
release coordinator owns merge slots, version allocation and combined runtime
delivery. Current source/package versions alone are not synchronized delivery.
Production creator-sponsor maintenance remains another session's owned operation.

## Acceptance and remaining gates

Focused tests exercise exact large integer USD accounting, recorded access and
reward costs, unknown/estimated components, absent/unsupported human review,
wrong report/evidence/version/marker, tampering, separately retained trust,
initial-vs-projection commitment semantics, wrong payee/amount/chronology,
repeated/legacy joins, cap breaches, pending/simulated/incomplete windows,
mixed networks, duplicate transfer references and generic bounded-file failures.
CLI tests run fresh children with fetch poisoned. The compiled browser fixture
checks 320/390/1366 widths, example simulation, download/readback, retained
digests, stale async results, clear, local storage and GET-only browser transport.

Both TypeScript graphs, scoped lint, default isolated production build, compiled
browser fixture, independent source review and actual hosted aggregate/platform
success are release gates. Track exact results in the task's private handoff and
PR. Actual human usefulness, invoice authentication, production activation,
independent outside demand and temporal attestation remain separate evidence
gates. No real settled money or customer metric is fabricated by these fixtures.
