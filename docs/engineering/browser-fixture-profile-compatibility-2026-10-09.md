# Browser fixture profile compatibility — 2026-10-09

The composed decision-review source exposed three fixture assumptions: the browser
journal PostgreSQL check applied ordinary-only migrations after a native marker;
two standalone browser bundles imported wallet authentication; historical render
tests had no auth context for their current-report comparison. Runtime authority,
native migration refusal and the existing historical report gate stay unchanged.

The journal fixture preserves every supplied accepted migration through 0085,
including the actual native substrate, domain wrappers and cutover contracts. It
separately classifies ordinary-only 0086/0087, actively checks their native refusal
and rollback, and installs them on a fresh ordinary database using actual 0001–0072
and 0078 prerequisites. It does not install the native-dependent 0077/0079 catalogs
on that ordinary database. A future unclassified migration fails the fixture
rather than being silently installed or omitted. Separate feature fixtures retain
their complete customer-original, concurrency and RPC acceptance responsibilities.

Default CI still uses an owned network-none PostgreSQL 17 container. The explicit
portable options `--psql-bin ABSOLUTE_BIN --port LOOPBACK_PORT --cluster-dir
ABSOLUTE_DATA_DIRECTORY` require an owned empty cluster, exact data-directory,
loopback/port/version/PID identity and fresh synthetic roles before DDL. The
fixture uses actual psql clients and pg_ctl restart/stop, preserves the journal
across an actual database-process restart, and retains direct lifecycle logs.
Restart does not prove power-loss durability or production enrollment.

Standalone selection/payer browser fixtures replace only the wallet-auth hook
with explicit signed-out state. They retain the real research hook, ResearchTurn
and DecisionReviews, assert the esbuild input graph includes those modules and
excludes Node JWT, and run actual Chromium behavior. The selection fixture uses
compile-time empty client environment with its explicit testnet definitions.
These fixtures do not qualify authentication or human decision controls; the
actual built owner/Origin/UI feature fixtures remain separate gates.

Historical render tests keep DecisionReviews real, provide a signed-out hook
boundary for current composition, and prove frozen archives neither call that
hook nor expose review/feedback controls. This is fixture maintenance: no product
version, deployment, payment, wallet, database rollout or wider issue completion
is claimed. Exact candidate CI/platform acceptance remains required.
