# Durable sign-in challenges — September 9, 2026

v0.22.27 replaces cookie-only nonce checking with server-issued, expiring,
single-use challenges. The preceding local fixture signed one synthetic SIWE
message and retained the cookie across two verify requests; both issued sessions.
That was a local reproduction, not evidence of a production compromise.

## Current behavior

`GET /api/auth/nonce` records a SHA-256 hash of a domain-separated nonce and
server issue/expiry times before returning a five-minute cookie and nonce. It never
stores a wallet signature or private key. Expired hashes are pruned on issuance.

`POST /api/auth/verify` checks cookie shape and origin, applies its rate limit,
reads at most 16 KiB within ten seconds, then atomically consumes an issued,
unexpired challenge before checking the real SIWE signature/domain and Arc-testnet
chain. A second request cannot consume the same challenge. Invalid signatures and
wrong-chain attempts consume it; malformed bodies, origin rejection and throttling
do not reach consumption. The browser cookie is cleared on verify, so retrying the
normal UI obtains a new challenge. All auth-route responses are `no-store`.

Missing, expired, future-issued and consumed challenges are refused. A challenge
database failure returns 503 and cannot mint a session. Rate limiting may retain
its existing in-process fallback, but challenge authority has no memory fallback.
An ambiguous storage response requires a new challenge, never assumed success.

SQLite uses one conditional DELETE to consume. Supabase migration
`0042_auth_challenges.sql` creates the hash-only table and service-role-only RPCs
with RLS and explicit client privilege denial. Existing active hashes cannot be
overwritten. Issuance always generates a new random nonce.

## Validation

- Actual route tests use real SIWE signatures, JWT verification, request-scoped
  cookies and SQLite: successful login, retained-cookie replay, two simultaneous
  valid requests, unknown/expired nonce, wrong wallet/domain/chain, origin rejection,
  malformed input, throttling and storage failure.
- Two independent Node processes call the real SQLite adapter against one file;
  exactly one consumes the challenge. Reopen, future/expired timestamps, duplicate
  active issuance, cleanup and hash-only storage are checked separately.
- Upload tests exercise a chunked oversized stream and a stalled upload deadline.
- Supabase adapter tests verify RPC arguments, explicit boolean results and outage
  rejection. The SQL migration and `scripts/check-auth-challenges.sql` ran on an
  isolated, network-disabled PostgreSQL 17 container. Separate transactions holding
  the same delete lock returned true then false; the second waited for the first.

These checks used synthetic identities and isolated databases. They do not measure
customer adoption or payment traction.

## Deployment and remaining limits

The current production adapter was confirmed as SQLite. Initialization creates the
new table; Supabase deployments must apply migration 0042 before enabling this code.
Old unconsumed browser nonce cookies from before deployment are intentionally
rejected: start sign-in again. Existing session JWTs keep their prior lifetime.

Before serving a restored database, discard `auth_challenges` rows: a backup must
not restore a challenge already consumed after the backup. This cleanup applies
only to login challenges, never payment nonces, settlement rows or recovery journals.

Server clock correctness and trusted proxy host/IP configuration remain operational
dependencies. This does not implement per-session revocation, account/private buyer
history or a complete authentication audit, and does not enable mainnet.
