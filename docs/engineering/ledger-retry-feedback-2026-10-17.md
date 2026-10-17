# Ledger retry feedback

On October 17, the public dashboard showed unavailable question counts, recent
questions and settlement totals. An ordinary browser click reached the Retry
handler, but its notice stayed unchanged while the new read was pending. This
made an active retry look unresponsive. Public API reads also exceeded 25 seconds;
direct production loopback reads of `/api/metrics` and `/api/runs/summary` exceeded
six seconds. The API latency remains a separate operational investigation.

Manual retries now display the existing localized loading message in a disabled
button until their request finishes. A failed request enables Retry again. The
last successful data and its observation time remain explicitly stale until a
successful read replaces them. Automatic polling keeps its existing ten-second
delay after completion and fifteen-second request timeout. This change adds no
API requests, background work, payment retries or new authority.

Verification covers deferred success, deferred failure, stale data, interruption
of an earlier request, and the full existing ledger/source browser matrix for
Arc mainnet and testnet at 320, 390, 768 and 1440 pixels. The browser cases check
immediate loading, a disabled pending button, no concurrent poll, and recovery.

The affected surface is the hosted ledger, including clients that open that web
page. Native desktop, CLI, API, remote/stdio MCP, extension and bot contracts and
packages are unchanged. Required hosted CI and the production build gate merge.
The existing release coordinator includes the merged fix in the next combined
deployment; source acceptance alone does not establish production delivery.
