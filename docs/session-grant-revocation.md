# Session grant revocation and recovery

The browser pauses payment signing before asking the server to revoke its session.
The server authenticates the owner, captures the current grant, then atomically
matches its session ID, grant epoch and signer when disabling it. If recovery has
replaced that grant, the old request returns `409 session_changed`; the replacement
remains usable. The browser preserves its encrypted custody and wrapping key,
shows a paused state, and requires deliberate recovery before signing again.
Unavailable or malformed responses have the same conservative custody behavior.
Clients retained across awaited payee/price checks also refuse signing dispatch
when paused or superseded; recovery requires a fresh registration-bound client.
A confirmed revocation may clear local custody. Its awaited completion cannot
erase ciphertext or overwrite state published by a newer recovery operation.

SQLite and PostgreSQL implement the same compare-and-set. Legacy mode deletes only
the matching grant row. Journal mode expires only that matching grant and retains
original nonces, payment records, retained epochs and cumulative signer capacity.
Neither a conflict nor revocation refunds an exposed authorization. The residual
amount in the response remains advisory; withdrawals require independent balance
and settlement checks under the existing withdrawal authority.

Migration `0077_session_revoke_generation.sql` adds the fixed PostgreSQL RPC and
its identity-bound enrolled wrapper. It serializes its journal-mode observation
with journal activation and keeps the existing private writer capability inside
the transaction. Only the service role can call the legacy RPC; enrolled callers
use the named wrapper and its reviewed relation inventory. Missing or malformed
acknowledgements fail closed without a raw-table fallback.

The new functions and operation change the complete PostgreSQL source catalog.
The frozen pre/post reference comes from empty PG17 source commit `8c4d717`,
independent Actions run `36989009554`; release requires the existing native
acceptance to reproduce both catalogs exactly before target enrollment. The
owner migration replaces only dormant constants inside one transaction and
restores the identical immutable triggers before inserting the reviewed rows.
It takes enrollment's advisory mutex first, then locks the identity and enrolled
schema tables before its empty check, retaining exclusion through the refresh.
The migration refuses an already enrolled target before changing its catalog:
upgrading such a deployment requires a separately reviewed generation migration,
drain, original-state recovery and fresh enrollment. No migration relabels existing
financial history or learns an allowed catalog from a running target.

Acceptance includes an actual route with two SQLite connections racing recovery,
exposed-journal retention across revoke/replacement/reopen, actual PostgreSQL row
contention and journal accounting, the installed enrolled HTTPS facade, and the
real React hook/dedicated worker/IndexedDB path. Browser fixtures intercept every
HTTP request and use synthetic custody without funds. They test conflicts,
outages, malformed acknowledgements, successful clearing and a delayed old clear
after newer recovery. These checks do not establish funded mainnet acceptance.

This is the web session API and its shared database contract. Desktop, Operator,
CLI, stdio/remote MCP, extensions and bots keep their existing payer and recovery
roles; none gains access to a browser session key or a new payment permission.
The service behavior changes with the reviewed application deployment. No local
package or installer version is claimed synchronized by these source tests.
