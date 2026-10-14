# Customer acceptance on the verified application store

The native constructor composes the existing customer journal on the genuine
verified SQLite connection. It does not install tables, seed a journal identity,
or attach an ordinary fallback. Its exact schema and immutable identity fences
must already belong to the coordinator's admitted user-domain bundle. The
migration creates the one new journal UUID in `deliverable_acceptance_store`;
the native constructor requires that single original and never replaces it.

The ordinary constructor retains its existing initialization and enrolled-store
refusal. Both constructors share the original settled-purchase binding,
customer session/key checks, idempotency, revisions and explicit sharing logic.
Accepting, requesting revision or rejecting a deliverable remains a customer
opinion; it grants no refund, payment, cancellation or worker authority.

Native reads check the held identity, fences, deployment and schema before and
after the transaction. Native writes additionally require the private verified
connection's writable policy before SQL. Readonly write denial leaves a healthy
reader usable. A provenance or native statement refusal permanently retires
that port; there is no retry through an ordinary connection or recreated UUID.
Temporary SQLite BUSY/LOCKED errors return unavailable without closing the
borrowed application connection. A subsequent operation must pass the same
provenance checks again; transaction failure still rolls back.

The native application facade exposes the admitted port as a frozen,
nonenumerable capability on writable and readonly stores. An original store
without the complete bundle retains no acceptance capability; startup performs
no DDL. Session/key and HTTP/MCP contracts remain the existing shared contracts.

The first migration installs the fixed 19 user-domain tables together. The
mainnet family remains exactly four shapes: archive absent/present crossed with
the complete bundle absent/present. The never-deployed private-profile-only
after-shape is retired. `private-profile-storage-migrate` and its receipt format
remain compatibility names for this single migration. Its stopped-writer,
typed-original, flushed no-replace backup, EXCLUSIVE admission and uncertain
post-commit acknowledgement rules remain mandatory. Only the acceptance UUID
singleton is seeded; no users, ownership, consent or public profiles are seeded.
Table presence does not enable a feature: native ports and their individual
verification remain necessary, and existing held flags remain held.

Full-bundle migration and native policy checks have passed. Customer API/facade
verification, required CI and the next combined production deployment remain
release gates. The currently deployed acceptance endpoints remain unavailable.
