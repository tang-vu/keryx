# Completed private-job history API

The published OpenAPI document includes these existing read-only endpoints:

| POST endpoint | JSON body | Successful output |
| --- | --- | --- |
| `/api/me/private-jobs` | `{}` or the filters below; optional `format: "json"` | Completed-job metadata page |
| `/api/me/private-jobs/detail` | `{"id":"prv_<64 lowercase hex>"}`; optional `format: "report"` | One authorized bounded report projection |
| `/api/me/private-jobs/export` | Page filters plus optional `format: "json"` or `"csv"` | Bounded metadata export |

Send a JSON object of at most 8192 UTF-8 bytes. Unknown fields and **every URL
query parameter** are rejected. Keep private IDs and cursors in the POST body.
List/export accept `limit` (1–25; default 25), `cursor`, literal case-sensitive
`search` (200 UTF-16 code units), recorded `surface`, recorded incoming-settlement
`network` (`eip155:5042` or `eip155:5042002`), and inclusive intent-createdAt
`from`/`to`. Times retain zero to six fractional digits and UTC spelling
`Z` or `+00:00`. Preserve the filters and limit when following a cursor.

Use the active `keryx_session` (SIWE or supported verified Circle Google login)
and its durable session, or an unrevoked API
key with explicit `history:read`. Authorization header presence excludes cookie
fallback. Cookie requests require the exact configured `Origin`; bearer requests
may omit it, but any supplied Origin must match. An optional
`X-Keryx-Expected-Wallet` compares the authenticated payer and selects no owner.
The exact session identity or key wallet/scope is checked again before delivery.
Linked wallets and account membership do not grant access to these private jobs.

Pages scan at most 25 of 26 intent candidates, return at most 25 rows and fit
1,500,000 bytes within 15 seconds. A filtered empty page may have a continuation.
Detail has the same response/time cap and refuses oversized/inconsistent records.
Export is bounded to 20 pages, 500 rows, 2 MiB and 25 seconds. Check
`complete`, `truncated` and `nextCursor`; this is current-store history, not an
all-archive or transaction-snapshot claim. CSV includes a metadata row and
neutralizes formula prefixes.

List/export contain metadata only. Detail returns an allowlisted report,
excluding raw trace, ciphertext, signatures, recovery packets and transport
fields. Completed jobs require a saved result, permanent execution claim and
validated recorded incoming settlement; an intent or payment alone is not a
completed job. Incoming evidence is not independent chain-finality verification.
`ownSettledSpendMicros`, `creatorRewardsMicros` and `paidCreators` remain null.
Detail citation `recordedRewardUsdc` is a stored attribution, not creator earnings.
There are no public report links, creator-ledger or privacy-mutation capabilities.

All responses are private/no-store/no-referrer/noindex. Invalid inputs return
400; missing/revoked authentication 401; invalid origin or scope 403; unsupported
method 405; changed owner/session 409; absent/inaccessible unfinished detail 404;
storage, record consistency, abort or deadline failure 503. These calls do not
create jobs, submit payments, reconcile settlement or change funding authority.

Web, Desktop, CLI, MCP and bot clients retain their existing authenticated
read adapters; this addition documents the HTTP contract without granting a
surface new permissions. Runtime rollout remains part of the coordinator's batch.
