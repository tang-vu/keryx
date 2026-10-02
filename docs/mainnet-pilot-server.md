# Isolated browser pilot server candidate

This release prepares an isolated SQLite server composition. Production candidate routes return
`503 mainnet_pilot_closed`: `getLivePilotServerContext()` always refuses. The ordinary application
still selects the immutable Arc testnet profile. This is internal implementation assurance,
not an external audit, M3 closure, mainnet activation or permission to spend funds.

## Shared financial path

The explicit test composition connects the existing `runAgent`, `BrowserCoSignGateway`, SQLite
adapter and durable browser journal. Profile arguments default to the existing testnet profile;
the candidate selects mainnet through a verified, independently pinned server context. A request,
challenge or Host header cannot select the payment profile or a legacy treasury fallback.

The browser and server parse the same complete public enrollment artifact. Its canonical SHA-256
binds the full intended release commit, origin, registry, approved sources and participants,
limits, custody epoch, expiry and immutable mainnet network profile. The artifact's draft
`candidateDigest` remains a preparation label. The full **enrollment digest** binds signing and
storage identity. Parsing an artifact does not authorize activation.

Only a newly created empty SQLite file can receive the distinct mainnet pilot identity. The
stored provenance digest must equal the enrollment digest. Startup verifies identity, exact
application schema and SQL fences without adopting, migrating or repairing testnet state.
Supabase is excluded. Browser journal intents, immutable binding metadata, signer capacity and
retained grant epochs use the existing tables and writer transaction.

Additional policy tables retain ask budget allocations, owner delegation challenges and seller
submission claims. Ask allocations remain reserved even after a failed, interrupted or zero-spend
dispatch. They are capacity commitments, not settled spend. Global, per-owner and per-ask ceilings
are checked in `BEGIN IMMEDIATE`, together with existing atomic nonce and grant admission.
Concurrent independent processes cannot consume the same remaining allocation twice.

Every seller payment must match an admitted journal row in `submission_attempted`: source, kind,
payee, integer amount, signer, nonce, profile, captured grant and exact signed-header hash. A
retained single-use seller claim precedes facilitator calls. Lost acknowledgements cannot
authorize another submission. Confirmed settlement remains confirmed when later delivery fails;
unread content earns no citation reward. Unknown outcomes retain capacity and require recovery.

## Browser endpoints

All write requests require the exact pinned HTTPS Origin. Origin is only an ingress check;
authority comes from owner signature verification and the server session.

| Endpoint | Contract |
| --- | --- |
| `POST /api/mainnet-pilot/grant/challenge` | `{owner,signer}` produces server-issued random grant epoch, bounded funded capacity and expiry; challenge lasts 90 seconds. |
| `POST /api/mainnet-pilot/grant` | Exact issued fields, enrollment digest and a separate owner delegation signature; consumes the challenge and creates the grant/session atomically. |
| `GET /api/mainnet-pilot/grant` | Authenticated current owner/signer/epoch/cap/expiry/enrollment metadata for reload and worker binding. |
| `DELETE /api/mainnet-pilot/grant` | Revokes the current grant, invalidates the cookie and cancels live signature delivery while retaining historical authorizations and capacity. |
| `POST /api/mainnet-pilot/ask` | Authenticated `{question,budgetUsd}` runs the shared agent and SSE pipeline within retained allocation limits. |
| `POST /api/mainnet-pilot/challenge` | Authenticated `{reqId}` returns the original exposed durable challenge only while its captured pending delivery and grant remain current. |
| `POST /api/mainnet-pilot/sign` | Authenticated `{reqId,paymentHeader}` verifies and persists non-bearer metadata. Restart recovery can acknowledge it without creating a new submitter. |
| `GET /api/mainnet-pilot/source/{id}/item/{itemId}/preview?version=...` | Authenticated exact immutable article metadata and current registry price/payee; contains no paid body or wrapped key. |
| `GET /api/mainnet-pilot/source/{id}/item/{itemId}?version=...` | Admitted x402 fetch toll and settlement-gated delivery. |
| `POST /api/mainnet-pilot/cite/{id}?author=...&amount=...` | Admitted exact creator citation reward. |

Delegation fields are canonical strings: `owner`, `signer`, `grantEpoch`, `capMicroUsdc`,
`expirySeconds`, with `enrollmentDigest` and `signature` on grant submission. The session-key
derivation signature never reaches this server. The random session bearer is retained only as
a hash and delivered in a `__Host-` Secure, HttpOnly, SameSite=Strict cookie. Old delegation
replays and old cookies cannot reinstate a replaced or revoked grant.

Deletion from IndexedDB cannot erase keys already held by another worker, withdraw Gateway funds
or claw back exposed signatures. Browser logout must first revoke server authority successfully,
then clear the local isolated key. Existing Gateway balance and uncertain authorizations remain
an explicit recovery responsibility.

## Source and surface boundaries

Registry reads attest chain identity before and after RPC, pin the returned block and recheck its
hash. Payout and author splits come only from active approved registry records with source IDs
derived from the exact creator and source URL. Mutable database payout rows and RPC outages never
activate fallback authority. One refused source is omitted without aborting other eligible
sources; discovery recheck failures emit a safe SKIP, and seller failures remain per-payment leg.

The current content subset is an exact versioned full-text article in encrypted SQLite storage,
with body hash and byte-count receipts. Signed discounts, legacy/testnet content manifests,
IPFS, scholarly purchases and legacy source bundles are excluded. Fresh feed/content ownership
and distribution-rights evidence must be reviewed before a real source is enrolled.

On a sealed pilot deployment the API proxy rejects unsupported routes and wrong hosts before
route authority runs. Legacy DB and gateway factories reject the pilot domain before legacy
wallet initialization, covering ordinary CLI, stdio/remote MCP, bot and background dispatch
composition too. SQL fences separately deny private treasury, A2A orders, API keys, funding,
withdrawals and unsupported browser-original domains. The normal testnet deployment retains
its ordinary behavior. The pilot has no server payment key or automatic funding path.

## Evidence and remaining activation work

Native synthetic tests exercise the shared authenticated SSE journey with real ephemeral EIP-712
signatures, exact decrypted cited content, fetch and citation receipts, delegation replay,
reload/replacement/revocation, restart recovery without submission, lost receipt retention,
settled-but-undelivered content, registry refusal and separate-process ask/nonce admission races.
Synthetic facilitator references are explicitly `synthetic-only:*`; generated state stays in
temporary private files and cannot become real settlement or traction evidence.

A follow-up reviewed live loader must validate an explicit owner-approved activation artifact,
the sealed identity, complete release/enrollment pins and expiry, fixed public transports and
funded-capacity evidence. Before funding, verify the deployed SourceRegistry runtime bytecode
and deployment provenance and confirmed fresh creator registrations. Operational evidence must
also cover real vendor settlement/reconciliation, retained-history restore, remaining Gateway
fund recovery, ownership/rights, the dedicated worker and renderer journey, and truthful health
reporting for closed versus active pilot mode. The existing global configuration still refuses
mainnet; these isolated routes alone do not make a usable live pilot. External security review
and broader product adoption/profit gates remain open.
