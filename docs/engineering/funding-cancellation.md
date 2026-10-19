# Missing-hash approval recovery

A retained approval can be `possible` without a returned hash after an interrupted
wallet callback. Empty history, zero allowance and an unused latest/pending nonce
do not prove that signed bytes cannot later be broadcast. Preserve the original
funding hold and session custody. No new deposit or budget renewal is a recovery
step.

## Native Circle Google wallets

Native `ARC` and `ARC-TESTNET` wallets do not support Circle's raw transaction
signing endpoint. The current [user-controlled OpenAPI](https://developers.circle.com/openapi/user-controlled-wallets.yaml)
limits `POST /v1/w3s/user/sign/transaction` to `SOL`, `SOL-DEVNET`, `EVM` and
`EVM-TESTNET`. The broad supported-wallet matrix is not endpoint acceptance.
Error `156027` on a new cancellation does not prove an older approval was never
signed. Neither the browser nor an older/direct API caller may create this
unsupported native-Arc signing challenge. Message and typed-data signing remain
separate capabilities.

The Circle EIP-1193 adapter reports the Keryx-specific, denial-only
`keryxExactTransactionSigning.supported: false` metadata through EIP-5792
`wallet_getCapabilities`. This is not a standard guarantee of signing support.
Funding checks it before new plan creation and every ready/rejected funding or
cancellation claim. Existing external wallets without this metadata retain their
normal transaction checks. Only recognized unsupported-method errors from this
read are ignored; a network failure refuses before exposure. Never reinterpret a
`4200` caught after a transaction claim as a safe rejection. Submitted/confirmed
recovery and consent using already available Gateway credit remain separate.

For a connected Google wallet, the recovery page offers explicit read-only Circle
history inspection instead of a cancellation fee/signing prompt. A same-origin,
rate-limited authenticated POST carries the in-memory user token; the server makes
only GET requests. It independently resolves the immutable original EOA and binds
the wallet, Circle user, selected network, outbound direction and search window.
Queries are limited to 31 days and 20 rows per page. The browser follows UUID
cursors explicitly, up to five pages per search; a full page, repeated cursor,
outage, expired credential or empty result never clears the original. The displayed
date range is limited to the original creation window; it is not a claim that all
historical or subsequently signed transactions have been inspected.

Circle's Transaction contract makes `walletId`, `userId` and `sourceAddress`
optional. Missing fields no longer discard a valid page. Every supplied identity
field must still match the verified original; malformed or conflicting fields
reject the page. A candidate hash requires a positive match through `walletId` or
`sourceAddress`. A row with only `userId`, or neither wallet/owner field, remains
status/ID metadata with its hash withheld. All rows still count toward the page
size and cursor. A candidate hash remains subject to the canonical finalized
sender/nonce verifier before any original can change.

History failures emit a bounded server diagnostic containing only the stage
(`wallet`, `list` or `validation`), available HTTP status/numeric Circle code, or
allowlisted Zod issue paths. Tokens, headers, wallet data, raw responses and error
messages are never serialized. The client retains the existing generic error.
These diagnostics distinguish an upstream refusal from a response-contract
failure; a static parser mismatch alone does not establish the live 503 cause.

Circle IDs, statuses and hashes are candidate metadata only. The owner can check
a returned hash through the existing configured-RPC canonical finalized nonce
verifier. That verifier distinguishes the exact planned approval from another
transaction consuming its nonce. Lookup never signs, broadcasts, deposits, renews
a budget, stores credentials or terminalizes an attempt from vendor status alone.
Previously saved cancellation hashes and manual original-hash inspection remain
available. A wallet/account change aborts or discards the in-flight history page.

Native Circle cancellation requires a Circle transaction ID and accepts only an
idempotency key; it does not accept this flow's hard gas/fee limits. Native transfer
and contract execution do not accept a caller-selected nonce. They are not silent
fallbacks for the exact-nonce cancellation. No generic-EVM wallet substitution,
new wallet/custody or new self-transfer is introduced. If no exact finalized hash
can be recovered, this historical original remains held. A managed native Circle
transaction lifecycle with retained challenge/transaction IDs is separate work,
not completion of this original's recovery.

## Owner flow for wallets supporting exact transaction signing

The wallet page offers a separate cancellation fee review for an unresolved
approval whose deposit is still `ready`. It uses the retained original nonce,
exact owner and configured Arc profile. The recipient is the same owner, native
value is zero and calldata is empty. Contract/delegated-code accounts refuse this
flow. The owner reviews network, nonce, gas limit, both EIP-1559 fee limits and the
exact maximum native USDC gas cost (18 decimals), then explicitly consents and
signs. This does not transfer research principal or revoke a token allowance.

A review lasts 60 seconds through signing and broadcast. That deadline is an
application guard; an already signed transaction has no on-chain expiry. Current
fee estimates include a 20% margin. An unknown earlier pending transaction may
have a higher replacement fee and prevent acceptance. There is no automatic fee
bump, signature retry or rebroadcast.

## Persistence and authority

The existing IndexedDB journal retains cancellation attempts separately from the
original approval hash/status. An exact original-snapshot CAS claims an attempt
before the sign-only wallet call. Returned bytes must independently match the
reviewed type, chain, recovered owner, nonce, recipient, zero value, empty data,
gas, fee fields and access list. Their deterministic hash is saved before a
separate CAS claims the single raw RPC send. The pinned viem action sets
`retryCount: 0`. Raw signed bytes and credentials are never persisted.

Timeout, rejection, storage failure, account/network change, supersession or an
expired review never clears the original hold. A verified late signature can
retain its hash but is not sent after expiry. An explicit fresh review may
supersede an interrupted attempt, keeping every previously saved hash. Every
candidate uses the same original nonce, so only one can consume it. A stale
sign-only completion cannot claim a send. Signature and broadcast actions are
owner actions; preparing this feature does not authorize an agent to execute them.

Saved hashes survive reload and have a read-only finality check. The existing
replacement verifier requires canonical finalized same-sender/same-nonce evidence
from the configured RPC. Only that verifier resolves the original journal. A
finalized cancellation releases the old plan without claiming funded research.
The original approval may win the race; its actual outcome remains authoritative
and does not automatically send a deposit. Nonce consumption observed without a
recoverable hash still requires positive transaction evidence.

The added journal fields are optional for old records. Older strict parsers may
refuse records containing cancellation metadata; rollback must preserve the hold
and current recovery parser, never delete the record to regain funding access.

## Surfaces and acceptance

Web and desktop-hosted wallet pages share this browser-owned recovery. CLI, API,
remote/stdio MCP, extension and bots neither own its IndexedDB custody nor gain a
signer or funding authority; they continue to hand owner wallet actions to web.
No public request/payment contract, cap, grant, installer or package version
changes. Existing ROOT owns the combined deployment and surface delivery checks.

Focused tests cover exact signed-envelope mutations, wrong owner/chain/code/nonce,
fee and balance failures, snapshot/claim races, expiry/abort/account changes,
storage failure and uncertain raw sends. Hermetic browser tests use the real
IndexedDB journal and existing finalized verifier to cover consent, fee units,
hash-before-send persistence, reload and superseded signer callbacks. All keys,
signatures and RPC responses in these tests are synthetic and cannot establish
live settlement or a successful Circle wallet signature.
