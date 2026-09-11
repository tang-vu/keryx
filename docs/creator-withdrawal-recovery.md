# Creator cash-out recovery implementation

Status, 2026-09-11: in progress. The signed-request, single-admission and matched-response layers are
implemented; the production HTTP relay still needs integration with the full recovery
flow. Do not describe this foundation as completed withdrawal recovery.

## Target journey

A creator reviews the amount, recipient and bounded fees, signs once and retains the
original request before transport. The server verifies the original owner/session and
persists the request before claiming the initial Circle call. A lost response, reload
or restart leads to authenticated recovery of that same request. Subsequent steps save
the matched attestation and mint identity before broadcasting, reconcile exact chain
evidence and record a cash-out only after verified success. Pending/uncertain outcomes
remain visible. A fresh salt or signature is a new action, never a recovery mechanism.

## Implemented foundation

`lib/gateway/withdraw-protocol.ts` shares EIP-712 types with the browser builder and
validates an EOA signature against a copied policy and request. It rejects noncanonical
integer strings, uint256 overflow, nonzero address padding, changed recipients/contracts,
unsupported hooks, amounts/fees over policy and modified signed terms. Values stay in
integer micro-USDC. Its identity is the **BurnIntent typed-data digest**, not the vendor's
transfer UUID or encoded TransferSpec hash.

`lib/gateway/withdrawal-request.ts` creates a versioned Arc-testnet private record.
`lib/db/creator-withdrawal-requests.ts` and migration 0062 persist that original record
and a separate single-use transfer claim. Migration 0063 also makes the underlying
canonical TransferSpec unique. Changing a signed fee or block-height limit changes the
BurnIntent ID but cannot create another journal/admission for that same transfer.
Repeated requests return the same stored
snapshot or reject conflicting policy; they cannot overwrite it. Only the newly inserted
claim, with exact readback of its generated token, authorizes the first transfer call.
Response loss leaves the attempt retained. Retry cannot acquire another claim. No
network, signature service, Circle request or mint is performed by these database methods.

Migration 0064 and `lib/db/creator-withdrawal-attestations.ts` save the original matched
response under that same transfer claim. A foreign owner or different claim cannot save
it. Duplicate writes read back the original timestamp and payload; a different response
conflicts. Stored request identity, transfer UUID, spec hash and authority label are
revalidated on every read. A lost database response can be recovered by reading/repeating
the storage operation with the same snapshot, without another Circle POST. This does
not renew an attestation or grant mint permission. No cash-out ledger row is created.

Migration 0065 fixes competing-index races observed in CI runs 34555965891 and
34557046444. Same-request attestation saves take a transaction-scoped request row lock
before insertion; request admission handles a concurrent unique violation only when
the original ID now exists. The adapter still verifies the exact stored original.
Different request IDs cannot reuse a spec or transfer UUID. Original rows and timestamps
remain immutable. The PostgreSQL harness races fresh first insertions across eight
additional requests with three callers each and checks cross-request UUID rejection.

The SQLite schema and Supabase adapter expose identical backend methods. Both retain
request and claim identity; PostgreSQL grants journal reads and RPC execution to the
service role only, with no client access or direct service writes. Signed requests must
never appear in the public `/api/withdrawals` feed. Server retention and eventual
tombstone policy need to preserve replay barriers while respecting the final privacy policy.

## Initial transfer coordinator

`lib/gateway/withdrawal-transfer-service.ts` now coordinates the original request,
server-owned durable gas admission, one transfer claim and matched-response storage.
Only the caller receiving a fresh claim may POST the canonical signed-request array
to Circle. Existing claims never invoke admission or POST again. Invalid/lost responses
remain `awaiting-transfer-evidence`; stored attestations remain `attestation-stored`,
with `chainFinalityVerified: false`. Owner-scoped progress contains no signature,
attestation or internal claim token. A response already returned by Circle is retained
despite a subsequent caller disconnect; committed-response readback loss can recover
through the existing store. HTTP transport disables redirects/retries and bounds the
whole response by ten seconds and 16 KiB.

This coordinator is not wired into production. The relay journal now implements
`admitGas` for its required callback: an immutable original-request gas ceiling is
stored before Circle submission, without allocating a nonce or needing an attestation.
`reserve` subsequently binds the stored attestation and nonce under that ceiling.
Budget and capacity accounting use the union of held requests and legacy nonce slots,
so attaching a slot never charges twice. A cheaper mint does not release the unused
ceiling, and unknown claims cannot release their reservation. Both admission and slot
creation use the same SQLite transaction authority. Protected operator inspection
reports total committed gas and requests still awaiting an attestation/slot, without
exposing their signatures or identifiers.

Journal schema version 2 adds immutable admission storage. Version 0/1 upgrades are
explicit and preserve existing slots, signed bytes and observations; missing version-2
admission history is rejected. Existing slots continue consuming budget even without
an admission row. Seven focused tests cover contention, restart, committed-readback
loss, cancellation, original ceiling/capacity, retained unused gas, version-1 upgrade
and actual coordinator sequencing with an unknown synthetic vendor response. This is
a durable accounting cap, not proof of a funded relay balance.

`withdrawal-backed-admission.ts` now combines that cap with a native balance observation
under the shared protected directory lock. The snapshot includes every unresolved gas
ceiling; finalized original mints reduce only outstanding backing, while lifetime gas
and request limits remain charged. A fresh block must be no older than the stored mint
observations. Its hash, number, timestamp and chain are rechecked after the balance read.
The admission transaction then compares the original commitment count and total, rejecting
competing changes. Existing slots cannot grant fresh pre-transfer admission. A cancelled
RPC retains the lock until the awaited dependency settles; the concrete HTTP transport
has bounded cancellation. Tests use synthetic RPC responses and real SQLite journals,
covering insufficient aggregate backing, duplicate holds, stale/wrong-chain/changed blocks,
competing writes, cancellation and existing-slot rejection. They are not live funding
evidence. Runtime funding and exclusive key isolation, admission configuration, HTTP
integration and live acceptance remain required. Balance-only or no-op admission is not
sufficient. Historical finality observations retain the existing operator-selected RPC
trust; the backing snapshot does not independently revalidate historical consensus.

`withdrawal-admission-bootstrap.ts` now supplies a concrete server-owned admission
factory. It snapshots operator configuration, derives the isolated relay address,
checks protected Linux file ownership and journal policy, opens existing SQLite and
rechecks its identity before using the backing callback. It neither initializes nor
upgrades history and retains the connection until admission settles. Missing history,
key/policy mismatch and disabled runtime deny admission. The server service factory now
binds this admission to the authenticated handler; production route configuration remains
required.

`withdrawal-http-service.ts` composes submission and status with the existing live
revocable cookie-session context, protected runtime admission and concrete Circle HTTP
transport. Options are server-owned and the network must be Arc testnet. Four integration
tests use actual signed cookies and SQLite session/claim persistence with intercepted
Circle HTTP and a substituted admission boundary. They verify missing/revoked sessions,
duplicate submission, owner-scoped status, same-wallet cookie replacement during admission,
revocation after claim storage, recovery without another vendor call, and network rejection.
The focused tests, lint and TypeScript checks pass locally. Next.js route registration,
operator configuration and finalized mint status/UI remain open; these checks do not
constitute live funded acceptance.

Local Windows validation covers disabled/invalid configuration; the native Linux drill
uses actual SQLite and viem HTTP decoding with synthetic RPC responses to verify
durable reopen, idempotent holds, policy mismatch and missing-history rejection.
These checks passed along with TypeScript and focused lint. The Linux Vitest cases
are also included for CI; they do not demonstrate live funded operation.

Eleven focused coordinator tests pass: concurrent callers, lost claim/vendor/storage
responses, denied admission, cancellation, immutable request snapshots, invalid and
oversized evidence, response-body deadline, owner isolation and projection privacy.
No test sends a live transfer. Operator bootstrap commit `6a3af61` passed
[CI run 34561202764](https://github.com/tang-vu/keryx/actions/runs/34561202764), including
the Linux runtime tests and production build.
Transfer coordinator commit `c2cb047` passed
[CI run 34561977865](https://github.com/tang-vu/keryx/actions/runs/34561977865).

## Recovery of admitted requests into nonce slots

`lib/gateway/withdrawal-relay-queue.ts` reads bounded private journal pages of gas
admissions lacking nonce slots, and looks up stored attestations using each original
owner. Missing evidence does not consume a nonce or block later ready requests.
Malformed/misbound responses and terms above the held ceiling remain unavailable;
their original gas holds remain intact. Journal `reserveAdmitted` attaches the
matched response through the existing atomic nonce reservation. Concurrent assignment
can reject a call but cannot duplicate a nonce. A committed slot with lost readback
disappears from the pending page and remains readable as the original slot; direct
recovery retains its original fee terms rather than replacing them with new settings.

The queue shares the relay worker's cooperative directory lock and keeps it until
awaited reads settle, including after cancellation. It performs no Circle POST,
transaction signing, broadcast or completed cash-out recording. A cursor limits each
pass to at most 64 lookups (32 by default). Callers continue with `nextCursor` and
start subsequent full sweeps without a cursor to revisit unresolved requests and new
admissions whose IDs sort earlier. Cursors and request IDs are private operator state.
Five focused tests pass, including actual SQLite request/claim/attestation storage
through the transfer coordinator, reopen recovery, pagination past missing evidence,
wrong evidence/fee bounds, cancellation/lock retention and committed-slot readback
loss. Focused lint and TypeScript checking pass. No live vendor/chain operation occurs.

The queue now has an explicit operator command for the SQLite deployment. It is not
yet wired into a scheduler or HTTP route. Runtime must run queue and signing passes
without inferring transfer failure from absent evidence. Gas-admission commit `6b6df21` passed
[CI run 34562497548](https://github.com/tang-vu/keryx/actions/runs/34562497548), including
Linux runtime checks and production build.

### Operator queue mode

`npm run withdrawal:relay -- --queue` requires the existing protected relay runtime
configuration, plus these explicit operator arguments:

- `--application-db`: absolute canonical path to the existing owner-only SQLite
  application database. No default path, creation or migrations are performed.
- `--gas`, `--max-fee-per-gas`, `--priority-fee-per-gas`, `--gas-budget-wei`: reviewed
  integer transaction terms; fee and budget values use native wei. They must fit the
  original request's reserved ceiling. This command does not estimate market fees.
- Optional `--after-id` and `--limit` (1-64, default 32): private cursor paging.

Queue mode is mutually exclusive with `--run` and `--upgrade`; queue-specific flags
are rejected in other modes. The application database opens read-only/query-only,
with existing withdrawal tables checked before processing. Linux permissions, links,
ancestor ownership and file identity are checked using the same filesystem rules as
the protected relay journal. The callback exposes only owner-scoped attestation reads.
Missing, unrelated or permissive application files fail without creating/migrating
them. Supabase operator selection needs separate wiring; there is no automatic
fallback to a local application database. Exit code 2 reports aborted or unavailable
requests; absent evidence remains pending. Cursor output stays in private operator
state. No funded runtime or production scheduling is enabled by this addition.

Local validation: six Windows-applicable tests pass, with seven Linux-only cases
skipped on Windows; focused lint and TypeScript checking pass. A native Linux run of
the actual queue CLI with unfunded synthetic accounts confirms original-nonce and
duplicate recovery, unchanged application database bytes, absent prepared transaction,
invalid flag/limit refusal, missing/unsafe database refusal and owner isolation.
The Linux filesystem drill also confirms protected ancestry and writable/missing
parent refusal. Queue-core commit `3641c09` passed
[CI run 34562844128](https://github.com/tang-vu/keryx/actions/runs/34562844128), including
production build. None of this establishes a live funded withdrawal acceptance run.

## Authenticated submission handler foundation

`lib/gateway/withdrawal-submit-handler.ts` now wraps the transfer coordinator in a
server-owned HTTP boundary. It accepts only the signed wire request, reconstructs
policy from configured chain/contracts/amount/fee caps and the authenticated owner,
and supports cash-out to that owner's own wallet. Browser policy fields, foreign
signatures, excess amounts/fees and noncanonical input fail before gas admission.
The request uses same-origin POST, no query parameters, an 8 KiB/five-second body
limit and a required server-side limiter before cryptographic validation.

The exact original session ID and wallet are revalidated after body/limit waits,
before and after gas admission, immediately before Circle transport and before the
HTTP response. A changed session after claim storage does not reopen the claim.
Requests with existing claims remain recovery-only; vendor-response loss preserves
the original record and unknown state. Only no-store transfer progress is returned
with mint finality unchecked. Seven tests use actual SQLite request/claim/attestation
storage for duplicate HTTP calls, configured limits, client-policy/foreign-owner
denial, limiter refusal, same-wallet session replacement at admission/claim boundaries,
response loss and request restrictions. Admission and authentication callbacks
in these tests are synthetic; real backed admission and cookie
binding remain required. The handler is not registered as a public Next.js route.

Both submit and status handlers now invoke `withdrawal-rate-limit.ts` directly using
the authenticated database context. Fixed 60-second limits are 3 submissions per wallet
and 20 service-wide, with independent status limits of 30 per wallet and 200 service-wide.
Wallet counters are consumed first, so a rejected wallet does not take another global
point; a rejected global check still retains the wallet point. No lost response or
restart resets these counters. Exhaustion returns no-store 429 with Retry-After;
storage failure or malformed readback returns no-store 503 with no memory fallback.
The existing SQLite/Supabase atomic counter interface supplies persistence. Missing
SQLite RETURNING rows now throw rather than producing an allowed decision. Bucket
keys contain a domain-separated wallet hash, not bearer tokens or raw wallet strings;
this is pseudonymous operational state, not anonymity. Gas admission and settlement
remain separate authorities. Status requests may update only these abuse counters,
never withdrawal payment or submission records.

Twenty-six focused tests pass across withdrawal rate limits, submit/status handlers
and the existing rate-limit store suite. New cases cover competing SQLite connections,
reopen recovery, service-wide limits across distinct wallets, committed readback loss,
missing RETURNING rows, malformed decisions and fixed-window expiry. Submission-boundary
commit `99d5c1f` passed
[CI run 34565708497](https://github.com/tang-vu/keryx/actions/runs/34565708497), including
production build.

Browser-status commit `8134f83` passed
[CI run 34564636883](https://github.com/tang-vu/keryx/actions/runs/34564636883), including
the Chromium withdrawal recovery checks and production build.

## Authenticated status handler foundation

`lib/gateway/withdrawal-status-handler.ts` implements the server HTTP boundary for
reading an original withdrawal. It is not yet registered as a public Next.js route.
Integration must bind its authentication callback to live revocable account sessions;
the browser cannot supply owner or store authority. The request uses a same-origin
POST, no query parameters and a strict `{ id }` JSON body capped at 1 KiB/five seconds.
The shared streamed JSON reader now accepts a smaller explicit cap while preserving
its existing 64 KiB default for MCP/private purchases. A stalled stream cancellation
does not extend the read deadline.

The handler queries only owner-scoped request/claim/attestation reads, then checks
the live session again before replying. Revocation or a changed wallet withholds
the previous owner's data. Foreign and missing records share a 404 response, database
failures use a generic 503, and valid projections are `no-store` with no signature,
attestation or claim token. `mintStatus: not-checked` prevents stored transfer evidence
from being represented as completed minting. Reads do not claim, save, sign or POST
to Circle. Eight new tests cover actual SQLite projections and read-only behavior,
owner isolation, injected session revocation/account change, request restrictions,
oversized/stalled input and failure redaction. These are handler-boundary tests;
production cookie/auth binding and browser recovery still require integration.

The eight handler tests, eleven transfer-coordinator tests and three existing MCP
body-reader tests pass; focused lint and TypeScript checking pass. Operator command
commit `16e6fdd` passed
[CI run 34563259680](https://github.com/tang-vu/keryx/actions/runs/34563259680), including
Linux queue CLI tests and production build.

## Browser draft/signature journal

`lib/gateway/withdrawal-browser-journal.ts` now persists an owner-scoped unsigned
draft before wallet signing, the verified original signature and a single submission
marker in strict IndexedDB transactions. Its identity/policy validation uses the same
EIP-712 fields as the backend. `prepareWithdrawIntent` exposes the builder's unsigned
step; the existing `buildAndSignWithdrawIntent` wrapper retains its behavior for the
legacy panel. Signature verification remains mandatory for every signed-row read.
Transactions compare the complete previous row before writing and resolve only after
commit, so competing tabs cannot both claim transport permission. Unsigned reservations
are retained after rejected/interrupted prompts, and owner-indexed history is paginated.

Imported originals are permanently recovery-only. Missing/corrupt storage never makes
an existing original eligible for a local retry; recovery must use authenticated
server evidence. The journal provides no signing, network, local deletion or export
operation itself. It stores sensitive authorization material in origin-local IndexedDB,
which is not a security boundary against same-origin scripts/XSS, browser eviction or
manual replacement. Server request/spec uniqueness and transfer claims remain the
financial replay barriers. Finite authorization expiry, active-account rechecks in
the eventual UI and the full browser/server recovery flow still require integration.

`npm run test:browser-withdrawal-journal` runs Chromium with all HTTP intercepted and
unfunded local EOA signatures. It checks pre-sign persistence, backend identity agreement,
two-tab claiming, reload, owner isolation, actual transaction abort, corruption,
recovery-only imports after database deletion, local pagination and unavailable storage.
The test is included in CI. The production panel is not yet wired to this journal.
Local Chromium verification, sixteen protocol/coordinator tests, focused lint and
TypeScript checking pass. Status-handler commit `fcfe3d9` passed
[CI run 34563608777](https://github.com/tang-vu/keryx/actions/runs/34563608777), including
production build.

## Browser signing and submission coordinator

`lib/gateway/withdrawal-browser-flow.ts` joins the persisted journal to wallet signing
and an app-owned transfer transport. Signing uses the exact stored draft and pinned
wallet account, with a live active-account accessor and cancellation checks. A valid
returned signature is saved for its original owner even if the account changed or the
operation was cancelled during the prompt; no submission is performed by signing.
An already-signed/imported row never triggers another wallet prompt.

Submission consumes the strict cross-tab marker, rechecks the active account, rereads
the committed original and only then calls transport. A changed/missing journal or
post-claim account change cannot fall back to an in-memory request or renew permission.
All transport outcomes require read-only recovery; an HTTP response is not accepted as
mint completion. The app-owned transport now has bounded HTTP/abort wiring; the
eventual status view must validate authenticated original mint evidence. The flow
does not create drafts automatically or import missing history as fresh requests.

The Chromium drill now also exercises real EOA signature identity through the flow,
draft persistence before the wallet callback, no second prompt for a signed original,
two-tab submission with lost response, durable-marker readback before transport,
account changes during signing, and account changes after claiming but before sending.
The latter retains the consumed marker with zero transport calls. Wallet/account and
transport callbacks are synthetic; actual IndexedDB and signature verification run in
Chromium. No funded wallet or production payment endpoint is used. Production UI/API
integration remains open.

Chromium flow verification, focused lint and TypeScript checking pass locally.
Journal commit `00e58ab` passed
[CI run 34564078587](https://github.com/tang-vu/keryx/actions/runs/34564078587), including
the Chromium withdrawal journal test and production build.

## Portable browser recovery

`withdrawal-recovery-file.ts` exports a validated saved signed original in a versioned
Arc-testnet envelope, bounded to 16 KiB of UTF-8. It is private authorization data, not
a public receipt or payment confirmation. Export requires the original active owner
and refuses unsigned drafts. Parsing revalidates the signature, owner, network and
strict envelope; added fields cannot grant submission permission. Import uses only the
recovery-only journal operation and never overwrites an existing row, even after local
storage loss. Account/cancellation checks bracket asynchronous operations, and neither
export nor import performs HTTP.

Focused tests cover the strict envelope, owner/signature binding, network mismatch and
UTF-8 bounds. Real Chromium verification exports the original, deletes local storage,
imports the file and confirms the original signature is restored while submission
remains prohibited; duplicate import and foreign-account export are rejected. UI file
controls and independent lost-device acceptance remain open.

## Browser HTTP submission

`submitWithdrawalBrowserHttpOnce` connects the committed browser flow to
`withdrawal-browser-submit.ts`. It validates a snapshot of the original signed request
and rechecks the live account immediately before the fixed `/api/me/withdrawals/submit`
POST. The body contains only signed wire terms, never client policy authority. Same-origin
credentials, no caching/redirects/retries, a 30-second whole HTTP deadline and a 2 KiB
response cap apply. Only HTTP 202 with progress matching the original owner, recipient,
amount and digest is accepted; the caller still returns recovery-required. HTTP errors,
body stalls and late responses cannot renew the consumed browser claim or establish
mint finality. Raw server diagnostics are withheld.

Four focused tests cover exact payload/privacy, invalid signatures, cancellation and
the pre-send account guard, misbound/oversized/error responses, and stalled headers/body.
The real Chromium drill races two tabs through this concrete HTTP binding, checks the
persisted marker at interception, drops the response and verifies subsequent calls send
no further POST. All HTTP is intercepted; no funded transaction is performed. Local
focused tests, Chromium, lint and TypeScript checking pass. The production endpoint
and withdrawal panel still require runtime integration and live testnet acceptance.

## Cash-out persistence

Both application adapters now delegate cash-out writes to `lib/db/withdrawal-records.ts`.
The first transaction row is retained; duplicate writes must match its owner, recipient,
amount and network. Original labels and timestamps are preserved. SQLite ignores only
the transaction-hash conflict, while Supabase sends ignore-duplicates and checks write
errors before an exact transaction readback. Missing/error/conflicting readbacks reject
reporting success. A lost reporting response may retry this same record, never the
payment. No payment-event or revenue row is created.

Focused tests cover actual SQLite persistence, retained metadata, conflicting economics
and lost-readback recovery. The actual Supabase client is exercised against intercepted
HTTP for ignore-duplicates, matching readback, missing rows and vendor errors. This is
not production PostgreSQL acceptance. The writer itself does not establish mint provenance.

`withdrawal-cash-out.ts` now provides the operator reporting bridge from validated
journal observations to the matching application original and idempotent ledger writer.
No observation means no cash-out row. It derives the transaction, recipient, amount and
first observation timestamp from journal evidence, uses a generic creator label and
refuses amounts that cannot round-trip every micro-USDC through the legacy number field.
The bridge has no signing, Circle or broadcast capability. A lost ledger response may
repeat the same report while the mint observation stays retained. Focused tests use
real SQLite journal/ledger storage and synthetic worker observations to exercise
unobserved/prepared states, observed reporting, response-loss recovery, conflicting
application originals, cancellation and amount precision. Operator scheduling and
end-to-end funded reconciliation remain open.

### Operator reporting command

Run `npm run withdrawal:report -- --directory ABSOLUTE_RELAY_DIR --application-db
ABSOLUTE_DB` on the protected Linux host. It opens the existing mint journal read-only
and the explicitly selected application store with only original-request reads and
cash-out reporting capabilities. No private key, relay enablement, RPC, signing or
broadcast is needed. Missing files/tables and unsafe permissions are rejected; the
command never initializes or migrates a database.

Each page defaults to 32 requests, with `--limit` restricted to 1..64. Continue using
the private `--after-id` cursor, then start later full sweeps without a cursor to revisit
unknown/error rows. A per-row failure increments unavailable and does not block later
rows. Exit 2 indicates cancellation or unavailable records, and exit 1 indicates a
configuration/process failure. Recorded counts are confirmations in this scan, including
duplicates already in the ledger; they are not new transactions or revenue. The command
does not install an automatic supervisor or change the production withdrawal route.

## Owner mint progress projection

`withdrawal-mint-progress.ts` derives private creator progress from the validated
protected mint journal. It verifies the signed original and authenticated owner before
journal reads, then matches the full stored request. Missing slots remain not-queued;
unobserved slots are queued or prepared. Prepared bytes do not establish broadcast,
inclusion, failure or success. Only a validated recorded worker observation produces
finalized-observed with transaction/block identity, observation time and the explicit
operator-selected-RPC finality basis. The allowlist excludes signatures, attestations,
gas costs and internal nonce terms. Cancellation withholds the result.

Real SQLite journal tests exercise each state, original-policy mismatch, finalized
observation recovery after reopening, projection fields, foreign-owner denial before
reads and cancellation. Worker observations in these tests are synthetic and validated
through the existing journal. Protected read-only runtime access, HTTP reauthentication
and browser status parsing are now connected in the internal service. UI presentation
and idempotent cash-out ledger recording remain integration work.

`withdrawal-mint-reader.ts` opens only the configured existing protected journal with
SQLite readOnly and query_only enabled. It verifies file identity and policy around
opening and requires neither a signer nor RPC access. Configured missing/corrupt history
fails closed; absent directory configuration retains explicit not-checked status. The
HTTP handler reads the application original under the authenticated owner before the
mint journal, then reauthenticates after reading. Native Linux verification confirms
unchanged database bytes; HTTP tests cover revocation during the read and no journal
access for foreign requests. Twenty focused tests, Chromium regression, lint and
TypeScript checks pass locally. Production routes and funded acceptance remain open.

## Browser HTTP status recovery

`lib/gateway/withdrawal-browser-status.ts` reads the planned authenticated status
endpoint using a fixed relative URL and POST body containing only the original ID.
It uses same-origin credentials, no cache/redirects/retries, a five-second total
deadline and 2 KiB response limit. Delayed headers/body or cancellation fail without
granting a later response authority. The strict projection must match the retained
draft's owner, recipient, amount and EIP-712 ID. Unchecked, unqueued, queued and prepared
states keep `chainFinalityVerified: false`. Finalized-observed requires true finality,
transaction/block hashes, block number, observation timestamp and operator-selected-RPC
basis. Extra fields and incomplete or contradictory finality metadata are rejected.
404 means unavailable evidence, not failed/unsent; 401 requires authentication.
Server diagnostic messages are not propagated into the UI.

`recoverWithdrawalBrowserStatus` reads the retained journal, checks the live account
before HTTP and again before returning, and leaves submission markers untouched.
Six focused tests cover original-data binding, fixed transport, authentication/absence,
error redaction, response limits, caller mutation, abort, stalled headers/body and
discarded late responses. The Chromium drill also exercises intercepted same-origin
status HTTP, confirms that a 404 cannot renew submission permission and withholds
results after account change. The public Next.js endpoint and production panel remain
unwired; these checks do not establish live server/browser or funded acceptance.
Focused tests, Chromium verification, lint and TypeScript checking pass locally.
Browser-flow commit `4fd9722` passed
[CI run 34564372010](https://github.com/tang-vu/keryx/actions/runs/34564372010), including
production build.

## Read-only mint observation

`lib/gateway/withdrawal-mint-observation.ts` revalidates the original request and matched
response, recovers the EIP-191 signer of the payload hash, and queries the intended
minter's signer allowlist. It checks Arc testnet chain identity, nonempty minter code,
attestation expiry and the exact mint call from the selected relayer at one block.
It rechecks that block's hash and timestamp and the chain ID before returning an
`eligible-at-observed-block` observation. This follows the pinned
[Mints.sol](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/modules/minter/Mints.sol)
signature and expiry checks.

The observer has a five-second deadline, propagates cancellation to its HTTP transport
and prevents late completion from returning evidence. Its local freshness policy allows
blocks at most 60 seconds old and at most five seconds ahead of the local clock.
RPC failure, cancellation, unexpected output or inconsistent reads return no observation;
none of these establishes a failed withdrawal or releases funds.

This trusts the operator-selected RPC and local clock. The code hash records observed
minter bytecode; it does not audit a proxy implementation or match a deployed version
to the pinned source. An `eth_call` success at that block is neither future permission
nor finality. No key, nonce reservation, signing, broadcast or database mutation is
performed. Preparing a transaction still needs fresh checks and exclusive bounded
signer authority. This helper is not yet connected to the production relay.

## Remaining implementation and acceptance

### Private relay journal foundation

`lib/gateway/withdrawal-mint-journal.ts` is a separate local SQLite journal for one
dedicated relay key. This boundary applies whether the application uses SQLite or
Supabase: all processes controlling this key must share this exact journal. No
production key or journal has been provisioned by this change, and the HTTP relay
still uses its original flow.

Connections enforce SQLite `synchronous=FULL`; the journal requires reliable local
storage and does not claim safety on an unsupported shared/network filesystem.
Explicit initialization pins the testnet chain, relayer, starting nonce, lifetime
gas ceiling and maximum slot count. Normal reopening cannot initialize missing
state. Initialization also refuses a partially missing journal or unrelated database;
it cannot reconstruct a used key's lost nonce history. An operator must establish
the starting nonce against the intended chain and verify exclusive key custody.

Slot admission validates and retains the original request, matched attestation and
exact gas terms. A SQLite immediate transaction checks contiguous nonce history,
reserves the next nonce and charges the full maximum gas cost against the lifetime
ceiling. Duplicate admission returns the exact original; a conflicting request,
changed policy or over-budget allocation fails. Every admitted slot stays charged,
including slots with no signed bytes. This conservative lifetime ceiling does not
recycle capacity after receipt, timeout, cancellation or attestation expiry.

Prepared bytes are checked against their stored slot, inserted immutably and read
back with their derived hash and recovered signer verified again. A lost readback
leaves the stored original recoverable. The module does not sign or broadcast; a
future worker must only submit the durably read-back bytes. Ordered private request
IDs allow restart recovery without relying on an in-memory queue. No stored signature
or raw transaction belongs in public APIs, application logs or Canteen updates.

Remaining runtime work includes binding the worker lock to its key inventory, protected journal storage
and backup/restore, chain nonce reconciliation, fresh eligibility/gas checks, exact
receipt/finality evidence, bounded replacement/cancellation, and HTTP/browser integration.
Successive reserved nonces may queue behind an unresolved earlier slot; the worker
must recover the original earlier slot, never skip it or reuse its nonce. The journal
is not proof that a key was never used elsewhere or that a transaction was accepted.

### Signed transaction validation

The signed-byte validator in `lib/gateway/withdrawal-mint-transaction.ts` now binds
canonical EIP-1559 transaction bytes to the original request and attestation, exact
relayer, nonce, minter, calldata, zero native value and selected gas terms. It derives
the transaction hash from those bytes. It rejects unsigned, foreign-signed, wrong-chain,
legacy, altered and high-s payloads. Signature recovery alone is insufficient: the
[EIP-2 low-s rule](https://eips.ethereum.org/EIPS/eip-2) is checked separately.
Gas limits and fee products use integer native wei, with a separate explicit ceiling;
they are not interpreted as micro-USDC. Seven tests sign locally with unfunded accounts,
including a high-s payload that recovers the expected sender but must still be rejected.

Its result is `signed-transaction-matched-only`. This validates bytes for the journal's
durable storage/readback, but does not itself persist them, reserve a nonce, establish
exclusive key custody, authorize broadcast or demonstrate current chain acceptance.
Terms must eventually come from the durable operator-owned mint slot, never an HTTP
client. Signed transaction bytes are private bearer data until broadcast and must not
be included in public status feeds or logs. Attestation expiry does not expire an outer
signed transaction: it can still be mined and consume gas while reverting. Unknown
prepared transactions therefore cannot free their nonce or gas reservation on timeout.

### Exact receipt matching

`lib/gateway/withdrawal-mint-receipt.ts` validates a viem-normalized successful receipt
against the original signed transaction and request. Transaction hash, sender, minter,
gas use and effective gas price must fit the prepared terms. The receipt block cannot
exceed the matched attestation's expiration height; the exact expiration height remains
valid under the pinned minter's comparison.

Exactly one `AttestationUsed` event from the intended minter must contain the canonical
token, recipient, TransferSpec hash, source domain, depositor, signer and integer value.
Matching compares full ABI bytes, including address/domain padding. Logs must agree
with the receipt's block/transaction identity, have distinct nonnegative indexes and
not be removed. Unrelated well-formed logs are allowed. The event definition was
rechecked against pinned Circle `Mints.sol` on September 11.

The result says `receipt-matched-only` and retains `chainFinalityVerified: false`.
This helper does not fetch a receipt, establish canonical inclusion/finality, persist
a withdrawal, release reservations or infer a refund from a reverted/missing receipt.
RPC observation, canonical-block rechecks and the operator's deployed-code/finality
policy must precede any completed cash-out projection. Tests use locally signed
synthetic transactions and receipts; they do not demonstrate a live mint.
All eight receipt tests pass locally; the combined receipt, signed-transaction and
journal run passes 25 tests. Focused lint and TypeScript checking also pass.
Receipt matching commit `114dbfe` passed
[CI run 34558650412](https://github.com/tang-vu/keryx/actions/runs/34558650412), including
the journal process tests, PostgreSQL checks and production build.

### RPC inclusion and finality observation

`lib/gateway/withdrawal-receipt-observation.ts` connects the signed-byte and receipt
matchers to read-only viem RPC calls. It verifies chain ID, requests the original hash,
checks that hash at the exact transaction index of the receipt's canonical block and
reads the `finalized` anchor. It reads the receipt and inclusion block again, rechecks
the anchor by number and verifies chain ID again. Changed gas/receipt evidence, missing
or duplicate inclusion, inconsistent blocks, unsupported finality and RPC errors return
no observation. No failure, refund or reservation release follows from that result.

Arc's [bridge integration guide](https://docs.arc.io/integrate/infrastructure/bridges)
and [transaction lifecycle](https://docs.arc.io/integrate/wallets/transaction-lifecycle),
checked September 11, document committed-block finality and `finalized` resolving to
the latest committed block. A matching anchor may therefore be the receipt's own
block; no arbitrary extra confirmation count is imposed. The observer reports
`mint-finalized-observed`, `chainFinalityVerified: true` and explicitly
`finalityBasis: operator-selected-rpc`. This means verification of RPC-reported
inclusion/finality under that documented testnet policy. It does not independently
verify validator signatures, establish RPC honesty or audit the minter implementation.
The lower-level receipt matcher alone continues to report finality as unverified.

The observer uses a five-second deadline, propagates abort to transport and rejects
late completion. The finalized anchor must be no more than 60 seconds old and no
more than five seconds ahead of the local clock, including at completion. Historical
receipts may be older. Eight tests exercise viem's actual JSON-RPC decoding over a
synthetic transport, one-block finality, transaction position, inconsistent reads,
timeouts, caller cancellation and mutation. They send no live transaction. Production
RPC selection, protected storage/backup and cash-out projection
remain part of worker integration; this module is not yet wired to the HTTP relay.

### Stored observation and reconciliation

The relay journal now exposes `reconcile` and `getObserved`. Reconciliation reads its
original slot and signed bytes, then invokes the server-owned read-only RPC observer.
No HTTP client may supply a precomputed observation as authority. The first matching
result is stored immutably in `mint_journal_observations` under that prepared request.
Stored request/transaction/spec identities, recipient, amount, block/anchor relationship
and integer gas accounting are revalidated against the original journal on readback.

Subsequent matching checks return the first saved observation, retaining its original
timestamp and anchor. A later anchor may advance; a changed mint block, amount or gas
result conflicts and never overwrites history. A null/error/aborted latest RPC check
returns `latestCheck: unknown` alongside any previously stored observation. Reading
that history is not a fresh RPC check or an independently verifiable consensus proof.
Its authority depends on the configured observer, protected journal and RPC trust
already described. A lost post-commit readback can recover the original stored result.
None of these operations signs, broadcasts, renews a nonce, releases gas capacity,
records an application cash-out or implies a refund.

The schema helper now pins SQLite `user_version=2`, including gas admissions. New
journals initialize all five tables atomically. Older version-0/1 journals require
an explicit `upgrade` option, which validates the original policy and immutability
barriers and retains existing slots/prepared bytes and observations. A version-1
journal missing observation history is
corrupt, not an old journal to silently upgrade. Initialization cannot repair missing
history. No production relay journal has been created or upgraded by this change.

### Relay worker pass

`lib/gateway/withdrawal-relay-worker.ts` now joins journal recovery, mint eligibility,
local signing, original-byte broadcast and receipt reconciliation in one worker pass.
It uses the existing cooperative lock helper in the dedicated relay directory. The
lock remains held until awaited work returns, including when cancellation happens
during an RPC. It is never reclaimed by elapsed time or PID. A process crash still
requires operator inspection of the retained lock before restart.

For each unresolved nonce in order, the worker reconciles any prepared transaction
first. Existing recorded observations are retained and skipped; they do not starve
later work through the active-step limit. Signing/broadcast requires the journal's
relayer, a different configured inventory of other signers, Arc testnet identity,
matching latest/pending nonce, observed mint eligibility, native gas funding, a
compatible block gas/base-fee limit and a simulation with the exact selected gas terms.
It signs locally only when no prepared bytes exist, persists/readbacks the original
and broadcasts only that stored snapshot. Returned hashes must match the stored hash.

Missing submission/receipt responses preserve the original. If a later receipt is
observed, recovery does not sign or submit again. Otherwise, if the nonce remains
available and eligibility still passes, a later pass may resend only the exact same
stored bytes. A consumed/skipped/occupied nonce pauses the pass for reconciliation;
it cannot produce a new nonce or Circle POST. The diagnostic counters distinguish
local signatures, broadcast attempts and observations; they are not traction totals.

`withdrawalRelayDependenciesForRpc` wires the real read-only observers and viem client.
The shared `withdrawal-rpc-transport.ts` combines caller and deadline cancellation,
disables retries and bounds each entire response to five seconds and 4 MiB, including
the body. This avoids the installed viem behavior where an explicit fetch signal
replaces its internal timeout signal and its header timeout ends before body parsing.

Nine worker tests use actual local signatures and journals with synthetic RPC/finality
adapters. They cover save-before-send, lost submission and database readback, exact-byte
retry, nonce/funding refusal, lock lifetime, cancellation, completed-prefix progress
and unexpected returned hashes. Five transport tests exercise real viem HTTP handling
against a mocked fetch, including stalled headers/body and bounded response size.
The combined worker, transport and observer run passes 29 tests locally. No live mint
or public application withdrawal was performed.
Focused lint and TypeScript checking pass. The preceding observation-journal commit
`fef15d8` passed [CI run 34559529412](https://github.com/tang-vu/keryx/actions/runs/34559529412),
including production build.

This is a callable worker core, not a provisioned production service. Runtime
provisioning still needs verified inventory completeness, backup/restore and supervisor
configuration. Complete request admission, withdrawal
projection, reverted/foreign-mint reconciliation, bounded cancellation/replacement,
HTTP/browser integration and live acceptance remain open. The existing production
withdrawal endpoint has not been switched to this worker.

### Operator entrypoint

`npm run withdrawal:relay` inspects an existing journal by default. It does not call
RPC or sign and prints only aggregate slot/prepared/observed counts. `--run` executes
one bounded testnet pass; `--upgrade` explicitly checks/upgrades schema without relaying.
The flags are mutually exclusive. Environment files must be loaded explicitly; the
command never creates a key/journal or removes an existing crash lock.

Runtime configuration requires `KERYX_WITHDRAWAL_RELAY_ENABLED=1`,
`KERYX_WITHDRAWAL_RELAY_ISOLATED=1`, `KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY`,
`KERYX_WITHDRAWAL_RELAY_ADDRESS` and an absolute `KERYX_WITHDRAWAL_RELAY_DIRECTORY`.
The address must match the derived key. At least the actual public funder key must be
loaded; an enabled private research treasury also requires its key. Every other
nonempty loaded `*_PRIVATE_KEY` is parsed and its derived address compared with the
relay. Configured seller/private recipient addresses are also excluded. Malformed,
missing required or reused key configuration fails with a generic error. These checks
cover the loaded inventory; the isolation flag is an operator declaration, not proof
that the key was never copied or used outside that inventory.

The Linux directory contains `policy.json` (at most 4 KiB) and an existing nonempty
`mint.sqlite`. Directory, policy, database and present SQLite sidecars must belong to
the process owner with no group/other access. Symlinks, file hard links and replaceable
non-sticky ancestors are refused. Root-owned sticky `/tmp` is allowed for isolated
tests. The command checks database inode/device and policy again after opening, binds
the policy's relayer to the actual key and uses the journal's immutable policy check.
Windows runtime execution is refused until equivalent ACL checks are implemented;
POSIX mode bits are not presented as Windows access control.

Inspection opens the database read-only under the cooperative lock. Upgrade uses the
same lock; execution uses the worker's lock. SIGINT/SIGTERM abort the active pass and
cleanup waits for awaited work. Output omits keys, request IDs, signed payloads and
private policy contents. A waiting or aborted run exits with code 2 for operator
handling; unknown errors exit 1. No automatic restart, wallet rotation or nonce reset
is performed.

Windows validation passed the runtime configuration tests and CLI help; Linux-specific
tests are skipped there. A separate WSL check exercised the real CLI for inspection,
schema checking, an empty relay pass, permission refusal and retained-lock refusal with
unfunded synthetic keys. A second Linux check covered private ancestry and rejection
of a writable ancestor. The Linux Vitest suite additionally covers links and policy
bounds. This is runtime bootstrap evidence, not acceptance of a live paid withdrawal.
Focused lint and TypeScript checking pass. Worker/transport commit `b8b4cf6` passed
[CI run 34560433030](https://github.com/tang-vu/keryx/actions/runs/34560433030), including
production build.

The request-matching layer in `lib/gateway/withdrawal-attestation.ts` now checks a
single attestation or a one-entry attestation set against the exact encoded original
spec, including every routing field, value, salt, empty hook and length. It also checks
the returned expiration height against the payload. Its output explicitly says
`request-matched-only`: this does not authenticate Circle's signature, establish current
mint eligibility, prove settlement or verify chain finality. The encoding is checked
against Circle's [TransferSpec](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/TransferSpec.sol)
and [attestation definitions](https://github.com/circlefin/evm-gateway-contracts/blob/fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/lib/Attestations.sol)
at the pinned source revision. Deployed-contract/version matching remains required.

1. Integrate the read-only minter observation with prepared-transaction checks and
   deployed-version verification, and bind later Circle transfer status to the exact
   original spec. Persisting a response is not confirmation from HTTP success alone.
2. Integrate the dedicated relay journal with exclusive key custody and bounded
   signing/broadcast. The current general funder also signs elsewhere; pointing its key
   at a new journal would not control those other senders. Use the journal's original
   prepared transaction identity and retain uncertainty after any lost response.
3. Integrate the relay, session revalidation, bounded input, rate limits and authenticated
   request/status history. Reading status must not sign, repeat the Circle POST or mint.
4. Implement durable browser request/attempt storage, account-switch isolation, reload
   and explicit local recovery. Cover missing/replaced storage and cancellation semantics.
5. Exercise transfer-response loss, attestation storage failure, mint submission/receipt
   loss, restart and concurrent callers through the integrated journey. Verify exact
   original chain evidence and idempotent cash-out recording, then perform a separately
   scoped testnet acceptance run. Do not replay historical withdrawal authorizations.

The [Circle create-transfer API](https://developers.circle.com/api-reference/gateway/all/create-transfer-attestation)
documents a transfer UUID and attestation response. [Lookup by UUID](https://developers.circle.com/api-reference/gateway/all/get-transfer-by-id)
provides status and attestation details. These pages, read September 11, do not establish
that repeating a lost POST is safe. Unknown submission state must remain unresolved until
matching evidence supports a transition. [TransferSpec lookup](https://developers.circle.com/api-reference/gateway/all/get-transfer-spec)
documents spec fields, not a substitute transfer-status result. Mainnet/vendor compatibility
must be verified separately from this testnet implementation.

## Current checks

Fifteen focused tests pass, including the actual browser builder signing with an unfunded
local account, modified terms, canonical encoding, caller mutation, SQLite connection/restart
contention, immutable barriers, foreign-owner denial and Supabase committed-response loss.
TypeScript and focused lint pass. The isolated PostgreSQL 17 harness also passes duplicate
request/claim contention, original-attempt retention and service/client permission checks.
Its unsigned synthetic SQL fixture tests database semantics; application tests separately
verify signatures. Attestation checks cover changed spec fields, malformed headers,
wrong set counts and inconsistent expiry. Persistence checks include restart, competing
writes, foreign owner/claim, immutable records and lost-response/corrupt-readback handling.
Synthetic response signatures are deliberately
not presented as Circle authorization. None of these tests sends funds or establishes
the integrated journey. Foundation commit `2bd3801` also passed
[CI run 34554723909](https://github.com/tang-vu/keryx/actions/runs/34554723909), including
the new PostgreSQL check and production build. Attestation persistence and spec-identity
commit `30d6161` passed [CI run 34555613062](https://github.com/tang-vu/keryx/actions/runs/34555613062),
including unit tests, PostgreSQL, browser/contract checks and production build. These
backend layers are not yet wired into the production creator withdrawal journey.

Observer and PostgreSQL concurrency fixes through commit `591a03b` passed
[CI run 34557370494](https://github.com/tang-vu/keryx/actions/runs/34557370494), including
the expanded PostgreSQL contention drill, browser/contract checks and production build.
Signed-byte validation commit `24ca021` passed
[CI run 34557666883](https://github.com/tang-vu/keryx/actions/runs/34557666883), including
production build. The relay journal adds separate SQLite tests for competing OS
processes, connection/restart recovery, exact lifetime gas bounds, initialization and
policy refusal, original prepared-byte recovery after committed-response loss,
immutable records and corrupt hash readback. These use unfunded synthetic accounts
and perform no network or settlement operation. All sixteen journal tests pass locally,
including first-observation persistence, unknown/aborted latest checks, conflicting
evidence, committed-readback loss, retained gas ceilings, corruption and explicit schema
upgrade. Focused lint and TypeScript checking pass. RPC observation commit `2104681`
passed [CI run 34558992243](https://github.com/tang-vu/keryx/actions/runs/34558992243),
including production build.

The read-only observer adds seven tests using real local signatures and viem's RPC
encoding over a synthetic transport. They cover exact calldata and caller, rejected
signers, wrong chain, absent code, expired/stale/future blocks, simulated reverts,
inconsistent block/chain readback, caller mutation, deadline and mid-flight cancellation.
All 22 focused tests pass. These checks do not authenticate a live Circle response or
send a transaction.

```sh
npx vitest run lib/gateway/withdraw-protocol.test.ts lib/db/creator-withdrawal-requests.test.ts lib/gateway/withdrawal-attestation.test.ts lib/gateway/withdrawal-mint-observation.test.ts
node --import tsx scripts/test-creator-withdrawal-postgres.mts
npm run typecheck
```
