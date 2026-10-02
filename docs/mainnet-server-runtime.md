# Full mainnet server migration

The owner requested the existing public Keryx product on mainnet, across its supported
surfaces. This supersedes the invited-pilot release proposal. The default deployment
remains Arc testnet; preparing or selecting a profile does not authorize a production
cutover, funding, or spending.

## Application storage boundary

The normal `getDb()` selector calls `lib/db/application-storage.ts`. Matched server and
public build configuration selects a canonical Arc profile. Mainnet requires an explicit
protected storage manifest whose immutable identity matches that profile. It cannot
fall back to the legacy SQLite path or a legacy Supabase client. A changed identity or
manifest invalidates the admitted facade before another operation.

General mainnet identity uses `keryx-mainnet-storage-identity-v1`, `mainnet-real`, and the
canonical mainnet storage-profile digest. Its namespace is freshly provisioned; existing
testnet data cannot be enrolled, relabelled, or adopted into it. Testnet history, signed
authorizations, custody and recovery artifacts must remain separately retained.

SQLite provisioning installs the source-owned application schema and profile fences
inside its existing native writer transaction. Browser admission preserves atomic
nonce insertion, authoritative payment row, retained grant epoch and cumulative signer
capacity. Selected-profile preparation rejects a foreign network or Gateway contract.
Unknown or pending liabilities are retained; profile selection never resets them.

The application storage role permits only the reviewed enrolled factories and their
storage substrate. Its entire transitive graph remains checked. Provisioning and the
separate Gateway funding executor, orchestrator, transaction and composition modules
remain unreachable from ordinary application entrypoints. Mainnet storage also denies
the dormant funding ledger's writes. This boundary does not confer wallet custody or
approve automatic treasury top-ups.

The Supabase composition selects the enrolled adapter without legacy fallback. Its
existing PostgreSQL source-contract verification still rejects a mainnet marker until
the new identity, profile-bound SQL writers/fences and normative source-generated
catalog witnesses pass actual PostgreSQL acceptance. Selecting this adapter is not
evidence that those mainnet SQL capabilities work.

## Normal payment integration

The shared pure session consent contract binds the independently selected network,
chain/token/Gateway, origin, owner, session signer, single-use server grant epoch,
cumulative integer micro-USDC cap and expiry. The readable owner delegation signature
is separate from the secret session-key derivation signature. Parsing is structural
validation; server admission and worker checks must independently enforce approved TTL,
known funding, current owner authority and retained consumption.

The normal mainnet API uses authenticated `POST /api/session/grant/challenge`
with `{sessAddr,budgetMicros,recover?}` and returns `{consent,funding}`. `budgetMicros`
means desired current funded capacity. The server chooses the entropy-backed epoch
and proposes a cumulative cap of confirmed lifetime debits plus the smaller of desired
current capacity and known mainnet Circle availability. The public funding projection
contains `availableMicroUsdc`, `confirmedSpentMicroUsdc`, `retainedSpentMicroUsdc` and
`proposedRemainingMicroUsdc`, all canonical nonnegative integer strings. Retained spend
includes pending/unknown holds; those are never credited as confirmed or released by
renewal. Accounting must remain stable across the balance read. Expiry is limited to the configured
TTL (at most 86,400 seconds). Its issued challenge expires after 90 seconds.
`POST /api/session/grant` accepts `{consent,signature,sessionSignature}`: the owner's
public delegation and a separate exact-grant public proof of session-key possession.
Both proofs are verified before one atomic consumption/upsert. Another owner cannot
claim a publicly known funded signer without that signer's exact proof. Replays cannot
recreate epochs or reset retained capacity. Historical proofs remain after expiry.

`GET /api/session/grant` returns the current tuple, network, origin, canonical
`capMicroUsdc`, nested `consent`, `ownerSignature` and `sessionSignature` plus expiry
metadata and actual retained `spentMicroUsdc` (also returned by grant POST).
`POST /api/ask/challenge` accepts only `{reqId}` from the authenticated
owner and returns its live exposed original journal tuple, requirements, nonce and
full persisted item/offer context. It cannot construct authority from an SSE packet
or callback fields. SQLite normal handler acceptance covers these endpoints;
PostgreSQL owner-consent methods refuse until their native migration is admitted.

`GET /api/session/authorizations/{reqId}` is an authenticated, owner-scoped
read of the original durable authorization, including after expiry, replacement
or revocation. It returns `{journal,authorization,settlementConfirmed,
statusAuthority:"retained-journal-only",retryAuthorized:false}`. The retained
public owner consent and signer-possession proofs bind the original epoch and
signer; the response contains no payment bearer header or custody material.
Confirmed settlement requires the original settled journal phase and actual
recorded transaction evidence. An unresolved record remains held: reading it
cannot create a retry, replacement nonce or payment permission. Foreign owners
receive no original record.

The held-balance monitor accepts only exact current-chunk depositor/domain rows
with both canonical finite, nonnegative six-decimal balance fields. Missing,
malformed or duplicate rows remain unknown instead of displaying zero; a row
from another request chunk cannot overwrite its result. This read does not
authorize funding or release a payment hold.

Mainnet source fetch and citation terms require a fresh active on-chain creator-owned
URL identity; cached testnet rows or an RPC outage cannot supply fallback payout
authority. The mainnet bindings retain the exact encrypted item identity and complete
signed offer context. Selected RPC checks attest both before and after authority
reads, and local SDK signing/transaction boundaries validate the actual mainnet
domain independently of a returned challenge.

`GET /api/source/{id}/item/{itemId}/preview?version={contentVersion}` returns only
the exact current item identity, fresh source-owned `payTo` and canonical integer
`listPriceMicroUsdc`. Missing, duplicate or stale versions refuse before payout lookup;
inactive sources and authority outages refuse without cached fallback. It exposes no
article plaintext or encryption key and uses no-store responses. The independent
browser worker compares this metadata with the original admitted item context.

The caller buyer protocol captures the public deployment profile before reading any
challenge. Its existing request/amount limits remain normal caller policy, with no
invitation list or pilot-wide ceilings. A foreign challenge cannot choose the chain.

Mainnet cannot select offline payment simulation because a treasury key is absent.
During the unfinished treasury migration, `RealGateway` refuses mainnet before loading
the legacy persistent wallet or constructing signers. Completing normal treasury,
private, A2A and hosted sponsor roles still requires reviewed mainnet custody and
funding admission; this temporary refusal is not the final full-surface deliverable.
Paid-content cache encryption is required for mainnet independently of a treasury key.

## Remaining acceptance

The full release still needs the actual normal owner grant, independent worker challenge,
SSE signature, seller settlement, decrypted body/evidence and citation reward journey;
fresh authoritative mainnet source registration; original-network reconciliation;
caller/session and creator withdrawal; and applicable API, private/A2A, treasury,
CLI/MCP, desktop, extension and bot distribution checks. PostgreSQL support requires
native schema and concurrent-writer evidence. Existing component and synthetic tests
are supporting evidence, not funded settlement or external security-audit closure.

Cash-out must preserve original signer custody after payment expiry, revocation or
logout, authenticate its retained owner independently of the active grant, and retain
signed pending liabilities when calculating available withdrawal capacity. Restoring
custody for withdrawal does not renew payment permission. No actual mainnet activation,
private custody file, funded transaction or deployment is part of this preparation.

Withdrawal transport preparation now accepts an explicit canonical mainnet profile:
the unsigned builder pins its contracts, the v2 request retains its original network,
and estimation, metadata and transfer reads select the fixed Circle service from that
profile. Testnet v1 requests remain readable on their original rail. Mainnet contract
or network relabeling refuses before signing or vendor transport; fresh height checks
compare both chain and the same observed block before/after metadata reads. Circle's
[supported chains](https://developers.circle.com/gateway/references/supported-blockchains)
and [live metadata](https://gateway-api.circle.com/v1/info) were checked on 2026-10-02
for Arc domain 26, Mainnet metadata and the pinned wallet/minter addresses. This is a
transport prerequisite; normal session recovery routes, durable cashout holds and
mainnet creator relay admission remain unfinished and are not activated by these helpers.
