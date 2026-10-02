# Full mainnet server migration

The owner requested the existing public Keryx product on mainnet, across its supported
surfaces. This supersedes the invited-pilot release proposal. The default deployment
remains Arc testnet; preparing or selecting a profile does not authorize a production
cutover, funding, or spending.

The actual public deployment uses SQLite. Its full ordinary mainnet release targets
a fresh sealed SQLite namespace while retaining legacy testnet custody and history
separately. Supabase mainnet is an optional staged backend, explicitly closed until
independent source-generated native PostgreSQL acceptance; it is not a gate on the
ordinary SQLite public release.

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
The authenticated challenge route admits at most six requests per actor per minute
through the existing durable rate limiter before any Circle lookup or issued epoch.
Unavailable limiter state refuses; this operational abuse bound adds no pilot list
or funding/spending authority.
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

The mainnet funding client may opt into authenticated
`GET /api/session/credit?address={signer}&accounting=original-v1` (with optional
`grantEpoch` for retained ownership and `after` for a canonical baseline timestamp).
Alongside the known balance, it returns `observedAt`,
`accountingAuthority:"original-admitted-settled-v1"`, actual
`confirmedSpentMicroUsdc`, `retainedSpentMicroUsdc` and
`postBaselineConfirmedDebitMicroUsdc`. Existing history requires the authenticated
owner's retained dual public proof. Fresh zero history is checked from native
tables; no read initializes a journal or assumes missing authority means zero.
Accounting must remain stable around the Circle read. The offset contains only
confirmed original authorizations admitted strictly after the supplied baseline.
A pre-baseline debit whose confirmation arrives late cannot acknowledge an absent
deposit. Unknown holds, elapsed time and empty vendor searches never provide credit.
Ambiguous older deposit acknowledgment still requires original deposit provenance
or conservative recovery; this projection does not resolve every vendor delay.

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

## Session cashout and original outcomes

The normal SQLite session endpoints are `POST /api/session/withdraw/prepare`
with `{sessAddr,grantEpoch,amountMicros}`, `POST /api/session/withdraw/submit`
with `{requestId,signature}`, and `GET /api/session/withdraw/{requestId}`.
The owner reviews the amount and fee ceiling before preparation. The worker reserves
its local barrier and calls `POST /api/session/withdraw/authorize` with `{requestId}`
before any burn signature. That immutable exposure marker is required by submit.
`POST /api/session/withdraw/cancel` accepts the same selector only while no exposure,
signed request or transfer claim exists. It atomically retains `cancelled_unexposed`
and permits a new reviewed preparation; the old ID cannot sign, submit or reactivate.
GET, authorize and cancel return the same original preparation plus `signingPhase`
(`prepared`, `exposed`, `cancelled_unexposed`, `completed`) and an exact original
cancellation acknowledgement when applicable. A worker releases its local barrier
only for matching cancellation and no local crypto exposure. Uncertain authorize,
signed or submitted originals stay held; a timeout or empty vendor lookup is no proof
of cancellation. This is the trusted normal-client never-exposed protocol; it does
not cancel an already signed on-chain intent or erase a key held elsewhere. Payment
lifetime counters and nonces remain retained throughout.
Preparation verifies the authenticated owner's retained public delegation and
signer-possession proof independently of the active grant. It reads fresh selected
chain/Circle fee and finite height terms and preserves an immutable original burn.
The prepared balance binds available funds, confirmed lifetime debits, held payment
liabilities, held withdrawals and exact fee. One `BEGIN IMMEDIATE` checks all those
native counters before committing the withdrawal barrier and pausing grants.
An admission and settlement between the quote and transaction therefore refuses.

The signed request, one transfer claim and matched attestation use the existing
`creator_withdrawal_*` journal. Repeated requests recover the original salt, fee,
network and request ID. Response loss, expiry, revocation or missing search evidence
cannot permit another burn or release unknown liabilities. Authenticated
`GET /api/session/withdraw/payments?sessAddr={signer}&grantEpoch={epoch}` exposes
bounded original liability pages with optional `afterNonce` and `retryAuthorized:false`;
it cannot resubmit those authorizations.

The owner wallet reviews and submits the exact selected mainnet mint calldata and
its own gas. `POST /api/session/withdraw/complete` accepts only
`{requestId,transactionHash}`. The server reads the actual signed owner transaction,
matches the original attestation, mint recipient, value, event and canonical finalized
receipt through the selected RPC, and retains that exact completion. It never accepts
a client claim of finality or signs/broadcasts a mint. Completion releases only the
withdrawal barrier; lifetime payment counters and all unknown payment holds remain.
The same stable signer can then receive a new explicit owner grant and resume research.
The worker must independently verify this original outcome before releasing its local
barrier. Native synthetic handler evidence is not funded vendor acceptance.

Preparing a new withdrawal requires operator-selected integer
`KERYX_WITHDRAWAL_MAX_FEE_MICROS`, matched `KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS` /
`NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS` and
`KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS`. These do not initialize a gas relay,
private key or automatic funding path. Original status remains readable if new
preparation policy is unavailable.

## Ordinary creator owner-wallet cashout

On selected mainnet, `/api/me/withdrawals/prepare` returns the ordinary unsigned
creator draft for local persistence and explicit owner review. Rejection before
signing creates no server withdrawal hold. `/submit` validates the exact owner
BurnIntent and atomically retains it against fresh known Circle availability and
all local browser, hosted and withdrawal liabilities. The transaction compares
confirmed debits as well as holds; concurrent admission or settlement invalidates
the quote. Signed unknown originals remain held, and the existing one-use transfer
claim prevents response loss from issuing another burn.

Authenticated `/status` returns the original private record, attestation, transfer
progress and read-only simulated owner mint calldata. `/complete` takes only the
original ID and public transaction hash, observes the actual owner-signed mint and
canonical selected-chain receipt, and retains its completion before releasing that
original capacity hold. The connected owner wallet explicitly pays mint gas. This
path does not require a gas relay, treasury key or the legacy `/api/withdraw` path.
History remains private. Supabase owner cashout stays closed pending native evidence.

## Prefunded hosted mainnet payments

Normal treasury requests select `createMainnetHostedGateway` on mainnet. An actual
enrolled SQLite facade and a reviewed canonical policy are required before the
separately named key can be read. The policy binds the complete storage identity
digest, HTTPS origin, dedicated signer, cumulative lifetime ceiling, per-query
ceiling and expiry. `KERYX_MAINNET_TREASURY_POLICY_JSON` must be canonical and its
SHA-256 must equal `KERYX_MAINNET_TREASURY_POLICY_DIGEST`. The dedicated
`KERYX_MAINNET_TREASURY_PRIVATE_KEY` must match that signer. Private execution uses
the corresponding `KERYX_MAINNET_PRIVATE_TREASURY_*` policy/key and a distinct signer.
Native policy history binds each signer permanently to its public or private role;
a later public rotation cannot recycle historical public custody as private authority.
Absent admission or known prefunding refuses real payment; it never chooses the
testnet key loader, creates custody, deposits funds, or enters the staged funding
executor. The owner chooses operating budgets and prefunds Gateway explicitly.

The installed SDK's validated full typed authorization is atomically reserved before
crypto. Native admission compares retained/confirmed accounting across the fresh
Circle read, enforces signer lifetime and original query ceilings, and retains the
exact nonce, source, recipient, amount, network, contracts and validity. The header
hash and submission marker commit before paid HTTP. A second connection cannot spend
the same remaining cap or resubmit an original nonce. Renewing the policy expiry does
not reset signer or query totals. Unknown response, timeout or an empty ledger search
does not release exposure. Policy expiry stops new admission; it does not revoke an
already signed authorization that remains valid at the vendor. Existing original-network
reconciliation owns public payment outcomes. Private execution reuses its original incoming settlement,
single-use worker claim, creator submission and confirmation journal; those creator
legs never enter public payment rows. Normal private mainnet purchase admission has
no payer invitation list; product budgets, authenticated ownership, worker health,
distinct merchant authority and known treasury capacity still apply.

Native synthetic evidence covers actual selected SDK signatures, pre-crypto native
reservation, pre-HTTP submission persistence, concurrent lifetime-cap refusal,
unknown submission retention, policy renewal and private ledger isolation. It does
not establish real vendor settlement or activate an operating policy. Optional
Supabase hosted authority remains explicitly refused pending native schema acceptance.

## Remaining acceptance

Before activation, compose the final browser, backend and operational changes on
current main and verify applicable web, desktop, CLI/MCP, API, extension and bot
distribution. Native synthetic acceptance now covers normal owner delegation,
original payment recovery, hosted public/private signing and session/creator cashout.
Browser authored acceptance separately exercises actual worker/React/SSE/paid body
and citation journeys; their exact combined release still needs review. Fresh
authoritative mainnet source registration, owner-approved operating budgets and
funded external vendor acceptance remain operational gates. Optional PostgreSQL
support requires its own native schema and concurrent-writer evidence. Synthetic
tests do not establish funded settlement or external security-audit closure.

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
transport prerequisite. Native normal session recovery and owner-wallet creator
cashout are now implemented. The optional creator gas-relay operator remains staged;
ordinary creators explicitly submit their own reviewed mint and gas.
