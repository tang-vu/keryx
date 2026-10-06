# Sentence-cited summaries

Application 0.27.4 candidate, October 6, 2026. The owner chose to replace
excerpt-only delivery (D-300) with a model-written summary cited sentence by
sentence, falling back to excerpts when no sentence survives. Payment authority,
custody, spend limits and the excerpt ledger are unchanged.

## Why

The last closed ordinary-client round graded 0/3 useful, and a researcher's real
literature task (#128) ended with no supported answer. Readers received quoted
excerpts under a statement that the draft was withheld. D-300 withheld prose
because a source marker did not map an assertion to its evidence: an unsupported
sentence could reuse an accepted marker. The reviewed decision brief addresses the
same gap with a larger contract and stays disabled after three failed evaluations.

## Contract

- In the existing synthesis call, each evidence item may carry one `statement`:
  a single sentence written from that one server-resolved quote. There is no free
  summary, conclusion or cross-source paragraph.
- The existing evidence review call also returns `statementSupport` for rows with a
  statement: whether the quote, in its bounded context, establishes everything the
  sentence asserts. No model call is added and no retry is introduced.
- A sentence is delivered only when its quote passed every ledger gate for the same
  target and marker (literal membership, complete span, source role, exact arXiv
  identity, excerpt support threshold) and its own reviewed support is at least 0.7.
  A missing, duplicate or failed review gives 0. A caller-supplied score is discarded.
- One qualifying excerpt carries at most one sentence; at most four per target.
- Each sentence is rendered in the same paragraph as the verbatim source text it was
  checked against. Qualifying excerpts without a sentence are still listed, and
  targets without evidence still show their gap.
- When no sentence survives, delivery is byte-identical to the previous excerpt
  answer. Confidence stays Low. Reward eligibility comes from the ledger alone.

## Observed

Three local runs, one each, Deep mode, source budget 0, isolated testnet profile
with forced offline payment, SQLite, real `deepseek-chat` and the configured search
provider. One run each is an observation, not a rate, and the reading was by the
developer, not an independent grader or a customer.

| Question | Reads | Targets with a sentence | Sentences |
| --- | --- | --- | --- |
| EIP-4844 cost, retention and scope, with the official EIP URL | 2 | 3 of 3 | 4 |
| The frozen SQLite live-backup comparison (Vietnamese, two official URLs) | 4 | 6 of 8 | 11 |
| arXiv 1706.03762 architecture, BLEU and stated limitations | 1 of 3 | 2 of 5 | 2 |

Every delivered sentence restated its excerpt without a changed number or negation
on inspection. One SQLite sentence added a short gloss ("that is, a consistent
snapshot") that its quote implies but does not state; the reviewer accepted it.
Sentences answered in the language of the question.

## Limits

- A sentence is close to its quote by construction. The summary reads as an answer
  per target, not as a comparison or recommendation across sources. Checklists and
  cross-source conclusions still appear as gaps.
- The review is a model judgment. It can accept a gloss or a subtle overstatement.
  The paired source text is the reader's check.
- Reading limits bound the result more than synthesis does. The arXiv run read only
  the abstract page: the PDF exceeded the article byte limit and a secondary page was
  unreachable, so three of five targets had no evidence.
- No ordinary-client mainnet acceptance, paid-source run or independent grading was
  performed. The closed live allowances were not reopened.

## Surfaces

The change is in the shared finalized answer, so web/SSE/history, the hosted API,
A2A, remote MCP, the OpenAI-compatible endpoint, bots, extension, repository CLI and
private research workers deliver it without adapter changes. The public trace adds
`answerDelivery: "cited-summary"` and a sentence count. Evidence records, receipts,
exports, result schemas, MCP/desktop packages and settlement are unchanged; no
consumer parses the answer layout. Engines that do not extend the shared JSON chat
engine (the offline heuristic) keep excerpt delivery. The reviewed decision brief
keeps its own path and remains disabled.
