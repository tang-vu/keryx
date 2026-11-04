# Public search failure observations

The existing agent creates a Tavily provider only from trusted server
configuration. At that composition point a per-run observer forwards the same
search calls, arguments, receiver, results and exceptions. It creates no retry,
new request or supplier admission. Injected providers and Searx retain their
original paths. Private and unattended search withholding remains unchanged.

When existing discovery counters reconcile, a failing configured Tavily search
summary may include a `public-search-failures-v1` trace detail. It contains only
three integer counts, with at most nine attempted calls:

- `admissionHeld`: an existing `ResearchAdmissionHeldError` escaped the trusted
  constructor's admission checks before vendor HTTP.
- `signalAborted`: a failure was observed while its operation signal was aborted.
  This does not distinguish a deadline, caller cancellation or a coincident error.
- `unclassified`: the remaining failures. Vendor HTTP, transport, response and
  generic bounded-allowance errors remain unclassified.

The observer does not read exception messages, codes, causes, stacks or other
properties. It stores no question, query, key, URL, HTTP status, header or body.
The constructor's existing vendor redaction prevents a vendor-thrown typed error
from being recorded as admission refusal. A throwing prototype/signal trap cannot
replace the original failure. Incomplete, inconsistent or overflow observations
omit detail and leave discovery behavior intact. Successful searches also omit it.

These counts explain only observations of new attempts. They grant no evidence,
source coverage, task completion, billing or spending authority, and establish no
cause for historical search failures. Existing numeric trace text and source
selection remain unchanged. No provider, quota, policy, financial or custody
implementation changes are part of this outcome.
