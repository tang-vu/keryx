# Broad web research

Authorized October 1, 2026. This document describes the implementation and release
gates for question-driven web discovery beyond the registered source catalog.
Bounded live discovery and original-document extraction have been observed. Verify
production availability through the deployed health response and an actual run;
local implementation and a key do not establish it. These checks are not evidence of
correct answers, independent demand or mainnet readiness.

## Product outcome

A participant can bring a research question without first arranging for its sources
to be registered with Keryx. The agent searches for relevant public documents, decides
which to read under bounded attention and time, and produces a claim-linked answer.
Each admitted citation refers to the actual extracted document observed during that
run. Search snippets are discovery previews, never evidence of the document contents.

Registered creator sources remain available when their information adds useful
evidence. Public web documents carry no Keryx creator payout authority. Existing
source ownership, pricing, browser authorization and settlement rules remain intact.
Zero source-access USDC does not mean zero search, model or infrastructure cost.

## Discovery and reading

Use an operator-configured search service with a fixed server-side endpoint. Do not
accept provider endpoints from a question, silently rotate through public instances,
or treat a narrow encyclopedia/feed search as whole-web coverage. The owner has no
existing search service. Prepare Tavily Basic Search as the initial managed-provider
option: its [documented Free plan](https://docs.tavily.com/documentation/api-credits)
currently supplies 1,000 monthly credits without a payment card, with one credit per
basic search request. Keep auto-parameters, generated answers and raw-content extras
disabled; result snippets are previews and Keryx reads original documents itself.
The owner configured its key privately on October 1. No paid upgrade,
automatic paid overage or subscription purchase is authorized. A key alone is not
proof of a free plan or available quota; verify the account terms before live calls.

Explicit provider selection must not silently fall back to another service or change
the funding mode. Secrets are server-only and never placed in URLs, logs or receipts.
Credentials go only to the fixed vendor endpoint with redirects refused. Quota errors
are unavailable discovery, not evidence that no relevant sources exist.

SearXNG remains a self-hosted option and provides a
[documented search API](https://docs.searxng.org/dev/search_api.html); its instance must
enable JSON and its upstream availability must be observed, not assumed.

Search the question and a bounded subset of its research targets. Normalize candidate
URLs and limit results, query fanout, publisher concentration and total run time.
Read selected original documents with DNS-pinned, public-only, redirect-aware transport.
A narrowly configured local search backend must never weaken the public document
fetch boundary. Do not execute page scripts, fetch embedded resources, bypass a
paywall or present an unavailable document as a successful read.

HTML/text extraction and bounded PDF text extraction are delivery requirements.
Scanned PDFs, videos, browser-only pages and extraction failures remain explicitly
unsupported where no usable text was obtained. Extraction is not an attestation that
every part of a publisher's document was read. Record actual final URL, observed time,
document identity, extracted-body version and truncation/format limitations.

Parse hostile HTML/PDF in disposable Node child processes with no inherited service
credentials, bounded input/output and deadline termination. One parser admission
slot per server process has no waiting queue; additional attempts fail visibly.
The 64 MiB V8 old-space setting is not an operating-system limit on total process
memory. Multiple server processes multiply the concurrency bound. Keep these
residual limits explicit and verify the actual traced worker assets in a production
build. Runtime dependencies require Node 22 LTS at least 22.19, or Node 24 and
newer; CI and the observed production runtime use Node 24.
Use the project's pinned npm 11.19.0 installer. Older npm optional-peer resolution
produced incompatible lockfile closures in clean CI; do not regenerate the lock
with an older installer or upgrade payment dependencies to work around it. CI pins
Node 24.21.0 with its matching npm. Production Node 24.16 may remain in place, but
its installer must pass the npm 11.19.0 gate before deployment.

## Evidence and uncertainty

Admit only immutable observed text to synthesis and the existing literal quote gate.
A matching quotation establishes that a passage occurred in the extracted source;
it does not establish that its claim is true. Preserve missing support, conflicting
positions and limits of the final assessment. Do not promise universally verified
research or infer viral performance from video descriptions.

Deduplicate normalized identical extracted content. Two copies or two URLs from the
same publisher must not inflate confidence as two independent sources. Registrable
domain grouping, including private suffixes, is a conservative concentration signal,
not proof of common ownership or independence; separately hosted sites can still
share an original source. High source-grounding confidence requires matching evidence
from at least two distinct admitted domain groups for each covered research target,
alongside the existing support and final-assessment gates. It is not a probability
that the answer is factually correct.

Expanded candidate selection must have deterministic bounded computational work,
retain exact monetary caps, and report approximate selection honestly where used.
Every displayed provenance field must survive persisted receipt projection and
rendering. Do not replace observed timestamps or document versions with model guesses.

## Privacy and failure containment

Public questions sent to search providers leave Keryx's service boundary. Describe
that behavior in the research journey. Private execution must make no new external
web request unless its separately authorized effects policy permits it; public
logging and receipt sinks must not receive private query or fetched content.

With a configured provider, public browser, MCP and A2A research may search the web.
Unattended/default `engine` runs do not search externally, preserving the pilot quota.
A human CLI research command can explicitly opt in with `--web` through trusted server
input; it retains its actual `engine` origin. This flag never overrides the private-job
refusal and is not a permission supplied by public request JSON.

Provider failure, timeout, malformed output and absent configuration are different
from a successful search with no results. One document failure must not discard
other usable evidence or authorize a payment retry. Cancellation and aggregate
deadlines must stop outstanding work and preserve the existing SSE lifecycle.

## Acceptance and release

The October 1 read-only smoke observed six successful Basic Search requests across
SQLite documentation, children's YouTube policy and climate education. Selected
original HTML and a NOAA PDF yielded extracted text and body hashes. Google policy
pages were unavailable through the bounded reader; that topic remains unsupported
by this smoke. No model synthesis, database write, creator payment or participant
use was exercised. The account usage endpoint reported the Researcher plan with a
1,000-credit limit and zero usage before and after; it did not corroborate consumed
credits, so six observed requests must not be reported as measured billing.

The smoke mistakenly applied its two-read limit per query variant instead of per
topic: 11 read attempts produced six usable documents and five unavailable results,
exceeding the intended six total attempts. Further live calls stopped. Retain this
scope failure and use a single aggregate topic allowance for subsequent smoke runs.

Required implementation evidence includes bounded query/result/read behavior,
unsafe URL and redirect refusal, credential isolation, inert HTML extraction,
contained PDF extraction, cancellation, duplicate-body refusal and conservative
publisher grouping. Integration must prove that snippets cannot become citations,
public web reads create no creator payment, mixed runs retain creator safeguards,
private runs make zero public web calls, and actual extracted provenance reaches
both persisted receipts and the rendered answer.

Run focused fixtures and appropriate TypeScript, lint, production-build, browser and
CI gates, then review the SSE/payment boundary before merging. Synthetic evidence
proves implementation behavior only. Production acceptance also needs a configured
search provider and a bounded read-only smoke test across multiple real topics.
Buying a subscription or spending real funds requires separate explicit approval.

Follow the standing PR, merge, deployment and product-update workflow. Do not claim
that broad search is available merely because an unconfigured adapter was deployed.
Record any configuration or live verification gap and retain the full scope until it
is resolved. Real participant usefulness and repeat demand remain the separate
gates in [product validation](./product-validation.md).
