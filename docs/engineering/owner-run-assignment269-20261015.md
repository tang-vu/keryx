# Original269: bounded source implementation, OPEN

Base: `62981a66d313a4adfe6925b6b96cdfe649a3a136`. This is source and disposable
synthetic fixture authoring only. No test, module, compiler, browser, database,
Git writer, target DDL, live consent, assignment or production action was executed.
No original269 criterion, production rail or supported-consumer gate is accepted.

The short implementation plan follows accepted R47: exact finite proposal,
independent interactive recipient consent, separate local owner apply, atomic
operation receipt, revocable attribution, negative decisions after suppression,
and compensating undo. Threat boundaries are forged selectors/owner names,
stale account/member/credential/session generations, cross-original/network
substitution, immutable-ticket races, partial batches/audit, unknown commit
outcomes, and stale private/public consumer authority. Payment, session/auth,
claim, ownership and #497 history bodies are preserved.

## Implemented source

The new domain owns contracts, digesting, two fixed metadata tables, native
transaction journal, recipient HTTP boundary, inbox/profile-count/JSON
projection, English direct typed namespace, OpenAPI, CLI and synthetic tests.
The only facade attachment is hidden and frozen and exposes recipient methods;
it does not expose owner methods. No general admin HTTP endpoint is added.

Recipient identity is the **current durable account plus exact member generation**,
with account creation binding, active credential generation and exact durable
interactive session checked again under the transaction after lock waits. Wallet,
profile/handle/provider name, API key and payer are not identity or consent proof.
Editable private-profile metadata is not repurposed as a generation mechanism.
The profile-deletion/recreation semantics still need the account/profile owner's
review before rollout; this slice does not claim a person identity or a new
private-profile deletion fence.

Consent records the exact manifest and acknowledgement using the genuine session
transaction; the owner cannot submit a verified boolean or detached sentence.
One immutable event per request stores the full closed input, stable actor,
credential lineage, consent reference/time/scope, complete ordered prior member
states, original bindings, committed result receipt and storage time, <=64KiB.
No token, proof body, provider ID, question or answer is written to this audit.
Consent invalidation and all affected current associations terminalize in the
same transaction. Consent expiry is read suppression only and releases no
occupancy. Reject/withdraw remain available through minimal assignment metadata
for a current same-generation recipient after suppression.

The first slice bounds each operation and each recipient's retained nonterminal
inbox to 25 assignments; the proposal is <=16KiB. Body envelopes must also fit
16KiB and a five-second streamed-body deadline. IDs are fixed in the proposal;
members are unique and strictly sorted by run ID. Fresh apply/confirm require
unexpired positive consent. Confirm keeps owner-assignment origin and both dates;
it never creates an anonymous ticket. After the final route await, a synchronous
native transaction rechecks and serializes the response. There is no authority
cache or read-side mutation.

Original eligibility is ownerless, public/unlisted, non-erased, no browser funding,
private fulfillment, A2A ownership or anonymous ticket, exact stored TEXT-byte
digest/date, selected storage identity, and independently retained payment-row
network evidence. Missing/mixed historical network evidence refuses. Existing
testnet originals are not relabelled mainnet. Native selected policy currently
supports mainnet only; archive/testnet acceptance remains open, rather than using
an ordinary fallback or fake native authority. Financial rows, original JSON,
payTo, payer/payee, caps, nonces and rewards are never assignment write targets.

## Usable source call paths and undo

`/me/run-assignments` links from one wallet-menu entry. It fetches the qualified
inbox, accepts an exact pasted proposal for explicit consent, and offers confirm,
reject or withdraw. It aborts/invalidate responses on auth/focus changes and
retains unresolved in-flight request JSON for explicit same-ID resolution.
Copy that JSON before leaving the page: it is not a durable recovery journal.
GET/POST require a genuine cookie session and comparison-only expected wallet;
POST additionally requires exact configured Origin, closed expected-recipient
and action objects. Authorization-header presence is rejected. Supplied read
Origin and Sec-Fetch-Site are checked. No owner writer is reachable here.

The separate private inbox JSON carries `kind: owner-assignment-inbox`, with
`assigned-by-owner` and `claimed-from-owner-assignment` attribution. UI labels are
**Assigned by owner — awaiting confirmation** and **Claimed — originally assigned
by owner**. Separate profile counts describe only these associations. Existing
strict ownership v1, owned-page v2, #497 seal, public profile, public exports and
private profile activity are untouched and do not accept this new authority.
No private-content, erasure, publication or funding privilege is granted.

The local command is `node --import tsx scripts/owner-run-assignment.mts` from
this source root. Its default is `stage`, requiring explicit `--storage-manifest`,
`--identity-digest` and `--input` canonical JSON files. It loads no ambient ENV or
getDb and installs no target DDL. Native source-profile helpers retain their
existing isolated reference-schema construction; target staging is readonly.
`--consent-id` optionally verifies the separately recorded genuine consent.

All local owner operations require actual POSIX real/effective uid 0. Windows
owner execution is intentionally unavailable pending an independently reviewed
OS-authority port; entering a username cannot authorize it. `review-operation
--input <operation.json>` returns the complete operation digest without opening
storage. Explicit `apply`, `undo` or `cleanup` additionally require
`--approve-operation-digest <that digest>` and the same selected storage pins.
The private WeakMap capability only exists in that exact script invocation;
no new key, model, daemon, auth/config override or financial authority is added.
The root-OS-owner convention needs parent peer acceptance, not new credentials.

Undo is a new `undo` operation with new request ID, original `applyId`, and the
**complete original member set**, in manifest order, with expected current
revisions. Any stale/terminal member refuses the whole undo. All rows become
revoked and one causally linked receipt commits; old events/originals are retained.
`cleanup` additionally proves pending expiry or invalidated consent/member lineage
under lock and cannot expire a still-valid pending association. There is no timer.

After response loss, retain original request bytes/ID. `receipt` with the full
same operation, approved digest and explicit storage pins opens readonly and
returns an independently owner-authorized historical receipt or authoritative
absence. An unavailable lookup remains unresolved. Only an explicitly authorized
same-ID invocation may retry after authoritative absence; never replace the ID.
Exact replay after undo returns the old historical apply result without restoring
association. Neither historical receipts nor digest knowledge grant current access.

## Exact remaining cross-owner seams

1. **Shared occupancy is required.** Existing #262 issue/claim and original/A2A
   writers do not inspect assignment occupancy. Fresh apply therefore refuses
   `assignment_arbitration_unavailable`. Fixed, UNINSTALLED proposal text is in
   `lib/owner-run-assignments/occupancy-proposal.ts`: one ticket INSERT guard,
   original INSERT/UPDATE/DELETE guards, and A2A INSERT/UPDATE guards. Installation
   touches occupied relations, so only an output patch proposes its inclusion in
   the fixed metadata installer. Parent must allocate that additive partition,
   review original-owner interactions and run actual two-connection #262 races.
2. **#267 current native family bound.** `lib/accounts/sqlite-store.ts:145` uses
   `LIMIT 20`. The new complete fixed family has 22 tables. Parent must allocate
   the single source-derived bound correction, without changing account/auth or
   #497 journal bodies. Until then enrolled facade construction of the new bundle
   cannot be accepted. The original account factory is unchanged here.
3. **Migration references/tests.** `lib/db/topic-watches-storage-migration.ts`
   admits only the historical19-to-watch20 expansion, and
   `lib/db/native-metadata-migration.test.ts` asserts that family. They must remain
   historically correct; #269 needs its own separately claimed migration/reference
   and exact 20-to-22 acceptance, including full retained-data/fence preservation.
   No existing migration body, RPC or unclaimed migration was written. Max-four
   runtime source profiles and fixed5000/native fences remain unchanged.
4. **Existing consumers and deletion semantics.** Parent must allocate explicit
   new-version adapters to `lib/run-claims/history.ts`, both ownership-history
   adapters, `lib/history/owned-history*`, private/public profile consumers and
   privacy/export paths only if those surfaces are to accept assignment authority.
   Preserve the first genuine owner proof and #497's last-await synchronous seal;
   never cast assignment to claims.read. Public association needs separate
   publication consent. Account/profile deletion and any external consent writer
   require coordinated revocation/audit transactions before that consumer rollout.

Supabase has no new paired RPC/migration/port; absence returns 503, with no native
or ordinary fallback and no fabricated paired PASS. Web and hosted desktop share
the new private page only when the genuine native port is available. Desktop
local, CLI/MCP ordinary history readers, extension, bots/A2A/chat gain no assignment,
consent or payment authority. Their existing reads remain unchanged. Parent owns
cross-surface acceptance, actual Google/Circle user flow, archive/testnet and
mainnet original gates, separate peer review, focused checks, required PR CI,
serialized merge and batched release. Original269 remains **OPEN**.

## Meaningful UNRUN selection

New native test file exercises real disposable selected connections: transactional
consent/exact replay/changed second member, imported-attribution confirmation,
suppressed rejection, atomic multi-row consent withdrawal, last-member revision
failure rolling back earlier rows/audit/consent, revoked/replaced sessions,
readonly denial, cross-network and forged-owner refusal. Snapshots independently
compare originals and economic rows. Imported rows are explicitly fixture history,
not owner-apply acceptance. HTTP tests cover closed ingress and body bounds.

After the additive partitions are accepted, parent should execute these tests,
focused TypeScript/routing build checks, genuine live-session and lock-wait races,
actual full-batch apply/undo and changed-request controls using real local owner
authorization, dropped-COMMIT-response/lookup controls, immutable-ticket races,
native 5/6 vs permanent retirement, profile deletion and last-await races, current
source canonical acceptance, existing affected domain tests and required CI.
Every case is **UNRUN** here; no test, type, build, browser or paired storage PASS
is asserted. No commit, PR, issue closure, live assignment or deployment occurs.
