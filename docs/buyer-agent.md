# Independent buyer agent — Arc testnet

The buyer client purchases Keryx Quick/Deep research using the caller's own funded
Gateway balance. It imports no Keryx server configuration and cannot access the
Keryx funder. Requires Node 24 (recommended), this repository and `npm install`.
No mainnet support, automatic funding, deposits or approvals are included.

## Prepare

1. Use an EOA with an existing Arc-testnet Gateway balance. Keep its private key
   only in `.env.buyer.local` as `KERYX_BUYER_PRIVATE_KEY=0x...`, or inject the same
   environment variable from your own secret manager. Never paste a key into commands.
2. Open https://keryx.cc/research, choose a package/cap, enter your question, and
   download `request.json`. Keep this file private; it contains your question.
3. Independently confirm the Keryx treasury payee shown on that page before pinning
   it below. The client does not learn its trusted payee from a 402 challenge.
4. Choose a private working directory outside a public/shared folder. Commands below
   create `job-1` in the current directory. Within this repo use an existing
   `.buyer-jobs` parent (gitignored). Each purchase needs a new job directory.

## Quote, buy, resume

To recover an existing browser job, use **Export recovery file** in saved jobs,
then import it into a new private directory. These commands need no wallet and
do not contact the network until `resume`:

```bash
npm run buyer -- import --file keryx-recovery.json --state .buyer-jobs/recovered-job
npm run buyer -- resume --state .buyer-jobs/recovered-job
npm run buyer -- export --state .buyer-jobs/recovered-job --file .buyer-jobs/recovery-copy.json
```

The parent directory must exist. Import refuses existing state directories; export
refuses existing destination files. Browser import accepts either the exported
`keryx-buyer-recovery-v1` bundle or an older `intent.json`. The bundle preserves any
saved HTTP status and allowlisted seller acknowledgement. Legacy intents cannot
recover acknowledgement data that was never included. Import never grants permission
to sign or submit again, even when the original intent was only prepared.

Recovery files contain the private question and bearer job identifier. They exclude
signatures and keys, but must still be kept private. A copied acknowledgement is an
unverified seller assertion; its payer/network check is not cryptographic proof that
the seller settled this specific job. Receipt integrity and original-request binding
are checked separately during recovery. This bundle does not back up wallet keys,
Gateway funding attempts, browser accounts or the server database.

For a new purchase:

Replace `0xYOUR_VERIFIED_KERYX_PAYEE` with the public treasury address. The total cap
includes BOTH the service fee and creator cap. The following 0.10-USDC cap is an
example, not a current price promise.

```bash
npm run buyer -- quote --request request.json --payee 0xYOUR_VERIFIED_KERYX_PAYEE --max-total 0.10
npm run buyer -- buy --request request.json --payee 0xYOUR_VERIFIED_KERYX_PAYEE --max-total 0.10 --state ./job-1
npm run buyer -- resume --state ./job-1 --watch
```

`quote` performs an unsigned POST and reports `BUY_ELIGIBLE` only if the exact
challenge meets the configured policy. No payment or research is started.
`buy` obtains a fresh quote, enforces policy again, writes the job journal, signs
once and submits once. An existing directory is never reused for a new purchase.
`resume` needs no key, sends only GET requests, and watches queued/processing jobs
for at most 120 checks, five seconds apart, within a ten-minute window plus the
active request (each HTTP request has a 30-second timeout).
It stops on completed, failed, review-required, unknown order or network error.
Run it again with the SAME directory to continue. Exit 2 means an incomplete/review
state; exit 1 means refusal or an error; a completed verified result exits 0.

Limits: one pinned Keryx HTTPS origin, x402 v2 exact batching, Arc testnet USDC,
GatewayWalletBatched v1 domain, trusted payee, at most 0.50 USDC creator cap and
1 USDC total per job. Caller limits may be lower. Amounts must have at most six
decimal places. These are per-job limits, not a global wallet spend allowance.

## Recovery and evidence

The journal contains the normalized request, checked requirements, payer/payee,
nonce, validity and deterministic job ID before signing. A second durable boundary
is written before submitting the signature. Neither signatures nor private keys
are written into it. Journal creation is exclusive; parallel buys sharing a directory
cannot both sign. Keep journals private: the job ID is bearer access to the result.
POSIX files/directories use 0600/0700 permissions and fsync; Windows inherits the
parent ACL, so use a private local directory. Filesystem durability remains a dependency.

After response loss or process termination, `resume` polls the saved job ID. It never
re-signs, replays a payment, or assumes a 404/expired authorization proves failure.
A missing order may require Keryx operator reconciliation. Do not delete a journal
and buy again to recover an uncertain payment. A crash before submission may also
need manual review: recovery intentionally favors avoiding a duplicate debit.

Payment evidence and delivery are separate:

- `payment.state: seller_reported_settled` means a matching success response with a
  Circle transaction reference was retained, including on HTTP 500. It is explicitly
  seller-relayed evidence, not an independent query to Circle or an on-chain proof.
- Without that response, `payment.state: unconfirmed` remains, even if a job is found.
- Completed results must match job ID, exact package snapshot, creator cap and paid
  total. The portable receipt must pass canonical SHA-256 and HTTPS-header digest
  checks and bind the original question, mode, budget and returned answer.
- Creator settlement comes from the Keryx ledger. Pending/unknown amounts remain
  distinct. Reconciliation can produce a later receipt with a different digest;
  each downloaded snapshot is archived by digest rather than overwriting history.
- Hash consistency does not prove factual correctness or independent settlement.

Paste the reported job ID into https://keryx.cc/research for a visual view. The client
does not put private job IDs into workspace URLs. The old `npm run a2a` remains an
internal, Keryx-funded demo and is not evidence of independent customer demand.

Protocol reference: [Circle nanopayments](https://developers.circle.com/gateway/nanopayments).
The signed domain/types also match the installed batching SDK and Keryx's existing
browser co-sign path; no new seller or creator settlement rail is introduced.

## Prepare a report for mentor or operator feedback

Use the same private journal to obtain a redacted diagnostic:

```bash
node --import tsx scripts/buyer-agent.mts report --state .buyer-jobs/job-1 > buyer-report.json
```

This direct Node command keeps stdout as one JSON document and needs no signing key.
It uses the same GET-only recovery path, including receipt integrity/request checks
and local receipt archiving for completed jobs. It never buys or signs again.
Exit 0 means a completed verified report; exit 2 still prints a valid report for an
incomplete, failed, review-required or unknown-order state. Exit 1 means refusal/error;
do not treat an empty redirected file as a report. `report` does not accept `--watch`.

The report includes status, available pricing, timing, numeric target coverage and
receipt verification/accounting summaries. Missing data stays null, pending spend
stays pending, and an unknown order is `not_found_uncertain`, not proof of a failed
payment. `accountingAgreement` compares job and receipt settled/pending totals in
micro-USDC; `differs` preserves both reported amounts for investigation. A completed
report does not establish adequate research quality or independent settlement.

Only explicitly allowed fields are copied. Job IDs, wallet and transfer identifiers,
receipt digests, paths, questions, answers, quotations, source names and free-form
errors are omitted. Amounts, timing and quality can still reveal information, so read
the report before sharing. It is a diagnostic projection, not the original portable
receipt; a recipient cannot use it to independently verify the private result.
Choose any additional question context yourself. Never attach the private journal
or full `resume` output to a public check-in.
