# One account, several wallets, and sign-in without an existing wallet (#267)

Status: recorded design for independent review before implementation. This document
and one additive DECISIONS entry are the entire authorized source change. No auth,
profile, database, schema, history consumer, test or runtime implementation changes
are included. Actual checks, provider ceremonies and rollout acceptance are UNRUN.
Original [issue267](https://github.com/tang-vu/keryx/issues/267) remains open.

## Source and assignment

The inspected candidate is HEAD `0b19747a8c61836aa440d7c07036af57ebdaa37f`, tree
`72c5df3040609209779b9ca19eb8c70427b1b20a`; local `origin/main` matched that HEAD
at start. HEAD/tree do not include this uncommitted documentation overlay and do
not establish current remote main or deployed app identity. Execution owner is
`literal-cli-forty-designAccountMembership267`; outcome/release owner is
`root-session-transfer-20261012-01a130be`.

The retained original267.json, current-owner-overlap.json and bootstrap-receipt.json
were read from the assigned original267/account267 evidence directories. The live
coordination record assigns only this new document and additive DECISIONS editing
in this isolated worktree. Existing #260/#261/#262/#263/#264/#268 outcomes retain
their owners. Their source is a dependency to compose later, not authority to edit
another candidate, activate a capability, or infer its production completion.
This design does not delay the independent app64 release batch.

## Actual source facts

| Building block | Observed implementation and limitation |
| --- | --- |
| Interactive wallet login | [SIWE verify](../../app/api/auth/verify/route.ts) consumes a durable issued challenge and verifies signature, domain, nonce and configured chain before issuing a session. Its users-index upsert is best effort; it is not a stable account-membership transaction. |
| Circle signup/login without a pre-existing wallet | [prepare](../../app/api/auth/circle/prepare/route.ts) requests an EOA initialization challenge; [session](../../app/api/auth/circle/session/route.ts) resolves Circle's authenticated wallet, consumes the durable continuation, upserts the wallet user and issues the same wallet session. These are actual source building blocks; no vendor call was executed here. |
| Circle authority | [verifiedCircleWallet](../../lib/circle-wallet-server.ts) uses the server's fixed Circle endpoint and authenticated user token, exact configured blockchain, one userId, oldest immutable wallet ordering, ENDUSER/EOA/LIVE checks and bounded list refusal. A frozen oldest wallet cannot silently promote a newer wallet. Client address/userId and Google labels are not authority. |
| Circle signing boundary | [sign route](../../app/api/auth/circle/sign/route.ts) requires the vendor-authenticated wallet to equal the live wallet session. [Provider](../../lib/circle-wallet-provider.ts) supports personal_sign/message bytes. A different account-session wallet cannot use this route to sign for a proposed Circle member without a separately reviewed target-wallet context. |
| Durable web session | [auth-session](../../lib/auth-session.ts) verifies HS256 issuer/audience, jti, address and time, and compares the hashed durable row. [accountSessionContext](../../lib/account-sessions.ts) returns only `{db, wallet, currentId}`. It has no account ID, membership revision, optional-wallet account mode or issuer-method discriminator. |
| Private profile | [private-profile](../../lib/profiles/private-profile.ts), [routes](../../lib/profiles/profile-route.ts) and [SQLite](../../lib/db/private-profiles-sqlite.ts)/[Supabase](../../lib/db/private-profiles-supabase.ts) stores are wallet keyed. Cookie writes compare the expected wallet and exact origin; bearer presence never falls back to cookies. Activity covers attributed current-store rows, not a person or all linked wallets. |
| Verified external profiles | [verified-identities](../../lib/profiles/verified-identities.ts) binds ORCID/GitHub verification to a saved wallet profile and session-bound single-use lineage. These dated control assertions grant no account login or payment authority. |
| Membership consumer only | [KeryxDB](../../lib/db/keryx-db.ts) declares optional `historyMembership`; [owned-history](../../lib/history/owned-history.ts) accepts an opaque accountId, safe integer revision and 1–8 unique canonical wallets including the authenticated wallet. Neither ordinary [SQLite](../../lib/db/sqlite-adapter.ts) nor [Supabase](../../lib/db/supabase-adapter.ts) installs a producer in this source. |
| Read fences | [owned-history-reader](../../lib/history/owned-history-reader.ts) binds cursors to wallet, account/revision/set, origin/network and filters, and rechecks membership and owner/privacy state. [HTTP route](../../lib/history/owned-history-route.ts) rechecks the exact session currentId or bearer after private IO. Synthetic membership fixtures in [tests](../../lib/history/owned-history.test.ts) are consumer evidence, not a producer. |
| Keys | [api-keys](../../lib/api-keys.ts) stores hashed keys belonging to one wallet; [scopes](../../lib/api-key-scopes.ts) retain explicit private permissions. The current owned-history consumer would aggregate for any history-scoped key if a producer were attached. Attaching it therefore requires a consent/credential boundary, not just populating a table. |
| Claims and provenance | [claim service](../../lib/run-claims/service.ts) consumes a private claim against a durable interactive wallet/session and exact origin/network. [run-provenance](../../lib/research/run-provenance.ts) records trusted closed ingress metadata; missing historical provenance remains unknown. Claims attach ownership separately from the saved original and financial evidence. |
| Source verification | [source verification](../../app/api/sources/verify/route.ts) compares the session wallet with the persisted payout wallet, reads the exact feed token and uses an unchanged-source CAS. It establishes that source-control relation; it does not establish a linked person or account-wide creator powers. |
| Financial delegation | [session grants](../../lib/payments/session-grants.ts) reserve against exact sessionId/grantEpoch/signer; [consent](../../lib/payments/session-grant-consent.ts) binds owner, signer, origin, network, USDC/Gateway, cap and expiry. Membership has no role in those signed financial originals. |

These facts describe inspected source. Existing tests were read, not run. Historical
plans and acceptance receipts for other candidates do not pass this candidate's
future auth, storage or payment checks. See [roadmap](../project-roadmap.md),
[private profiles](private-profiles-2026-10-09.md),
[owned history](owned-personal-history-2026-10-12.md),
[claims](../anonymous-run-claims.md) and
[research-budget onboarding](../research-budget-onboarding.md).

## Proposed decision and authority model

Introduce one opaque, server-generated stable account ID for private profile and
current read membership. An account means a consented collection of credentials
and wallet-control proofs, not a verified natural person. The same wallet,
provider payTo, chat label, display name, profile URL, export contents or source
creator label never merges accounts or proves linked-person identity. An address
is a wallet selector only after independent control verification; it is not a
person identifier. Source verification remains a separate actual building block.

Keep the first implementation bounded to the existing Circle user-controlled EOA
and SIWE paths, private profile management and #268 current-store reads. Reuse
existing auth/profile/history surface families; this record adds no public API,
generic identity framework, login-policy activation or provider integration.
Future versioned contract changes must be reviewed together with their callers.

| Proposed stored fact | Authoritative producer and transition |
| --- | --- |
| Account | Random opaque ID, creation time and monotonic membership revision, allocated atomically after authenticated bootstrap and explicit account consent. ID never derives from wallet, provider subject, email or handle. |
| Current wallet membership | Canonical lower-case EVM wallet, account ID, unique membership generation, link time and consent/proof digest. First-account bootstrap uses the verified Circle/SIWE flow and explicit creation consent below; additional membership requires an active exact account session plus that wallet's fresh membership signature. A database unique constraint admits at most one current account per wallet, across address case variants and concurrent attempts. |
| Account session binding | Hashed durable session selector bound to account ID, credential lineage and issued security generation, with existing expiry/revocation semantics. The server resolves live state on every account request; JWT claims and cached UI state cannot override it. |
| Credential | Verified wallet login lineage; optional future RP-scoped passkey record. Credential uniqueness and current account association are transactional. Provider labels/asserted profile identities do not become credentials. |
| Private profile | One account-owned editable row, separately revised. Existing field validation and handle uniqueness remain. Profile edits do not alter membership or funding. |
| Membership mutation | Single-use, purpose-specific hashed challenge bound to exact account, session, current revision, target wallet, membership generation, configured origin and selected network; immutable consent digest plus bounded minimal audit metadata. |

Use revision 0 for a newly created empty account internally, increment once for
each committed membership change, and keep it stable between mutations. Never
derive revision from wall time or increment it during resolve(). Never reset it
on unlink/relink or reuse a deleted account ID. Refuse exhaustion beyond the safe
integer consumer bound. Account set size is at most eight, matching #268; the
bound is a disclosed product constraint rather than silent truncation. A future
larger limit needs jointly reviewed consumer and resource changes.

## Wallet-free signup, login and private profile creation

The default proposed route for a researcher with no existing wallet is the
existing optional Circle Google flow. Explain that it creates a user-controlled
EOA and a private Keryx account, costs no Keryx-funded research allowance, and
does not fund/deposit/approve a research budget. Explicitly accept creation and
the private profile association before committing the bootstrap. Authentication
alone is not spending consent. Unsupported or unconfigured Circle signup remains
unavailable; it cannot fall back to treasury keys or an invented verified user.

1. Start the existing bounded same-origin Circle continuation. Authenticate the
   user token server-side and request the existing EOA initialization ceremony if
   no wallet exists. Finish the user's Circle confirmation; no automatic retry
   or new wallet creation after an uncertain vendor response.
2. Resolve the exact original Circle wallet under current server checks. For a
   wallet with existing membership, login resolves its stable account only after
   current credential/session checks. For an unbound wallet, present an explicit
   account-creation choice. Never absorb another account or profile from a label.
3. In one admitted ordinary-domain transaction, consume the exact bootstrap
   lineage, create the account and first membership, attach the credential and
   create the durable account-session binding. Cookie issuance follows durable
   success. A failed profile-field save can leave a clearly reported empty
   profile; it cannot report saved fields. An uncertain bootstrap acknowledgement
   requires fresh authenticated resolution of committed state, not re-creation.
4. Create/edit the private account profile with explicit validated fields and
   owner/profile-revision comparisons. It is usable before funding. Existing
   anonymous-run claims can attach to this verified Circle wallet after a
   separate claim confirmation, only if their existing ordinary capability is
   admitted. Claiming is not required to create an account or profile.
5. Returning Circle or linked-wallet SIWE login resolves that current account
   instead of creating a fresh wallet-keyed profile. It does not silently choose
   a different payment wallet; funding/signing always requires an explicit exact
   wallet context under the existing financial checks.

This satisfies “without holding a wallet beforehand”: signup creates an unfunded
wallet. It does not claim that the existing source creates a zero-wallet account.
For a future user who declines wallet creation entirely, a Keryx login passkey
could bootstrap an account with zero memberships and create its private profile.
That mode requires its own reviewed credential/session implementation; existing
wallet-only accountSessionContext and the 1–8-wallet history consumer cannot
serve it by inventing a zero address. Zero-member history is explicitly empty
only for an admitted zero-member account; missing storage is unavailable. Direct
claims to that walletless account would require a reviewed claim-contract change;
until then claims require an explicitly linked verified wallet, without reissue.

### Circle versus passkeys: verified documentation and open questions

Official public documentation was read on October 13; no SDK install, browser,
wallet, provider API, search command or payment was executed.

| Option | Source-backed assessment and proposed boundary |
| --- | --- |
| Existing Circle user-controlled EOA | Circle documents social/email/PIN onboarding and device-approved signing. Keryx implements the Google/EOA subset already. Keep that default for the first increment; do not claim email/PIN is implemented or that Google login signs a Keryx link consent. [Circle guide](https://developers.circle.com/wallets/user-controlled), [setup](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app). |
| Keryx account-login passkey | WebAuthn provides RP-scoped public-key login, separate from an EVM payer. A future ceremony must verify server challenge, credential/account binding, configured origin, rpIdHash, signature, presence and required user verification; handle backup/counter state per the specification. This can support zero-wallet profiles without replacing browser financial custody. [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion). |
| Circle modular/passkey wallet | Circle documents passkey smart accounts, optional recovery and EIP-1193 integration. Provider-interface compatibility does not prove compatibility with Keryx's EOA derivation, EIP-712/EIP-3009/Gateway flow or retained originals. Keep it outside this increment. [Circle modular wallets](https://developers.circle.com/wallets/modular). |

Actual passkey browser/device recovery, Circle modular support for the exact
selected Arc product, same-address guarantees across supported chains, installed
SDK compatibility and applicable sanctions/legal eligibility remain UNKNOWN
where not established by these inspected sources. The original issue's platform
notes are proposals, not proofs. Recheck applicable official product/compliance
documentation and actual vendor/device acceptance before any later activation.
No modular wallet, gas sponsor, email/PIN provider or recovery service is enabled
by this design. Passkey delivery is an optional later boundary, not a new human
trial gate for the Circle-based original #267 criteria.

## Explicit second-wallet linking and account bootstrap for SIWE

For existing SIWE users, allow an authenticated unbound wallet to explicitly create
its account and adopt its own private profile. Reauthenticate bootstrap as needed;
never silently turn an old address-only JWT into account-wide authority. No
historical profile/run/payment backfill is inferred from wallet similarity.

For a second wallet, require the initiating durable account session and a fresh
signature from the target wallet. The server chooses the account from the session,
not the request. A target address is a proposed wallet to verify, never an owner
selector. Show that linking permits private history aggregation and that funds,
budgets, API-key scopes and source payouts remain wallet bound. Confirmation must
name the target wallet and current account context before any signature request.

The proposed nonfinancial link message has a distinct version/purpose and includes
the configured origin/domain, selected network/chain, opaque account ID, exact
target wallet, expected membership revision, random server nonce, issued time,
five-minute expiry and a commitment to the initiating session lineage. Keep the
raw session ID/token out of the message and output. Sign this canonical message
using the already supported wallet proof method, with an explicit membership-only
scope and no transaction, approval, budget, or source-authority effect. Validate
exact recovered wallet and every binding. Do not reuse login, payment, OAuth or
source-verification signatures. Circle wallets need their own explicit user
signature of this same intent when added to an existing account; token possession
or matching Google label is not a second-wallet link signature.

Choose a canonical UTF-8 personal-sign message for supported EOAs, with the literal
membership-only heading and fields above in fixed order and canonical integer/time
forms. Its format/purpose is distinct from SIWE and budget consent. The server
reconstructs the exact bytes from its issued challenge; arbitrary client text
cannot substitute for them. Verify the EOA message signature against those bytes.
This uses existing message-signing building blocks without assuming payment
signatures or typed-data compatibility prove membership.

Keep the existing Circle sign route's wallet-equals-session guard. When its target
wallet differs from the initiating account session, later implementation must
retain the initiating account session unchanged and obtain an independently
verified target-wallet signing context, then return only the nonfinancial proof
to the initiating link flow. Replacing the initiating login during proof makes
the link stale and must refuse. Target authentication must not implicitly create
a second account or transfer membership. The existing route does not implement
this two-context ceremony; its reviewed adapter/UX and actual Circle acceptance
remain explicit implementation gates rather than relaxing the current guard.

Consume the purpose-specific challenge once before completing a link; invalid
attempts cannot replay it. After awaited proof work, the transaction locks the
account, challenge and wallet uniqueness row, rechecks the exact live initiating
session, expiry, revision and membership generation, inserts the current link and
increments revision exactly once. Competing links have one winner. A conflict
reveals no other account identity. A link already committed under that exact
lineage may be resolved after explicit reload; there is no automatic new nonce,
retry, account merge or transfer. A wallet bound elsewhere must first be explicitly
detached by that account's authenticated owner, then freshly signed here.

Propose this only for the currently supported EOA proofs. Smart-contract wallet
proof verification and provider-specific signing variants stay unsupported until
their exact authentication and failure paths are reviewed; EIP-1193 alone proves
neither signature validity nor custody compatibility.

## Immediate unlink, stale sessions, cursor invalidation and refusal

Unlink is an explicit same-origin interactive account mutation requiring the exact
live session, account/revision and target membership-generation preconditions.
It does not require the removed wallet to cooperate, so a lost wallet can be
detached. A bearer API key cannot link, unlink, transfer membership or choose a
different profile owner. Do not allow removal of the last usable login credential
as an ordinary unlink; first establish an independently verified alternative.
Account closure is a separate explicit operation, not silent orphaning or fund
deletion. Detaching a current login wallet also removes its account-login binding.

In the write transaction, delete the current membership, advance revision, cancel
pending link/credential flows for the affected lineage, invalidate account-wide
key consent bound to the prior revision, and revoke account sessions authenticated
through the removed wallet. Other account sessions must refresh against the new
live revision before another read or mutation. In-flight requests retain their
starting exact session/revision, so they cannot auto-upgrade while returning old
output. A relink uses a new generation and fresh consent; old callbacks stay dead.

Resolve membership from durable primary state at the request start and after
every awaited private read, including list/detail/report/reference/receipts,
profile activity, all export pages and the final response boundary. Authenticate
the exact session or key again. Changed account, session, credential generation,
membership revision/set or row privacy discards pending private output. Final
authorization and mutation transactions serialize their authority decisions; an
unlink acknowledged before that read's final authorization must cause refusal.
Do not stream private aggregate output before this fence. Content already
authorized and delivered before unlink cannot be recalled; exports saved by a
user remain copies. UI abort alone is insufficient server authorization.

| Condition | Required result |
| --- | --- |
| Missing/expired/revoked exact session or key | Unauthenticated refusal; never renew through another same-wallet session or cookie fallback for a presented bearer. |
| Changed expected account/wallet/revision or stale mutation | Conflict/precondition refusal with no write; reload requires a fresh explicit action. |
| Replay, expired challenge, wrong purpose/origin/network/signature | Uniform unavailable/invalid mutation result, no identity disclosure or alternate runner/provider. |
| Membership/credential storage failure, malformed set, duplicate wallet, missing caller wallet or revision overflow | Unavailable and no private aggregate; never interpret an outage as null membership or zero activity. |
| Old cursor after link, unlink or relink | Invalid cursor; discard it and begin a fresh authorized first page. Cursors grant no rights. |
| Uncertain mutation acknowledgement | Report unconfirmed; explicitly reauthenticate/read current committed state. Never claim rollback, repeat writes or recreate authority automatically. |

History fallback to `[verifiedWallet]` remains only the existing intentionally
unadmitted wallet-only mode, labeled `wallet-owned-current-store`. An admitted
account operation cannot use missing capability as a fallback. The existing
consumer's `resolve(verifiedWallet)` cannot validate an account session or key
consent alone: a request-local verified authority boundary must admit account
mode before using that producer. Preserve wallet-only financial callers rather
than changing all accountSessionContext callers to accept an optional wallet.

## Wallet-bound keys and separate payment authority

Keys retain their original wallet, hash, scopes, rate/usage owner and source pins.
Linking does not remint, transfer or revoke their wallet-only rights. Through that
wallet, a key may acquire a private account-read association only with explicit
interactive owner consent. Existing history/profile scopes alone must not silently
expose another wallet's data or permit account-profile writes.

Proposed account-read consent is stored per exact key ID, account ID, wallet
membership generation and current membership revision. Its bounded read rights
must be explicitly selected in the existing key-management flow. New members or
unlink invalidate that consent until the account owner explicitly renews it;
they cannot expand an old credential's read set. After unlink, that key remains
wallet-only and cannot access the former account. Scope removal, key revocation
or consent revision changes during IO withhold output. The key never performs
membership changes. Current MCP/HTTP consumers need coordinated changes before
connecting the producer; synthetic wallet-only wrappers are not rollout proof.

Account profile reads use that explicit consent; account field writes remain
interactive in the initial increment. Existing wallet-profile key writes retain
their old wallet domain and cannot mutate a migrated account row through an alias.
Do not invent a new scope/API in this design-only patch; later contract changes
must define and document these distinctions without widening historical defaults.

Payment requests keep an explicitly selected verified wallet and its exact
financial session, signer, grant epoch and original network. An account-only
session without independently verified wallet authority grants no funding, key mint for a nonexistent wallet, signing,
withdrawal, creator registration or paid research authority. Roles/allowlists
and source-owner controls remain verified wallet predicates; a developer or
creator member cannot confer those powers on other members or account-only login.

Never pool or inherit payer grants, balances, quotas/caps, reservations, payment
nonces, signing keys, source-owned payTo or Arc registry authority. Reporting may
sum evidenced historic amounts, but availability and spending capacity remain
per wallet/signer. Unlink revokes account access, not financial liabilities. It
does not refund, settle, fail, release, delete or rewrite any financial original;
exposed authorizations retain their exact liabilities and existing reconciliation
rules. Existing signed owner consent and custody/default-OFF/Operator/private
holds remain. No treasury fallback, new funding, spend, DDL, schedules, enrollment
or pilot activation is authorized. App54 UNBOUND is never adopted as authority.

## History aggregation, profile figures and provenance

Implement the producer as a current-state projection over admitted membership,
returning exactly the stable account ID, current revision and bounded canonical
wallet set to the existing consumer. It does not search other stores, infer
members from payer/source/profile/chat data or return a cached stale list.
Keep original wallet ownership on every run. Recorded attributed runs and
explicitly claimed runs qualify through the existing owner/claim/privacy ports,
not because their payer or surface label happens to match a member.

Merge bounded per-wallet keysets using the existing descending `(createdAt,id)`
ordering, origin/network/filter/authority-bound cursor, privacy and final-session
fences. Account aggregation does not make current-store pagination a snapshot
or expand export/receipt bounds. Duplicate/cross-owner ambiguity refuses rather
than selecting a convenient owner. Details/actions must establish current member
ownership independently; displayed links and cursors cannot authorize a report.

Private account figures use deduplicated admitted recorded/claimed run IDs across
current members and the same current owner/privacy exclusions as history. Count
questions from complete bounded store aggregates, not a page or adding overlapping
per-wallet totals. Topics remain recorded machine topics; surface comes only from
trusted provenance, with historical unknown preserved. `firstSeenAt` reports the
defined account-creation date separately from earliest known member activity;
do not overwrite either historical users-index timestamp. Profile fields are
account assertions, not verified identity. Existing verified ORCID/GitHub links
keep their dated wallet provenance and require explicit adoption for any later
account display; they never become login or payment credentials.

Keep each receipt's owner run, payer, payee, kind, original network, integer
micro-USDC amount and settlement reference. Sum only recorded real settled
evidence with supported exact units; pending, offline, malformed, missing or
truncated evidence is qualified unknown/unavailable rather than invented zero.
Preserve the #268 distinction between current-member receipt payer and other
verified payer, and expose per-wallet breakdowns so unlink changes display
cohorts without rewriting receipts. Creator figures count distinct evidenced
settled payees in owned runs and do not claim the account paid them. A Circle
transfer ID is not relabeled an Arc transaction hash.

Anonymous/unclaimed runs are excluded. Existing valid claim confirmation must
attach them to an independently verified member wallet; claim expiry, revoked
session, origin/network mismatch or disabled capability refuses. Neither history
nor account signup mints historical claim secrets. Chat runs qualify only with
an existing producer's verified owned attribution/claim; matching chat labels,
provider payTo, names or exports cannot create it. Native private workspaces,
archives, original fulfillment and enrolled financial storage remain outside
ordinary account aggregation unless separately admitted later.

Unlink removes that wallet's rows/figures from subsequent account projections
immediately while preserving its history. Fresh independent wallet login can
read its own history under the existing wallet mode. A later link intentionally
shares that wallet's admitted history with the new account, including earlier
owned/claimed runs, and therefore needs an explicit historical-data disclosure.

## Ordinary adapters, privacy, retention and rollout boundaries

Use one additive private ordinary account domain with transactional membership,
credential/session bindings, challenge lineages and account-profile association.
These are conceptual records, not executable DDL or allocated migration numbers.
SQLite needs atomic uniqueness/revision operations and exact shape admission;
unknown tables/triggers or an enrolled marker refuse without repair. Supabase
needs fixed bounded service-role RPCs, private RLS/ACLs and equivalent transaction,
lock-wait and uniqueness behavior, with no REST fallback. The producer is optional
and nonenumerable following existing ordinary domains. Neither adapter silently
installs a runtime account schema or converts existing data because it was read.

Enrolled/native/archive facades omit/refuse the new capability before IO. Never
widen sealed method inventories, schema digests, identity manifests, provenance
or receipts to make ordinary CRUD work. Production needs a separately reviewed
capability/migration and owner-authorized operational admission for the actual
selected store. A source migration or successful isolated test does not grant it.
Existing privacy, claims and Circle configuration/activation stay unchanged.

Persist only what supports the declared account boundary: opaque ID, canonical
wallets, credential public verifier, generation/revision/times and hashed
challenge/consent identifiers. Raw secrets, SIWE/link signatures where only a
digest is needed, Circle tokens, provider auth codes, wallet keys, IPs and
passkey biometric data never enter account audit logs, URLs, telemetry, public
profiles, reports or exports. Request-local secrets are discarded on completion,
expiry or abort. Pending challenges expire after five minutes; retained replay
markers may be pruned only after the expiry window, with absence still refusing.

Propose a maximum 30-day retention for minimal nonfinancial mutation audit events,
then deletion of account correlation metadata unless needed for an explicitly
identified active dispute. This is a proposed product retention choice, not an
activated cleanup job or permission to delete existing evidence. Unlink removes
the current association immediately; a retained tombstone proves only dead
lineage/replay refusal and cannot resolve membership. Private-field deletion
must distinguish profile removal from account/credential closure and financial
retention. Historical wallet ownership/claims and immutable financial originals
remain under their existing retention rules; account deletion does not erase
them or assert that previously exported copies disappeared. Backups must honor
revocation generations on restore before account capability can be served.

Adopt existing private wallet fields only from the authenticated wallet creating the account
after an explicit preview. Never silently union biographies, handles or verified
identities across members. Competing handles and pre-existing account associations
refuse atomically; preserve prior rows until an approved migration mapping is
accepted. Public /u publishing remains a separate consent/capability; account
membership lists and private activity never become public automatically.

| Surface | Proposed bounded role and remaining delivery boundary |
| --- | --- |
| Web / hosted Desktop view | Existing connect/profile/history families own explicit interactive consent, second-wallet proof, unlink, credential refresh and stale UI invalidation. Native Desktop workspace/custody remains separate. |
| API | Existing private profile/history families consume verified account context only through reviewed versioned contracts. Bearer precedence, strict selectors, no-store and final exact-credential fences remain. No new API is implemented here. |
| CLI | Existing explicit scoped HTTPS read clients can consume admitted account-read consent. No local DB, wallet/provider runner or inherited payer grant. Membership mutation requires the interactive web ceremony. |
| Remote MCP | Request-local exact key/scope/account-consent revalidation, bounded private reads. No actor-string account selection or mixed-batch scope escalation. |
| Stdio MCP | Fixed key-only HTTPS bridge with the same private contracts and no cookies, signer, payment or retry. Built package acceptance/distribution is separate from source edits. |
| Extension | Existing verified wallet/run attribution and private claim handoff remain. No automatic membership, linked-wallet list propagation or new cookie/key custody. |
| Bots / OpenAI / A2A | Existing verified actor/claim producers supply ownership. Chat/provider labels never link accounts; noninteractive mutations and inherited spending authority remain unavailable. |

## Later implementation sequence and required failure matrix

PRIMARY retains this local design and obtains a different review before any
implementation. This worker creates no microdocs PR, push or checkpoint. Keep the
later #267 outcome coherent: reconcile accepted current main and dependencies,
then implement membership, explicit consent, account profile/session boundaries
and all affected consumers together. Source and implementation acceptance are
separate from production capability admission and delivery.

1. Review the authority/consent decisions, Circle-first bootstrap, ordinary
   storage boundary and exact scope interactions with #260/#262/#268 owners.
2. Add the ordinary transactional producer and account-profile/session bindings
   with both adapters' equivalent refusal/uniqueness semantics; keep activation
   off and existing wallet-only financial callers unchanged.
3. Implement explicit create/link/unlink in existing interactive surface families,
   versioned account read contracts and scoped-key consent, including exact final
   credential/revision fences and profile migration preview.
4. Compose history/profile/API/MCP/CLI/UI consumers; preserve provenance, claims,
   receipts, custody and original financial tests. Refresh source facts when the
   combined candidate changes. Optional passkey implementation follows separately.
5. Pass actual independent auth/storage/payment review, proportionate local checks
   and required aggregate/domain/platform CI. ROOT serializes the focused merge;
   production migration/activation and one combined deploy remain separately owned.

All matrix entries below are required future acceptance, **UNRUN here**. Reading
an existing test or recording a case is not execution evidence.

| Case | Required observable result |
| --- | --- |
| New researcher with no wallet/funds | Explicit Circle ceremony creates/reuses the original EOA, stable account and editable private profile without deposit, payment or grant; returning login finds that account. Vendor/configuration failure grants no fabricated account. |
| Optional true zero-wallet passkey mode | Only if implemented: valid registration/login yields an account/profile without address substitution; wallet-only funding/key/claim routes refuse. Wrong RP/origin/challenge/signature/verification and unsupported devices refuse without fallback custody. |
| Link controls | Exact active initiating session plus target signature succeed; absent/foreign/revoked/replaced session, wrong wallet, account, chain, origin, purpose, revision, time or consent fail before membership changes. |
| Replay and concurrent uniqueness | Consumed/invalid/expired nonce cannot replay; mixed-case/concurrent cross-account links have exactly one winner and reveal no other account. Unlink/relink creates fresh lineage; delayed old completion cannot recreate it. |
| Immediate unlink / lost wallet | No target cooperation needed; removed-wallet sessions and pending flows lose account rights. Other live sessions refresh; last usable login removal refuses. Wallet history and exact financial originals remain byte-identical. |
| Read races | Unlink, relink, session/key revocation, scope/consent change, profile deletion or run erasure during receipt/list/detail/reference/export/activity IO discards output. Another same-wallet session cannot renew a pending request. |
| Cursors and bounds | Old account/revision/filter/origin/network cursor refuses after mutation; equal timestamps, duplicate/overlapping runs, empty continuing scans and truncated receipts/exports remain correctly qualified. |
| Keys and roles | Legacy/private-scope wallet key alone sees no other member data. Explicit current consent allows only chosen reads; revision change removes aggregate consent. Keys cannot link/unlink or acquire another member's dev/creator/source powers. |
| Aggregates and provenance | Both adapters include only admitted recorded/claimed member ownership, exclude foreign/unclaimed/erased/native runs, preserve unknown provenance and exact per-wallet monetary evidence, and never turn a provider/chat/payer label into identity. |
| Adapter/storage failures | Missing/unknown/altered schema, revoked ACL, outage, timeout, lock wait and uncertain acknowledgement fail closed with no alternate adapter, partial successful aggregate, runtime repair or financial mutation. Enrolled/native/archive refusal precedes IO. |
| Privacy and retention | Raw secrets absent from stored/logged/public fields; no-store/error responses reveal no foreign identity. Expired/pruned challenges still refuse; restored backup cannot revive revoked sessions/old memberships. Profile deletion and unlink preserve financial originals. |
| Payment regression | Existing owner/signer consent, session grant/epoch cap, nonce admission, pending liability, revoke/recovery, source-owned payTo and Arc registry tests pass unchanged, plus cross-member negative cases proving no inherited authority. |
| Surface/delivery acceptance | Actual ordinary SQLite and isolated PostgreSQL concurrency/ACL/migration acceptance; actual auth/UI routing/stale-state checks; remote and built stdio/CLI contract checks; applicable Desktop/extension/bot parity. Synthetic fixtures are qualified separately from real vendor and deployed capability acceptance. |

Genuine external/human gates are current Circle configuration and actual vendor
ceremony/eligibility, owner-authorized production capability operations and any
later passkey recovery choice. No arbitrary paid trial, identity certification,
generic framework or extra admission layer is added to original #267 acceptance.
Private financial/Operator holds and current release ownership remain in force.

## Remaining original #267 criteria

| Original criterion | Status after this design-only patch |
| --- | --- |
| Create a profile without holding a wallet beforehand | Proposed concrete Circle-first path; stable account/profile implementation and actual acceptance remain. Existing Circle signup is a building block, not completion of this criterion. |
| Second-wallet proof of session and wallet control | Consent/challenge/transaction design recorded; producer, UI, both adapters and failure tests remain. |
| Aggregate history/profile figures without pooling payment limits | Consumer building block identified; producer, account figures, credential consent and coupled read fences remain. No account-wide source-only closure. |
| Immediate unlink tested against stale sessions | Revision/generation/session/cursor semantics recorded; implementation and actual race tests remain UNRUN. |
| Custody/signing/grants unchanged, confirmed by payment tests | Preservation constraints recorded; actual current-candidate existing payment and cross-member negative tests remain UNRUN. |
| DECISIONS design before implementation | One additive #267 entry accompanies this document before any implementation. It records a proposed design for different review, not approved implementation or issue closure. |

Next action: PRIMARY reviews this retained local two-file patch through a different
reviewer, then owns any authorized implementation/checks. ROOT captures the actual
CLI exit, signal and separate stdout/stderr EOF; this document cannot infer them.
No PR, Git writer, version, publication, deployment, Canteen update or issue closure
is performed by this worker.
