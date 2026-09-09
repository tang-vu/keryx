# Account session management — September 9, 2026

v0.22.29 adds account controls at `/connect`, linked as **Manage sessions** in the
wallet menu. Signed-in users see up to 100 newest active sessions, their sign-in and
expiry times, and a current-session marker. A truncation notice makes the window
explicit. Device names, IP addresses and locations are not inferred or collected.

`GET /api/auth/sessions` requires the durable JWT/row binding. Responses are no-store
and contain only hashed selectors, dates and the current marker. Each selector is
derived from the random JWT identifier; possession of a selector cannot authenticate.

`DELETE /api/auth/sessions/:id` removes only a session owned by the authenticated
wallet. The current session directs the user to normal Sign out. Missing and foreign
selectors return the same idempotent result; foreign rows remain intact. Collection
DELETE removes all other rows with a single owner-scoped statement, including rows
outside the displayed window. Read-back must confirm removal before success. If a new
session is created during bulk verification, the caller may receive a retry error.

Both mutations require a matching browser Origin and a currently active session.
Storage errors remain 503. No account-session action deletes spend grants, payment
journals or research jobs. Revocation prevents future authenticated requests; it does
not retroactively cancel an operation that already passed its authentication boundary.

SQLite and Supabase implement the same owner predicates. Migration 0044 adds only a
wallet/expiry index to the existing private table. SQLite initializes it automatically;
Supabase deployments should apply it for inventory lookup performance.

Validation covers real JWT/SQLite multi-wallet isolation, idempotency, current-session
preservation, revoked callers, no-op writes, outages and a 106-session inventory.
Supabase SDK tests inspect the actual encoded predicates and limits. The existing
browser-auth check also executes the real account component in Chromium, including
failed/successful selected revocation, bulk removal, current-session preservation and
mobile overflow. HTTP is intercepted; those fixtures do not sign or pay.

This closes session inventory and remote account revocation within the current testnet
product. Private research history, wallet key recovery, independent device acceptance,
security review and the wider mainnet acceptance map remain open.
