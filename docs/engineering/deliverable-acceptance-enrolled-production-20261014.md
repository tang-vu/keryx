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

This source increment is pending its genuine native fixture checks, independent
review, required CI and the next combined production deployment. It does not
claim that the currently deployed acceptance endpoints have become available.
