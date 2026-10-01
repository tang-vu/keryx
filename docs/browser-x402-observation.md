# Read-only Circle transfer observations

This dormant server helper observes a retained browser fetch original and a
matching Circle API record. It does not admit or expose an original, submit a
payment, change a journal, release capacity, grant private-body access, or mount
a route. No deployed gateway or worker uses it in this stage.

## Protected lookup and evidence scope

Accept only a bounded namespace/query/session/request locator and an optional
transfer UUID hint. The installed application's journal provides a signer lookup
hint; only its coherent exposed-original reader and shared cryptographic
snapshot validator establish the retained original and owner query proof. Check
the complete locator, original, nonce, economic tuple, network and asset before
contacting Circle. Read the same installed adapter again afterward and refuse
changes to the immutable original or owner proof. Legitimate phase progression
does not rewrite those facts.

There is no production caller-provided backend, fetch function, origin, receipt
JSON or token-minting callback. Privileged application code, the installed
adapter and the runtime's native fetch remain trusted. A private adapter-instance
binding is not an enrolled storage identity or a cross-restart recovery proof.

The evidence's `originalDigest` is SHA-256 of canonical JSON for the complete
retained original DTO. `queryProofDigest` uses the existing verified query-policy
digest. Consumers must use these definitions rather than assume interchangeability
with another stored digest or a Gateway signature hash.

Search the fixed Circle testnet transfer endpoint with nonce and economic
filters, then independently compare the returned nonce, payer, recipient,
integer micro-USDC amount, token and both networks. A UUID from a seller header
is a locator hint; it cannot establish settlement. Duplicate matching records,
mismatches, malformed replies, incomplete pagination and outages remain
unavailable, rather than becoming proof of nonpayment.

Pagination follows the pinned Circle SDK's Link-header transport contract.
Consume only bounded cursors for the fixed endpoint and rebuild requests with
the original filters; refuse foreign, malformed, repeated or exhausted next
links. Evidence covers the returned nonce-filtered API pages. It does not prove
complete independent ledger history or provider honesty.

## Honest states and bounded lifetime

The [Circle transfer reference](https://developers.circle.com/api-reference/gateway/all/get-x402transfer-by-id)
distinguishes accepted, batched, onchain-confirmed, completed and failed states.
It also identifies the transaction hash as a nullable batch-level reference.
Retain the actual status and hash. A shared batch hash does not identify this
authorization's exact onchain leaf, and an API status is not independent chain
finality. The observation explicitly carries `basis: "circle-api"` and
`chainFinality: "not-verified"`.

Use a 30-second total lifetime, five-second requests, four pages of at most
50 records, and four MiB across all response bodies. Decode bounded UTF-8 and
reject unsupported response shapes. Redirects and retries are disabled. Eight
shared slots bound concurrent observations and token readbacks; a timed-out
caller does not free a slot while noncancelable backend work still runs.

An opaque, immutable observation token lasts five seconds from the first actual
matching API observation. Backend readback and unseal cannot restart that
lifetime. Token readback checks the same adapter and immutable original again,
within the remaining lifetime. Caller JSON cannot recreate a verified token.

Historical metadata observations may remain valid after a grant expires or is
revoked. They confer no current signing permission, payment admission or access
to the owner's question, answer or paid body. A failed provider status does not
automatically cancel an original or restore a spend reservation.

## Remaining authority and release gates

This helper supplies facts, not a paid-read receipt or citation authorization.
Reward eligibility remains closed until the separately signed citation policy
binds an approved, retained authority manifest defining status and finality
requirements. Mainnet contract, SDK and exact-leaf/finality acceptance remain
separate gates.

A buyer-owned issuer must still capture the actual native delivery, authenticate
the creator's manifest and article version, join the exact original and approved
settlement evidence, then publish and reread encrypted private evidence before
creating an immutable reward plan. External sellers need no shared artifact key
or internal Keryx callback. Existing cache text and unsigned response headers
cannot manufacture that lineage.

Missing settlement evidence must degrade the relevant source or reward leg
without discarding a completed answer, redistributing withheld shares, or
stranding an SSE request. Pending work, grant expiry, storage identity, artifact
recovery and any on-demand resumption need explicit acceptance; this helper does
not supply an autonomous scheduler.

Source acceptance requires actual isolated SQLite/native HTTP tests, historical
v2 and v3-fetch consumption, bounded streams and pagination, mutation and
coherent-read refusal, expiry without slot leaks, unchanged database state,
TypeScript, scoped lint, independent review and required CI. PostgreSQL parity,
controlled buyer integration, private reader authentication and separate-origin
signer/custody cutover remain open until their own evidence passes.
