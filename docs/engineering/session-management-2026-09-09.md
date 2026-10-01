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

## Browser/server clock boundaries — 2026-10-01

The nonce endpoint also returns canonical server-issued login dates: issuance, five-minute challenge expiry, and the existing seven-day maximum account-session expiry. Existing nonce-only clients remain compatible with the server. Updated clients require the dated response and reject malformed or out-of-policy dates before signing; they do not fall back to the browser clock. Browser sign-in uses the server's seven-day window, and the private buyer helper derives its existing fifteen-minute login window from server issuance. Nonce consumption, signature verification, server-side session clamping, JWT expiry and durable session checks remain unchanged.

Grant creation echoes the exact expiry stored in the retained grant and reports bounded remaining duration after server work. The browser subtracts the complete request duration and anchors one monotonic UI deadline; rerenders cannot restart it. Authenticated `GET /api/session/grant` selects only the current account's grant, rejects query selectors and performs no renewal, deletion or capacity reset. Focus/visibility reads are bounded and deduplicated, reject owner/signer/generation changes, and only shorten the deadline. A failed or inactive read pauses the UI while retaining the key, original nonces and Gateway funds. An inactive result can also mean authority is unavailable; it is not proof that funds or records disappeared.

Paused sessions retain their supplied session identifier and block new questions until explicit recovery; the UI distinguishes unavailable status from definite expiry and never silently switches to treasury funding. The UI timer is advisory: browser clocks can pause during sleep. The server still enforces actual grant expiry and returns an error for an invalid supplied session instead of switching to treasury funding. Trusted server UTC remains necessary for authentication and financial observations. Payment signing also retains an independent local-clock boundary; these changes do not establish a synchronized host or make all paid flows independent of device clocks.
