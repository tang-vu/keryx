# Same-original failed-delivery fulfillment

This private recovery lane completes only the already-paid October 6 canary
original. It preserves the original `research_failed` snapshot, inbound settlement,
failed closure and every old reservation. It does not requeue that original,
submit another payment, issue a refund or count a second customer. Publication,
tests and a prepared result do not establish delivered acceptance.

The native SQLite claim is unique by original and permanent. Enrolled SQLite uses
the same native transaction and storage fences; PostgreSQL remains unsupported.
A stopped-writer, verified schema transition is required before activation. Runtime
startup must not introduce these tables into the enrolled authority automatically.

## Reviewed additive authority

Provision the fixed owner-only directory
`~/.local/share/keryx-business-canary-fulfillment` on the original host and user.
POSIX owner permissions, non-writable ancestors, no symlinks/hard links, exclusive
creation and file/directory synchronization are required. Preserve this registry
with the old registry; copying or deleting either does not renew authority.

The protected authorization file freezes the original policy, failed closure,
native failure evidence and old provider ledger hashes; execution host; clean
reviewed executor commit; exact input raw and semantic hashes; source manifest
and complete selected-body packet hash; captured official tariff body/hash and
retrieval time; and mandatory supported-target indices. The frozen target packet
is explicitly a reviewed reconstruction from the retained question, not recovery
of the lost model decomposition. Keep every requested target and source constraint.
The selected whole-body manifest admits at most two official public references;
other retained documents are not gathered or used as evidence.

The owner-reviewed five-target packet requires support for all five target indices
`[0, 1, 2, 3, 4]`. No sixth target or rewritten target packet may be introduced after
a supplier request. Unsupported specifics within a target remain explicit source
limitations; they cannot become invented network facts.

The fixed endpoint is `https://api.deepseek.com/chat/completions`, using request
alias `deepseek-v4-flash`, with redirects refused. The reviewed October 6 vendor
tariff and model alias routing must be captured and checked before live execution.
The alias may route to a newer vendor model; the requested alias alone does not
prove the exact serving model. The retained **20,660 micro-USD** reservation is a
conservative ceiling, not a provider invoice. The original model/search billing
remains unknown. The historical v1 supplier permission ended at
**2026-10-07T00:00:00Z**. Its strict format and expiry remain unchanged for retained
evidence. A later owner deadline never extends that v1 authorization.

### Explicit bounded successor window

The v2 private authorization and native authority require an explicitly supplied
`supplierWindow`: canonical UTC `approvalReceivedAt`, canonical UTC `expiresAt`
and `maximumDurationMs: 5400000`. The positive interval may be at most 90 minutes.
Its expiry must equal the authorization's top-level expiry, and permission receipt
must precede or equal authorization creation, which must precede expiry. There is
no default window, clock-derived renewal or permission created by deployment.
Freeze the actual receipt time of the applicable owner approval; build, deployment
and staging consume that window rather than restarting it.

The exact window is copied into the native authority and its canonical hash. The
claim's recorded time must fall inside that window; the native store additionally
rejects future claim times and expired live admission. The permanent unique claim
by original prevents replacing a claimed window or taking over an unfinished
execution. Historical reads validate the recorded times, allowing retained v1/v2
records and genuinely prepared results to be reviewed and completed after expiry.
They do not admit another supplier call. Live execution keeps its fresh protected
file, host, clean commit, reservation and expiry checks, including the deadline
abort signal.

This source change alone grants no supplier authority. A reviewed, deployed source,
fresh native original/ledger evidence, protected explicit owner-approved v2 tuple
and remaining execution window are required before the single execution. Changing
an environment date or a private helper cannot bypass the product schema. See
[release validation and surface boundaries](engineering/operator-fulfillment-window-2026-10-07.md).

The old one model and two searches retain **36,660 micro-USD**. The historical
unused ceiling is ten model calls and **243,260 micro-USD** combined. The additive
authorization and this executor narrow execution to exactly three
calls: sufficiency, cited-statement synthesis and independent evidence/statement
review, reserving slots 02 through 04 for a combined **98,640 micro-USD** ceiling.
Unused historical quota is not supplier permission. No search, decomposition,
source selection, new fetch, attribution, creator payment, signing, funding,
ordinary `runAgent`, retry or provider/heuristic fallback is available.

## Stage, review and complete

The private CLI is `scripts/fulfill-canary-original.mts`, run with the existing
explicit reviewed runtime environment through `node --import tsx`. It has no
public activation route or scheduler.

1. `inspect-packet --input <file> --input-sha256 <digest> --manifest <file>
   --manifest-sha256 <digest>` observes whole retained bodies and emits packet
   hashes/counts. It has no database, credential or network access.
2. Freeze and independently review the additive authorization. Positively drain
   all writers and verify the deployed commit, native authority and backups.
   `preflight --authorization <file> --sha256 <digest>` builds exact sufficiency
   and generation messages without a provider or claim. Oversize input refuses;
   requested targets are not dropped to fit a transport ceiling. The existing
   source-context selector retains exact offsets into frozen whole documents.
3. `execute --authorization <file> --sha256 <digest>` exclusively retains local
   intent and the unique native claim before any model request. Every actual
   request reserves a fixed hold and rechecks source, host, expiry and old/new
   ledgers. Dispatch rechecks its opaque capability and uses an abort signal bounded
   by the fixed deadline and revocation. The actual review packet is bounded before
   its reservation; a skipped subset of generated evidence cannot pass this lane's review gate.
4. Execution only stages `prepared-result.json`. It does not save the QueryRun,
   complete the order or release admission. The result uses the current
   `finalizeGroundedAnswer` cited-statement summary, not decision briefs or raw
   draft prose. Quotes must pass deterministic source-span gates and separate
   model statement review. Mandatory supported targets need reviewed statements;
   every target remains visible and optional unsupported requirements remain
   explicit gaps. A bounded, typed missing-parts record from sufficiency is rendered
   separately as unverified requested details, even when that target also has a
   supported sentence. Native completion binds the exact cited-summary and gap
   rendering; omitted gaps or injected draft prose refuse. All references have
   zero creator eligibility/rewards.
5. `verify-prepared` uses only the selected enrolled read-only store. Inspect the
   protected output privately for useful coverage of compatibility, supported
   flows, limitations and primary-source acceptance checks. Unsupported Arc
   specifics stay gaps; no unobserved network constant becomes a finding.
6. `complete-prepared --prepared-sha256 <exact-reviewed-raw-result-digest>` performs
   metadata only. One native transaction inserts the same-id QueryRun once and
   changes the exact failed original to completed with a distinct
   `fulfill_failed_original` resolution. It preserves the failed snapshot,
   original worker/start journal and settlement. Fresh native delivered proof
   plus readback of the committed old/new ledgers creates separate `delivered.json`.

The service receipt keeps the original accepted/start timestamps. Its execution
duration includes the original failure and the interval until the prepared result;
it is not reset to the three new model calls. Total elapsed service time and the
original completion objective remain unchanged, including an already-breached objective.

An empty, excerpt-only, malformed, unreviewed or missing-core result cannot complete
the order. Provider failure, uncertain acknowledgement, interruption or expiry keeps
the claim and all reservations; `execute` cannot run again. Only an already-prepared
immutable result may use idempotent metadata completion or read-only recovery.

The old failed marker remains unchanged. Removing old selectors alone keeps
ordinary admission held by default. A distinct, truthful delivered marker permits ordinary
admission after selector removal, while continuing to bind the raw old and additive
ledgers. Any changed/missing file fails closed. Retained filesystem observation is
not a continuous native database audit; the trusted controller must positively
drain writers and obtain fresh native proof before restoration. Privileged operator
tampering remains outside the protected-file threat model.

An expired unprepared permanent claim with fewer than three additive model holds
may instead use the explicit [interactive research isolation](engineering/failed-canary-research-isolation.md)
operation. The original stays unresolved and Operator/new paid/private admission
stays held; unrelated public interactive research retains its own existing caps
and payment authority. This operation does not retry, fulfill or refund the order.

## Surfaces and release gates

The web, desktop, CLI, API, remote/stdio MCP, extension and bots receive the same
saved original and existing response/receipt projections. Fulfillment authority,
question reconstruction and private source bodies are not added to public controls
or responses. The private CLI owns execution; ordinary surfaces remain held until
verified delivery or separately accepted expired-claim isolation. No new public
replay or paid retry route is introduced.

Synthetic tests cover permanent claims, exact hashes, expiry, bounds, failures,
visible gaps, useful reviewed statements, tampered ledgers, lost acknowledgements
and metadata-only recovery. Release still requires focused native adapter tests,
TypeScript/ops-script checks, lint, build, required CI/review, coordinated schema
transition, source-bound deployment and independent prepared-output/native proof.
Only actual same-original delivery may be reported; holds are not costs, billing
is not profit and owner-funded recovery is not independent-customer traction.

## Explicit SQLite transition

The additive tables are `a2a_failed_original_fulfillments` and
`a2a_fulfillment_completions`. Their claim/failure and completion records reject
update/delete; every table also receives the existing enrolled writer fences.
The exact generated mainnet application catalog SHA-256 values are:

- Predecessor: `ab57b1f21dbafdc286364097a762898fcef8365e6eb513a9fca3d303106f2044`.
- Current: `b18a171800ca0a366ba92c1b1a6318c43b925923d5ba03934c4dbc77d060c60c`.

These identify source-generated catalogs, excluding only enrollment/fence
objects, and grant no storage or signing authority. The native implementation is
`lib/db/a2a-fulfillment-migration.ts`; the operational command is
`scripts/mainnet-original-fulfillment-storage-migrate.mts`. It reuses the verified
backup and manifest CAS boundary of the existing economic migration. Its
`inspect` command reads only the exact admitted predecessor/current catalog.

Before migration, independently review the exact new source and deployment
helper, the protected runtime manifest and unchanged storage identity.
Positively drain public roles, private workers and all existing
scheduler/other writers under the same maintenance lease. Retain original role,
unit, environment, cadence and cap bindings. Neither this CLI nor
`--writers-stopped` discovers or drains a process. Do not invoke it from a
still-running ordinary role or bypass reviewed deployment admission.

The primary release path is the existing source-bound `npm run redeploy` with
reviewed PM2 inputs, an exact accepted `origin/main` commit and held schedulers.
The paired `KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG` and
`KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256` inputs retain their historical names.
Their root-owned `0600`, singly linked protected JSON has exactly six fields:
`format`, `manifest`, `expectedManifestDigest`, `expectedIdentityDigest`, `backup`
and `receipt`. Select `format: "keryx-redeploy-original-fulfillment-migration-v1"`;
all other values come from the protected inspection/maintenance evidence. The
legacy economic format continues to select only its existing economic migration.
Neither format accepts a caller-selected script or command.

The helper validates protected bytes and positively stopped public role definitions
before source sync. With every writer still drained, redeploy builds the exact new
source, validates stopped roles and the protected config again, then invokes the
fixed `scripts/mainnet-original-fulfillment-storage-migrate.mts` **before starting
either new public role**. No old runtime starts against the upgraded catalog.
Any migration attempt arms failure containment: retain all builds, backup/receipt
and held writers, with no automatic old-build rollback after uncertain DDL.
The operator separately verifies/drains private and scheduled writers; neither
preservation nor the public-role validator performs that work.

The direct native CLI remains available for read-only inspection and separately
reviewed controlled migration. Use these exact argument shapes with an accepted
source/runtime binding; paths and private digests come from the protected controller:

```text
node --import <reviewed-tsx-loader> <reviewed-source>/scripts/mainnet-original-fulfillment-storage-migrate.mts inspect --manifest <protected-manifest>
node --import <reviewed-tsx-loader> <reviewed-source>/scripts/mainnet-original-fulfillment-storage-migrate.mts migrate --manifest <protected-manifest> --expected-manifest <inspection-manifest-digest> --expected-identity <inspection-identity-digest> --backup <new-private-backup.sqlite> --receipt <new-private-receipt.jsonl> --writers-stopped
```

The mutation exclusively creates and flushes a backup and receipt, compares every
typed row/column (including raw text bytes and row identities), and rechecks the
source, manifest and backup under the same exclusive native DDL transaction. It
accepts only the exact predecessor/current catalog, preserves identity and every
existing row, installs both tables/fences together, and verifies the exact new
catalog, integrity and foreign keys. Receipt/readback digests do not expose row
contents, keys or private file paths in stdout.

After the receipt proves `migration-verified`, verify the protected backup,
original identity, full native history, new catalog and restored source-bound
runtime independently. The old runtime must never restart against the upgraded
catalog. On any refusal or uncertain acknowledgement keep every artifact and all
writers stopped; do not rerun with overwritten receipts, relabel provenance or
restore an older schema while new records may exist. A current-store invocation
with fresh artifacts only verifies/backs up that state and reports
`already-current`; it does not reset claims or authorize supplier execution.
