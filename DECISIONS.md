# Keryx — Decision Log

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
