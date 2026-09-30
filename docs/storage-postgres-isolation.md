# PostgreSQL deployment identity and authority isolation

Proposed implementation design, October 1, 2026, baseline `origin/main` `c9ef864`.
This extends [deployment storage isolation](./deployment-storage-isolation.md).
No marker migration, enrollment, PostgreSQL fence or backend cutover is delivered
by this document. M2 remains open. Production data, Supabase credentials,
signers, payments and service installation are outside this investigation.

## Concrete current bypasses

The [Supabase adapter](../lib/db/supabase-adapter.ts) constructs a service-role
client directly. `init()` scans and encrypts caches before checking any storage
identity. Its methods and imported helpers mix direct table CRUD with RPC calls;
passing an initialization guard would not bind subsequent requests to that identity.

| Authority | Existing bypass of a startup-only check | Required boundary |
| --- | --- | --- |
| Login challenges/web sessions/API keys/users | Raw session/key reads and deletes; migrations 0042/0043 grant all table privileges to service_role; existing RPCs take no expected identity | Checked challenge/session/key operations; deny underlying authority-table reads and mutations to application roles |
| Source payout and paid-delivery authority | Direct `sources` upsert/select and source/cache/offer helpers | Identity-bound source/offer/cache operations, preserving source-owned payTo, verification and encrypted delivery |
| Session spend and browser authorizations | Direct session-grant reads/upsert/delete; legacy spend/admission RPCs without identity | Checked grant/admission/recovery RPCs composed with existing cap/nonce/journal controls |
| Financial evidence and reconciliation | Direct payment insert/select/update plus pending-payment RPCs; withdrawal/private research helpers | Checked exact ledger/recovery reads and transitions; independent settlement evidence rules remain |
| Private orders, treasury, creator submissions and withdrawals | Existing atomic definer RPCs restrict transitions but do not identify the deployment | Add identity to each external entry point without replacing domain locks or idempotency |

[Migration 0034](../supabase/migrations/0034_private_data_hardening.sql) grants
service-role table privileges and execute on all public functions at that point.
Later private-table migrations revoke some writes, but table reads and old
functions remain part of the inventory. Replaying a blanket historical grant
after cutover would reopen bypasses. RLS alone cannot fence service_role with
BYPASSRLS: [PostgreSQL's row-security reference](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
documents that privileged roles bypass policies. Explicit relation/function
privileges and trusted definer entry points are necessary.

[Migration 0069](../supabase/migrations/0069_browser_authorization_journal.sql)
already provides owner-private transaction writer rows, fixed search paths,
retained grant epochs, signer consumption, nonce/tuple fences and atomic journal
reads. Its general grant fence is conditional on journal activation; its payment
fence targets browser-associated rows. It is not a general deployment fence.
An enrollment must neither activate that journal nor reset its retained exposure.

## Shared identity and owner enrollment

Consume the shared pure identity validation/digest API coordinated with the
SQLite implementation; do not introduce an independent PostgreSQL identity type.
The proposed record format is `keryx-storage-identity-v1`: deployment/storage/
enrollment UUIDs, literal `eip155:5042002`, `testnet-real` or `testnet-offline`,
code-pinned profile digest, canonical ISO enrollment time and SHA-256 provenance
digest. Runtime expected identity is the **entire exact record**, including its
enrollment evidence fields. PostgreSQL JSON names/validation must match the shared
serialized contract; names below describe proposed operations, not shipped RPCs.
Coordinated helper exports are `StorageIdentity`, `validateStorageIdentity`,
`storageIdentityDigest` and `STORAGE_TESTNET_PROFILE_DIGEST` in the proposed
`lib/db/storage-identity.ts`. UUIDs are lowercase version 4; enrollment time is
exact `YYYY-MM-DDTHH:mm:ss.sssZ`; extra keys refuse. Shared digest serialization
orders fields as format, deploymentId, storageId, network, authorityMode,
profileDigest, enrollmentId, enrolledAt, provenanceDigest. Do not assume PostgreSQL
`jsonb::text` hashes the same bytes as that serialization.

An owner-managed singleton stores that record and its shared-helper digest. Give
the runtime service role only a bounded read of nonsecret identity metadata,
preferably a bootstrap read RPC. Deny insert/update/delete/truncate/references,
schema ownership, role membership, function replacement and enrollment execution
to service_role, anon and authenticated. Reject update/delete/truncate of the
marker through owner-installed immutability triggers as defense in depth; a
trusted DB owner can still alter schema, which is an explicit residual trust.
No application role owns the marker or its triggers/functions.

Legacy enrollment is a separate keyless owner tool and private evidence workflow.
Its owner transaction takes a fixed enrollment advisory lock and sufficient locks
on inventoried substantive tables, rechecks the reviewed consistent provenance
snapshot, refuses foreign/unknown unresolved authority, installs the complete
fences and inserts the marker atomically. Concurrent conflicting identities refuse;
an identical completed enrollment may acknowledge completion only after verifying
the complete fence/schema fingerprint. Marker-only success is never enrollment
success. Ordinary migrations must require expected identity first and must not
be usable by runtime credentials to bootstrap or rewrite it.

## Restricted transactional API

Every external authority operation receives mandatory `p_expected_identity jsonb`
without a default. A private helper validates its exact key set, types, canonical
representations and pinned profile, then compares **every field** to the singleton
inside that operation's transaction before any authority read or mutation. Missing
marker, missing/null/extra/malformed fields, wrong store/deployment/mode/profile/
enrollment, or failed metadata reads raise a bounded refusal. Compare canonical
enrollment timestamp text rather than accepting normalization that erases an
identity difference. Do not trust a caller-provided digest without validating the
record; no caller-settable GUC represents enrollment or authorization.

The adapter obtains expected identity from its reviewed nonsecret deployment
manifest, validates it once, checks bootstrap metadata before its existing cache
scan, and passes the unchanged complete record on **every** RPC. Identity discovery
from the target database cannot silently become the expected identity. Reject
unavailable Supabase; never fall back to SQLite after backend selection.

Use named, bounded domain RPCs rather than arbitrary table names, SQL strings or
generic execute/update JSON. Migrate direct CRUD and helper reads to those RPCs.
Preserve single-statement authority snapshots where they already exist, including
the combined intent/binding/payment result of `get_browser_journal`. Domain row
locks, exact integer allocation and reservation semantics remain required after
identity admission. Separate PostgREST preflight and table requests do not form
one transaction.

Runtime roles lose raw SELECT/INSERT/UPDATE/DELETE/TRUNCATE on authority tables,
including inherited/column grants and writable views, and lose EXECUTE on all
legacy unchecked signatures. A new overload does not revoke the old signature.
Check function ownership, schema CREATE/USAGE, sequences, role membership,
publication/event paths and default privileges in the acceptance inventory.
Keep approved public presentation projections separate: they must not expose
login/payment bearers, become payout authority, or be used as internal authority
reads. Do not accidentally remove necessary public UI data without a reviewed
replacement.

Each allowed RPC is owner-installed SECURITY DEFINER with fixed
`search_path=pg_catalog,pg_temp`, qualified application relation/function names,
validated arguments and no caller-controlled dynamic SQL. Revoke PUBLIC,
anon/authenticated EXECUTE in the same installation transaction, grant only the
explicit reviewed service-role signatures, and deny execution of private helpers.
Future object-owner default privileges must not grant new application functions
to PUBLIC. PostgreSQL's [function security guidance](https://www.postgresql.org/docs/17/sql-createfunction.html)
requires safe search paths and warns about default PUBLIC execute privileges.
The [privilege reference](https://www.postgresql.org/docs/17/ddl-priv.html) explains
why table ownership must stay outside the runtime role.

For mutation defense in depth, use a new owner-private transaction capability
relation containing transaction ID, marker identity digest and operation scope.
Only a trusted RPC, after exact identity validation, can install its capability;
triggers on inventoried authority mutations require it and independently enforce
mode/network restrictions. The service role cannot manufacture or inspect writer
rows. Remove the capability before every successful return, and let exception
rollback remove it on failure; error-catching branches must not retain capability.
Never persist a caller-controlled readiness flag or expose a capability-creation
RPC. Test calls batched in one transaction to prove a completed RPC leaves no
authority for subsequent raw SQL. Revoked raw reads, not mutation triggers, fence
authority SELECT.

Identity is a nonsecret deployment binding, not protection against a malicious
runtime credential holder who learns and deliberately supplies the target's valid
record. Trusted transport, dedicated project credentials, operator manifest and
DB-owner trust remain part of the threat model. The supported network stays
testnet-only; no runtime caller can opt into mainnet through identity JSON.

## Browser journal composition and cutover

Storage capability must not stand in for `browser_journal_writer`: journal RPCs
require exact storage identity first, then use their existing journal capability
and lifecycle checks. General storage triggers require storage capability while
0069 triggers continue to require journal capability where appropriate. Retain
original epochs, consumed signer amounts, reservation locks, immutable payment
tuples and single-use nonces. Preserve the internal-only capacity-release helper.
Audit trigger ordering only for correctness and bounded errors; security cannot
depend on a particular trigger firing before another.

Replace or wrap existing journal bodies behind private, ungranted entry points
within one transaction; legacy public signatures must lose execution privilege.
Do the same for private treasury, withdrawals, auth and source authority. Wrappers
must fail before invoking old bodies, and unwrapped bodies cannot remain publicly
executable. Activation remains an explicitly authorized operation with its own
provenance and checks; enrollment alone does not invoke `activate_browser_journal`.

Drain old workers/connections, preserve pending recovery evidence, deploy checked
callers and owner SQL fences together under the approved cutover. Rolling back to
old code must refuse under the new fences rather than restore broad privileges.
There is no acceptance stage that silently treats fenced SQLite and unchecked
Supabase as equivalent. A smaller SQLite-only delivery may keep Supabase authority
disabled until PostgreSQL has passed its independent gates.

## Available acceptance mechanism and current constraint

The existing [browser PostgreSQL harness](../scripts/test-browser-authorization-postgres.mts)
already creates synthetic roles (`service_role BYPASSRLS`), replays actual
migrations, launches disposable `postgres:17` with `--network none`, no ports or
mounts, limited memory/CPU, tests concurrent connections and cleans its container.
It fails instead of skipping when Docker is absent. Linux
[CI](../.github/workflows/ci.yml) runs that harness on `ubuntu-latest`; private
treasury and withdrawal PostgreSQL harnesses provide further patterns. A future
storage harness should reuse this isolation model and pin an approved image
digest/toolchain in reproducible CI, without loading app environment or real data.

Local availability was checked read-only on this Windows host: no `docker`,
`podman`, `psql`, `postgres`, `initdb` or `pg_ctl` command was found on PATH;
the conventional PostgreSQL/Docker/Podman Program Files directories were absent.
`wsl.exe` exists, but `--list --quiet` and `-l` returned installation/help text
rather than an available Ubuntu runtime. This bounded check establishes **no
usable isolated PostgreSQL runner found here**, not an exhaustive disk inventory.
The exact existing Windows evaluator path was also checked:
`wsl.exe -d Ubuntu -- docker info --format '{{.ServerVersion}}'` returned
installation/help output and exit status 1.
No installation, distro activation, daemon start, image pull or service change
was attempted. Real PostgreSQL acceptance therefore remains pending; SQL text
inspection, adapter mocks or an in-memory SQL approximation cannot close it.

Before implementation acceptance, run actual migrations and proposed fences
against isolated PostgreSQL with the relevant application-role privileges:

1. Wrong/missing/full-field-mismatch identity refuses each read and mutation,
   including init/cache access, auth reads, recovery reads and old signatures.
2. Raw table/column/view CRUD and TRUNCATE, forged GUCs, writer-table mutation,
   search-path/temp-object shadowing and helper execution cannot bypass admission.
3. Owner enrollment is immutable/idempotent; concurrent conflicting enrollment and
   snapshot changes fail atomically. Refusals do not change legacy rows/counters.
4. Correct identity preserves all existing browser admission, cap, epoch, nonce,
   activation, cancellation, settlement, reconciliation and withdrawal behavior;
   failed RPCs leave no capability or stranded reservation.
5. Offline stores reject signing/real settlement authority; real stores reject new
   simulated financial writers while retaining historical labelled simulations.
6. Every table/function privilege inventory is exact; default/new grants, old
   overloads, reconnects, restart/restore and unguarded stale callers are exercised.
7. Add a hermetic PostgREST/adapter contract check for signature/JSON serialization
   and refusal propagation, plus TypeScript and focused domain tests. Database-role
   SQL tests alone do not prove the HTTP adapter passes identity on every call.

Next implementation ownership must explicitly cover SQL/RPC inventory, adapter
and imported helper conversion, migration/enrollment tooling and real PostgreSQL
CI. The pure identity API/SQLite owner is separate; this document creates no
overlapping type or premature marker migration.

Integration cost is substantial: bounded textual inventory found 147 async method
declarations and 84 `.from(` calls in `supabase-adapter.ts`, plus 83 SupabaseClient/
table/RPC lines in its DB helper files. A lowercase SQL declaration search found
57 historical function declarations; that is neither a distinct-signature count
nor an exhaustive count of differently formatted SQL. Review the complete catalog
and caller ownership before implementation. Existing synthetic acceptance tests
that write directly as service_role must distinguish pre-cutover fixture setup
from post-cutover RPC access; restoring broad test-only runtime grants would mask
the intended fence. Linux CI can provide real evaluator evidence despite local
runner absence, but that evidence must actually pass before acceptance.

## Candidate implementation evidence (not acceptance)

The isolated candidate installs migrations 0070 through 0074 as one staged boundary:
canonical full identity validation and immutable enrollment, fixed named table
RPCs and legacy domain wrappers, private transaction capabilities, raw application
ACL removal and table write fences, and owner-only whole-store snapshot/CAS.
Supabase helpers now use the restricted authority client; it supplies the expected
identity on every RPC and throws HTTP/SQL refusals rather than returning empty
results. Its guarded metadata getter returns the configured frozen identity only
after marker admission. It never adopts a target identity.

The PG owner reported 43 focused source checks passing for the pure identity helper and the real Supabase
JavaScript HTTP serialization boundary using a synthetic fetch fixture. They prove
pre-init refusal, mismatch non-adoption, exact full identity in named RPC arguments,
immutable configured metadata, and SQL refusal propagation. The synthetic source fixture alone does not prove SQL
installation or PostgreSQL/PostgREST return-shape compatibility; the separate gates below provide selected real evaluator evidence.

The new `scripts/test-storage-postgres.mts` evaluator replays actual migrations
inside an isolated PostgreSQL 17 Docker container using synthetic roles and rows.
It fails when Docker is unavailable. A separate Linux CI workflow runs this
evaluator. Its authored cases cover marker absence, full identity mismatch, raw
role and unchecked RPC denial, forged GUC/temp shadowing, snapshot change, immutable
owner enrollment, cap concurrency, browser journal composition, financial profile
refusal and restart. Actual isolated PostgreSQL review-hardening CI passed on commit 723b625
([run 36771861508](https://github.com/tang-vu/keryx/actions/runs/36771861508));
the isolated PostgREST/Supabase-JS shape gate passed on 65ad6f0
([run 36772112133](https://github.com/tang-vu/keryx/actions/runs/36772112133)).
These selected synthetic gates leave the unified candidate in draft. TypeScript/legacy adapter fixtures, complete RPC semantic review, and
additional domain/crash/HTTP parity acceptance remain open. No runtime gate is
closed, no real project migration is authorized by this document, and no production
credential or private database was accessed.
