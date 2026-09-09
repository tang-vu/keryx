# Revocable account sessions — September 9, 2026

v0.22.28 makes account logout a server-side revocation. JWT signature validation alone
previously allowed a retained cookie to remain valid until expiry after logout.

New tokens have a random identifier, pinned HS256 algorithm, issuer, audience and
type, validated wallet/role claims and exact issue/expiry times. The server first
creates a private `web_sessions` row containing only the identifier hash, wallet and
timestamps. Each authentication check requires an exact matching, active row. Expiry
is capped at seven days and any earlier SIWE expiration requested by the signer.

Logout deletes only the matching session and wallet row, then clears the cookie.
The operation is idempotent. A storage error returns 503 and leaves the cookie for
retry; the UI retains account/connection state and reports failure instead of claiming
success. Session introspection distinguishes storage unavailability from signed-out;
protected callers receive no authority on either condition. Invalid/expired/legacy
cookies cannot authenticate and can be cleared without restoring their authority.

Browser hook revisions reject stale lookup responses after logout. Same-page hooks
update together; other tabs refresh via BroadcastChannel, with focus refresh as a
fallback. These messages carry no token, wallet or private research data. The menu and
Connect page wait for server confirmation before disconnecting their wallet connector.

## Validation

- Real JWT and SQLite tests: successful session, retained-cookie rejection after
  logout, idempotent retry, independent devices/wallets, reopen persistence, expiry,
  wrong issuer/audience/wallet/identifier/role, legacy rejection and storage failures.
- Existing real-SIWE route tests pass through the new durable issuance boundary.
- Supabase adapter checks verify exact hash reads and owner-scoped DELETE predicates.
  Migration 0043 and `scripts/check-web-sessions.sql` execute on an isolated PostgreSQL
  17 container, including duplicate denial, device isolation and private privileges.
- Real React hook and wallet-menu checks in Chromium cover failed logout, confirmed
  logout, sibling views, another browser tab and a delayed lookup that must not
  resurrect account UI. All HTTP is intercepted and signing is prohibited.

## Release and recovery

Existing JWTs without the new session identifier must sign in again once. They are
not automatically converted into active sessions. SQLite initializes the new table;
Supabase installations must apply `0043_web_sessions.sql` before this release.
JWT_SECRET is not changed by this migration.

Before exposing a restored database, clear `auth_challenges` and `web_sessions` rows.
Otherwise a stale backup could resurrect a used challenge or revoked session. Never
clear payment reservations, authorization nonces or research journals as part of that
ephemeral account cleanup. Signing-key rollback likewise needs session invalidation.

This changes account access, not already signed payment authority. It does not refund,
cancel or erase existing research, and already accepted requests may finish. Remote
device/session management, genuinely private research access, independent review and
mainnet readiness remain open; no test identity is external adoption or payment traction.
