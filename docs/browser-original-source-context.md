# Immutable source context for browser originals

This is a dormant source candidate for the separate-origin signing path. It does
not activate that path, replace the deployed worker, mount a public route, or
authorize funding. The existing owner query-policy signature and Gateway payment
typed-data schemas remain unchanged.

## Why a new original format is needed

The prior immutable original input retains supplied source, kind, offer and
article identities. Its signing/observation projection does not contain the full
source authority needed to reproduce the deployed browser's payee and price
checks. In particular, an offer ID cannot reconstruct its creator-signed proof.
Joining a current source or offer would substitute new state for the original.

The new original format therefore retains mandatory, versioned fetch context
before exposure. Its digest binds that context to the original namespace, query,
request, epoch, nonce and exact economic tuple. This is a durable backend binding;
Circle's unchanged Gateway signature does not verify article provenance.

The context contains the source and exact article version, registered source
identity and endpoint binding, pinned registry observation, creator, payout,
integer list price, and explicit price mode. A discounted price additionally
retains the complete original creator offer proof. Missing proof cannot become
list-price authority by default.

## Authority and admission

The trusted resolver establishes the source-to-registry mapping and the actual
entry at the captured block. Caller-provided block hashes, creator addresses and
payouts are assertions, not independent authority. Admission verifies the active
source, endpoint, payout, exact integer price and, for discounts, actual creator
signature, article/version, offer identity, expiry and price ceiling.

Capture and validate caller input before asynchronous work. Network observations
precede the database transaction; context, original and existing reservations
then commit atomically. This does not make blockchain reads atomic with SQL or
remove RPC, catalog-mapping and backend service-role trust.

Retained context is immutable. Same-original replay cannot change context,
refresh validity, select another offer, reset query limits or add capacity.
Observation projects only retained evidence in the existing coherent exposed-only
read. It does not recover missing proof by joining today's source or offer.

Historical validation uses original admission time and evidence. A future fresh
signer must independently revalidate current source authority and offer expiry.
Changed payout, deactivation, incompatible price or unavailable authority must
refuse without rewriting the original. That signer integration remains a gate;
historical observation is not an atomic permission or revocation barrier.

## Compatibility and cutover

Retain the prior original format and its exact reconstruction/header verification
for history and callbacks. Do not upgrade or backfill old rows. The new format is
an explicit union member requiring complete source context and its derived digest.

A monotonic minimum-original-version floor belongs to the existing control and
retained barrier. Installation does not raise it or activate authority. When a
separately authorized cutover raises the floor, incompatible fresh admission and
prepared-to-exposed transitions must refuse, including through old writers after
rollback. Deleting or recreating control cannot lower the retained floor.

Already exposed old originals keep exact canonical callback and historical
recovery eligibility, including their first callback. Safe cancellation of a
never-exposed original still requires the existing atomic transition. No timeout,
missing ACK, format change or read releases an exposed hold. Policy, epoch,
signer and nonce history are shared across formats.

## Citation prerequisite

The new context-dependent lane must refuse fresh citation signing until it has
an immutable pre-payment reward plan. The current agent computes its evidence and
source/author splits before payment, but saves the completed QueryRun afterward.
That record cannot reconstruct an original pre-payment authorization.

The next necessary stage must retain the query/question/answer/evidence identities,
eligible owned article versions and evidence markers, exact pool, source
allocations and author legs before any reward original is exposed. Unique leg
admission must bind the original recipient and integer amount to that plan and
retain its cumulative bounds. A digest or allowlisted wallet alone proves neither
authentic quoted support nor that an article was actually cited. Current offers,
completed answers and mutable allocations cannot manufacture historical evidence.

This staging does not redefine the product as fetch-only. Citation authority and
the complete separate-origin delivery path remain required for the intended
release. Existing deployed legacy behavior is not cut over by this candidate.

## Acceptance and remaining gates

Source acceptance requires actual SQLite and PostgreSQL/PostgREST evidence for
atomic rollback, immutable context/replay, wrong creator/version/price/payout and
missing-proof refusal, coherent historical projection, old-writer fences and
preserved exact historical callbacks. Tests must distinguish verified resolver
observations from arbitrary supplied metadata and preserve counters on refusals.

Production acceptance still requires trusted enrollment and exclusive history,
independent registry verification by the signer, citation-plan authority, owner
approval UI, independent signer assets/hosting, key custody and recovery, actual
wallet/mobile integration, UTC trust, cutover/drain/rollback and external review.
No activation issuer, transaction signing, mainnet permissions or real funds are
introduced. Source tests do not close M1–M8.
