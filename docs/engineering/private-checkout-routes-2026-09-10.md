# Restricted private checkout route verification

Release v0.22.43, commit `0fce34cb9ba2fabb84785c3c5601c4c76d7cc9a0`.

The purchase route is now mounted at POST `/api/agent/private-ask`. It uses the
existing durable owner session, same-origin checks, bounded request body, a separate
per-wallet rate limit, the restricted operational bootstrap and session revalidation
before submission. Quote availability uses that same bootstrap and policy snapshot.
Non-pilot accounts are rejected before operational reads; unavailable purchasing can
still produce a non-purchasable preview when quote configuration exists.

## Validation

- 32 focused route/bootstrap/readiness tests passed. After adding a mounted-route
  positive assertion, the route and buyer checkout workflow suites passed together
  (16 tests). These groups overlap; their counts are not additive.
- Bootstrap integration uses actual unfunded EOA signatures, SQLite and real status
  files with injected Gateway/facilitator responses. Repeated submission invokes the
  synthetic settlement once and creates one eligible worker job. This is not a real
  payment or funded pilot.
- TypeScript passed. Lint had zero errors and three existing warnings outside the
  changed files. Full CI run `34458120090` completed successfully.
- `npm run redeploy` typechecked, built and loaded this commit on production.

At `2026-09-10T09:09:34.049Z`, public health reported `0fce34c` and `operational`.
A temporary owner-operated SIWE session exercised the actual new route:

| Probe | Observed HTTP status |
| --- | --- |
| Anonymous purchase request | 401 |
| Authenticated purchase with pilot configuration disabled | 503 |
| Authenticated purchase with a foreign Origin | 403 |
| Authenticated quote with private research disabled | 503 |

The anonymous, disabled purchase and quote responses had `Cache-Control: no-store`.
The temporary session's sign-out was confirmed. No payment typed-data signature was
created and no research job or payment submission was requested by this drill.

## Remaining acceptance

Production purchase and private worker enablement remain off. A managed worker,
restricted owner-pilot configuration and real paid end-to-end recovery still need
acceptance. Operational snapshots remain best-effort observations, not worker or
funding leases. Database capacity reservation and permanent authorization claims
remain authoritative. This release does not establish general availability,
independent buyer traction, profitability or mainnet readiness.
