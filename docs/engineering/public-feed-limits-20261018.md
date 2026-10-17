# Bound public financial-feed reads

Both public financial-feed routes capped only the upper value of `limit`.
`parseInt("-1")` passed `-1` through to the storage reader; SQLite interprets
that LIMIT as unlimited. Isolated route regression tests reproduced HTTP 200
for that negative input on both routes before this correction. No live probe
or production mutation was performed.

Require one positive safe integer in plain decimal form before obtaining the
database. Invalid, zero, negative, fractional, lossy/exponent, unsafe or repeated
values return HTTP 400 with `invalid_limit` and `Cache-Control: no-store`.
Missing input retains the existing defaults: 50 payments and 20 withdrawals.
Positive requests above the existing maxima still clamp to 200 and 100.

The existing storage readers, payment privacy projection, response shape and
financial authority are unchanged. Web, desktop, CLI, remote/stdio MCP,
extension and bot callers using valid limits retain their behavior. This is
a bounded public read correction, with no new signing, settlement, spending,
custody, schema, configuration or schedule behavior.

Validation covers both real route handlers with a hermetic storage boundary:
invalid values refuse before database access, defaults and positive bounds
remain compatible. Preserve focused TypeScript, independent source review
and normal required CI. Existing ROOT owns serialized merge and inclusion
in the one combined release, followed by public verification.
