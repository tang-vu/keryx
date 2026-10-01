# Browser signing originals: backend stage

This candidate extends the existing browser authorization journal on Arc testnet.
It supplies backend admission and read interfaces only. Schema installation is
inactive and does not activate durable-v2, change browser routes, deploy a signer,
authorize funds, or complete mainnet acceptance. No production activation command
or flag is included. D-272 legacy recovery and retained history remain authoritative.

## Owner policy and retained capacity

`admitBrowserQueryPolicy` verifies an actual EOA owner's EIP-712 signature in the
separate `KeryxBrowserQueryPolicy` version-2 domain, chain 5042002, with the fixed
`https://keryx.cc` audience. It binds the signer, original grant epoch, question
digest, query ID, request nonce, policy ID, expiry and integer micro-USDC limits.
It does not establish that the question or approval came from an independent trusted
UI. Smart-contract owner signatures are not supported by this stage.

One normalized owner/signer/service/network namespace retains cumulative query
allocation and job count across approval IDs, aliases and grant replacement. Each
new proof specifies an absolute lifetime ceiling and job limit; neither adds to nor
resets capacity. A ceiling below retained allocation cannot admit another query.
Allocated query capacity, job count and query payment consumption are never released
in this stage, including unused allocation. These are policy counters, not an extra
payment debit or a refund. Existing journal signer/epoch reservation and exact
terminal-failure release semantics are preserved separately.

## Exact originals and callbacks

`admitBrowserSigningOriginal` commits the complete original authorization tuple,
existing intent, payment and signer/epoch reservation, plus query consumption in
one transaction before exposure. Repeating the exact request returns its retained
original without another nonce or debit; changing its epoch or economics refuses.
Fresh legs require the original query's current grant and unexpired proof. Recovery
of an already admitted original remains available after replacement or expiry.

The original's UTC window is derived once from its admitted timestamp and the
existing validated SDK timeout: validAfter is admitted seconds minus 600 and
validBefore is admitted seconds plus that timeout. No new signing grace or enlarged
SDK window is introduced. Current validity checks remain a separate integration gate.

Canonical sorted JSON, normalized addresses, decimal strings and UTF-8 base64
encoding define the full inner payment header. The new callback verifies actual
ECDSA recovery and exact full-header serialization before recording its SHA-256 and
original window. The old metadata-only callback refuses every v2 original, including
duplicates. Legacy callbacks retain their historical window/hash behavior; missing
legacy fields are never fabricated or backfilled. This is one authorization identity,
not a guarantee of one ECDSA computation, one HTTP delivery or exactly-once settlement.
Lost responses retain the original and its capacity.

## Coherent reads and backend trust

`readBrowserSigningSnapshot` reads the original, journal, current grant, retained
query/namespace counters and signer/epoch consumption in one backend snapshot. It
then validates immutable copied data and both actual owner proofs: the original
query approval and the latest namespace ceiling approval. An older query approval
need not equal a later absolute namespace ceiling; it cannot claim to authorize that
new ceiling. Reads do not repair, expire or release state.

SQLite admission uses an existing journal writer transaction and permanent retained
v2 writer barrier. PostgreSQL migration 0070 composes migration 0069 admission and
protected callbacks with private transaction capabilities, fixed search paths and
restricted table/function privileges. PostgreSQL service-role application composition
is trusted to perform ECDSA validation; SQL alone does not recover the signature.
Privileged server/database compromise, restored or cloned authority databases and
rollback remain outside this source-stage guarantee. A backup is not exclusivity proof.

## Installation, evidence and remaining gates

Normal SQLite initialization and migration 0070 install inactive schema. Synthetic
fixtures alone explicitly enable v2. Once activated, its retained barrier refuses old
fresh admission even if its control row is removed or reset; disabling fresh v2 does
not invalidate already exposed legacy callbacks. Before any future activation, drain
incompatible clients and every old writer, preserve original callbacks/epochs/caps,
and prove the intended live protocol. Do not retrofit legacy authorizations with a
new canonical window. This candidate provides no activation issuer.

Focused synthetic tests cover actual owner proofs, immutable mutation capture,
actual same-key full-header equality across fresh Chromium contexts, native SQLite
concurrent processes and termination rollback, conservative limits and legacy recovery.
Actual PostgreSQL roles/transactions and Windows/Linux CI are separate required
receipts; test intent is not a passing receipt. No real wallet, funds or private data
are used.

Remaining gates include runtime integration and activation evidence; an independently
trusted owner-policy UI and GET-only signer observation channel; independently deployed
signer asset/key custody, recovery and actual wallet/mobile acceptance; retained-history
exclusivity/restore proof; funded ambiguity/drain recovery; and independent security
review. Current parent-derived worker secrets do not pass a malicious-parent threat
model. Mainnet remains release-wide blocked while policy, key confidentiality, gas,
resume or recovery evidence is incomplete.
