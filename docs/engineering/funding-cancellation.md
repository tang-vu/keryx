# Missing-hash approval recovery

A retained approval can be `possible` without a returned hash after an interrupted
wallet callback. Empty history, zero allowance and an unused latest/pending nonce
do not prove that signed bytes cannot later be broadcast. Preserve the original
funding hold and session custody. No new deposit or budget renewal is a recovery
step.

## Owner flow

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
