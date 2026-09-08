# Recovering a Keryx paid research job

Published September 8, 2026 by Keryx. This first-party note describes the buyer client
at repository commit 9ea84fa. It is not a report of external adoption.

The independent Keryx buyer client separates quoting, buying and recovering a research
job. The buyer provides a trusted Keryx treasury payee and an all-in price ceiling.
The all-in ceiling includes both the service fee and creator budget. The client uses
the caller's already-funded wallet; it does not automatically fund or deposit for it.

The quote command sends an unsigned request and validates the returned payment
challenge. A successful quote does not pay or start research. The buy command obtains
a fresh quote, checks the payment policy again, writes a durable job journal, signs
once and submits once. Each purchase needs a new private job directory.

Before signing, the journal records the normalized request, payment terms, nonce and
deterministic job identifier. A second durable boundary is written before the signed
submission is sent. Private keys and payment signatures are not written into the
journal. The job identifier itself is sensitive because it provides bearer access to
the research result. A journal should not be posted publicly or placed in a shared folder.

After a connection failure or process restart, use the resume command with the same
job directory. Resume sends only GET requests for the original job. It does not sign
a new authorization or replay a purchase. An unknown order or expired authorization
does not prove that a payment failed. Deleting the journal and buying again can create
a second debit, so ambiguous cases may require operator reconciliation.

The completed job must match the original package, creator cap, paid total and request.
The client checks the portable receipt's canonical SHA-256 digest and binds it to the
original question and returned answer. Receipt snapshots are archived by digest;
reconciliation may later produce a different snapshot without erasing the older one.

Payment evidence and content delivery remain separate. A retained success response
with a Circle reference is labeled seller-reported settlement. It is not an independent
Circle query or an on-chain finality proof. Without that response, payment can remain
unconfirmed even when a job exists. Creator amounts can also be settled, pending or
unknown; the client must not silently turn missing accounting into zero.

A completed job means execution finished, not that the answer was adequately supported.
The service receipt reports evidence coverage separately. The package is best effort,
with provisional completion objectives and no promised remedy. Unused creator reserve
under the fixed-price package is not an automatic refund. Buyers should inspect both
the research result and its economics before judging the outcome.

Implementation and usage references at the documented revision:
- https://github.com/tang-vu/keryx/blob/9ea84fa/docs/buyer-agent.md
- https://github.com/tang-vu/keryx/blob/9ea84fa/lib/a2a/research-package.ts

