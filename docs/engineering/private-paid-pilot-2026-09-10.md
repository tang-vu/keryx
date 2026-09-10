# First owner-operated private paid pilot

Completed on September 10, 2026 against production v0.22.43, commit `3648532`.
This is an owner-operated Arc testnet acceptance run, not independent customer traction
or mainnet revenue. Private purchasing was enabled for one explicitly configured pilot
payer. Other accounts remained in preview mode and could not purchase.

## Payment and recovery evidence

A fresh buyer received 0.1 native testnet USDC from the dedicated private treasury and
deposited 0.05 USDC into Gateway using a bounded approval. Funding journals retained
transaction hashes before broadcast; interrupted verification was recovered by reading
the existing transactions, without duplicate transfers or deposits.

The private buyer CLI submitted exactly one signed checkout and received a settled
incoming payment response. Read-only recovery first observed execution claimed, then
completed. Recovery sent no payment requests and confirmed session sign-out. The
managed private worker stored the completed result.

| Ledger item | Testnet USDC |
| --- | ---: |
| Package payment | 0.050000 |
| Service fee component | 0.020000 |
| Creator budget | 0.030000 |
| Confirmed fetch toll | 0.002000 |
| Confirmed citation reward | 0.015000 |
| Uncommitted creator budget | 0.013000 |

Both creator legs were `facilitator-confirmed`; unresolved and processing amounts were
zero. Uncommitted budget remains reserved under the current lifetime-capacity policy;
it is not an automatic refund or additional earned fee. Treasury Gateway balance and
required backing were both 83000 micro-USDC, with 70000 micro-USDC of unallocated
capacity. The buyer's Gateway balance was zero after the package payment.

These are stored settlement evidence and balance observations, not an independent
chain-finality audit. The private recovery snapshot is server-reported evidence, not a
portable cryptographic receipt.

## Privacy and browser acceptance

An authenticated non-owner received HTTP 404 when requesting this result. Database
inspection found no public query run, public payment rows or public creator-attempt
rows for the private job. The owner's browser history opened the stored answer and
displayed 0.017000 USDC of confirmed creator spend; reload recovered the same result.
Playwright checks at 390x844 and 1440x1000 found no horizontal overflow or page errors.
The browser check allowed private reads only and sent no payment requests.

This used an ephemeral owner session, not an independent mobile wallet-extension
checkout. It does not establish privacy across every feed, backup or provider log.
Private question text, identifiers, cookies, signatures and raw journals are deliberately
excluded from this public record.

## Quality and accounting limits

The English answer contained 903 characters, two subclaims and one first-party citation.
The run recorded two BUY decisions, nineteen SKIP decisions and seven qualifying evidence
quotes. Recorded coverage scores were 1.0 and 0.9; these are internal assessments, not
independent quality validation. Decision counts are distinct from charged payment legs.

The stored run has six served reasoning attempts but seven usage records: 11458 input
tokens, 3069 output tokens and 1664 cached input tokens. Running `economicsRunSample`
against the actual stored result returns `usageCoverage: "unknown"`. The existing
one-record-per-served-attempt check cannot establish complete billing coverage here.
Call-level accounting needs investigation before treating this run as fully priced;
no provider invoice reconciliation or profit claim follows from this pilot.

Still outstanding: independent buyer acceptance, private browser checkout, portable
private receipts, paid-job shutdown/crash recovery drills and mainnet release gates.
