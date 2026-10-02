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
