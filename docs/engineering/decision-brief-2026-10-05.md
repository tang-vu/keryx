# Bounded decision briefs and real-client acceptance

Application 0.26.9 is a release candidate until review, CI, deployment and live
verification pass. Production enablement of the richer answer is a separate gate.
The owner authorized at most USD 2 for this entire new round, including at most
three ordinary production-client questions and at most 0.15 source USDC, using
existing balances only. Earlier USD 1 allowances are closed. Model/search fees do
not return to a creator wallet; source payees are determined by their own authority.

## Useful output requires more than readable sources

The optional brief has bounded factual rows, explicit quote IDs and conditional
actions linked to factual premises. It has no free title, summary, conclusion or
conflict paragraph that can escape review. An omitted optional actions key means
an empty proposed action set before review; present malformed actions, invalid
facts, unknown fields and excessive rows are refused. This adds no prose.

Quote options retain exact UTF-16 offsets into the unlocked source and bounded
contiguous neighboring text. Generation and review see the same merged neighboring
contexts; gaps are never concatenated. Context expansion has a 12,000-character
aggregate refusal bound. Original read truncation and content-version metadata
remain distinct from omissions in the selected context. On the wire, duplicate
quote-context text can be omitted only when identical text at the same offsets
already exists in a shared source context. The original packet remains immutable.

The separate review must return the packet digest and exactly one verdict for
every fact, action and selected quote contribution. No missing, duplicate, foreign
or rewritten review is accepted. A fact needs both whole-row support and relevant
contributions from every selected quote. Scores can only decrease. Losing any
required quote or premise removes the whole row and dependent actions. The old
source/version/literal/evidence gates still apply; the final delivered projection
can only restrict their answer/reward eligibility. Orphan quote legs are withheld
even when every factual row fails. Review remains a model assessment, not truth
certification; confidence stays Low and missing requested targets stay visible.

Only official DeepSeek Flash transport is eligible for the staged brief. The
candidate uses a non-thinking generator and a separate reasoning review with
bounded output. Other providers retain D-300 delivery. There is no paid model
repair loop. Invalid generation/review falls back without losing paid-read records.
Private reviewer context stays server-local; receipts retain citation-sized excerpts,
the final answer and a digest/count trace. Brief attribution explanations are fixed
text, so later model attribution prose cannot escape the answer review boundary.

## Measured failures remain failures

The first independent frozen set contained twelve answerable engineering decisions
across Node.js, PostgreSQL, Python and Docker, plus four insufficient cases. With
the first non-thinking review candidate, only 3/12 met every usefulness criterion;
six material unsupported rows were identified among 118 rendered fact/action rows.
Examples included broadening an anonymous-volume exception to all volumes and
claiming absent cancellation documentation from incomplete context. A second model
approval and a Low label did not make those claims acceptable. Twenty-five model
calls reserved USD 0.277887. Raw provider completions were not retained in that
attempt, so the exact causes of two parsed-empty generations remain unknown.

A second independently authored set used different primary-document sections and
the corrected contract, including per-quote review and reasoning-enabled verification.
Its high-effort reviewer exhausted an 8,192-token output ceiling. Four completed
answerable cases delivered only fallback gaps. The batch was stopped once the
10/12 usefulness gate was unreachable. Nine request reservations were retained,
including two without a completed case artifact after interruption. They are
unknown outcomes, not free or successful requests. The whole development journal
then held USD 0.412751 for 34 calls. Unexecuted cases remain in the specified
denominator; the second frozen set cannot exceed 8/12 useful.

A final candidate used low-effort reasoning and 4,096-token output bounds on a
fresh third set. Previous tasks did not become held-out again. Each of its at most
32 new calls had to fit 20,000 UTF-8 input
bytes including the JSON instruction, plus 4,096 framing tokens and at most 4,096
output tokens. At the dated peak tariff, that is at most 12,144 microUSD per call,
or USD 0.388608 total, within the remaining USD 0.389249 development allocation.
Oversize input is refused without deleting source context. The same cumulative
journal retains every failed or uncertain attempt; no allowance is reset.

The third set also failed: five completed answerable cases produced no useful
brief. Four reviews returned empty content after reaching the 4,096-token limit;
one generation was malformed JSON. The run stopped with eleven new reservations,
including two without a completed case artifact. All sixteen specified cases remain
in the denominator, so at most 7/12 answerable cases could pass. The cumulative
development hold is USD 0.515162 for 45 requests; there are no further development
model dispatches in this round. The feature stays disabled. This result measures
the bounded candidate, not every possible provider/model configuration.

Acceptance remains at least 10/12 useful answerable artifacts and zero material
unsupported rendered rows, with the four insufficient/conflicting cases graded
separately. These are independently authored internal scenarios and agent source
review, not human/customer acceptance or autonomous discovery recall. The harness
isolates synthesis with a fixed permissive coverage assessment; it executes no
search, database, source payment or client journey. Frozen inputs, excluded grader
labels, exact captures, failures, prompt/source hashes and output artifacts are
retained privately. Actual-client acceptance of the reliability release is pending;
it cannot turn these failed brief evaluations into a passing usefulness claim.

## Retain completed work when compute fails

After a paid read, a failed intermediate coverage assessment stops additional
purchases. Failed gap expansion, final assessment or synthesis still reaches a
final dispatch with the original receipts. Unavailable final assessment continues
to withhold citation rewards. An attribution transport failure now reaches the
existing equal-share fallback over the already admitted, delivered citations;
it makes no extra provider request and introduces no new payout authority.
Public failure text excludes raw provider errors. Legacy conflict SSE reports
only an unverified conflict count, not unreviewed factual claims or preferences.

## Finite real-client cost controls

The operator can configure a protected, hash-bound, dated model allowance outside
the build directory. Every actual HTTP request must first create and fsync an
exclusive immutable reservation slot, including the containing directory. Crashes,
missing usage and failed calls consume their full hold. Concurrency/restart cannot
reopen a slot. Expired/changed/malformed policies fail closed. The allowance pins
the official Flash endpoint/model with no provider retry or fallback; model choices
cannot escape it. Complete source context that exceeds the request cap is refused.

The development ceiling is USD 0.802. Production model allocation is USD 0.887895:
42 affordable slots of USD 0.020660, at most USD 0.867720 actually reserved. Search
holds USD 0.048 for at most six basic searches and source USDC holds 0.15, also
counted conservatively inside the USD 2 aggregate. USD 0.112105 is unallocated.
Reservations are conservative ceilings, not provider invoices. Prices were checked
against [DeepSeek's official tariff](https://api-docs.deepseek.com/quick_start/pricing/)
on October 4 UTC; the provider documents the requested legacy Flash alias as
served by DeepSeek-V4.1-Flash. Review settings follow the
[official thinking-mode contract](https://api-docs.deepseek.com/guides/thinking_mode/).

The guard covers the shared public engine factory, not separately approved private
provider policies or direct watchdog/evaluation constructors. Those paths are
outside this client allowance and are not invoked to fill the acceptance count.
Reviewed deployment accepts only the three named non-secret role controls, with the
model policy path/digest paired and identical across web and A2A. Financial role
arguments and the sealed environment file remain unchanged. Every reviewed deploy
also requires `KERYX_REDEPLOY_EXPECTED_COMMIT`: the fetched remote main must match
that exact SHA before source reset, and reset uses that immutable object. Existing
temporary/backup builds are refused before source mutation; a newly appearing
temporary build is refused again before building. Restore ordinary
provider configuration after the bounded client work, retaining the journal.

## Delivery gates and surfaces

Web/SSE/history, API, A2A, remote MCP and thin consumers use the shared finalized
answer and receipt exports. Repository CLI and local desktop execution retain their
own environment/capability boundaries; hosted stdio MCP buys the hosted service.
The private engine policy is not silently replaced. No signer, nonce, session cap,
registry, payment record schema or settlement contract changes. Archived answers
and receipts remain unchanged. Package/installer versions and deployed commit must
be verified independently before claiming synchronized delivery.

Release still requires focused payment/stream/contract checks, TypeScript, lint,
production build, required CI, independent review, merge and deployment of current
origin/main. Mainnet acceptance uses the ordinary Chrome client, ordinary origin and
existing balances under the stated cap. Real requests are not relabeled simulated;
owner-operated activity is not promoted as independent customer traction. An empty
paid-source catalog can produce real research with zero source USDC. Restore the
previously active private worker, verify service/queue health, retain evidence and
clean only this task's verified merged local branches/worktrees after release.
