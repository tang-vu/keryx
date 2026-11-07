# Retained cache bodies during gap expansion

A fresh cache timestamp is a discovery hint. Reevaluation accepts a retained body
only when it contains non-whitespace text, matching initial cache admission.
Valid cached text is passed through unchanged so source hashes and quote offsets
continue to refer to the original bytes. Empty, whitespace-only and unavailable
bodies use the existing missing-cache path.

That path retains the fetch-allocation check before read admission. A zero or
exhausted allocation does not permit a replacement purchase. With an available
allocation, any paid fallback still uses its actual price, review verdict,
current source terms, rights, funding and payment boundaries. Rejecting a cache
body does not refund an earlier charge or release an unresolved liability.
Stored cache rows and historical reports are not rewritten.

The real orchestrator regressions cover ASCII/Unicode whitespace, empty and
unavailable bodies, valid padded text, zero/exhausted budgets and price-bound
live-review admission with changed-authority refusal. The previous source fails
four body-admission cases and two review-route cases. Fixtures use synthetic
providers/payments; they establish control flow, not independent answer quality.
The existing 48-trial offline study is reproduced with identical outputs and no
outbound attempts; only the current orchestrator input fingerprint changes.
