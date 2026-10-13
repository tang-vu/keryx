# Private profile editor recovery — October 13, 2026

The private editor now distinguishes a pending initial read from an unavailable
store and provides an explicit Retry after a failed read. Retry is disabled while
the request is pending. Reads and mutations remain owner-bound and do not retry
automatically. A save imports only a valid current-owner profile acknowledgement;
deletion clears fields only after the exact deletion acknowledgement. Failed,
malformed, aborted or stale responses preserve the current owner's edits and
cannot import another owner's profile.

The current candidate passed 78 mounted editor and client tests plus focused
TypeScript checking. Tests render the actual editor and identity panel with
synthetic authentication and HTTP boundaries, covering recovery, owner changes,
sign-out, interrupted mutations, bounded text, safe links and deletion refusal.
This establishes fixture behavior, not a real session or selected-store rollout.

Issue #260 remains open for physical store admission, deployed SIWE/scoped API
and MCP acceptance, adapter contention/parity and exhaustive deployed privacy
checks. The private domain remains private, with its existing activation holds;
this UI correction adds no publication, custody, payout or spending authority.
The release coordinator owns required CI, merge and the next combined deployment.
