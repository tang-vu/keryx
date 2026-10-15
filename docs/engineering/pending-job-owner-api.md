# Authenticated original job association

`POST /api/agent/ask` retains its ordinary x402 contract. The optional exact
`X-Keryx-Account-Job: associate` header additionally requires the original payment
signature, an active signed `keryx_session`, matching `Origin`, and the selected
enrolled mainnet SQLite owner-admission port. `Authorization` is refused in this
opt-in branch. Header absence preserves existing unsigned discovery and signed
payment behavior. Ownership is an account association, never a payer replacement
or a grant to spend. A replay cannot attach an old original. Session admission is
checked before settlement and atomically with new-original creation; unavailable
admission returns 401. Payment and ambiguity protections remain in force.

`GET /api/me/jobs` requires an active account cookie. A key alone grants no access.
Pages contain at most 25 records with a 26-row lookahead, ordered by creation time
then original ID descending. Pass `nextCursor` unchanged; invalid cursors return
400. This is a keyset view, not a snapshot.

The default view retains the verified wallet's existing payer history whether
or not a native owner port exists. Only `pending=owned` selects authenticated
original associations. That explicit branch requires the native port, never
falls back to payer history on failure, and adds row `attention`/`recoveryState` and view-level
`ownership: authenticated_original`, `recoveryState: unknown`. It includes
retained completed and failed originals too. Optional `id` selects an exact
original only in that view; an invalid selected ID returns 503. Missing capability
or stale proof returns 503. The default view ignores `id`.

Rows expose the existing allowlisted history projection and shared escalation
contract. Native rows omit the worker request (`question` is null). Original
payment fields describe retained facts; missing provenance stays null/unknown.
No payment nonce, signed authorization or raw worker input is exposed. GET does
not refund, retry, reconcile, pay or clear a hold.

This contract addition changes no route, authentication, storage or payment code.
Its three authored controls remain UNRUN until applied and checked by the owner.
Retain the existing 28 mounted admission controls and prior native/UI evidence;
this document does not assert production activation, a real new settlement or
completion of the original issue's broader delivery requirements.
