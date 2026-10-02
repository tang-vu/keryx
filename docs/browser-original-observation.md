# Browser original observation (source stage)

The observation helpers authenticate a retained session signer with a separate
`KeryxOriginalObservation` EIP-712 domain. They prepare a bounded GET-only protocol
for `https://keryx.cc/api/ask/original-observation`; no public route, worker bootstrap,
origin deployment, credential issuer or runtime activation is installed by this stage.
The existing trusted-owner snapshot reader is unchanged.

The signed request fixes the audience, method, path, session and request IDs, a random
challenge, and a five-second server-time window. It carries no asserted owner. Actual
signature recovery precedes the backend read. The new SQLite transaction and private
PostgreSQL snapshot operation derive the historical owner from the retained original
and policy namespace in one coherent read. Only `exposed`, `signed`,
`submission_attempted`, `settled` and `failed` originals are returned. Prepared and
cancelled-unexposed originals return no nonce, signing tuple or economic proof. Reads
never mark an original exposed, admit a payment or release capacity.

The response is a descriptive, read-only projection of the original, owner-approved
query and current namespace policies, retained counters and current grant. It contains
no signing-permission field. Its read interval encloses the backend read and validation;
it cannot make a subsequent signature atomic with revocation or another writer.
Historical revoked-signer access and replay of a captured signed read request during
its short validity window remain explicit privacy residuals requiring production review.

The client captures native fetch, omits credentials and referrers, refuses redirects
and retries, and bounds streamed bodies without trusting Content-Length. Proof headers
are canonical and at most 4 KiB; responses are at most 16 KiB. Five-second total age
includes clock bootstrap, signing, transport and asynchronous proof validation. Captured
wall elapsed and monotonic elapsed must be nonnegative, within budget and agree within
250 ms. Stable absolute browser UTC offsets cancel; runtime clock integrity, actual OS
sleep and mobile behavior still need acceptance. Financial authorization windows are
unchanged. Fixed refusals disclose no exception payload or proof.

The server has eight process-local concurrent slots and a bounded start rate. A caller
timeout retains its slot until the underlying asynchronous operation settles. This
limits abandoned work within one process; it is not distributed admission authority.
PostgreSQL access uses the service-only, fixed-search-path read function. Server UTC,
service-role integrity and exclusive retained backend history remain trusted boundaries.

Focused fixtures use generated unfunded keys, actual SQLite, actual ECDSA recovery,
native localhost HTTP and Chromium. They prove exposed-only historical reads without
financial writes, expiry after a delayed read, held timeout slots, streamed byte limits,
and injected elapsed discontinuities. Chromium fixture instrumentation transfers a
synthetic secret directly to a trusted test context; it does not demonstrate production
key custody or malicious-parent isolation. PostgreSQL acceptance additionally exercises
the actual database and protected role boundaries in its dedicated workflow.

Independent signer deployment and asset ownership, custody/recovery choice, actual
wallet and mobile integration, UTC trust, external review and mainnet release gates
remain open. A concrete `PrivateKeyAccount` type is not evidence of secret isolation.
