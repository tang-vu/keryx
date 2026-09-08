# How Keryx pays cited creators

Published September 8, 2026 by Keryx. This is first-party engineering documentation
based on repository commit 9ea84fa, not independent reporting or customer evidence.

Keryx separates the cost of opening source content from the reward for citing it.
An access toll purchases a read through the source's x402 endpoint. A citation reward
is a separate payment considered after the answer is written and its evidence checked.
Cached content can avoid a new access toll while still contributing to an answer and
qualifying for a citation reward. A paid read does not guarantee a citation reward.

The agent divides the research budget into an access budget and a citation pool using
the configured citation-pool ratio. Source selection also respects an attention limit.
The reasoning model proposes which sources to BUY, SKIP or read from CACHE, but its
proposals do not directly authorize unlimited spending. The orchestrator applies the
budget, source and payment checks before executing a read.

After reading, the model assesses coverage for the research questions and drafts an
answer with source markers such as [S1]. It also proposes evidence records containing
a research-question index, source marker, exact quote and estimated support score.
The deterministic evidence ledger checks these proposals against the original content
that was actually gathered. A proposed quotation must occur in that source after
whitespace normalization, and must be between 8 and 240 characters long.

A citation can qualify for a reward only when its source marker appears in the answer,
the synthesis declares that marker, and a validated quotation has support of at least
0.4. If the final evidence-assessment transport fails, reward authorization is disabled.
These checks verify an evidence link; they do not independently establish that the
publisher's statements are true or that the model's support estimate is correct.

Research coverage and reward eligibility are distinct. For each research question,
reported coverage is the minimum of the final model assessment and the strongest
qualifying evidence support. A narrow quotation may qualify for a citation reward even
when the final assessment says the wider question is only partially answered. A reward
therefore does not establish that the job achieved adequate coverage.

The model proposes contribution weights for accepted sources. Keryx resolves those
weights and allocates the citation pool using integer micro-USDC amounts. Only sources
accepted by the evidence ledger enter this allocation. Creator payment calls then use
the source's authoritative payment terms; a model-proposed weight does not choose a
recipient or change the source's payout authority. When no citation qualifies, the
citation pool stays unspent, while access tolls already settled remain paid.

The receipt distinguishes settled and pending payment records. A Circle transfer
reference is not automatically an explorer transaction hash or proof of completed
on-chain batch finality. Likewise, receipt integrity verifies that the receipt content
has not changed; it does not prove independent customer demand or factual correctness.

Implementation references at the documented revision:
- https://github.com/tang-vu/keryx/blob/9ea84fa/lib/agent/run-agent.ts
- https://github.com/tang-vu/keryx/blob/9ea84fa/lib/agent/evidence-ledger.ts
- https://github.com/tang-vu/keryx/blob/9ea84fa/lib/registry/source-fetch-payto.ts

