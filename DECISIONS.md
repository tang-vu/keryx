# Keryx — Decision Log

**D-169** - Withdrawal receipt evidence - *Require the exact original transaction
and canonical minter event before accepting receipt-level cash-out evidence.*
Successful receipt status alone is insufficient. The matcher verifies the signed-byte
hash, relayer, minter, bounded gas accounting and attestation expiration height. One
canonical AttestationUsed event must match all routing, ownership and value fields;
every log must agree with its enclosing receipt identity. This remains receipt-level
evidence, separate from RPC observation, canonical inclusion, finality and deployed
code verification. Missing/reverted/malformed evidence cannot release a reservation,
record a completed withdrawal or imply a refund. Gas uses native wei; creator value
uses integer micro-USDC.

**D-168** - Relay nonce and gas journal - *Place a dedicated relay key's prepared
transactions and lifetime gas reservations in one durable local authority.*
The application request/attestation journal remains in its configured database. A
separate private SQLite journal belongs to the dedicated relay worker, so SQLite and
Supabase application deployments use the same nonce authority. All processes holding
the key must share that file. Explicit initialization pins policy and starting nonce;
normal reopening and partial-history loss cannot reset it. Immediate transactions
reserve contiguous nonces and maximum gas cost under immutable lifetime and slot caps.
Original request, attestation, terms and signed bytes are revalidated on recovery.
Missing responses never release gas or nonce reservations. No signer, broadcaster or
production integration is activated yet. Key exclusivity, protected storage/restore,
chain reconciliation and replacement/cancellation still require runtime enforcement.

**D-167** - Prepared mint identity - *Bind exact signed transaction bytes before any
storage or broadcast authority can depend on their hash.*
The validator accepts canonical Arc-testnet EIP-1559 mint transactions only. It rechecks
the original request/attestation, recovered relayer, nonce, minter, calldata, zero native
value and exact bounded gas terms; low-s is checked separately from address recovery.
The raw-byte hash is the transaction identity. Native gas wei and ERC-20 micro-USDC
remain separate integer units. The validator grants no nonce or broadcast authority;
exclusive signer custody, atomic gas/nonce slots and durable prepared-byte readback
still precede submission. An expired inner attestation cannot be used to release an
unknown outer signed transaction, which may still consume gas if mined and reverted.

**D-166** - Withdrawal journal concurrency - *Preserve both unique identities while
making duplicate storage recovery reliable under PostgreSQL contention.*
CI exposed unique-index races for the same request/spec and request/transfer UUID:
ON CONFLICT(id) alone does not handle a violation reported by the other unique index.
Migration 0065 serializes attestation saves on the existing request row. First request
insertion has no row to lock, so its unique-violation handler accepts only an already
stored original request ID; strict adapter readback remains mandatory. Different IDs
reusing a spec or transfer UUID still fail. No row is overwritten, no claim renewed,
and no network operation is retried by storage recovery. Fresh multi-caller PostgreSQL
insertion tests cover both paths and preserve original timestamps and permissions.

**D-165** - Withdrawal mint observation - *Check the exact original attestation at a
rechecked block without granting broadcast authority.*
The read-only observer recovers the payload signer, checks the intended minter's allowlist
and simulates the exact mint call from the selected relayer. Chain identity, code, expiry,
block freshness and hash readback must agree. A bounded deadline and transport cancellation
prevent late RPC completion from returning eligibility. Missing evidence stays unknown;
it never records settlement or releases an obligation. RPC and clock trust remain explicit,
and observed proxy bytecode is not implementation verification. This is a prerequisite
for prepared mint transactions, not an alternative to exclusive nonce/gas authority,
durable signed-transaction identity, exact receipt matching or finality verification.
The production withdrawal relay remains unchanged until the recovery journey is integrated.

**D-164** - Creator cash-out recovery - *Identify the original signed burn intent and persist
initial transfer admission before contacting Circle.*
The recovery journal uses the BurnIntent EIP-712 digest as its request identity, distinct
from Circle's transfer UUID and encoded TransferSpec hash. The underlying canonical spec
is separately unique: changing signed fee/expiry terms cannot obtain another admission
for that same transfer. Shared types preserve the
browser's existing signing format. Validation snapshots the request and operator policy,
checks exact padded addresses, same-chain routing, recipient, integer value/fee limits and
the recovered owner signature. Private immutable request/attempt rows preserve the original
policy and authorization. Only a successful new atomic claim with matching readback grants
initial transfer authority; an existing claim, elapsed time or a lost RPC response does not.
SQLite and service-only PostgreSQL RPCs implement the same admission rule. This is the first
layer of a larger recovery flow: the existing HTTP relay is not yet rewired. The original
request-matched attestation is stored immutably under the same claim, with exact readback;
matching bytes is explicitly separate from signer authorization or settlement. Deployed
minter checks, mint nonce authority and prepared-transaction recovery, authenticated
lookup, durable browser recovery and end-to-end failure acceptance remain required before
claiming cash-out recovery complete. The journal is private backend data, not settled earnings
or a public receipt; mainnet support and real-fund activation remain separate gates.

**D-163** - Private interruption recovery - *Restore the original backup first; an operator
may close an interrupted execution to new creator payments without replaying it.*
The operator uses the actual worker database, spool and encryption key under the same
exclusive worker lock. The command never stops a process or removes a retained crash lock.
A matching authenticated backup is restored with the original execution authority. Without
a result, closing requires a complete bounded scan of recognized backups; unknown files,
corruption and authority mismatch refuse the action. Preview is the default. Applying records
an immutable interruption against the original owner and worker, serialized with creator
admission. Only never-committed budget becomes reusable; every admitted authorization remains
backed regardless of expiry or observed status. Original payments, nonces and execution claims
are preserved. Late confirmations and restoration of the original result remain allowed,
while the spend fence remains permanent. Owner views explicitly report interruption and no
refund from this action. This extends D-162's result-only release eligibility. It is not
automatic retry, a completed answer, reimbursement or proof of lost off-site backups.
Operator quiescence, use of the correct storage and protected locator handling remain required;
full support/refund policy and independent paid crash acceptance remain open.

**D-162** - Private treasury reuse - *Release only never-committed budget after durable
result sealing; keep every admitted authorization charged to the lifetime ceiling.*
Creator admission and result persistence already serialize against the execution identity.
Once a validated result exists, no new creator leg can enter that job. An append-only,
job-keyed release records original creator budget minus the sum of all admitted legs.
No caller supplies the release amount. Confirmed, pending, processing, expired and
failed-observed submissions all remain allocated; neither answer totals nor absence of a
receipt can free their backing. A worker claim or encrypted backup without a restored
database result is insufficient. Original reservations, nonces and execution claims stay
intact. The coordinator applies the release idempotently after its creator page completes,
and retries storage failures on later sweeps without signing or resubmitting payments.
SQLite uses a conditional atomic insert; PostgreSQL takes the pool and execution locks,
with service-only RPC authority. New reservations and operator summaries subtract the
recorded release; conservative backing remains capacity minus confirmed outflows. This
is internal capacity reuse, not a transfer, refund, top-up, revenue or profit. Releasing
admitted failed legs, capital replenishment and long-history scheduling remain separate work.

**D-161** - Remote wallet SDK startup - *Restore remembered connectors; initialize other
remote SDKs only after explicit wallet selection.*
The installed wagmi reconnect action probes every connector's provider, and WalletConnect
also initializes its provider in setup. Wrap MetaMask and WalletConnect while keeping the
injected connector unchanged. Capture recent and persisted connection IDs through wagmi
storage before createConfig can persist its empty initial state. IDs are startup hints,
not account authorization. Preserve all saved connections, including a non-current one.
A never-selected remote provider refuses automatic probing; explicit connect activates it,
initializes provider/event listeners once, and forwards original arguments, capability
results and runtime connector context. Automatic setup errors are contained because wagmi
does not await setup; explicit selection reports failure and can retry initialization.
If connection hints were lost, selecting the wallet explicitly restores its normal SDK flow.
Existing wallet/session/chain/balance/signature/payment checks remain authoritative. This
reduces unnecessary SDK startup; it is not a diagnosed fix for prior headless renderer stalls.
Vendor connector and storage-format upgrades require renewed restore/event tests.

**D-160** - Private local deletion - *Remove question/signature payloads without removing the
local submission barrier.*
An explicit two-step browser action replaces a validated local journal with a minimal
account/job marker in the same strict-durability IndexedDB transaction. Complete-row
comparison refuses concurrent state changes. The marker contains no question, salt,
authorization or signature; local recovery pagination skips it. Exclusive reservations,
signature saving and submission claiming cannot reuse a deleted job. An explicitly imported,
validated backup may replace the marker atomically, but only as recovery-only imported state.
This preserves the server's independent admission authority and does not cancel an already
claimed/in-flight payment or release any budget. The UI clears its displayed result and draft;
other open tabs, exported files, server history, browser/OS backups and storage-level remnants
are outside this deletion boundary. This is application-level removal, not secure disk erasure.
Corrupt or foreign-account journals remain fail-closed. Server retention, automatic expiry,
cross-tab memory clearing and secure-erasure guarantees are not established by this feature.

**D-159** - Private browser purchase integration - *Separate proposal, consent, signing and
one-attempt submission; recover the existing intent after uncertainty.*
The signed-in browser requests private terms with POST. A quote proposes the provider/model
and endpoint for explicit review; it does not silently authorize a later policy. The buyer
retains the full reviewed request, merchant pins and total/fee limits, then requires a fresh
available quote to match exactly before generating an authorization. Account session, connected
wallet, Arc chain and Gateway balance are checked around the signature. The first signature
is saved even if the prompt outlives cancellation, then the durable browser claim precedes
the sole private purchase POST. Failed, missing or malformed responses never trigger retry.
Credentialed transport allows only exact same-origin session/quote/private-purchase/result
routes, with no redirects or private query parameters. Recovery shares the CLI request/spend
validator and sends no payment. The UI exposes configured pilot availability, provider policy,
retained unused budget, best-effort quality and plaintext local-storage consent; export is
explicit and imports remain recovery-only. The public page passes only merchant addresses,
not provider credentials or treasury keys. Server admission/allowlisting remains authoritative.
The Chromium acceptance uses synthetic wallet RPC and intercepted HTTP, including response
loss, reload, account/wallet changes and viewport checks. It does not establish independent
wallet-extension/mobile acceptance, a new live paid pilot, portable cryptographic private
receipts, local deletion/retention completion or mainnet readiness.

**D-158** - Private browser recovery foundation - *Reserve before signing and commit a
single submission claim before HTTP.*
Use a separate IndexedDB database for private jobs. A fresh unsigned draft binds the payer,
private/public merchant separation, exact question, provider policy, budget, salt and nonce.
Reserve it exclusively before a wallet prompt. Save and verify the first EOA signature against
that draft, then use a strict-durability transaction with a complete-row comparison to admit
only one submitting tab. Transaction completion, not individual write success, is the boundary.
Any imported CLI/browser intent is recovery-only. Reload never generates a replacement
authorization. Local enumeration includes reservations that never reached the server.
The browser and CLI share signature validation, commitment checking and the existing job-ID
preimage; Web Crypto preserves the server SHA-256 identity. Caller-supplied trusted merchant
pins remain separate from saved or imported data. IndexedDB and explicit exports contain
plaintext private questions and bearer signatures: they are not encrypted or protected from
same-origin script compromise. The eventual UI must disclose this before storing and require
an explicit export action. Browser persistence cannot prove payment, survive storage eviction
or replace server-side admission. This stage provides storage primitives and Chromium tests;
browser quote/review, wallet signing orchestration, HTTP submission and deletion UX are not
enabled by importing the module.

**D-157** - Provider call accounting - *Correlate usage with actual model calls, not reasoning steps.*
The first private paid pilot recorded six served reasoning steps and seven usage records.
Synthesis can perform a second evidence-review request, and its failure is intentionally caught
to retain the answer. Each shared JSON transport invocation now receives a local random call ID,
with pending/returned/failed state and asynchronously isolated correlation on its usage record.
No prompts, response bodies or provider request IDs are retained. Anthropic SDK retries are
disabled so retry attempts pass through the existing resilient engine and call ledger.
Complete cost coverage requires one matching usage record per returned call, no failed or pending
call, and explicit reasoning evidence. Failed work remains conservatively unpriced even with
reported counters. Compact projections carry coverage version 2; old complete classifications
cannot prove this stronger invariant and remain unpriced, without rewriting historical results.
This fixes coverage eligibility, not vendor invoices, current rate verification, or profit.

**D-156** - Private worker supervision and deploy ordering - *Drain before replacing live
worker code; retain crash evidence instead of forcing a restart.*
Use a systemd unit on the existing VPS with explicit environment-file loading, SIGTERM,
an unlimited stop timeout and no automatic SIGKILL or restart. The worker's existing
permanent execution claims and cooperative lock remain untouched. Before changing Git or
dependencies, deployment stops a previously active private service and verifies inactive state
and zero MainPID. It starts that service again only after web health passes. Absent/inactive
services stay that way. Failed/transitional states or a failed stop block source replacement;
later deployment failures leave the private service stopped for operator inspection, including
web rollback. A service being active is not an idle/readiness assertion. Infinite drain can
delay deploy or shutdown indefinitely; an operator must inspect actual process/job state before
any forced intervention. This unit uses the current root-owned single-host layout, not a claim
of production identity isolation, automatic recovery, alert delivery or mainnet acceptance.

**D-155** - Private pilot HTTP integration - *Use the same account-aware operational bootstrap
for quote availability and payment admission.*
Mount the owner-session-only POST purchase route with same-origin checks, bounded JSON,
per-wallet throttling and the disabled-by-default pilot bootstrap. Read purchase bodies before
readiness so a slow body cannot age the operational observation; revalidate the session afterward.
Quotes use the ready service's own policy snapshot and advertise availability only for an allowed
authenticated payer. An unavailable bootstrap can still produce a non-purchasable quote preview.
Both routes recheck the session after asynchronous readiness. Neither quotes nor HTTP 202 promise
completed research or chain finality. Production flags remain off; supervision and an end-to-end
owner pilot are required before enabling them. This supersedes D-154's unmounted-route status,
not its best-effort availability limits or durable database payment authority.

**D-154** - Restricted private purchase bootstrap - *Compose operational observations for
explicit pilot accounts while keeping durable payment authority in the existing service.*
The prepared bootstrap requires a separate purchase enable flag and a bounded server-configured
list of payer addresses. It snapshots validated policy, derives configured signer identities,
and requires a matching idle worker observation, fully backed treasury and nonzero unallocated
capacity before exposing the service for that request. Run these read-only checks through the
existing five-second readiness wrapper; never cache the returned service across requests.
This is a best-effort availability gate for a restricted pilot, not a durable admission lease:
the worker can stop or funds can change after observation. Atomic treasury reservation, exact
authorization verification and the permanent incoming submission claim remain the payment
authority. Worker supervision, owner session/origin checks and recovery remain necessary.
No HTTP route mounts the new bootstrap, and neither quote availability nor production purchase
flags change in this commit. General availability and mainnet acceptance require stronger
operational evidence than this restricted gate.

**D-153** - Private worker reconciliation scheduling - *Recover results, observe pending payments,
then execute eligible work with separate accounting authority.*
Enabled workers now visit one treasury-reserved job per iteration, including unconfirmed incoming
payments and already executed jobs. Exact existing reconcilers perform read-only Circle searches
and persist matching evidence; the coordinator has no signer or payment submission capability.
Creator scans continue in pages of 25 using private in-memory cursors; empty job pages restart
the sweep so earlier inserted IDs are revisited. A cooperative 30-second search signal and process
shutdown stop additional searches without racing paid work. Database waits may outlast that signal.
Errors advance past a bad job, remain redacted and mark the iteration degraded; they do not prevent
unrelated settled jobs from executing. Processing, failed observations and mismatches never release
capacity or authorize retry. This is polling, not a readiness lease or latency guarantee; completed
reservations remain in the sweep and large histories will need indexed pending-only selection.

**D-152** - Private creator evidence progression - *Keep checking processing observations and
only advance the same transfer to confirmed evidence.*
A real SQLite regression reproduced received/batched creator records being permanently skipped,
so owner spend and treasury backing could never reflect later confirmation. Reconciliation now
distinguishes processing from confirmed counts and rechecks processing records. Both adapters allow
one atomic update from received/batched to confirmed/completed only for the same search source,
transfer identifier and complete admitted submission. Facilitator and confirmed records stay
immutable; mismatched transfers and downgrades cannot replace evidence. The existing timestamp
remains the first observation time, not a finality timestamp. This supersedes the earlier blanket
first-writer rule for processing search stages only. No authorization, budget or execution claim is
released or replayed. This remains Circle-observed evidence, not independent chain verification.

**D-151** - Economics usage coverage - *Missing provider usage is unknown cost, not free work.*
Price a run only when its reasoning attempts account for all recorded provider responses and
contain no failed provider attempt. Circuit-open skips are not calls; explicit heuristic-only
execution can have zero token cost. Persist a compact coverage classification without copying
attempt traces. Old projections lack this evidence and remain unpriced. This conservative
observer cannot prove invoice completeness or whole-service profit; dated rates and the explicit
testnet shadow-pricing assumption remain unchanged.

Transport follow-up: real engine tests reproduced empty, partial and malformed compatible-provider
usage being normalized into apparently measured counters. Require explicit valid input/output
counters before recording a response; preserve the valid answer when usage is unavailable. Optional
cached counts may be absent but must be valid and bounded when present. This closes the parser gap
before compact coverage is calculated; historical projections are not rewritten.

**D-150** - Private worker reasoning counters - *Report observed provider and fallback
use separately from successful result persistence.*
For newly executed jobs that return a run, the worker counts primary-tier served,
failed/circuit-open and fallback-tier served attempts as job-level flags. Missing
attempt traces are unknown. These counters can overlap for mixed runs and do not
include re-read stored jobs or claim-only responses. Execution exceptions remain
errors and may provide no reasoning trace. Only aggregate counts leave the worker;
no engine names or provider error bodies are copied. Allowed heuristic fallback does
not turn a saved result into a failed payment/job, and zero observed failures is not
a provider-health guarantee.

**D-149** - Private purchase session revalidation - *Recheck the original live owner
session after readiness/body waits and before invoking payment admission.*
A regression test with actual SQLite revocation reproduced the prepared handler
accepting a purchase after its session was revoked during asynchronous readiness.
The handler now requires an active session with the same owner and session identifier;
revocation or session lookup failure stops submission. This is a boundary check, not
an atomic transaction spanning revocation and settlement. It does not revoke already
issued payment signatures or cancel a submission that has already entered the service.
The public private-purchase route remains unmounted.

**D-148** - Private operations inspection - *Compose worker-policy and treasury
observations in an explicit operator diagnostic command without enabling checkout.*
The command derives configured signer addresses without signing, validates private
runtime policy, and opens the normal database adapter. It reads worker state before
and after the backing check to flag a changed instance/configuration/phase. Reports
omit process IDs, wallet identities, provider endpoints and private job data. Exit zero
only means these observations show matching idle state, backing and spare capacity;
checkoutReady remains false. Disabled configuration does not import signer/database
modules. Database initialization may apply normal adapter schema setup. No spool is
created and no execution or payment operation is invoked. Provider acceptance, durable
admission fencing and the remaining product/mainnet gates are not inferred.

**D-147** - Private treasury backing observation - *Compare recorded conservative
coverage with Gateway available micro-USDC, preserving unknown and insufficient states.*
The read-only inspector snapshots trusted treasury policy, verifies the pinned network
and domain, and requires stored capacity to match configuration. An absent pool uses
the full configured ceiling, never zero. A null balance remains unavailable. Accounting
is read again after the uncached balance request; observed changes invalidate the
comparison. Cancellation prevents subsequent reads, though an already-started Gateway
request retains its own transport timeout. A backed observation never reports checkout
ready: it is not an atomic cross-system reservation and cannot establish exclusive
signer authority, provider health or future available funds.

**D-146** - Private treasury observation - *Read lifetime capacity, allocations and
creator commitments in one SQL snapshot, keeping uncertain payments separate.*
Both adapters expose an operator-only summary; PostgreSQL uses a service-role-only
SECURITY INVOKER function. Confirmed amounts count facilitator success or confirmed/
completed transfer-search evidence, never received/batched or missing proof. The
conservative backing target is capacity minus recorded confirmed creator outflows.
Pending/processing commitments remain covered, including potentially already deducted
amounts, so this is conservative rather than a measured free balance. No allocation
is released. Inconsistent totals or mismatched stored proof are refused. This is a
database observation, not independent receipt verification, profit, refund authority,
live funding evidence or a checkout-readiness decision.

**D-145** - Private worker configuration identity - *Bind advisory worker observations
to a canonical digest of validated public operating policy.*
The digest includes the pinned network, private/public merchants, treasury signer and
capacity, service fee and full reasoning disclosure. Addresses are normalized and
field order is canonical; credentials and signing/encryption keys are excluded.
Bootstrap computes it from the validated policy used to construct the worker, and
status-v2 records include it. Inspection requires an exact expected digest and commit;
old status-v1 records are unavailable. Matching remains advisory and explicitly never
returns checkout ready: it cannot verify provider credentials, actual funds, complete
signer inventory, process fencing or storage health.

**D-144** - Private purchase readiness boundary - *Await bounded server-owned checks
before obtaining a purchase service.*
The prepared HTTP handler supports asynchronous bootstrap and supplies a cancellation
signal to read-only readiness checks. Errors, request cancellation and a five-second
timeout return unavailable; late resolution cannot call submit. Bootstrap must not
sign, reserve or settle because timed-out underlying work can continue if it ignores
cancellation. Request cancellation is checked again before submission. No concrete
worker/funding/configuration acceptance policy or public purchase route is enabled
by this boundary; the advisory status file alone remains insufficient authority.

**D-143** - Private operator exclusion - *Hold an exclusive spool-directory lock for
the complete worker run or manual restore operation.*
The command acquires `private-worker.lock` before database initialization and releases
it only after draining work and closing the database. Exclusive creation rejects a
second operator; release verifies the original random instance record before deletion.
Partial lock writes and process crashes require manual inspection, never age/PID-based
takeover. The lock coordinates these commands on a controlled local filesystem; it
does not fence arbitrary code, separate spool directories or distributed workers.
The permanent database execution claim remains execution authority. No private payment
nonce or claim may be reset as part of cleaning an abandoned filesystem lock.

**D-142** - Private worker observation - *Persist bounded local lifecycle observations
without treating them as a checkout lease.*
The operator loop writes starting/recovering/working/idle/degraded/stopped transitions
to an atomically replaced file in the controlled spool directory. Starting new work
requires its pre-work observation write to succeed; active execution is never raced
against a telemetry timer. Records contain only process identity, commit, phase and
timestamp. The reader rejects malformed, oversized, future and older-than-30-second
observations and never reports checkout ready. A long active job may make the last
observation stale without proving the worker died. Cross-process fencing, shared
configuration identity, funding/provider checks and public admission remain separate
unfinished gates. This is operational evidence, not payment authority.

**D-141** - Private buyer checkout - *Compose independently pinned request and price
limits, temporary owner sign-in, availability checks and a single journaled submission.*
The CLI accepts a bounded private request file, never a question on the command line.
It snapshots buyer policy before asynchronous work and refuses an existing state
directory before login. Server availability is necessary before payment signing;
the current quote route still disables purchasing. A changed owner, provider, request
or price fails validation. The payment authorization and attempt marker are durable
before HTTP submission. Ambiguous responses require read-only recovery, not a retry.
Sign-out must be confirmed before success returns; a late sign-out failure does not
mean payment was never attempted. The command does not activate checkout or mainnet.

**D-140** - Automatic result recovery - *Run bounded encrypted-backup recovery before
admitting more private worker jobs.*
The operator loop scans at most 25 directory entries per iteration with a retained
iterator. Failed restores remain on disk; scanning advances rather than repeatedly
selecting the first failed file. New work waits for a complete error-free sweep.
Restoration uses existing immutable database admission and never reexecutes research.
Shutdown drains a current restore before closing the iterator. Directory errors and
restore failures produce counters only. This assumes one operator worker per spool;
it is not a cross-process lock or a snapshot of concurrently modified directories.
Production provisioning, key lifecycle, disk monitoring and crash acceptance remain open.

**D-139** - Private recovery operations - *Require encrypted result storage for the
operator worker and provide a separate single-backup restore command.*
The enabled bootstrap rejects a missing spool. The command requires an absolute
operator directory and an explicit encryption key before opening the database.
Restore authenticates the backup before database initialization and uses immutable
result admission without starting a worker or constructing a signer. It remains usable
with the worker disabled and prints no private content. Operators must select the
original database and stop concurrent work before manual recovery. Automatic recovery,
key lifecycle and production provisioning are not implied by this command.

**D-138** - Private result recovery - *Optionally persist an authenticated encrypted
result backup before attempting the primary database write.*
AES-256-GCM uses a dedicated environment-supplied encryption key, random IV and random
filename token bound as authenticated data. Recovery calls the existing immutable
result admission method, preserving original owner and permanent worker-claim checks.
Only an exact database acknowledgment permits backup deletion. A database outage must
not cause paid research to execute again. This is an optional executor dependency,
not enabled by the production bootstrap. Key provisioning, recovery scheduling,
retention and filesystem failure acceptance remain launch gates. See
`docs/engineering/private-result-spool.md` for durability and privacy limits.

**D-137** - Private worker process - *Poll sequential bounded ticks with explicit
operator environment configuration and drain active work on SIGINT/SIGTERM.*
The command is disabled by default before configuration/database imports and does not
automatically load a legacy environment file. Idle sleep is abortable, but active
execution is awaited rather than raced against shutdown. Unexpected tick exceptions
are redacted; summaries contain counters only. Errors/unpersisted results set a nonzero
eventual exit code while the daemon continues polling. Once mode executes one tick,
not a readiness probe. No PM2 registration or checkout activation ships with the command;
funding, supervisor grace period and claimed-job recovery require operator acceptance.

**D-136** - Private worker bootstrap - *Require explicit private worker and research
configuration, derive the dedicated EOA from its environment key, and construct the
batching signer without loading or creating legacy wallets.*
The bootstrap validates runtime merchant/provider/treasury policy against configured
public funder and seller identities, cached reserved payees, Arc-testnet network and
domain 26. Worker balance reads use the existing bounded Gateway reader; unknown funds
throw and zero remains zero. No deposit or transfer is initiated. The returned worker
has not run, does not prove backing for its configured capacity, and is not checkout
readiness. Tests verify a real SDK-generated signature locally with an unfunded EOA.
Full operator signer inventory, prefunding, daemon health, recovery and launch gates
remain required before activation; environment flags are not evidence those gates passed.

**D-135** - Private worker ticks - *Process one bounded candidate page serially through
the existing executor; retain the cursor privately and isolate per-job failures.*
Overlapping ticks on one worker instance are refused. Configuration and signer methods
are snapshotted at construction, with explicit provider validation and no legacy engine
fallback configuration. The cursor advances after errors so a bad job cannot starve
later IDs, and resets after a short page. Pause only between jobs; never race a paid
execution against a polling timeout. Executor claims remain the cross-process authority.
Summaries contain counters only. A returned run counts as completed only when private
result storage can be read; absent storage is reported as unpersisted. Claimed jobs
are never reset or reexecuted. The polling primitive is tested with the actual executor
and SQLite using a blocked provider transport, local fallback and an empty corpus.
A daemon, operator bootstrap, readiness gate and recovery for claimed-but-unpersisted
jobs remain outstanding; these counters alone are not an operational readiness signal.

**D-134** - Private worker discovery - *Page backend-only candidate IDs by dedicated
treasury signer, requiring stored settlement fields and no existing execution claim.*
SQLite and a service-role-only PostgreSQL function select at most 25 IDs/owners in
ascending ID order with an exclusive cursor. Restart each sweep after its last page
to pick up newly inserted IDs below the cursor. No question, signature, provider key
or receipt is returned. Selection is a hint, not signature/settlement validation or
execution authority; runPrivateResearch must revalidate and win its atomic claim.
Pending payments and already-claimed jobs cannot be selected, and claims are not leased
or reset. Tests cover database reopen, cursor bounds and PostgreSQL permissions.
The polling loop, worker bootstrap and operational readiness gate remain to be wired.

**D-133** - Private purchase HTTP boundary - *Use a live account session and same-origin
check before a server-provided limiter/bootstrap, bounded input and backend admission.*
The handler takes its payer from the durable session, not body fields, and passes the
submission to the existing signature/pricing/treasury service. Responses are no-store
and expose only job ID and server-reported payment status. Known confirmation that failed
initial persistence gets one storage-only retry; no second payment operation runs. If
storage remains unavailable, the original pending attempt requires reconciliation.
Private exceptions and recovery confirmation are omitted from responses. A common
64-KiB/five-second body reader now serves this handler and MCP without changing MCP's
public error response. The purchase handler is not mounted at a public route: a
worker-ready bootstrap, rate-limit wiring and operational acceptance remain required.

**D-132** - Private buyer submission - *Send the verified saved payload only after an
exclusive durable local attempt marker, and recover by reading after any uncertainty.*
The internal Node transport requires an existing account cookie, pins the private URL,
disallows redirects and sends no caller-supplied quote requirements. It does not sign,
fund or retry. Non-success HTTP responses, timeouts, invalid/oversized bodies and foreign
job IDs preserve the marker and require recovery. Existing markers prevent another
HTTP attempt, including after rejection. An authorization outside its validity window
is not sent and its claimed marker remains reserved. Successful responses are explicitly
server-reported; they do not independently verify settlement or permit another payment.
The private HTTP purchase route, CLI composition and worker activation remain unwired.

**D-131** - Private buyer preparation - *Validate independently chosen quote terms,
reserve a new local directory before signing, and verify/persist the signed intent
before returning a journal reference.*
The Node helper snapshots merchant policy and signer identity, uses the private v2
commitment and existing Arc-testnet typed data, then verifies the actual EOA signature.
An existing directory denies a fresh attempt before signing. Signing, validation or
write failures retain the reservation and produce a generic error; callers must not
delete it and regenerate an authorization as recovery. Output is a local journal
reference, not a paid or submitted job. Plaintext journal and Windows ACL limitations
remain unchanged. This helper performs no network call, funding, payment submission
or feature activation, and is not yet exposed in the CLI or browser checkout.

**D-130** - MCP input limits - *Read POST bodies once with a 64-KiB byte cap and
a five-second deadline before access resolution or tool dispatch.*
Count streamed bytes independently of Content-Length, reject invalid UTF-8/JSON with
a generic JSON-RPC error, and pass the parsed value into the SDK transport. Cancel
without awaiting an untrusted cancellation promise so the deadline also bounds error
cleanup. Walk nested batches iteratively to avoid recursive stack exhaustion. These
limits complement existing origin, rate and treasury checks; they are not a global
concurrency cap or a replacement for deployment-level request limits.

**D-129** - Private recovery CLI - *Validate the journal before login, recover in a
temporary session, then optionally write a new private snapshot after sign-out.*
The command reads KERYX_BUYER_PRIVATE_KEY only from its environment and requires explicit
trusted merchant addresses. It never creates/funds wallets, signs payment typed data or
changes original intent/attempt files. Default stdout contains state and integer spend
summaries without job ID, question, answer or cookies. Explicit output is exclusive,
plaintext and labelled server-reported evidence; an existing destination fails before
login. Session revocation must be confirmed before output is written. Failure diagnostics
omit private exception bodies. The command supports existing private journals only; it
does not make private checkout, journal creation UI or independently verified private
receipts available.

**D-128** - Temporary buyer account sessions - *Use pinned SIWE login for private
read recovery, keep the cookie in memory and confirm revocation before returning.*
The Node helper signs only a keryx.cc Arc-testnet SIWE message with a fresh validated
challenge and 15-minute expiry. It does not accept arbitrary signable server text or
payment typed data. Requests have bounded deadlines and bodies; raw auth errors and
cookies are not propagated. Success or operation failure both enter sign-out cleanup;
one idempotent revocation retry is allowed, and unconfirmed revocation is an explicit
failure. A lost login response can create a server session whose cookie is unknown,
so expiry remains the fallback and full revocation is not claimed in that case. This
helper is not yet a CLI command and does not persist credentials or activate purchases.

**D-127** - Private buyer read recovery - *Use the validated local intent and a live
account cookie to request the existing private result, never to resubmit payment.*
The Node recovery helper calls only the pinned account result endpoint with the job ID
in a POST body, a bounded deadline and redirect rejection. It never sends the original
payment signature/salt or changes journal state. The returned owner, research fields,
package, price and budget must match the signed intent; integer creator accounting and
per-leg status totals must reconcile. Session expiry, missing results and malformed or
mismatched responses produce generic failures without copying response bodies. This is
a server-reported view, not an independently verified portable receipt; the existing
response does not bind a result digest or expose a signed per-job result proof. CLI login,
commands and encrypted local backup remain incomplete.

**D-126** - Private buyer journal recovery - *Persist the original provider-bound
signed intent and claim a local submission marker before any HTTP payment attempt.*
The Node-side journal validates EOA ownership, canonical commitment, private resource,
trusted merchant and derived job ID on create and restore. Restoring an expired intent
is allowed for recovery; it never refreshes nonce, salt or signature. A bounded 64 KiB
read prevents unbounded file parsing. Exclusive directory/file creation and fsync precede
submission authority; existing or partial attempt markers deny another local attempt.
This is a plaintext private journal with restricted creation modes, not encryption or
a Windows ACL guarantee. Copies and tampering cannot replace server-side nonce checks.
No CLI command, browser storage or payment request is activated by these helpers; clients
must use the claimed validated snapshot and recovery-only paths after an attempt.

**D-125** - Authenticated quote preview HTTP boundary - *Require live sessions and
same-origin bounded POST bodies; expose preview terms only.* The new account quote
route derives its owner from the revocable session, accepts at most 16 KiB within five
seconds and returns no-store responses. Bootstrap defaults off and derives private and
public treasury identities from explicitly configured keys without signing, funding or
legacy wallet creation. Invalid/missing keys and stale public merchant reservations
fail closed with generic errors. Only the quote method leaves bootstrap. Every successful
response explicitly reports purchasingAvailable=false; no private payment endpoint is
introduced. Production remains disabled until private runtime provisioning and the rest
of checkout/worker/operational acceptance are complete.

**D-124** - Private service composition - *Derive payment requirements from the
validated runtime and an explicit integer service fee, never from submitted metadata.*
The backend service snapshots runtime configuration, builds quotes with signed creator
budget plus operator service fee, then rebuilds those same requirements for admission
before invoking capacity-gated incoming settlement. Client-supplied payment requirements
are rejected by the strict submission envelope; an otherwise valid signature for a
lower amount cannot pass admission. Runtime fee input is mandatory, positive and bounded
to keep total within the existing one-USDC testnet limit. Repeated signed submissions
reuse durable intent/payment state. Only the response projection is intended for HTTP;
unpersisted success evidence remains in a separate backend recovery field. No HTTP
route, session authentication, browser checkout or worker activation is introduced.
Those layers must consume this service and preserve its authority boundaries.

**D-123** - Explicit private runtime configuration - *Default off; require distinct
merchant/treasury authority and an operator allowlisted reasoning endpoint.* The backend
policy parser accepts only an explicit 0/1 enable flag, pinned Arc testnet context and
complete private credentials/configuration. The private merchant must appear in the
public seller reservation set. Its payee and creator treasury signer cannot reuse known
public treasury authorities; the creator signer must also match the configured private
address and must not be a reserved merchant. Context signer addresses must be derived
from actual backend signer instances. The private engine factory resolves the endpoint,
which must match an explicit operator allowlist. Parser failures never expose raw input
or credentials. This validates configuration consistency only, not funding, legal/provider
retention approval or a complete signer inventory. The parser is not yet a route switch;
no purchase endpoint is activated by setting these variables alone.

**D-122** - Treasury admission enforcement - *Reserve shared creator capacity after
payer verification but before incoming settle; bind v2 execution to the saved signer.*
Fresh private payment submission requires an explicit operator treasury policy. Verified
payments that cannot obtain capacity return capacity-unavailable before claiming or
submitting settlement. A lost allocation acknowledgement cannot authorize settlement;
a later attempt can recover the same immutable allocation. Existing incoming attempts
return their previous state without reallocation. Before any funding check or execution
claim, v2 execution reads an owner-scoped allocation and requires its signer to match
the actual creator-payment signer. Readback also validates the signed budget. Stored
results and existing execution claims remain recoverable without creating allocations.
No configured ceiling proves funds exist: dedicated signer backing, safe replenishment
and release handling remain operational prerequisites. Public purchase routes remain
closed; no real allocation or payment was created by these synthetic tests.

**D-121** - Shared private treasury capacity - *Allocate signed creator budgets
atomically against an immutable ceiling for a dedicated signer.* Per-job caps alone
cannot prevent concurrent jobs from assuming the same available funds. The new database
primitive binds one permanent reservation per job to its verified signed creator budget.
SQLite uses a single conditional insert; PostgreSQL locks the signer pool before summing
allocations. Retries return the matching original allocation; signer/ceiling substitution
fails. Supabase requires matching readback after RPC success and never treats a lost
response as a new allocation authority. Integer micro-USDC values are bounded below the
JavaScript safe integer limit. This is a conservative lifetime allocation, not a balance
oracle: completed and uncertain jobs keep their allocations. It requires a dedicated,
verified-funded signer with no other spending paths. No pool has been provisioned and
the primitive is not yet wired into purchase/execution. Safe replenishment, unused-budget
recovery and abuse-resistant prepayment admission remain prerequisites for public use.

**D-120** - Authenticated private admission - *Rebuild trusted quote terms and
match the verified signed request before reserving an intent.* The backend boundary
requires the authenticated payer to equal the locally verified signing EOA. It resolves
provider disclosure from a copied operator configuration, reconstructs the quote from
the signed research fields and trusted payment requirement, and applies the strict v2
quote validator. Foreign owners, tampered requests, legacy requests and changed provider
policies fail before any database write. Identical admissions retain the original intent;
reservation neither submits payment nor grants execution. The helper returns only an ID
and reserved status, not bearer authorization. The real database test now composes quote,
EOA signing, admission, synthetic facilitator settlement, pinned engine execution and
stored-result recovery. Live-session routing, operator pricing and endpoint approval,
capacity reservation and browser consent still need wiring before purchase activation.

**D-119** - Private incoming recovery - *Persist exact confirmed/completed Circle
transfer-search evidence without resubmitting payment.* Owner-scoped reconciliation
uses the shared bounded, paginated search and independently matches nonce, payer,
recipient, networks, token and integer amount. Received/batched observations remain
processing; missing, mismatched and failed observations keep the durable attempt
pending and never authorize retry or release. Only confirmed/completed search evidence
can satisfy incoming payment for execution. Its provenance and observed transfer stage
remain distinct from facilitator success; neither asserts independently verified chain
finality. Existing first confirmation is immutable. SQLite validation and PostgreSQL
RPC migration 0054 accept the new evidence variant. No public endpoint, scheduler or
purchase activation is introduced; operator wiring and acceptance drills remain open.

**D-118** - Private incoming settlement - *Claim once before settle; retain ambiguous
attempts permanently and return unpersisted confirmation for storage-only recovery.*
The backend helper reads a verified durable intent owned by the caller, requires v2
provider binding for fresh submission, checks authorization time and verifies the payer
before atomically claiming submission. Only the fresh claimant calls settle. Existing
pending or settled attempts return without another facilitator call, including after
expiry. Success requires a valid payer/network/transaction and exact saved authorization
tuple. Invalid, lost or failed settlement responses remain pending. Confirmation write
failure returns backend evidence for retrying persistence, never resubmitting payment.
The fixed testnet transport uses a 30-second deadline, 64 KiB response limit, no redirects
and no retry or discovery extensions. Payload metadata excludes question, salt, private
job ID and provider disclosure. The installed batching SDK wire format was inspected;
this path uses bounded HTTP instead of its unbounded default fetch. No public route is
activated. Caller authentication, trusted quote/merchant/provider admission, incoming
reconciliation and operational readiness remain prerequisites for opening purchases.

**D-117** - Private quote terms - *Build secret-free provider-bound quotes and
validate them against independently selected buyer terms before authorization.*
The backend uses the same private engine factory as execution to resolve provider
and wire model. The portable buyer validator requires v2 disclosure, exact resource,
Arc testnet requirement and separate trusted merchant. Integer micro-USDC arithmetic
checks total, creator budget and service fee against independent total and fee caps.
Quotes explicitly retain unused budget and promise best-effort research only; misleading
refund or quality terms are rejected. Successful parsing is neither buyer consent nor
payment evidence. No HTTP route, signing, payment admission or provider call is enabled.
Operator endpoint approval, retention disclosure and an actual consent flow remain open.

**D-116** - Private execution transport authority - *Construct the v2 engine
inside the executor from explicit backend configuration, then compare its disclosure
to the signed request before any funding check or execution claim.* A separately
supplied policy could previously match while an injected engine used another provider.
The v2 path now exclusively uses the pinned private factory, with no arbitrary engine
callback. Configuration is copied before storage awaits. Legacy v1 callback execution
remains for historical internal callers and does not establish provider consent; it
cannot execute a v2 request. Stored-result and claimed-job recovery need no provider
credentials. The factory does not perform HTTP during construction. Endpoint approval,
retention terms, admission and buyer-facing consent remain necessary before purchases.

**D-115** ? Signed private reasoning policy ? *Bind resolved provider, model,
endpoint, local fallback and prohibited redirects into the authorization nonce.*
Requests with an explicit strict reasoning disclosure use commitment domain v2;
legacy v1 canonical bytes remain unchanged for historical verification. Unknown
fields or a model/disclosure mismatch cannot silently downgrade to v1. Fresh backend
execution requires its supplied policy to match the signed disclosure before funding
checks, model construction or claiming work. Stored-result and existing-claim recovery
remain read-only and do not depend on the current provider configuration. The trusted
caller must supply the matching private engine factory; a matching policy alone does
not prove which engine was injected. Legacy requests do not establish provider consent.
No private purchase route is enabled by this change. Approved endpoint inventory,
retention disclosure, buyer consent UI and actual payment admission remain outstanding.

**D-114** · Private reasoning provider boundary · *Construct one explicit catalog
model/endpoint with local fallback, no automatic provider rotation or redirects.*
The backend factory requires an exact current catalog ID, matching provider, HTTPS
base URL without credentials/query/fragment and an explicit server credential. It
rejects retired/default aliases rather than silently remapping them. Planning and
synthesis use the same pinned wire model. Each job gets its own memory circuit store
and deterministic heuristic fallback; public durable circuits and provider defaults
are not selected. Fetch rejects redirects under the private option, and transport
options are copied so caller mutation cannot reroute later steps. A secret-free
disclosure records the resolved endpoint/model/fallback. It is not yet bound into
buyer-approved quote/intent state, so this factory is not activated by private purchase
or execution routes. Approved endpoint inventory, provider retention terms and durable
disclosure binding remain release prerequisites. Existing public redirect behavior is
preserved; the private factory explicitly selects the stricter policy.

**D-113** · Reasoning failure log privacy · *Retain operational categories, never
raw provider or circuit-store error bodies.* Provider fallback previously interpolated
the full thrown message into a warning, even though structured attempts already used
categories. Errors can echo request text or credentials. Warnings now use the same
category and a runtime-validated integer HTTP status only; malformed status values
cannot enter structured attempts. Circuit-store failures log the failed operation and
memory fallback without copying arbitrary database error text. Fallback and circuit
behavior remain tested, including success after an outage. This removes these known
disclosure paths; it does not certify SDK telemetry, provider retention, all application
logs or historical log deletion. Those remain part of private-purchase acceptance.

**D-112** · Private research account workspace · *Recover and read private jobs in
memory under the signed-in account, without a new payment or public dispatch link.*
The history endpoint shares live session checks, same-origin policy, bounded body
selectors and no-store responses with private result reading. Both responses identify
the authenticated wallet. The browser validates their schema, wallet and selected
request fields, holds IDs only in component state, and cancels/ignores obsolete reads.
Wallet-session changes remount the workspace; 401 responses clear history and results.
The UI exposes source decisions, answer/evidence and current spend separately from
snapshot citation attribution. Text is rendered without executing markup. It does not
poll claimed workers as if they were alive or retry payments. Result reads permit a
bounded 16 MiB UTF-8 body to accommodate the existing 4 MiB JS-string snapshot limit;
other buyer reads retain their 2 MB default. Private purchases, portable private
receipts, CLI integration and full provider/public-projection acceptance remain open.

**D-111** · Private history enumeration · *Recover private job identities from the
owner's durable intents, independently of browser storage and job completion.* Both
adapters expose a backend-only 25-row keyset page plus sentinel, filtered by the
normalized payer and ordered by creation timestamp then ID. Every returned intent is
revalidated against its signature, identity and owner before projection. An explicit
allowlist returns the original question/package and price commitment, not signatures,
salts or payment authority. A history entry does not imply a paid or completed job;
the result endpoint provides current state separately. Cursor timestamps preserve DB
precision; cursors never grant access to another payer's records. A matching composite
index supports the order. This is backend groundwork for account recovery; authenticated
history transport and browser/CLI integration remain to be connected.

**D-110** · Authenticated private result reading · *Read-only POST with a live owner
session, a bounded body selector and an explicit result schema.* The new account route
derives the payer from the revocable session, requires same-origin access, and never
starts execution or submits payment. Wrong-owner/missing jobs share a 404 response;
storage/schema failures return a generic 503 with no raw error. Responses are no-store.
The result projection binds signed intent identity, requires real treasury A2A provenance,
validates displayed decisions/evidence/claim indices and strips unselected nested fields.
It exposes answer/evidence/agency to the owner, omits raw trace and authorization data,
and composes current spend independently of historical snapshot totals. Citation reward
figures are explicitly recorded snapshot amounts, not current payment confirmation.
Execution-claimed is not a worker heartbeat or permission to retry. Private purchases,
private account enumeration, UI/CLI recovery and provider/public-projection acceptance
remain incomplete; the read route alone does not activate private research sales.

**D-109** · Private buyer spend projection · *Read current durable payment evidence
separately from immutable research output.* The backend owner projection allowlists
economic and source fields, excludes signed authorizations/worker identities/private
text, and never reads historical result totals. Exact micro-USDC strings separate
unresolved admission, Circle processing (`received`/`batched`) and confirmation
evidence. Neither facilitator success nor a stored Circle stage is represented as
independently verified chain finality. Every admission stays committed, including
expired or confirmed legs; uncommitted budget is an observation, not a refund or
permission to spend. Sequential reads are not a transactional financial snapshot.
Missing ownership returns no projection before ledger access; storage errors propagate
instead of manufacturing zero spend. The caller must authenticate the payer. This
internal view does not expose a route, enable private purchases, or provide creator
analytics; authenticated result delivery and its disclosure review remain required.

**D-108** ? Private research executor and effects ? *Run the signed job once with a
complete private storage/disclosure strategy, never via public dependency defaults.*
The backend executor reads verified intent/payment state, returns stored results or an
existing-claim status without restarting research, checks prefunding, and atomically
claims execution before invoking the agent. Question, budget, depth, model selection
and execution limits come from the signed intent/package. It assembles the explicit
private gateway and effects rather than calling the public dependency selector.
Effects use only a job-local in-memory content cache, no shared memory/reputation or
external discovery, no outbound citation notifications/alerts and no public activation
writes. Payment observations must match durable admission and, when settled, a saved
confirmation; a flag on an arbitrary PaymentRecord cannot promote private settlement.
Only the scoped private result store receives the completed run. Diagnostic observers
retain counts only. The caller still authenticates the payer and supplies trusted
signer/balance/model dependencies. Synthetic SQLite integration covers concurrent
workers, actual transport/journal operations, grounded citation rewards, forbidden
shared effects and saved-result replay without payment. No private HTTP quote/purchase
or production signer factory is activated; provider disclosure review, isolated read
projections, creator earnings and authenticated browser/CLI recovery remain required.

**D-107** ? Private server payment gateway ? *Share creator payment operations while
keeping legacy wallet custody/funding out of private construction.* `ServerPaymentGateway`
now owns source/article purchases, citation payments, price/content identity checks and
receipt-preserving error handling. The existing `RealGateway` retains its legacy
spend-wallet loading and funding implementation and inherits those operations.
`PrivateServerGateway` instead requires an explicit signer/address and a read-only
Gateway-balance callback; it never creates a wallet, loads the legacy key file, deposits
or transfers funds itself. It refuses another job before HTTP, attaches the durable
private journal to both fetch and citation legs, and retains confirmed debit evidence
when confirmation persistence or paid delivery fails. Insufficient funds require
explicit prefunding. This does not provision a signer or merchant, prove the freshness
of a caller-supplied worker, or replace source/registry payout checks. The execution
factory must obtain a fresh durable claim and supply trusted environment-owned signer
and balance dependencies. Full isolated research effects, creator projections and
private HTTP/client recovery remain unconnected; no private endpoint is enabled.

**D-106** ? Private creator reconciliation ? *Recover from the durable submission
using complete Circle search and retain the origin/stage of the evidence.* The private
backend reconciler reuses the existing paginated search and exact nonce/payer/payee/
network/USDC/integer-amount matcher. It sends no private job/source identity to search,
never signs or retries payments, and never writes public payment metrics. A separate
`circle-transfer-search` confirmation variant stores the transfer ID and first-observed
Circle status; `received`/`batched` are accepted processing stages, not on-chain finality.
Existing facilitator receipts retain their original provenance. Missing, failed,
unknown, mismatched or ambiguous search evidence cannot promote storage or release
budget. DB/search outages remain unresolved. A bounded owner-scoped cursor permits
continued scanning beyond old pending rows; callers must follow it and begin a fresh
scan later to revisit unresolved rows. Immutable existing confirmations are skipped,
so this does not track later finality changes. Tests cover reopen recovery and a match
on the second Circle page. No production scheduler/private route is enabled. Exact
terminal-failure handling, finality tracking, safe projections and full private
execution remain separate required work.

**D-105** ? Private creator confirmations ? *Persist the first trusted settlement
observation against an admitted tuple; preserve observed receipts if persistence is
uncertain.* The separate confirmation store requires the same owner and worker and
matches nonce, expiry, payer, payee, integer amount, network and asset to admission.
It acknowledges exact retries, rejects conflicting references on readback and never
releases creator budget or reopens execution. Confirmations can arrive after result
saving; immutable historical snapshots are not rewritten. The private journal adapter
connects pre-submit admission to outcome persistence and returns the original observed
attempt with `confirmation-unpersisted` if a DB write/readback fails. Retrying outcome
persistence does not sign or send HTTP; the same journal cannot admit a second signed
request. Unknown/mismatched observations do not promote the ledger. The source label
is not cryptographic proof: only trusted transport outcomes may construct these records.
Synthetic integration covers paid HTTP 500 plus DB outage and subsequent persistence
without a second paid request. Production gateways are not connected to this factory;
Circle reconciliation, restart recovery of unpersisted observations, safe creator
projections and full private execution remain outstanding.

**D-104** ? Private creator admission ledger ? *Atomically consume the signed
creator budget before HTTP submission, once per economic leg and nonce.* A separate
`private_creator_submissions` table records only non-bearer tuple evidence under an
owner-validated permanent worker. The leg key binds kind, source, optional article
and recipient; changing only the nonce cannot pay that leg again. Nonces are unique
across this ledger. SQLite uses one insert-select; Supabase serializes on the worker
row before summing integer micro-USDC against the original signed creator budget.
Result sealing takes the same PostgreSQL lock and new legs are denied after a saved
result. Only a fresh insert and matching validated readback admit HTTP; duplicates,
cap exhaustion or lost acknowledgement do not. Every admitted amount remains held,
including uncertain outcomes and expired authorizations. No release or settlement
promotion is implemented in this slice. The caller must supply independently checked
source payout/spender authority; ledger identity is not a replacement for registry
checks or trusted signer evidence. The transport and SQLite ledger are integrated in
synthetic tests, but no production gateway/factory supplies this journal yet. Creator
settlement promotion, earnings projections, reconciliation and private execution
remain unfinished. Never clear this table during restore/restart to obtain capacity.

**D-103** ? Creator submission persistence boundary ? *Allow an exact non-bearer
journal admission immediately before treasury signed HTTP submission.* The server
x402 transport accepts an optional backend `beforeSubmit` callback. When supplied,
it matches the signer's from/to/value to the expected payment and passes only nonce,
expiry, normalized payer/payee, integer micro-USDC, network and asset. The signed
header and immutable scalar evidence are captured before awaiting the callback.
Callback rejection prevents HTTP submission and is not retried or converted into a
post-submit pending result. Once submission happens, response loss remains pending
and confirmed settlement evidence remains available even on a failed paid response.
The callback itself must enforce durable uniqueness, private job/worker authority
and the atomic creator budget; this hook does not implement those policies or prove
payment. Existing public callers omit it. No real gateway/private factory currently
supplies a journal, so the private ledger and recovery gap remain open until integrated.

**D-102** ? Citation transport privacy ? *Keep job identity in the local payment
record, not in the citation request URL.* The citation seller uses only the source,
author and amount; its unused `query` parameter unnecessarily exposed correlation
metadata to request logs and transport providers. Both browser co-sign and treasury
requests now omit it for the challenge and paid retry. Internal payment records retain
the original query ID, including pending and settled-but-undelivered outcomes, so
accounting and reconciliation keep their attribution. Existing incoming URLs remain
compatible because the seller never consumed this field. Source, payee, amount and
nonce checks are unchanged. This reduces URL disclosure; it does not make public
results private or hide amounts/payees from the payment provider. Private creator
ledger and end-to-end result access isolation still require integration.

**D-101** ? Private result durability ? *Keep the first completed snapshot in an
isolated store, scoped to the verified intent owner and permanent worker claim.*
Both adapters require validated settled payment/intent/worker state before saving.
The snapshot is copied before asynchronous lookups and checked against the signed
job ID, question, creator budget and research mode. Atomic insert-if-absent retains
the first exact serialization; exact retries acknowledge it and conflicting data
cannot overwrite it. Readback is required before acknowledging persistence. Missing
or failed readback leaves the save uncertain, never permission to execute research or
pay again. Owner-scoped reads revalidate admission; no public run/order/payment table,
archive, memory or notification hook is touched. The stored `query-run-v1` text is an
opaque backend snapshot, not a validated buyer receipt or settlement proof. Future
owner-facing projections must validate their required fields and bind financial claims
to the isolated creator ledger. Supabase clients cannot read or mutate the table; only
service-role reads and a worker/owner-scoped insertion RPC are granted. This is storage
isolation, not end-to-end encryption: backend operators and authorized backups retain
access. Private execution, creator ledger, authenticated polling and transport remain
unavailable until the complete flow is integrated and tested.

**D-100** ? Private worker admission ? *Claim execution once, only after validating
an owner-bound settled payment; never use elapsed time as permission to execute again.*
SQLite and Supabase store a separate permanent execution claim. An atomic insert
selects an existing owner intent with a confirmed payment; the adapter additionally
revalidates the original signed intent and full confirmation tuple. Only a fresh insert
followed by a matching validated readback returns a server-generated worker identity.
Duplicate claims return no execution authority, including after restart or authorization
expiry. Lost RPC/readback responses fail closed and must be inspected/recovered without
replaying paid work. Supabase grants service-role reads and one restricted claim RPC,
with no client access or direct application updates/deletes. Worker identity is backend
state, not an account response or a substitute for authenticated payer access. These
claims are groundwork for private effects/result persistence; no scheduler, execution
route, receipt transport or private merchant is enabled yet. Do not clear or rewind
claims during a restore: a worker may already have paid creators. Recovery requires
per-leg evidence and durable result state before any retry can be authorized.

**D-99** · Research execution effects · *Select one complete, job-scoped effects
strategy before reasoning or funding; never fill missing private handlers with public
defaults.* The orchestrator now routes payment persistence, cache reads/writes,
discovery, shared memory, citation notifications, alerts and activation through an
explicit server-owned interface. `collectRun` retains the same selected strategy for
final persistence after its existing save checkpoint. Historical public callers use
the unchanged public implementation. Reserved `prv_` IDs require an explicit job scope;
missing methods, a public scope or another job ID fail before execution. Scope metadata
is not payer authentication, payment evidence or proof that an implementation is
private. The future private factory must verify admission and supply isolated durable
stores and disclosure-safe observers. Gateway/provider behavior, public SSE delivery,
creator earnings and authenticated result recovery still require separate integration.
This refactor does not enable a private route or advertise private results.

**D-98** · Public seller merchant reservation · *Reject reserved private recipients
before any public x402 verification, settlement or content delivery.* The server-only
`KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES` list includes current and retired private
merchants. Public research, source/article and citation sellers check both their quoted
payee and the authorization's signed recipient; unsigned resource/discovery metadata
cannot bypass the decision. The unused legacy wrapper applies the same guard. Active
reservations also reject missing/malformed authorization recipients rather than rely
on vendor address coercion. Invalid lists or a public/private merchant collision return
503 instead of disabling the guard. Keep this configuration through rotation and
restore; do not repurpose reserved wallets as public creator payees. An empty list
preserves current public-only operation and must never coexist with enabled private
quotes. No private merchant is provisioned or private flow enabled in v0.22.31.

**D-97** · Private payment submission journal · *Persist one submission boundary
per private intent and keep ambiguity durable.* A separate payment-attempt record is
claimed atomically before any future facilitator I/O. Exactly one caller can obtain
a fresh pending claim; replay, restart, elapsed authorization validity and an already
confirmed readback never authorize another submission. Confirmation is a one-way
compare-and-set bound to the original network, payer, payee, amount and nonce. Exact
repeats retain the first reference; conflicting confirmations fail. The confirmation
envelope is an internal backend contract, not cryptographic evidence and not a client
receipt format. Only an actual trusted facilitator success may populate it in real
execution. PostgreSQL exposes restricted owner-scoped transitions and denies direct
application updates. This internal storage has no network executor or route yet.
Future transport must preserve an observed Circle receipt even when journaling fails;
missing readback remains unknown. No expiry-driven failure, retry, refund, worker
enqueue or public traction follows from this journal alone.

**D-96** · Durable private intent reservation · *Keep signed private input outside
the public run, order and payment tables, with an immutable first writer.* A dedicated
private intent table stores the normalized signed request, original salt, authorization,
quote and merchant snapshot. Its `prv_` identity is domain-separated from legacy order
IDs and binds network, payer, payee and nonce. Both adapters reverify stored signature
and request binding, scope reads to an independently authenticated payer supplied by
the server, and reject conflicting retries without replacing the original. SQLite
blocks updates with a trigger; PostgreSQL grants the application only insert/select
and denies anonymous/authenticated direct access. A reservation is not settlement or
a runnable order. No caller uses this storage yet; seller reservation, payment state,
private execution/results, notifications, cross-query learning and authenticated
recovery still require integration. Backup copies contain bearer authorizations and
private questions and must retain the existing private-data handling protections.

**D-95** · Private merchant and signature verification · *Verify the private request
against a server-selected quote and a distinct trusted merchant before admission.*
The new, currently unwired verifier checks canonical commitment equality and the EOA
EIP-712 signature locally. The submitted body cannot choose authoritative quote terms,
merchant policy or payer identity. Both server verification and fresh buyer intent
creation reject a private/public research merchant collision. This keeps the original
nonce format intact and prepares stateless purpose separation through signed `to`.
All public seller paths must reserve the private merchant before enabling private
quotes; that enforcement and merchant configuration are not implemented yet. A nonce
purpose table alone is insufficient because restoring older state could lose it.
Original quote terms and access policy must survive retries, rotation and restore.
Signature verification is not settlement, balance, fresh validity or access proof;
a paid job must remain recoverable after its original authorization expires. No route,
signer integration, funds or privacy feature is activated by this internal change.

**D-94** · Private request commitment foundation · *A proposed private job binds
its normalized request and quoted transfer terms into a domain-separated SHA-256
nonce with a fresh 32-byte Web Crypto salt.* The existing EIP-3009 typed signature
then covers that nonce. The pure browser/Node module pins the future resource, access
policy, network, asset, Gateway domain, payer/payee, amount, time bounds, package
contract and requested model. Unknown fields fail validation; legacy request schemas
remain unchanged. Binding equality alone is neither signature verification nor
settlement, authentication or confidentiality. No route uses this module yet. Keep
salt/request data in private storage, preserve old nonces and paid journals, and do
not advertise private quotes until admission, cross-version replay handling, storage,
all public projections and authenticated recovery are implemented and reviewed.

**D-93** · Payer history and research privacy · *Account enumeration and result
confidentiality are different authorities.* `/api/me/jobs` enumerates durable orders
only for the active signed-in payer, independent of browser journal availability or
whether a result was saved. Timestamp/ID keyset pagination handles tied timestamps;
cursor contents never select another wallet. The projection excludes authorization
nonces, worker fields and raw responses. GET-only result inspection does not recreate
a pre-payment intent or establish original-request receipt verification. Historical
jobs retain their existing publication/access contract; the UI says so. The complete
private-result migration, including public projections, notifications, payer-bound
recovery and versioned request identity, is tracked in `docs/private-research-access.md`.

**D-92** · Account session management · *A session selector is not a credential.*
The authenticated wallet may list active sessions and revoke a selected session or
all other sessions. Every operation verifies a live signed session and scopes its
database predicate to that wallet. Browser mutations require a matching Origin.
Only hashed selectors and issue/expiry times leave the server; raw JWT identifiers,
tokens, IP addresses and invented device/location labels do not. Inventory is capped
at 100 with an explicit truncation notice, while bulk revocation reaches all matching
rows atomically and preserves the current session. Read-back failures and no-op writes
cannot report successful revocation. Another wallet's selector gives no access and
gets the same idempotent response as an absent selector. Already accepted work and
payment authorizations retain their separately documented authority. Private research
history and device key recovery remain distinct requirements.

**D-91** · Revocable account sessions · *A signed JWT is necessary but insufficient
for account access.* Each new login persists a hash of a random session identifier,
the exact wallet and second-aligned issue/expiry times before issuing its JWT.
Verification pins algorithm, issuer, audience, token type and validated claims, then
requires the exact active database row. Logout removes that row before clearing the
cookie; storage uncertainty returns an error and retains the cookie for retry.
Other device sessions remain independent. Legacy JWTs without this binding must
sign in again; no silent upgrade or compatibility bypass is allowed. Browser hook
revisions prevent late lookups from resurrecting logged-out UI, and other tabs refresh
through ephemeral browser messaging. Account logout does not erase spend grants,
pending authorizations or completed research. Already accepted work may finish.
Before restoring service from a backup, discard ephemeral login challenges and web
sessions so an older snapshot cannot resurrect revoked authority. Private research
access policy and multi-device session management remain further account work.

**D-90** · Sign-in replay prevention · *A cookie binds the browser flow; only a
durable, issued, unexpired challenge can authorize a new session.* A local real-SIWE
fixture reproduced replay by retaining the old nonce cookie. The server now stores
only a domain-separated nonce hash with a five-minute server expiry, then atomically
deletes one eligible challenge before signature verification. Cookie deletion is not
the authority. SQLite and service-role-only Supabase RPCs implement the same condition;
database failures deny sign-in. Bounded uploads and separate hashed-IP rate buckets
limit admission. A rejected signature consumes its challenge; malformed/oversized or
cross-origin requests do not reach that boundary. Current JWTs are not rotated or
revoked by this change. Session revocation, private buyer history and broader auth
review remain separate mainnet work. Restores must discard ephemeral login challenges
before serving traffic, without discarding payment authorizations or journals.

**D-89** · Portable buyer recovery · *Copy the original intent and any saved seller
acknowledgement across runtimes without restoring submission authority.* The bounded,
versioned bundle contains no signatures, keys, URL override or permission to pay.
Both runtimes recompute the original job ID. Browser insertion is exclusive and
atomic; Node import creates a new single-use state directory. Existing and partially
written directories remain unavailable to `buy`. Legacy intent-only files remain
valid for GET recovery. Missing evidence stays unknown, and copied acknowledgements
remain unverified seller assertions: payer/network matching does not establish
cryptographic job-level settlement. Receipt binding remains a separate check. This
addresses the owner browser pilot's lost portable acknowledgement without claiming
wallet/funding backup or authenticated server history. Reversible: easy; legacy
intent files and existing journals remain supported.

**D-88** · Deployment dependency state · *Reuse a recorded successful installation,
not a Git reflog comparison.* The VPS clears an installation stamp before `npm ci`
and writes it only after success. Reuse matches manifest/lock, runtime/ABI/npm/config,
installed hidden lock and presence of direct dependency manifests. Version-only root
release metadata is ignored only without install hooks, workspaces or local deps.
This avoids unnecessary reinstallations and prevents a failed installation from
being mistaken for a completed one after Git advances. The helper is dependency-free
Node code; config values are hashed, not exposed. It is not an installed-file security
audit or a deployment concurrency lock. A transient SSH/public-tunnel interruption
during v0.22.22 recovered while the original deploy continued; its root cause remains
unknown. Reversible: easy (remove stamp to force a clean installation).

**D-87** · Business planning UI · *Use the same exact arithmetic on the page and in
the CLI, keeping estimates separate from the testnet ledger.* `/economics` exposes
the existing USD scenario model with editable assumptions, alternative service-fee
and retained-reserve contributions, monthly results and rounded break-even volume.
Unknown costs stay unknown; invalid edits suppress stale results. Inputs live only
in page memory with deliberate local JSON import/export, and a late import cannot
overwrite intervening edits. Initial fees are illustrative. The calculator neither
changes offers nor reads telemetry, signs, pays or establishes actual profitability.
Reversible: easy (new page and presentation over the existing pure model).

**D-86** · Browser Gateway funding · *Persist each explicit approval/deposit attempt
before asking the wallet, and recover uncertain attempts without replay.* Funding
uses the connected EOA on Arc testnet, exact USDC approval and `deposit(token,value)`
to its own Gateway balance, capped at 1 testnet USDC per plan. A separate IndexedDB
store has one active plan per payer across tabs. Each claimed step records the pending
nonce and observed block; confirmation requires matching sender, target, calldata,
value, nonce, transaction/receipt block and two confirmations. Only provider code 4001
reopens a rejected prompt. Missing responses remain locked for hash-based RPC recovery;
approval never automatically starts a deposit. Unknown credit stops funding, and mined
deposit evidence is distinct from Circle's available credit. Browser storage, RPC and
wallet providers remain trust dependencies; lost storage and replaced/cancelled wallet
transactions need further recovery work. Fresh paid wallet runtime and independent
buyer acceptance remain open. Shared wallet options now wait for hydration because
browser-only connector discovery differed from SSR and caused a reproduced React error.
Reversible: medium (browser additions; no server settlement or existing journal migration).

**D-85** · Browser buyer workspace · *Bind a visible purchase review to the connected
EOA, then keep recovery independent of that wallet.* `/research` now connects the
one-shot engine to the user's wallet rather than the playground worker. The adapter
reads `eth_accounts` and `eth_chainId` before/after Gateway lookup and before signing;
captured hook metadata is not live authority. Question, package, price and payee must
still match the accepted review. A private recovery download is offered before signing
and retained as an explicit action. Browser history/import/export/removal uses the
validated IndexedDB journal; only GET can follow saved or imported jobs. Completed
results require original-request receipt verification before a verified download is
offered. All payment/quality uncertainty remains visible. The existing manual job-ID
viewer reuses the same answer/economics presentation. Local history is not account
authentication or a permanent backup. Initial checkout requires a funded Gateway EOA;
browser deposits and a fresh end-to-end paid wallet pilot remain unfinished B1 work.
Reversible: medium (UI/adapter additions; no server settlement or journal migration).

**D-84** · Gateway balance uncertainty · *An unreadable balance is not zero and must
not suggest another deposit.* Before connecting the browser buyer engine, tracing its
funding dependency found that the session credit endpoint and creator panel converted
Circle errors into zero. The single-depositor reader now requires a matching USDC,
domain and depositor row with exact six-decimal units, bounded bytes and a deadline.
The credit endpoint returns non-cacheable HTTP 503 with `available: null` on unknown
funds, while an explicit matching zero remains a successful known balance. Browser
consumers check identity/network and keep lookup failure distinct from empty funds.
Signature recovery preserves the worker when balance lookup fails; creator earnings
show an unavailable state with retry. No deposit, grant cap or withdrawal is invented
from this observation. Reversible: medium (credit-response semantics and its callers).

**D-83** · Browser purchase durability · *Commit local recovery state before signing,
and a one-shot submission boundary before sending.* IndexedDB stores only validated
intents and allowlisted seller acknowledgements, never signatures. An exclusive insert
and verified read-back precede the wallet prompt; a strict read/write transaction grants
only one tab permission to submit an intent. Request success is insufficient: transaction
completion is required. Imported files are recovery-only, and local deletion does not
cancel a payment or server job. The browser orchestrator rechecks the exact reviewed
price, EOA, Arc-testnet chain and the EOA's Gateway balance; it recovers the returned
EIP-712 signer before committing the submission gate. Changed prices require review,
including lower prices. After that gate, response/storage failures remain uncertain;
acknowledgements survive HTTP 500 and recovery uses GET only. The transport pins origin,
rejects redirects/URL credentials and combines caller cancellation with its deadline.
This is the purchase engine, not yet a connected-wallet UI or a completed B1 journey.
Same-origin scripts and browser storage eviction remain explicit residual risks.
Reversible: medium (local journal version and purchase orchestration; no ledger migration).

**D-82** · Deployment cache · *Do not write a persistent compiler cache for a disposable
build directory.* The `a6fdd80` deploy spent 5.1 minutes writing Turbopack's cache after
compilation. `redeploy-vps.sh` recreates `.next.tmp` before each build, so that cache
cannot warm the next deployment. Disable build filesystem caching only when
`NEXT_DIST_DIR=.next.tmp`, following the installed Next.js build-environment guide.
Normal builds and development retain their cache defaults. This does not disable
runtime caching or relax typecheck/build/health gates. Reversible: easy (one build option).

**D-81** · Buyer runtime portability · *Share policy and result binding while keeping
runtime cryptography separate.* Browser checkout needs the same refusal rules and
recovery identity as the independent CLI. Shared modules now own request/challenge
schemas, typed data, the v2 order-ID preimage, immutable package definitions/fingerprint
serialization and result/request binding. Node keeps its synchronous public APIs and
filesystem journal; browser adapters use Web Crypto and contain no server configuration
or filesystem imports. Header decoding uses bounded UTF-8/base64 primitives in both
runtimes. Package checks resolve the journal's recorded version rather than assuming
the current package. Imported browser intents are validation/recovery inputs, not
permission to sign or resubmit. Existing IDs, package fingerprints and receipt bytes
remain compatible. This foundation introduces no checkout UI or payment submission.
Package lookup additionally refuses inherited object property names as unregistered
versions; a prototype property is not a published package contract.
Reversible: medium (shared API imports; no ledger or wire-format migration).

**D-80** · Browser receipt evidence · *Share canonicalization and envelope policy,
but hash in each runtime.* The research workspace now checks source-decision receipt
bytes with Web Crypto, the HTTPS digest header, displayed job/answer and answer hash.
The Node verifier retains its synchronous API and existing `keryx-json-v1` digest
format through the same pure core. A shared 2 MB streaming decoder bounds input before
parsing/hashing. Missing crypto, malformed data or mismatched receipts withhold only
the decision panel; they do not discard the answer or trigger payment. This verifies
integrity and displayed-result binding, not original buyer intent, research truth or
independent settlement. Full request verification still requires a buyer journal.
Reversible: easy (browser verification UI and runtime adapters).

**D-79** · Business readiness · *Keep business scenarios separate from measured testnet
economics and actual pricing.* The owner expanded the goal to a complete ecosystem,
revenue/profit model and mainnet readiness. The observer currently leaves most sampled
runs unpriced; its partial shadow margin is not monthly profit. A pure local calculator
uses explicit USD assumptions, exact micro-dollar arithmetic and null unknowns. It
shows service-fee-only contribution separately from fixed-package retained reserve,
counts creator spend once and rounds break-even volume upward. No quote, settlement
or network configuration changes. The new delivery acceptance map includes product
journeys, independent cohorts, full costs, security/operations evidence and external
Arc/Gateway availability; launch still needs explicit owner approval. Reversible:
easy (planning tool and acceptance documentation).

**D-78** · Buyer support · *Share an allowlisted diagnostic instead of a private job
response or journal.* `buyer report` reuses GET-only recovery and receipt verification,
then emits only bounded numeric fields and known status values. Its independent
schema strips job IDs, wallet/transfer identifiers, digests, paths, research text and
unstructured messages at every nested boundary. Missing measurements remain null and
uncertain payments remain unconfirmed. Job pricing and verified receipt totals stay
separate; micro-USDC comparison reports agreement or disagreement without rewriting
either. This is a local buyer assertion, not a portable receipt, independent settlement
proof or anonymity guarantee; economic/quality figures may still be sensitive. No
signer, purchase retry, new public endpoint or payment-authority change. Reversible:
easy (additional CLI projection).

**D-77** · Evidence selection · *Spend the context budget on missing target terms and
preserve nearby sentence boundaries.* An English receipt/SQL diagnostic omitted the
available digest-verification sentence. Tracking the best word-match ratio per target
treated repeated generic terms as coverage; fixed windows also cut recovery context.
Track the union of covered target terms instead, prefer sentence boundaries within
bounded overlapping windows, and charge merged source characters against the unchanged
2,000-character per-source budget. Retain a smaller opening for provenance/context.
The scan stays capped at 200,000 characters; long or unrecognized sentences fall back
to character windows. These are lexical heuristics, not proof of semantic relevance.
Assessment, re-evaluation, synthesis and attribution still receive verbatim source
slices through the same helper. No reward threshold, payout authority, model request
count or receipt schema changes. Two English rounds recovered receipt and recovery
answers while missing SQL, metrics and empty-corpus questions remained unsupported;
this does not establish general research quality. Reversible: easy (selection only).

**D-76** · Buyer-visible agency · *Read source decisions from the existing portable
receipt instead of adding another paid-job response contract.* Completed jobs in the
buyer workspace show recorded BUY/SKIP/CACHE choices, quoted access prices, rationales
and target links. The browser checks the display schema and matches job ID and answer;
this is not digest verification or proof of settlement. Receipt errors remain isolated
from the completed answer, retries are GET-only, and clearing/switching the job aborts
the request. No new database, payment or public receipt fields. Reversible: easy.

**D-75** · Planning scope · *Separate source/style constraints from information needs
inside the existing planning request.* The paid Engineering pilot produced a redundant
documentation-summary target and understated coverage. The planner first lists internal
`constraints`, then substantive `claims`; only claims become research targets. The original
user question still accompanies discovery, decisions, coverage and synthesis, so this
internal list does not replace or enforce user instructions. Explicit reliability and
source-comparison questions remain substantive. No post-hoc target deletion, raised
coverage score or payment gate change is introduced. Final repeated model diagnostics
observed no instruction-only target in 18 outputs, but one Vietnamese output merged
two requested topics and source qualifiers were not consistently repeated in targets.
Reversible: easy (prompt only, unchanged public/storage contracts).

**D-74** · Complete portable accounting · *Build portable receipts from all creator
payment attempts, not the legacy citation-only query.* A paid Engineering pilot reported
0.017 USDC creator spend while its receipt included only the 0.015 citation leg. The
receipt route used `listPaymentsByQuery`, whose documented meaning is citation payouts;
switch to the existing `listCreatorPaymentAttemptsByQuery` used for complete accounting.
The projection still excludes inbound funding and preserves settled/pending/failed
classification. No payment is resent, no database row is rewritten, and the buyer keeps
the old receipt snapshot when the corrected projection produces a new digest. Regression
tests cover both settled and pending access tolls. Reversible: easy (read-path fix only).

**D-73** · Question identity and negative answers · *Supply explicit target/index pairs
to synthesis, and score evidence for answering a question rather than agreeing with its
premise.* A broader live diagnostic found synthesis numbering answer sentences instead
of the two requested targets, and review assigning zero to explicit negative answers
about coverage/finality. Synthesis now receives named `researchTargets` with their
caller-owned indices; invalid indices still fail the existing ledger. Review explicitly
allows a source-backed negative answer or limitation. No index is silently remapped,
no score is raised after review, and no payment gate changes. Five boundary cases passed
after the prompt changes; repeated fixed-pair review still had one false negative, so
general reliability remains unproven. Reversible: easy (internal prompt contract only).

**D-72** · Review calibration · *Have the relevance reviewer state the supported fact
before scoring its relationship to the requested action, actor and timing.* Repeated
diagnostics isolated false negatives even when synthesis selected the correct journal
sentence. The reviewer now distinguishes equivalent wording and explicit mechanisms
from merely related topics, without demanding unasked implementation details. The
internal `supportedFact` is a model assessment, not a new quote, public receipt field or
independent authority. Existing support minimum, fail-closed parsing, quote checks and
payment allocation remain unchanged. This uses the existing review request and token
ceiling; the extra text may consume more output tokens, and truncation still withholds
support. A 15-pair repeated diagnostic found fewer false negatives without observed
false positives; this small model-only check does not prove general quality. Reversible:
easy (prompt/schema only; no payment or storage migration).

**D-71** · Coverage and relevance · *Assess the requested scope, then separately review
whether each selected quote supports its assigned target.* JSON coverage now uses an explicit
rubric and asks for supported answers and missing requested parts. Source links must resolve
to nonempty gathered content; malformed/missing scores remain zero. The sufficient flag is
derived from all validated targets meeting the existing 0.4 threshold, avoiding contradictory
model flags. JSON synthesis adds one bounded relevance-review request for up to 32 proposals.
It sees each question/quote pair, not the original support score, and can only lower support.
Missing, duplicate, malformed or out-of-bound reviews cannot authorize evidence. A review
transport failure preserves the draft with zero support and an explicit stream message;
there is no inner retry or new payment. Provider token usage includes this extra call under
the synthesis step; it adds up to one configured transport deadline and model cost. The same
provider can serve both passes: this is not independent factual verification. The original
quote ledger, assessment minimum, integer allocation and payout authority remain intact.
Why: calibration alone raised coverage while accepting a resume-after-failure quote for a
pre-submission journaling question. The review correctly rejected that link. Reversible:
medium (reasoning behavior/trace only; no persisted receipt schema or payment migration).

**D-70** · Evidence selection · *Let JSON synthesis select bounded verbatim quote options
instead of copying arbitrary quote text.* Options come only from the already-unlocked
passages supplied to synthesis: sentence segments, split at word boundaries when necessary,
8–240 characters each, at most 64 per source. Their combined text cannot exceed the selected
passage text; the additional prompt menu can repeat up to 2,000 characters per source.
The model selects an ID, source marker, research target and support score. Unknown IDs,
cross-source selections, raw quote text and malformed entries yield invalid proposals for
the existing ledger to reject. No overlong model proposal is silently shortened or assigned
new support. IDs are local to the model request; public receipts retain ordinary quote text.
The ledger still checks original-source occurrence, target/marker membership, support and
assessment availability. Neither an offered option nor exact text proves semantic relevance;
coverage remains model-assessed. Why: repeated prompt instructions did not prevent overlong
quotes from erasing otherwise relevant evidence. Reversible: easy (internal model contract;
no receipt schema, payment authority, content-access or storage migration).

**D-69** · Bounded reasoning · *Explicitly disable DeepSeek V4 thinking for JSON steps,
and retain relevant evidence that overlaps another selected window.* DeepSeek documents
thinking as enabled by default; the live corpus evaluation exhausted output allowances
before JSON completed. Only explicitly identified DeepSeek flash/pro requests receive
the vendor option; generic compatible endpoints and other providers do not. Token caps,
usage accounting and truncation-triggered failover remain intact. The passage selector
now permits overlap, discounts repeated context and merges adjacent/overlapping spans
as exact original substrings. Four selected windows still carry at most 2,000 raw source
characters. This fixes a reproduced omission of GET-only resume instructions between
selected windows. Short, directly relevant quotations are reinforced in the prompt;
semantic relevance remains model-assessed and overlong quotes still fail the ledger.
Why: the two observed failures had concrete transport/context causes; raising spend or
weakening evidence gates would not resolve them. Reversible: easy (no storage/payment change).
Vendor reference checked September 8: https://api-docs.deepseek.com/guides/thinking_mode/

**D-68** · Research corpus · *Publish dated first-party engineering notes with pinned code
references and complete RSS bodies before another paid pilot.* The seed abstracts do not
document Keryx sufficiently. The publisher kit supplies that missing material without
rewriting old seed receipts, impersonating independent publishers or assigning a payout
wallet. Public feed availability is separate from creator registration, feed verification,
publisher-signed manifests and payment. Live model evaluation remains partial and records
semantic/quotation failures alongside model scores. Why: useful source material and honest
quality evaluation must precede further paid-pilot claims. Reversible: easy (documentation
and feed build/check tooling; no runtime, storage or payment migration).

**D-67** · Evidence context · *Select bounded verbatim passages from already-unlocked
content instead of sending different opening-only slices to each model step.* Scan at most
200,000 JavaScript string characters per source; retain its opening and up to three
non-overlapping 500-character windows ranked by lexical question/target coverage. At most
2,000 source-text characters reach each model step, plus structured metadata. Sufficiency,
re-evaluation and synthesis share the selection for identical inputs; attribution uses the
question because its interface has no decomposed targets. Explicit offsets, original/scanned
lengths and delivery kind distinguish omitted content and abstracts. Quotes still validate
against the original unlocked text; no fetch, storage migration, payout authority or budget
change is introduced. Selection can miss paraphrases, clipped boundary spans, or evidence
past the scan limit; an omitted passage is not evidence of absence. A short abstract remains
short. Why: fixed 800/1,000/2,000-character prefixes hid late evidence and gave model stages
inconsistent source context. Reversible: easy (shared model-context helper).

**D-66** · Preview target contract · *Reject an actionable LLM decision that omits valid
research-target indexes before any source payment.* The second owner-operated buyer pilot
planned the intended Keryx topic, but every positive proposal lacked usable targets and the
preview gate correctly blocked it. The decision prompt now supplies indexed targets and
explains the required zero-based links. BUY/CACHE output with missing, empty or invalid
targets fails the reasoning step, using existing bounded retry/provider fallback and visible
attempt telemetry. Intentional SKIP remains valid. No target is inferred from rationale;
the preview gate, authoritative prices, budget/attention bounds and evidence-gated rewards
remain intact. Why: malformed positive proposals must not masquerade as deliberate no-spend
decisions. Reversible: easy (LLM output contract, no payment or storage migration).

**D-65** · Research quality · *Plan questions before evidence, and report an empty evidence
set as measured zero support.* The first owner-operated buyer pilot paid successfully but
decomposed an ambiguous citation-settlement question into invented patent-dispute assertions.
Planning now asks for research questions, preserves explicit user scope, and supplies Keryx's
product context for unqualified citation-payment questions. Malformed targets fall back to the
original question. This is prompt guidance, not a deterministic guarantee of interpretation.
Runs with no eligible/read sources retain zero coverage for each target, low confidence and
distinct pending/settled source-payment messages. The workspace distinguishes completed
execution from supported research. Historical missing measurements remain unknown; package
prices, non-refundable terms, authorization and payout gates are unchanged. Why: completion
and receipt integrity passed while useful research failed. Reversible: easy (no schema migration).

**D-64** · Independent buyer · *Journal a single authorization before submission; recovery
only reads the original deterministic order.* The caller provides its own already-funded EOA,
trusted treasury payee and all-in price ceiling. A separate CLI imports no server config,
funds no wallet and signs only pinned Arc-testnet USDC/Gateway batching requirements.
Each exclusive job directory stores request, economic tuple and nonce before signing;
submission is checkpointed before the bearer header leaves memory. Resume cannot sign,
POST or infer payment failure from missing orders or authorization expiry. This preserves
uncertainty even in a crash before actual submission and may require operator review.
The response proof is retained before reading delivery and labeled seller-relayed; receipt
hash/request binding is separate from independent financial verification. Payout authority,
treasury caps, paid package semantics and server reconciliation remain unchanged.
Why: the existing demo bootstraps itself from Keryx funds and cannot safely recover client
process loss. Reversible: easy (additive CLI/journal and workspace download/guide).

**D-63** · Buyer workspace · *Expose server-priced package preparation and existing paid-job
inspection as a read-only workspace before adding another signer.* `/research` reuses the
paid endpoint's quote function and accepted job responses. It never authorizes a payment,
starts a job, or turns unknown creator economics into zero. Job IDs retain the existing
bearer-access semantics and stay in component memory; no public directory or persistent
browser history is introduced. Polling uses a locally constructed same-origin endpoint,
stops on terminal/review states, and cannot resubmit a purchase. The current GET may repair
order metadata from an already-durable run under the existing D-61 evidence gate; the
workspace introduces no new recovery authority. Why: the paid API already has durable jobs
and service receipts, but buyers lack a cohesive way to inspect them. Separate client
payment/recovery and receipt verification need their own bounded implementation. Reversible:
easy (additive UI, no schema or settlement changes).

Autonomous architecture/product/UX decisions, with rationale. Newest first.
Format: **D-NN** · area · decision · why · reversibility.

**D-62** · A2A product contract · *Bind every newly paid order to an immutable, versioned
research-package snapshot and return measured service receipts, while keeping the initial service
level explicitly provisional.* Package `1.0.0` publishes two modes: Quick uses at most two
attention slots and no re-evaluation round with a 180-second target; Deep uses at most four slots
and one round with a 300-second target. Both measure claim grounding against evidence-ledger v1's
`0.4` threshold. The snapshot is stored on the private order and its canonical fingerprint is part
of the request hash/replay tuple, so an async worker cannot silently execute changed deployment
defaults after the buyer paid. A caller may pin `packageVersion`; an unsupported version fails
before any 402 settlement.

Queued work returns the accepted contract, elapsed time, deadline and breach state. Completed work
returns accepted/start/finish timing, queue/execution/end-to-end durations, target result, exact
grounded-claim counts/rate when the complete claim ledger is available, evidence/citation counts,
confidence, and the portable receipt URL. Failed work returns timing without fabricating quality
results or an SLO success. Historical orders keep a null package and never inherit v1 labels.
The service receipt remains application response data rather than being folded into x402's payment
proof: the emerging x402 offer/receipt extension is not yet a stable place for Keryx-specific
latency and evidence semantics.

`provisional_slo`, `best_effort`, and `remedy:none` are machine-readable parts of the contract: this
is not yet a contractual SLA or refund promise. Promotion requires four consecutive weeks of
genuine external paid cohorts, at least 30 terminal orders per package, published completion and
within-target rates, no unresolved review queue, and explicit support/legal/remedy ownership.
Creator `payTo`, registry/offer authority, x402/Circle settlement, prepaid caps, integer allocation,
and evidence-gated rewards do not change. Why: a repeat buyer must know what execution they bought
and be able to measure delivery, but two observed external Deep runs and zero Quick runs are not a
credible SLA basis. Reversible: medium (additive public contract/receipt and private JSON snapshot;
payment and payout authority are unchanged).

**D-61** · A2A operations/recovery · *Resolve ambiguous paid jobs with evidence-bound terminal
metadata transitions, never by rerunning research.* `payment_events` plus Circle reconciliation
remain the source of truth for creator settlement; the saved real-mode `QueryRun` is the source of
truth for a deliverable answer; `a2a_orders` is the authorization-keyed control plane. An operator
may inspect one exact `a2a_<sha256>` order without mutation, then perform only one of two
compare-and-set transitions from a started `running` order:

1. `repair_completed` reconstructs the response from that order's already-durable real-mode
   `QueryRun`. It does not call the agent or any payment gateway.
2. `close_failed` is available only after the 15-minute review threshold, only when no QueryRun
   exists, and only for a journal-v1 order whose durable payment-boundary field is still null and
   whose creator-attempt ledger is empty. Historical orders and every job that reached a creator
   gateway call remain under review even if currently recorded attempts look definitive: absence
   of a row cannot prove a process did not die between value movement and ledger persistence.

Every new A2A run awaits the order's `payment_started_at` compare-and-set immediately before each
creator gateway call. A null value is therefore negative evidence only when the same order carries
`execution_journal_version=1`; old rows are never backfilled into that guarantee. It also crosses a
`result_saving_at` checkpoint immediately before QueryRun persistence, so a stale close cannot race
a late no-payment answer into existence. Saved-run repair
also requires the QueryRun's integer settled+pending total to equal the durable ledger's
settled+pending+failed total, so a lost payment write cannot become an incomplete buyer receipt.

The same row atomically stores a bounded resolution record (action, fixed evidence-derived reason,
resolver class, timestamp, and integer micro-USDC evidence) with the terminal outcome. Mutating CLI
commands require the exact order id twice, expose no private question, wallet, transaction, or
worker identity, and provide no retry command. Public failure polling itemizes current settled and
pending creator economics plus the sanitized resolution record. Queue health exposes aggregate
counts and recent latency only; one `review_required` order or a queue older than two minutes marks
operations degraded without taking liveness down.

Settlement state transitions remain owned by the existing Circle reconciliation path; a review
cannot promote, fail, refund, or synthesize a payment. Late definitive Circle evidence therefore
continues to update the financial ledger independently of the terminal job record. Adversarial
gates cover terminal-CAS races, saved offline runs, missing-ledger totals, historical/no-boundary
rows, pending/simulated attempts, stale thresholds, cap overflow, private-data omission, and
aggregate queue/latency classification. Why: the prior
durable worker prevented duplicate spend but left a paid pilot order with no executable runbook or
error-budget signal. Reversible: medium (additive private audit data, a private CLI, aggregate
health fields, and additive public failure receipt fields; payment authority and the no-rerun
invariant do not change).

**D-60** · A2A product reliability · *Acknowledge long paid research with a durable opt-in async
job, but never lease-retry an order after creator spending may have begun.* Existing callers retain
`responseMode=wait`; production callers may send `responseMode=async` or `Prefer: respond-async`.
Only after Circle settles the exact package does Keryx store private normalized worker input and
return `202 Accepted` with a poll location plus the same `PAYMENT-RESPONSE` settlement proof.

For migration compatibility, the internal status remains `running`: a null `started_at` means
queued, while the private worker atomically stamps `started_at` and `worker_id` before calling the
agent. It recomputes the D-58 canonical request hash before any creator spend. Historical running
orders are backfilled as started and cannot enter the queue. A pre-claim crash is safe to claim;
an after-claim crash is never automatically requeued because a downstream Circle response may
have been lost after value moved. Polling surfaces that ambiguity as `review_required` after 15
minutes. Circle settlement, treasury signing, registry/offer `payTo`, creator caps, exact
micro-USDC allocation, and evidence-gated rewards remain unchanged. Why: an 80–150 second paid HTTP
request is not an operable external-agent product, while a generic retrying queue would weaken the
once-only spend invariant. Reversible: medium (additive private columns/worker and public async
contract; synchronous compatibility and every payment authority remain intact).

**D-59** · Settlement/Operations · *Acknowledge permanently ambiguous legacy treasury attempts
without rewriting financial truth or suppressing user-cap risk.* A private sync-state audit record
may stop stale/critical readiness escalation only when an operator names one exact payment id, a
fresh cursor-complete Circle search returns no matching transfer, the row is older than 24 hours,
the signed expiry is unavailable, no browser grant generation is attached, and the payer exactly
matches the address derived from the server's persistent spend key (with stored metadata parity).
The acknowledgement
is bound to the complete payer/payee/network/nonce/integer-amount tuple by SHA-256 and is idempotent;
a conflicting replay fails rather than replacing the first audit record.

The payment remains `pending`, stays outside settled earnings and traction, and is searched again
on every reconciliation pass. Exact Circle accepted/failed evidence still wins immediately;
conflicting evidence always degrades health. Browser reservations and rows with exact signed expiry
cannot use this lane. Public health reports `acknowledged` plus separate acknowledged/unacknowledged
counts instead of calling an investigated, non-cap-holding legacy treasury ambiguity a permanent
readiness failure. Why: the first pre-expiry-telemetry treasury timeout has no retained bearer
signature or terminal Circle receipt and therefore can never honestly be backfilled as failed, but
leaving the same reviewed incident as a forever-critical readiness alarm creates alert fatigue.
Reversible: easy (remove or ignore the private acknowledgement; the underlying payment row was
never changed).

**D-58** · A2A economics/idempotency · *Sell testnet research as a dynamically quoted fixed-price
package and bind one downstream run to one settled inbound authorization.* POST validates the body
before constructing its x402 requirements. Price is exact integer micro-USDC: the Quick/Deep
orchestration fee plus the caller-selected creator-spend cap, clamped to the server ceiling. Keryx's
treasury remains the downstream signer, but the confirmed inbound amount covers its worst-case
creator liability before research begins. The package is explicitly non-refundable; receipts split
service fee, actual creator spend, and unused reserve rather than presenting reserve as payout.

An authorization-scoped order id hashes network, payer, treasury payee, and EIP-3009 nonce (falling
back to Circle's settled transaction id only when the facilitator omits the nonce). The inbound
ledger id and query id derive from that order. A private durable order row atomically claims the
authorization; replays return completed/processing/failed state and never call the orchestrator
again. Completed QueryRun persistence can repair the narrow order-completion crash window, but an
order that failed before a QueryRun exists is never automatically retried because downstream legs
may already have settled. Why: the old fixed $0.02 inbound toll could authorize up to $0.50 of
treasury creator spend, and replayed successful authorizations had no durable once-only run claim.
Reversible: medium (public A2A pricing contract and additive private order table; creator payment,
registry authority, Gateway signing, and browser sessions are unchanged).

**D-57** · Testnet economics · *Observe unit economics without changing payment authority or
presenting projections as revenue.* Every new dispatch records trusted server-side funding
provenance (`browser`, `treasury`, or explicit `offline`) plus provider-reported token counters;
prompts and completions are never retained. The economics observer joins those sampled runs to the
existing payment ledger. Only rows with exact settled evidence count as inbound revenue or creator
spend, pending payments remain pending, and historical funding is `unknown` rather than inferred.

DeepSeek cost estimates use a dated, versioned table from the vendor's canonical pricing page.
Unknown providers/models make a run unpriced instead of silently costing zero. A separate shadow
policy models $0.02 Quick / $0.05 Deep orchestration fees and a $0.005 infrastructure allowance;
it excludes creator pass-through and is displayed as “simulation · not revenue.” Why: testnet needs
evidence for a viable mainnet price before adding a fee, while Keryx must not corrupt the creator's
100% payout rail or confuse treasury-subsidized volume with customer economics. Reversible: easy
(additive run metadata, read-only API/status surface, no settlement/schema/contract change).

**D-56** · Agent quality/evaluation · *Gate reasoning changes with a hermetic frozen-corpus
evaluation harness; keep payment safety deterministic and separate from semantic scoring.* Every
case runs the production orchestrator against an isolated in-memory SQLite database and the
explicit offline gateway. A second fail-closed grader rejects settled or pending payments, real
transaction evidence, budget overruns, forbidden reads, unexpected citations, and insufficient
evidence coverage before a weighted quality score is considered. The reviewed baseline is bound to
the complete corpus by SHA-256, and CI rejects both material per-case regressions and unreviewed
corpus changes. Provider-backed model comparisons are opt-in and never inherit the default
heuristic baseline. Why: unit tests protect economic invariants, but prompt/model/selection changes
could still degrade evidence yield or citation decisions without breaking types or safety tests.
Reversible: easy (tooling and CI gate only; no runtime, registry, key, pricing, or settlement
authority changes).

---

**D-55** · Settlement/Operations · *Persist the signed authorization expiry exactly, but never use
expiry as settlement or failure evidence.* Both browser and treasury x402 buyers now normalize the
`validBefore` carried by the signed EIP-3009 payload into `payment_events.authorization_expires_at`
before submission. Historical rows stay NULL because deriving a deadline from `created_at` would
fabricate evidence. Reconciliation reports exact expired/unknown-expiry counts and separates
browser-funded rows, whose grant reservations remain held, from treasury rows, which consume no
browser capacity.

Crossing `validBefore` does not terminalize a row or release a reservation: Circle may have accepted
the authorization before expiry even when Keryx lost the response. Only the existing exact Circle
transfer tuple can prove accepted or failed state. Why: the first long-lived production ambiguity
made the authorization window and the funding owner operationally important, while a generic
“reservation remains held” alert incorrectly described a treasury attempt. Reversible: easy
(additive nullable metadata and presentation; settlement authority is unchanged).

**D-54** · Settlement/Reconciliation · *Search Circle's documented transfer index completely;
query filters may narrow candidates but never prove a nonce or settlement state.* Circle's x402
transfer-search API filters by payer, payee, network, token, date and cursors, but not by EIP-3009
nonce. Keryx previously sent an undocumented `nonce` parameter and read only ten rows. If Circle
ignored that parameter, later payments between the same wallets could push the ambiguous transfer
off page one and leave a valid settlement permanently pending.

Reconciliation now starts one day before the locally recorded submission, leaves the end open so
a bearer authorization submitted later is still discoverable, requests 50 rows, and follows every
Circle `pageAfter` cursor up to a fail-closed bound. Next links must remain on the configured Circle
transfer endpoint. Only after retrieval does Keryx require exactly one matching nonce, payer,
payee, Arc network on both sides, USDC token and integer micro-USDC amount. A malformed response,
untrusted cursor, or exhausted scan bound changes no ledger state; an empty complete scan remains
pending rather than becoming failed. Why: production's first long-lived ambiguous receipt exposed
that the lookup assumed an API filter the installed Circle SDK and current documentation do not
offer. Reversible: easy (transport-only search policy; no schema, key, grant, price, or payout
authority change).

**D-53** · Reasoning/Spend selection · *Choose an evidence portfolio under separate money and
attention budgets; preview predictions still cannot authorize evidence or payment.* After the
reasoning engine proposes BUY/CACHE/SKIP with normalized claim targets, the existing preview gates
first downgrade untargeted, below-floor, and unusable-cache proposals. A deterministic selector may
then choose only a subset of the remaining BUY/CACHE proposals. It cannot promote SKIP, add a
candidate, change the registry/offer price, select `payTo`, increase the dispatch/fetch cap, or
authorize a citation reward.

The selector maximizes predicted claim coverage with diminishing returns, so corroboration can add
value without letting four redundant sources automatically occupy every context slot. BUY consumes
its authoritative micro-USDC price plus one attention slot; CACHE consumes zero fetch USDC plus one
attention slot, regardless of its public list price. A small explicit attention cost leaves a slot
unused when another read adds too little predicted coverage. Quick remains capped at two sources and
Deep at four. The selected set is input-order invariant, bounded to a deterministic candidate window
for future large catalogs, and read in marginal-coverage order; CACHE wins only a true ordering tie
so sufficient free evidence can stop a later signature.

The pre-spend plan and its per-claim predictions are visible in the SSE trace, archived run, UI and
portable receipt. After synthesis, a separate outcome records which selected reads produced
reward-qualified evidence. Preview coverage remains a forecast; final confidence, citations and
creator rewards still come exclusively from exact paid/cached body quotes under D-23, and actual
money remains Circle-evidenced under D-37/D-43/D-44. Why: value-per-list-price ranking treated a
cached article as if it still cost its listed toll and could crowd an exact, higher-value source out
of the scarce attention budget; production quality was limited by evidence coverage rather than
settlement reliability. Reversible: easy (restore the former subset policy; no key, grant, payment,
registry, cache, or database migration changes).

**D-52** · Product/Provenance · *A portable research receipt binds one exported snapshot, but its
digest is integrity evidence rather than identity or settlement authority.* `GET
/api/dispatch/[id]/receipt` deterministically projects an archived dispatch into visible
BUY/SKIP/CACHE decisions, the exact answer and its separate SHA-256, claim-indexed public evidence,
cited article versions/content receipts, and sanitized creator-payment rows. Recursive sorted-key
canonicalization hashes the entire payload. A local verifier catches changes that do not also
replace the integrity block; `--expect` compares against a digest retained separately, and an HTTPS
verification also compares the response header. The self-hash is explicitly not a Keryx or
publisher signature and cannot prove who served the original bytes after export.

Payment truth remains the durable ledger state from D-37/D-43/D-44. Only rows classified settled
from Circle evidence enter settled totals; pending, terminal failed and offline simulation amounts
remain separate. New runs' finish-time settled+pending count is compared with the durable rows, and
a mismatch is labeled `incomplete` instead of trusting `QueryRun.totalToCreators`. The public bundle
omits payer addresses, authorization nonces and internal row ids, calls no Gateway/decryption/registry
write path, and carries Circle transfer ids as settlement references rather than Arc transaction
hashes. Exact reconciliation may legitimately change the settlement snapshot and therefore its
digest, while the archived answer hash stays stable. Why: Keryx had all the parts of a research
receipt but no single artifact another agent could download, archive and integrity-check without
scraping UI or trusting aggregate money fields. Reversible: easy (remove the read-only projection,
export affordance and verifier; no economic or archived state changes).

**D-51** · Product/Provenance · *An archived answer is immutable; freshness is a metadata audit,
and only a new paid dispatch may judge replacement evidence.* Each versioned citation already
records the exact SHA-256 or encrypted IPFS CID bought for that answer. Keryx now compares that
receipt with the same article id in its current index and reports `current`, `superseded`, or
`unavailable`. A superseded version means only that the asset changed. It cannot lower confidence,
erase a quote, reverse a payout, or assert that the answer became incorrect; an unavailable current
asset and any failed source/publication lookup remain unknown rather than being treated as unchanged.
The public freshness API exposes the same metadata and its limits without decrypting or buying content.

When a reader explicitly re-asks the same normalized question, the new permalink compares the two
immutable receipts: cited sources, exact versions, matched-claim coverage, confidence, evidence-span
counts and Circle-settled creator payouts. Missing payment rows make the monetary delta unknown,
and simulations remain zero settled money. A different follow-up question never receives this delta.
The re-ask itself remains a normal dispatch with the same Quick/Deep attention policy, hard budget,
browser custody, registry payout authority, evidence gate, and Circle-only settlement truth. Why:
the archive can now show both content drift and what a paid reread actually changed without silently
refreshing conclusions or spending on a reader's behalf. Reversible: easy (remove the audit/delta
projections; no economic or archived state is rewritten).

**D-50** · Product/Attention/Telemetry · *Research depth may bound attention and latency, while
free previews may only remove spend authority; activation telemetry is aggregate operational
state, never identity.* Web dispatches default to Quick: at most two claim-targeted paid or cached
reads, no off-Arc marketplace probe, and no gap-expansion round. Deep preserves the existing
four-source attention ceiling, external discovery, and bounded re-evaluation. Both modes retain the
same hard USDC budget, browser signer custody, atomic grant reservation, registry payout authority,
evidence gate, integer citation allocation, and Circle-only settlement truth.

Before the first paid fetch, Keryx maps engine-proposed source targets from free previews onto the
decomposed claims. Invalid claim indexes are discarded; an untargeted or below-floor BUY/CACHE is
deterministically changed to SKIP. The pre-check can warn, narrow, or stop a spend plan, but cannot
add a source, increase a price/budget, select `payTo`, or authorize a reward. Final confidence and
creator rewards still come only from paid/cached body evidence under D-23, never from preview
coverage.

The activation funnel stores one row per `(UTC day, allowlisted event)` with an integer count. It
stores no actor, wallet, IP, cookie, fingerprint, user agent, referrer, question, source, or payment
identifier; its public dashboard calls these event totals, not unique users. Wallet-based returning
asks are classified from the existing SIWE-attributed dispatch ledger and only the aggregate event
is incremented. Why: current latency, grounding, and adoption data need a faster default plus a
measurable path from landing to answer and creator cash-out without weakening payment authority or
introducing surveillance. Reversible: easy (switch the web default, remove the downward-only gate,
or stop incrementing aggregate counters; economic state is unchanged).

**D-49** · Security/Operations · *Authentication secrets, payment authority, compute allowance,
and settlement evidence are separate state machines.* A raw API bearer value is verified before
the durable limiter sees it; valid callers are keyed by non-secret database id and legacy secret
buckets are purged. Supabase keeps browser roles read-only only for explicitly public metadata,
while private tables and every economic RPC are service-role-only under RLS. Browser sessions still
derive payment authority exclusively from the SIWE owner, the browser-held signer, the persisted
atomic grant, and Circle evidence; separately, their server compute is wallet-rate-limited and each
dispatch is bounded by the remaining grant plus a lower per-run ceiling. Grant create/recovery now
fails closed when independent balance evidence is unavailable.

An old pending authorization degrades public/operational health after one hour and becomes critical
after 24 hours, but age alone never settles, fails, or releases it. Only the exact Circle tuple under
D-43/D-44 changes financial state. Deploys now run an explicit TypeScript gate before the low-
downtime build, and the web origin ships a CSP/security-header baseline without forcing every public
archive page into dynamic nonce rendering. Why: a secret identifier, a compute quota, a spend cap,
and a settlement receipt contain different authority; using one as another created data exposure or
unbounded operational work even when the financial cap itself remained sound. Reversible: medium
(limits/headers are tunable; database privilege and secret-storage fixes should not be reversed).

**D-48** · Settlement evidence · *An unavailable verification leg is `unknown`, never a zero
balance or a settlement finding.* The Circle parity sweep first identifies Gateway shortfalls,
then reads those creators' Arc USDC balances because they may have cashed out through another
client. `undefined` remains the internal first-pass marker that selects those wallets for a chain
read; after the read is attempted, `null` means the RPC did not answer and the public verdict is
`unknown`. Only a numeric Arc balance that still leaves a gap can produce `short` and an alert.
Why: otherwise an expired or unavailable RPC credential turns missing evidence into a false claim
that a creator payout never settled, contradicting the settled-only reporting invariant. This
changes watchdog classification only; ledger rows, settlement state, payout authority and funds
are untouched. Reversible: easy (pure reconciliation semantics plus presentation copy).

**D-47** · Public proof/Provenance · *No aggregate is self-proving; publish each claim beside the
authority that can actually verify it and the limit of that authority.* `/proof` composes five
existing, independent evidence layers without creating a new payment or identity source of truth:
the runtime commit binds the deployed build to GitHub and CI; Arc RPC plus SourceRegistry establish
creator, payout, price and split authority; the Circle balance API checks whether creator wallets
still hold what Keryx's settled ledger says they earned; ArcScan withdrawal hashes prove earnings
can leave Gateway on-chain; and the origin ledger separates independently initiated demand from
Keryx's own agents. Anonymous queries remain queries, never inferred unique people, while all money
figures remain settled-only under D-20/D-28/D-42.

The registry watchdog now retains the Arc head block it observed so a public reader can compare the
RPC head with the index checkpoint. `/api/health` publishes only a coarse RPC provider label; it
never returns the configured URL because Canteen endpoints contain server credentials. The page
states what each layer cannot prove—especially that a Circle transfer id is not an Arc transaction
hash and that real first-party volume is not external adoption. Payment authority, browser custody,
spend caps, reconciliation, delivery and settlement state transitions are unchanged. Why: the
proofs existed across `/status`, `/dashboard`, ArcScan and GitHub, but an outside evaluator could not
map a headline claim to its verifying system without already understanding Keryx's architecture.
Reversible: easy (remove the composed page and additive health fields; underlying watchdogs and
ledgers are unchanged).

**D-46** · Content authenticity/Confidentiality · *A paid-body receipt proves what is stored, while
SourceRegistry remains the only payout authority.* RSS ingest now labels bodies conservatively as
`full_text`, `excerpt`, `abstract`, or `metadata_only`; it never calls an ordinary snippet full
text. A registry creator may replace one indexed article with a full body and sign EIP-712 over
`sourceId + itemId + canonicalUrl + SHA-256 bodyHash + plaintextBytes + deliveryKind + nonce`.
The owner API refreshes registry authority, verifies the signature against the exact bytes, then
encrypts the body before committing its envelope/manifest. Pinata availability chooses public IPFS
ciphertext or a private encrypted-DB fallback; it never chooses plaintext. The public receipt carries
only delivery/storage kind, byte count, hash, and manifest identity. It cannot set price, `payTo`,
active state, or author splits.

Every registration and refresh path now crosses one content-storage boundary. Production and
treasury-funded processes fail closed when the content key is absent; a Pinata outage retains
ciphertext in the DB, while explicit offline development remains labeled plaintext. Decrypted
caches are envelope-encrypted in SQLite/Supabase,
legacy cache rows are sealed at initialization, and direct public reads of `source_items` and
`cache_items` are removed. Key wrapping now uses a fresh AES-GCM nonce per envelope while retaining
read compatibility with legacy zero-nonce rows. Why: the old RSS path sold `contentSnippet` as full
text, refresh/registry paths bypassed encryption, public DB policies exposed paid storage, cached
plaintext survived settlement, and repeated GCM nonces under one master key were cryptographically
unsafe. Reversible: medium (manifest/receipt columns are additive; ciphertext migration is
one-way unless decrypted with the retained server key).

**D-45** · Reasoning/Attention · *Free cache reuse still spends an explicit attention budget.* The
orchestrator admits at most four paid-or-cached sources into one synthesis context by default,
ranked by expected value per dollar. A `CACHE` proposal must name at least one decomposed claim and
clear a configurable expected-value floor; re-evaluation cannot expand past the same cap. Every
rejection is surfaced as a normal SKIP rationale, independent of the USDC fetch budget. Why: zero
toll does not make text free to read—irrelevant cached bodies consume model context, increase
latency, and dilute evidence even though they do not move money. Reversible: easy (two environment
thresholds; no payment or persistence authority changes).

**D-44** · Settlement/Capacity · *A Circle-terminal failed transfer closes the pending receipt,
but may release browser capacity only into the exact grant generation that reserved it.* Each
create/recover operation assigns a fresh opaque `grantEpoch`; a browser pending payment retains
that epoch beside its non-secret authorization nonce. Reconciliation first requires the same exact
Circle economic tuple as D-43, then atomically changes `pending` to `failed`. It subtracts the
reserved micro-USDC only when the current grant still has the recorded epoch and session EOA.
Legacy rows and failures from an earlier recovered grant close without changing the current cap.
Failed receipts remain visible but count as neither spend, creator earnings, settlement success,
notifications, fulfillment, nor traction.

Why: Circle's terminal `failed` state is definitive evidence that this authorization did not settle,
so retaining its reservation forever is unnecessary; applying that refund to a newly recovered
grant could instead grant extra capacity after the user has already rebased and spent. Reversible:
medium (the failed ledger state is additive; disabling release safely returns to conservative cap
retention).

**D-43** · Settlement/Recovery · *An ambiguous signed submission may become settled only from
Circle's nonce-indexed transfer ledger and one exact economic tuple.* A post-submit timeout keeps
its existing durable pending row and never stores the bearer signature. The reconciliation worker
searches Circle by EIP-3009 nonce, then independently binds the result to the recorded payer,
payee, Arc network as both sending and recipient network, USDC, and integer micro-USDC amount.
`received`, `batched`, `confirmed`, and `completed` all prove the same Gateway acceptance that a
successful settle response would have returned; the Circle transfer id becomes the receipt.
Missing, duplicate, malformed, or mismatched results stay pending and outside traction, earnings,
notifications, and wanted-claim fulfillment. An exact terminal failure follows D-44. Promotion is a compare-and-set on payment
id, nonce, and pending state, so concurrent watchdogs are idempotent and cannot replace a receipt.

Why: retaining uncertainty prevented double-spend but could permanently under-report a real debit
when only the HTTP response was lost. Aggregate Gateway balances cannot identify which concurrent
authorization settled; Circle's transfer search now exposes the nonce and full tuple needed to do
so without retaining replayable payment material. Reversible: low (disable the scheduled worker;
pending rows remain conservatively pending and the original payment path is unchanged).

**D-42** · Dashboard/Positioning · *Lead with the combined settled citation economy; preserve
demand provenance as a compact breakdown instead of fragmenting the headline.* The ledger's first
screen now presents total queries, settled payments, settled USDC volume, and creator payouts as one
economic system. Independent and Keryx-initiated activity remain explicitly separated immediately
below, and independent conversion, retention, satisfaction, settlement reliability, and grounding
remain their own trust layer. Empty-sample KPIs are hidden rather than promoted as `0 / 0` or
`Collecting`; latency and unit economics move to operational detail.

Why: the previous independent-first layout repeated the same usage numbers while burying the
strongest verified settlement totals below the fold. Combining display hierarchy makes the real
economy legible without relabeling first-party settlement as independent demand or changing any
origin bucket, denominator, or settled-only rule from D-20/D-28. Reversible: easy (presentation-only;
the metrics API and provenance model are unchanged).

**D-41** · Demand market/Agency · *A creator may answer a measured wanted claim with one exact
article version; the response guarantees candidacy, never purchase or payout.* Existing registry
creators can submit an already-indexed article from the wanted brief instead of relisting its feed.
Admission recomputes the live gap from completed dispatch receipts, matches only the article's free
title/preview, refreshes SourceRegistry creator/active/list-price authority, and snapshots
`sourceId + itemId + contentVersion + current articleOfferId?`. One semantic gap plus registry
creator admits at most one bounded treasury retry, with the existing per-wallet daily valve.

The worker atomically leases the intent, then refreshes the same registry creator, article version,
and signed discount before spending. A transient registry failure retries within the lease bound;
a changed creator, article, offer, or already-filled gap closes the coordination row without spend.
The exact article is placed first in the reasoning candidates so prompt limits cannot hide it, but
the agent still emits BUY/SKIP/CACHE under its normal hard budget. Fulfillment remains evidence plus
real settlement: the offered article's claim-indexed quote must qualify and its citation reward must
carry Circle evidence. Legacy source-only intents retain their historical generic retry.

Why: `/wanted` exposed demand and `/market` exposed exact supply, but registration was the only
bridge and the retry did not actually carry the offered article. This closes the market loop without
letting creator coordination become recommendation, spend, or payout authority. Reversible: medium
(nullable intent fields and additive route/UI; old retries and the article market remain usable).

**D-40** · Article market/Authority · *Publishers may sign temporary article discounts; the
SourceRegistry creator, list-price ceiling, active flag, and payout wallet remain authoritative.*
An offer is EIP-712 over `sourceId + itemId + contentVersion + priceUsdc6 + expiresAt + nonce` on
Arc testnet. Only the live registry `creator` may publish or revoke an on-chain source's current
offer revision; pricing fails closed when that authority cannot be freshly read. The offer price is
integer micro-USDC, at least the x402 minimum, never above the live registry price, and expires
within 30 days. Replacing or revoking the one current revision makes an earlier `offerId` return
409 before a paid challenge. A content change does the same through the existing version binding.

The server verifies the signature during owner admission, marketplace discovery, agent selection,
and again before 402. Browser co-signers independently refresh SourceRegistry, verify the creator
signature, price ceiling, exact article identity, expiry, challenge amount, and payee before
creating a bearer authorization. Treasury buyers verify challenge amount/payee and paid response
pricing. Fetch receipts persist offer id, effective amount, and list price. Pre-registry sources
retain the documented public-index wallet/price residual; their wallet signs offers directly.
Why: article identity created a stable object, but a source-level price still prevented a publisher
from pricing a flagship investigation differently from a routine post. A public signed offer book
makes price competition inspectable without introducing custody, escrow, buyer order matching, or
article metadata as payout authority. Reversible: medium (drop the additive offer table/routes and
all articles immediately fall back to their registry list price).

**D-39** · Content economics/Evidence · *The exact article version is the unit Keryx discovers,
buys, caches, cites, and rewards; SourceRegistry remains the authority for list-price ceiling and payee.*
For each verified publication, discovery chooses one relevant `source_items` row from free title and
preview metadata. The reasoning candidate carries a separate `item:<id>` asset identity while its
registry `sourceId` remains attached for source-owned `fetchPrice`, `walletAddress`, and author
splits. Paid reads use `/api/source/[id]/item/[itemId]?version=<contentVersion>`; the route rejects a
changed or missing version before issuing a 402 challenge, settles to the source owner, then serves
only that article. Plaintext rows use a SHA-256 content version and encrypted rows use their
content-addressed IPFS CID. Cache keys include source, item, and version, so an old whole-feed cache
or another revision can never silently satisfy the purchase. Fetch and citation receipts,
evidence, public footnotes, activity, and creator notifications carry the same article identity.

The first slice intentionally permits at most one article candidate per publication in one run, so
existing source-level attribution and payout splitting remain unambiguous. Publications with no
item rows keep the historical source-bundle path, and old nullable receipts remain readable. Item
metadata is never payout authority. Post-settlement delivery failure still follows D-38: retain the
settled receipt, exclude unavailable text from evidence, and continue the answer from other reads.
Why: buying an entire feed made the paid object, cited evidence, cache, and creator work disagree;
an article-level receipt makes the market leg inspectable and gives future bidding/reputation a
stable object to price. Reversible: medium (additive route/metadata and legacy fallback; removing it
would collapse new article receipts back into ambiguous source bundles).

**D-38** · Settlement/Delivery · *A confirmed Circle receipt remains settled even when the paid
resource fails after settlement; delivery success never rewrites payment truth.*
`settleThenServe` now builds the `PAYMENT-RESPONSE` immediately after a successful facilitator
settlement and attaches it to both the normal response and any later producer 5xx. Browser co-sign
and server-funded buyers evaluate that receipt before the HTTP status: a valid
payer/network/transaction proof creates a typed settled-delivery error, while a non-success
response without valid proof remains pending. The server-funded path still uses Circle's official
`BatchEvmScheme` to create the authorization; Keryx owns only the response classification because
the SDK's high-level `pay()` discards headers on non-2xx. The agent persists the settled leg, counts
it in spend and creator earnings, keeps
the session/query reservation consumed, and continues without unavailable source content. A
settled citation acknowledgement failure still qualifies the paid creator notification because
the reward itself landed; a fetch delivery failure never enters the evidence set.

Why: source DB, IPFS, decryption, or answer-production work happens after the irreversible payment
boundary. Treating its failure as ambiguous discarded definitive evidence Keryx already held and
could permanently under-report a real creator payment. Treating the failed body as usable content
would instead corrupt grounding. Payment and delivery therefore need explicit, independent state
transitions. Reversible: low (typed error and response-header preservation; no rail/schema change).

**D-37** · Browser co-sign/Settlement · *After a signed authorization crosses the submission
boundary, uncertainty is `pending`, never `failed`, `simulated`, or settled traction.*
The server now binds every 402 challenge to the orchestrator-authorised network, USDC asset,
integer micro-USDC amount, source/author `payTo`, Gateway contract, signing domain, and lifetime.
It then decodes the browser response before submission and requires its signer, payee, value,
nonce, signature shape, and validity window to match that challenge. A mismatch is pre-submission:
the atomic session reservation is released. Once the validated header is sent to the paid route,
any timeout, non-success HTTP response, or 2xx response without a valid Circle settlement reference
creates a durable `payment_events` row with `settlement_status=pending` and the public EIP-3009
nonce, but never the signature. The reservation remains consumed because the facilitator may have
settled before its response was lost. Re-evaluation also treats that reserved amount as spent for
the per-query cap, preventing an ambiguous first attempt plus a replacement from exceeding budget.

Pending amounts appear in the trace, receipt, creator ledger, live payments feed, dashboard warning,
and health telemetry, while remaining outside `settled=true`, spent totals, creator earnings,
notifications, fulfillment, parity claims, and traction. Post-payment cache/ledger write failures
are isolated from the payment call: the dispatch retains the receipt and content instead of
relabelling a completed settlement as a failed purchase. Exact per-nonce reconciliation remains a
separate operation because Circle's public balance endpoint is aggregate; refreshing a session
re-bases its cap from the live balance but does not invent a settlement verdict for the old row.
Why: transport failure after a bearer authorization exists is not evidence that no money moved,
and a missing response is equally not evidence that money settled. Reversible: medium (additive
ledger state and conservative accounting; removing it would reintroduce false payment claims).

**D-36** · Reasoning/Latency · *Provider-step circuit health is durable across workers; an
expired cooldown leases one half-open probe and a failed probe backs off exponentially.*
The Next server and the autonomous volume daemon are separate processes, and each normal volume
tick launches a fresh `seed --count 1` worker. Circuit state therefore lives in the shared database
under `(engine, reasoning step)`, not only in a module `Map`. A closed circuit admits calls. Once
open, it routes immediately to the next configured provider. When the cooldown expires, one worker
atomically leases the probe while concurrent callers keep using the alternate; a crashed probe is
recoverable when its lease expires. A successful real response deletes the streak. Another failed
probe retains it and doubles the cooldown from 30 minutes up to four hours. When a real alternate
exists, one exhausted call is enough to open; a last-provider-to-heuristic transition retains the
configurable two-failure threshold. Database failure degrades to the mirrored in-process circuit,
never turns a successful model response into a failure, and never changes spend or payout state.

Why: production receipts after D-31 still showed zero circuit skips while the same DeepSeek
`decide` and `synthesize` steps repeatedly spent 40–60 seconds on 503s/timeouts before MiMo served
them. The implementation was locally correct but lifecycle-wrong: the worker that learned the
failure exited, and even a long-lived process forgot the streak when the sixty-second cooldown
expired. The result was completed, fully settled answers taking 100–280 seconds despite a healthy
alternate. Durable state and retained half-open history make the resilience mechanism match the
actual deployment topology. Reversible: medium (drop `reasoning_circuits` and inject the memory
store; provider order, receipts, payment authority, budgets, and evidence gates are unchanged).

**D-35** · Public updates/Canteen · *Publish selectively: useful public product progress and
verified real traction belong on Canteen; private operations and security details do not.*
Canteen is an external product channel, not an automatic mirror of commits, deploys, logs, or
internal experiments. A product update must be understandable and useful to an outside reader. A
traction update must use verified, genuinely settled figures and enough public context to interpret
them. Do not publish local caller identities or addresses, daemon cadence or schedules, machine and
PM2 topology, configuration or environment details, credentials, raw operational logs, internal
failure traces, or security-sensitive/anti-abuse implementation details. If an update mixes public
progress with private details, publish only the safe public summary; if no meaningful safe summary
remains, skip the Canteen update.

Why: consistent public progress helps distribution, while indiscriminate operational disclosure
creates privacy and security risk and turns the product feed into noise. Reversible: easy (revise
the editorial boundary), but already-published sensitive data may not be retractable.

**D-34** · Traction provenance/Local caller · *One workstation daemon is one persistent actor;
it may add requests, but it never rotates wallets to manufacture people.*
The owner's workstation may run a low-frequency SIWE-authenticated client against the sponsored
web endpoint. It creates one ignored local wallet, reuses it permanently, asks a title-anchored
question from a current free source preview, and runs once every eight to twelve hours with a
$0.03 budget. Scheduling is persisted before network work, so a crash/restart sleeps rather than
looping treasury spend. It never sends the Keryx bot key and therefore lands as `origin=web` with a
server-verified `asker`. It also never signs unattended x402 charges: creator settlement comes from
the existing bounded sponsored-web path.

Why: a user-directed agent on another machine is real external demand, but wallet rotation whose
only purpose is raising the actors tile is Sybil traffic. This policy can add exactly one identified
actor and, after its second completed run, one returning actor. Later ticks increase that actor's
usage, not the actor count. Current-preview questions make the small spend useful to creators rather
than turning the daemon into a gap generator. Reversible: easy (stop/delete the local PM2 process;
the public identity and schedule remain in ignored local state for audit continuity, while its
signing key remains only in the ignored `.env.local`).

**D-33** · Feed refresh/SSRF · *Pinned DNS answers support both single-result and `all: true`
Node lookup callbacks; never fall back to an unpinned fetch for compatibility.*
The outbound public-URL guard resolves and validates every address, then gives Undici a custom
lookup function that can return only one already-approved IP. That function now responds with
`[{ address, family }]` when Node requests `all: true`, and retains `(address, family)` for the
single-result form. Feed refresh also includes the immediate transport cause below Undici's generic
`fetch failed` wrapper so future network failures remain diagnosable without a reproduction shell.

Why: production moved to Node 24, whose connection family autoselection invokes custom DNS lookup
with `all: true`. The old Node 20-shaped callback returned a string and family; Node 24 interpreted
that as a missing array entry and rejected all twelve external feeds with
`ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`. Using native DNS as a fallback would make
feeds work but reopen the DNS-rebinding gap the pinned dispatcher closes. Supporting both callback
contracts restores refresh while preserving the same vetted address as socket authority.
Reversible: low (only if the minimum Node runtime and Undici contract change together).

**D-32** · First-party quality/Metrics · *Normal autonomous questions are seeded from one current
free preview; broad exploration is explicit, bounded, and still labeled first-party.*
The volume engine now rotates through active, ownership-verified sources that have current items.
For a normal tick it gives the question model one publication's name, description, tags, and up to
four free title/summary previews. The result must share concrete vocabulary with that preview or it
is replaced by a deterministic title-anchored question. Paid item content never enters generation.
Ten percent of fresh ticks may still use registry-wide themes to discover genuine corpus gaps;
`KERYX_ENGINE_QUESTION_EXPLORATION_RATIO` controls that slice. Provider failure on a normal tick
falls back only to the core, corpus-aligned bank, never accidentally to the broad exploration bank.

Why: production's 33% evidence-grounded claim rate was not primarily a permissive/strict gate
problem. Recent first-party runs asked about CCTP, account abstraction and agent toolchains, then
correctly found zero supporting text across the material they bought. Sampling unrelated tags from
the whole registry made a plausible question, not an answerable one. Preview seeding improves the
economic loop honestly: the daemon should pay more often because it found useful evidence, while a
small exploration budget preserves the `/wanted` demand signal. These runs remain `origin=engine`;
the change cannot increment Independent usage, actors, votes, or conversion. Reversible: easy
(raise the exploration ratio or restore registry-wide theme generation).

**D-31** · Reasoning/Latency · *Circuit health is scoped to a provider and reasoning step, and
sub-threshold failures survive until that same step succeeds.*
A model that reliably handles small decomposition and sufficiency prompts may still time out on the
much larger all-source decision payload. Circuit state is therefore keyed by `(engine, step)`:
success in `decompose` cannot erase repeated `decide` failures, and an open `decide` circuit does
not suppress that provider for work it still serves well. Transient failures below the threshold
remain counted while the circuit is closed; the previous implementation accidentally deleted that
counter at the start of the next call, so a transient circuit with threshold two could never open.
Hard 4xx failures still open immediately, cooldown still admits a half-open probe, and every skip
remains visible in the run receipt.

Why: twelve live receipts carried 20 failed `decide` attempts and about 1.57 million milliseconds
in that step alone, yet the six-hour watchdog reported zero circuit skips. Successful lightweight
steps kept clearing the engine-wide state, while the below-threshold deletion also prevented
failure accumulation. Step-scoped containment bypasses only the payload/provider combination that
is failing and preserves independent healthy capability. Payment authority is unchanged: the
selected engine still only proposes decisions; budget, registry payTo, evidence and settlement
remain deterministic. Reversible: easy (return to engine-wide keys, though that restores the live
failure pattern).

**D-30** · Reasoning/Latency · *An available alternate model provider is the retry; do not retry
the same failing transport first.*
When a reasoning tier has another configured model provider behind it, a transient 429, 5xx or
network failure crosses providers after one attempt. Only the last real provider before the
deterministic heuristic retains the three-attempt retry budget, preserving resilience for a
single-provider deployment and giving the model path a final chance before deterministic
degradation. Full transport timeouts and hard 4xx errors already cross immediately.

Why: after cross-provider failover shipped, the live six-hour window showed 21 failed provider
attempts across 82 samples and eight steps saved by the alternate model, with no heuristic
fallbacks, while independent p95 dispatch latency was 83.66 seconds. Repeating a failing primary
was adding wall-clock delay before taking the action that actually recovered the step. The
structured attempt receipt and provider-scoped circuit breaker remain unchanged. Payment
authority is also unchanged: provider rotation cannot choose a payee, exceed a budget, or bypass
the evidence gate. Reversible: easy (restore per-tier retries or make the policy configurable).

**D-29** · Reasoning/Reliability · *A paid dispatch crosses configured model providers before it
may degrade to deterministic reasoning, and the receipt records every tier it actually tried.*
The default chain is credential-aware: Anthropic, DeepSeek Flash, MiMo V2.5, then the heuristic.
A deployment may set `KERYX_LLM_PROVIDER_ORDER` to an explicit ordered allowlist of those real
providers; omitted names are intentionally disabled, invalid/duplicate names are ignored, and an
empty/all-invalid value restores the default. The deterministic heuristic always remains last.
A caller-picked model leads the chain and excludes only that exact engine from the default
fallbacks. Each transport aborts at a configurable sixty-second deadline; rate limits, 5xx and
network failures retry three times, while a full timeout crosses providers immediately rather than
waiting through the same deadline again. A process-wide circuit opens after two exhausted
reasoning calls for sixty seconds. A hard
4xx configuration error opens immediately. The circuit is keyed by engine wire name, so one noisy
provider cannot suppress another.

Every completed run persists bounded per-step attempt telemetry: engine, tier, attempt, latency,
outcome, HTTP status and a coarse error category. Provider bodies are never stored because they may
echo paid source context. The dispatch watchdog aggregates real-model failover saves, failures and
circuit skips onto `/status`. The compact `engine` label remains the public summary, but it is now
backed by structured evidence rather than string parsing alone. Payment authority is unchanged:
models still only propose decisions/evidence, while the orchestrator alone enforces spend caps,
payTo, evidence qualification and integer settlement. Why: production showed 4/6 recent runs losing
a reasoning step to the heuristic while both DeepSeek and MiMo passed live probes; resilience was
available but the healthy second provider was not in the default failure path. Reversible: medium
(remove the secondary tiers/telemetry; no database migration or payment-rail change).

**D-28** · Dashboard/Positioning · *Independent demand leads; first-party agent activity remains
visible as provenance, not as a competing traction claim.*
The public ledger now calls human and third-party web/MCP/A2A use “Independent usage” and Keryx's
own runs “First-party agent activity.” The underlying origin buckets and settled-only metrics are
unchanged. Their distinction stays visible in one compact usage-mix strip, while the definition
moves behind an accessible tooltip and the aggregate ledger remains below. Why: blockchain
settlement proves that value moved, but it does not prove who initiated the demand. Keeping that
provenance preserves credible traction without making defensive disclosure the page's headline.
Reversible: easy (presentation-only copy and layout).

**D-27** · Browser co-sign/Security · *A persisted session grant is payment state, not bearer
authentication.*
The `/api/ask` browser co-sign path now requires the active SIWE wallet to equal the client-supplied
session id and the persisted grant owner before the request receives the user-funded exemption or
any sign-request id. A wallet address is public; treating it as sufficient proof let another caller
reserve that wallet's spend cap with invalid payment headers and use the co-sign route to bypass the
anonymous treasury rate tier. The attacker could not sign with or steal the session funds, but could
strand the victim's capacity and consume server-side reasoning. Pending signature slots also bind to
the SSE abort signal, so a disconnect removes the slot and releases the pre-signature reservation
immediately rather than waiting thirty seconds. Why: ownership must come from SIWE, while the grant
only bounds an already-authenticated owner's spend. Reversible: low (removing the binding would
reopen a cross-session denial-of-service path).

**D-26** · Distribution/Demand · *A shareable wanted brief is a live coordination view, never a
bounty promise or payment authority.*
Every published gap may be opened at `/wanted/[gapId]` with claim-specific metadata, a social card,
the failed dispatch receipt, current offer state, and a feed probe scoped to that claim. The URL
carries only the existing opaque semantic id. Both the page and probe rebuild the current
evidence-bounded demand board; a claim that is no longer open cannot be offered from stale shared
state. Registration still re-reads the feed, independently matches the selected post, resolves
SourceRegistry ownership, and applies the one-offer-per-gap-owner plus five-per-wallet daily
admission limits.

The page says explicitly that this is not a guaranteed bounty. Keryx may sponsor one treasury retry
up to 0.05 testnet USDC after indexing and ownership verification, but `filled` still requires
claim-matched evidence, at least 0.4 evidence-bounded coverage, and a genuinely settled citation
leg. Shared metadata, social previews, and feed-probe results cannot select `payTo`, increase a
budget, queue spend, or mark fulfillment. Why: the gap-to-payout loop existed but one undifferentiated
board was difficult to route to the specific writer who could close a claim. Reversible: easy
(remove the permalink and scoped presentation; the queue and settlement path are unchanged).

**D-25** · Treasury/Security · *Treasury-funded work is admitted as a bounded unit, and an
ambiguous post-broadcast transfer keeps its reservation.*
Wanted-claim registration now independently re-runs the public-preview claim matcher instead of
accepting mere feed membership. Admission is atomic at one intent per `(gap, verified owner)`
across every source and post, with a durable five-offer-per-wallet daily limit at the registration
boundary. This makes a creator's semantic offer—not each attacker-selected URL—the unit that can
enter the treasury retry queue. Remote MCP applies the same principle by rejecting a JSON-RPC
batch containing more than one treasury-funded `research` call, so an HTTP-request rate-limit
token cannot fan out into multiple spends.

Untrusted URL classification expands IPv6 before checking IPv4-compatible and IPv4-mapped
addresses, preventing hexadecimal forms such as `::ffff:7f00:1` from bypassing private-network
rules. The testnet onramp reserves an address before sending and releases it only when no
transaction was broadcast or a receipt confirms a revert. A receipt timeout after a transaction
hash is returned becomes `pending` and retains the reservation, because retrying an ambiguous
transfer can double-drip. Why: financial rate limits must cover the actual funded unit, URL
canonicalization must not weaken SSRF policy, and uncertain settlement is not failure.
Reversible: medium (limits are configurable in code; the conservative reservation rule requires
reconciliation before a retry can be made safe).

**D-24** · Demand/Settlement · *A creator's wanted-claim offer is durable coordination, never
payment authority; fulfillment requires evidence and real settlement.*
Each open semantic claim gets a stable SHA-256 id. The feed-match handoff carries only that opaque
id and the matched post URL; registration re-resolves the claim from the current demand board and
requires the post to exist in the RSS payload Keryx just ingested. The resulting `gap_intents` row
snapshots the failed question and offered source, but cannot choose a payee or spend a creator's
funds. The volume daemon atomically leases only intents whose source cache row is active, ownership
verified, and still owned by the wallet that made the offer. It retries with Keryx's existing
server-side x402 treasury path, capped at 0.05 USDC, a ten-minute crash-reclaim lease, and three
attempts; registration and verification requests never spend.

Completion is deliberately stricter than the generic demand board: `filled` requires the offered
source to carry reward-qualified evidence for the same semantic claim, evidence-bounded coverage
of at least 0.4, and a `settled=true` citation ledger leg with a Circle settlement identifier for
that source and retry run. Grounded-without-settlement is `unpaid`; weak/mismatched evidence is
`missed`; an offer whose gap closes before verification becomes `stale` without spend; repeated
execution errors become `failed`. SourceRegistry/payTo validation and integer
micro-USDC splitting remain unchanged. Why: feed matching previously ended at a registration link,
while probabilistic retries could neither target the creator's offer nor prove that the advertised
gap-to-payout loop completed. Reversible: medium (additive queue/table/UI; no new payment rail).

**D-23** · Grounding/Settlement · *A model citation cannot authorize a reward without a
deterministically verified evidence span.*
Synthesis now proposes `claimIndex + marker + exact quote + support`; the orchestrator accepts it
only when the claim index exists, the marker names content actually read, the normalized quote is
present in that source, the marker appears inline in the answer, and synthesis declared it cited.
Public evidence excerpts are capped at 240 characters so a receipt cannot substitute for gated
content. Rejected markers are removed from the public answer and never enter `citations`, so they
cannot reach `payCitation`; a failed final-assessment call also fails reward authorization closed
without discarding the completed answer. Final confidence and the demand board use coverage bounded by both the final
assessment and the strongest reward-qualified evidence, never source count or a stale pre-purchase
snapshot. Fetch tolls already settled remain valid payment for access; when no citation passes the
gate the citation pool stays unspent. Attribution may only weight the evidence-qualified set; an
invalid/incomplete attribution falls back to an equal split inside that set and can never introduce
a payee. Why: a live CCTP retry correctly measured every claim at 0% and wrote a negative answer,
but an empty `citedMarkers` fallback promoted all 13 reads to citations, labelled the answer High
confidence, and settled equal rewards. The model may propose economic state; code must authorize it.
New nullable scalar counters power the dashboard without loading every receipt, while historical
runs remain explicitly unsampled. Reversible: medium (additive run schema, but the reward gate is
now a financial invariant).

**D-22** · Distribution/Telemetry · *Attribute Remote MCP activation with a bounded setup-URL
channel, never with protocol client metadata.*
The stateless Streamable HTTP transport does not retain `initialize.clientInfo` for a later
`tools/call`, so each published setup URL declares one bounded channel:
`?client=codex|claude|cursor`. Missing and unrecognized values normalize to `direct` and `other`;
historical rows remain unknown. This is intentionally self-declared activation telemetry only.
Stable actor attribution still comes exclusively from a verified API-key wallet, and the channel
cannot change auth, rate limits, budget caps, or payment authority. Reversible: easy (stop
publishing tagged URLs; the nullable column is additive).

**D-21** · Distribution/Payments · *Add stateless Remote MCP beside, not instead of, the caller-funded
stdio MCP package.*
`https://keryx.cc/mcp` creates a fresh Web Standard Streamable HTTP server per request and exposes
the shared `collectRun` research core. Remote calls are treasury-funded because a hosted server
cannot safely hold each caller's local x402 buyer wallet: anonymous calls reuse the IP-limited
free tier and `anonMaxBudget`; ask-scoped API keys get the keyed limit, `a2aMaxBudget`, and
server-verified wallet attribution. A separate `mcp` origin keeps this channel measurable without
mislabeling it as inbound-paid A2A traffic. The npm stdio path remains available for agents that
must pay Keryx's x402 toll from their own wallet. Stateless JSON mode fits Next/serverless and gives
up durable sessions/server notifications, which the two request/response tools do not need.
Reversible: easy (remove `/mcp` and the registry remote; additive origin rows stay readable).

**D-20** · Traction · *External completed queries, not aggregate self-generated payments, are the
primary product KPI.*
Persist `origin` on `query_runs` so zero-spend dispatches remain in the correct conversion
denominator; payment-origin alone cannot do that. External means a real web asker or third-party
A2A caller, while the autonomous volume engine remains visible but secondary. Returning actors are
counted only from a server-verified SIWE wallet or a settled inbound A2A payer—anonymous users are
not fingerprinted. Money metrics read only `settled=true` rows. Latency and settlement-success
samples start when telemetry ships; historical rows stay NULL rather than receiving invented
values. Why: the system already proves the rail works, so the next bottleneck is repeat external
demand and answer quality. Remote MCP is a distinct external origin; authenticated MCP actors use
the verified API-key wallet and anonymous MCP callers remain unattributed. Reversible: easy (the
fields are additive; presentation can change).

**D-19** · Notify · *Citation email alerts are a second independent channel beside the webhook, not a column on it.*
Own table (`source_notify_email`) + own dispatcher mirroring the webhook's contract (settled-legs-only,
fire-and-forget, never throws), so a creator can run either channel or both and existing webhook code
stays untouched. Provider = Resend over one HTTP POST (no SDK, no SMTP dep); ships dark until
`KERYX_RESEND_API_KEY`+`KERYX_EMAIL_FROM` are set — same proven pattern as the Slack front door.
Per-source rate cap (default 1/h) because the 24/7 engine re-cites the same sources; unsubscribe is an
unauthenticated tokened link (per-row random secret, constant-time compare, uniform response) because
the recipient must always be able to stop mail even without the owner's wallet. Reversible: easy
(drop table + panel; run path is one fire-and-forget call).

**D-18** · Dashboard/Data · *Creator cash-outs (Gateway withdraws) live in their own `withdrawals` table, never in `payment_events`.* (user: surface real /tx/ proof on the dashboard)
A withdraw moves already-earned USDC OUT on-chain; it is not a new payment. Folding it into `payment_events` would double-count — `metrics()` aggregates that table for total payments, total volume, creator payouts, and reader→payer conversion, so every cash-out would inflate traction. A dedicated table keeps those figures honest while letting the dashboard surface the withdraw's real EVM mint hash — which, unlike the batched Circle settlement UUIDs in the payments feed, resolves at the explorer `/tx/` — as the hard per-tx on-chain proof that rewards are real, withdrawable USDC. Keyed by `tx_hash`, so re-recording the same withdraw is an idempotent no-op (the `withdraw` script persists on each live mint). Reversible: easy (drop the table + panel; no coupling to the payment path).

**D-17** · Trust · *Listing a source is permissionless, but EARNING requires feed-ownership proof.* (user: "do the best one")
Anyone can paste any RSS feed into the register form, so anyone could list a feed they don't own (Stripe's blog, Vitalik's site) with their own wallet and skim citation rewards — the content is real, but the wrong wallet gets paid. Fix: a `verified` flag gates the money path, not the directory. The agent (`run-agent.ts` discovery) only reads/cites/pays sources where `verified !== false`; unverified ones still appear in the registry, just off the rail. Proof = the owner places `keryx-verify:<payoutWallet>` anywhere in the feed (only whoever controls the feed's publishing pipeline can, and the token binds to the wallet so it can't be replayed) then POSTs `/api/sources/verify`. Migration-safe: the column defaults true, grandfathering the 17 curated seed rows + live VPS traction so the volume engine never stalls; only public web submissions start unverified. On-chain `register()` is the same squatting vector, so the indexer writes new rows unverified too (never downgrades an already-verified row). Reversible: easy (flip the discovery filter off). Note: `id = keccak256(creator, urlHash)` namespaces sources per wallet, so a verified owner can list their feed alongside any impostor copy and be the only one that earns.

**D-12** · Settlement · *Reuse x402 plumbing for BOTH toll moments instead of a new transfer primitive.*
Each source has its own wallet as `payTo`. (a) Fetch toll: agent `gateway.pay(/api/source/[id])` → real x402 settle to creator. (b) Citation reward: agent `gateway.pay(/api/cite/[id])` with dynamic price = weighted reward → real x402 settle to creator. Both land in `payment_events`. Why: every payment is a genuine batched on-chain settlement (no mocks), reusing verified code; no bespoke transfer path. Reversible: medium.

**D-11** · Settlement · *Two-tier economics: small fetch toll + weighted citation pool.*
Per query budget B. Fetch tolls are small per-source access fees (only on BUY). A citation pool (portion of B) is distributed AFTER synthesis by LLM-assigned contribution weight to sources actually cited. Sources fetched-but-not-cited keep only their toll; cited sources earn toll + weighted reward. Why: makes "paid per citation, weighted by contribution" literal and demoable; creates emergent budget behavior. Reversible: easy (tune pool %).

**D-10** · Multi-author · *Default to programmatic per-author nanopayments; on-chain splitter contract is an optional enhancement.*
When a source has N authors with split weights, send N weighted nanopayments to N wallets. Why: showcases nanopayment sub-cent floor, no contract deploy risk, fully real. On-chain `PaymentSplitter` (Circle Contracts) offered as enhancement for atomic splits. Reversible: easy.

**D-09** · Agent · *LLM-provider-agnostic `lib/llm` with Anthropic Claude default + deterministic heuristic fallback.*
Why: build/run/test the whole flow offline today (no key blocker); flip to real Claude reasoning for the demo. Claude (not OpenAI) since user is in the Anthropic ecosystem and we want best reasoning for the 30% sophistication score. Reversible: easy (swap provider).

**D-08** · Data · *Swappable `lib/db`: SQLite (better-sqlite3) for local dev, hosted Supabase for deploy.*
Why: no Docker locally → can't run Supabase locally; need to develop unblocked AND have a hosted DB for the Vercel demo. Single `db` interface keeps call sites clean. Reversible: medium.

**D-07** · Dashboard · *Poll every 1–2s instead of Supabase realtime subscriptions.*
Why: adapter-agnostic (works with SQLite + Supabase), simpler than scaffold's realtime, same screenshot-ready live effect. Reversible: easy (add realtime later for Supabase).

**D-06** · Traction · *Wire `arc-canteen push` for traction events + `circle feedback submit` for the dev-feedback prize.*
Why: `arc-canteen` is the literal mechanism the hackathon uses to track the 30% Traction score; feedback CLI captures the free $500 dev-feedback prize. Reversible: easy.

**D-05** · Discovery · *Internal source registry is the primary discovery channel; `circle services search` is a bonus external channel.*
Why: we control owned/registered creator sources (real payouts to real creators = traction); external x402 discovery is a nice-to-have. Reversible: easy.

**D-04** · Ingest · *Onboard sources via RSS (RSSHub or direct feed parse).*
Why: trivial one-click creator onboarding ("paste your RSS") → fast traction; RSSHub turns almost any site into a feed. Reversible: easy.

**D-03** · Product · *Name = Keryx; brand = "creators get paid every time an AI cites them."*
Why: repo is `keryx` (Greek herald/town-crier — announces + is paid); fits the per-citation narrative. Reversible: hard (naming).

**D-02** · Scope · *Keep the scaffold's working x402/Gateway plumbing verbatim; rebuild only the agent + creator economy on top.*
Why: payments are the risky/verified part — don't re-derive them; spend effort on the reasoning brain (the differentiator). Reversible: n/a.

**D-01** · Chain · *Build on Arc testnet (5042002); mainnet is a separate audited migration, not a config flag.*
Why: a one-variable switch cannot safely change every chain, token, Gateway, registry, browser, monitoring, and operating assumption. This supersedes the original hackathon-era config-flag shortcut. Reversible only through an explicit mainnet release and go/no-go review.

**D-15** · Enhancements · *Implement all four enhancements, sequenced by score-impact.* (user: "all four; you decide how to win")
Order: (1) Agent-to-agent mode — expose Keryx as a paid x402 endpoint other agents call; (2) External x402 discovery via `circle services search`; (3) Onchain PaymentSplitter (Circle Contracts) for atomic splits; (4) ERC-8004 agent identity + creator reputation feeding source selection. Core (web app + real settlement + volume) lands first. Reversible: easy (each is additive).

**D-14** · LLM · *Add DeepSeek (OpenAI-compatible) as the default cheap provider; Anthropic still supported.* (user choice — cheaper)
Shared `JsonChatEngine` base holds all prompts once; `AnthropicEngine` + `OpenAICompatibleEngine` are thin transports. Provider priority: Anthropic > DeepSeek > heuristic. Reversible: easy.

**D-13** · Deploy · *Primary deploy = run locally + Cloudflare Tunnel (cloudflared) for the public URL; keep SQLite.* (user suggestion — good fit)
Drops the Supabase + Vercel hard-dependency: the app + funded wallet + volume engine run on the local machine, exposed publicly via tunnel. Trade-off: live only while the machine/tunnel run (fine for demo + volume window). Supabase/Vercel path stays available behind config for always-on hosting. Reversible: easy (config flag).

**D-12b** · Recording · *The agent (client) is the single recorder of payments in both modes; x402 server endpoints settle but don't double-write.*
The agent has full context (queryId, rationale, weight, contribution) and runs the same recording offline & online with the real tx hash from `gateway.pay`. A2A external payers get server-side recording in that endpoint variant. Reversible: medium.

**D-16** · Discovery · *External x402 marketplace = discovery + reasoning only; never purchased (off-Arc rail enforced in code).* (user choice — "discover + decide, don't buy")
Each query the agent probes the live Circle x402 bazaar (`circle services search`, one cached snapshot), ranks endpoints locally by topical relevance, and the engine reasons BUY/SKIP over them alongside registered creators. The orchestrator then forces every external endpoint to SKIP — they settle on other chains (Base/ETH/… mainnet, none on Arc), so they're evaluated and logged but not settled (mirrors the budget-cap enforcement). Honors the no-real-money rule while adding Circle `services` tooling + open-economy agency with zero cross-chain spend. Reversible: easy (a Base-Sepolia testnet pay path can be added behind a flag later).

---

## Open questions (for the human) — RESOLVED
- LLM key: ✅ Anthropic primary + DeepSeek fallback (D-09, D-14).
- DB: ✅ local SQLite on the VPS is the source of truth; Supabase adapter kept behind config (D-08, D-13).
- Funder wallet: ✅ funded; real settlement is live (`KERYX_FORCE_OFFLINE=0`), 500+ settled payments.
- Deploy target: ✅ VPS at keryx.cc via Cloudflare Tunnel, not Vercel (D-13).
