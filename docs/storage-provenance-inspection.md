# SQLite storage provenance intake

This keyless inspector produces bounded operator intake evidence for one explicitly selected SQLite file. It does not enroll storage, accept a mode identity, prove legacy origin, or close M2. Every successful report retains `origin: unknown_legacy`, `enrollmentAuthorized: false`, and `modeIdentityAccepted: false`. Supabase inspection and enrollment remain open. See the [storage isolation design](deployment-storage-isolation.md).

Run from a trusted checkout with installed dependencies and Node.js 24, using a canonical absolute path to an existing regular SQLite file:

```powershell
node --import tsx scripts/inspect-storage-provenance.mts D:/operator-intake/synthetic.sqlite
```

Use a protected operator workspace. Synthetic acceptance is supplemented by the bounded protected-backup inspection recorded below. Do not copy private stores into the repository or publish reports automatically. The CLI never discovers a default database or reads environment files. Exit 0 means the selected intake completed, 1 means refusal, and 2 means invalid invocation. Neither success nor a matching testnet field authorizes migration or runtime startup.

## Explicit offline snapshot intake

The default invocation still refuses main files over 64 MiB. For a separately reviewed, finalized offline snapshot in a protected operator directory, explicitly select:

```bash
# Run in an explicitly privileged Linux operator context; the tool does not invoke sudo.
node --import tsx scripts/inspect-storage-provenance.mts --offline-snapshot /protected/operator-intake/reviewed-snapshot.sqlite
```

This flag is the operator's declaration of trusted offline input, not proof that the file is offline or has a known origin. The inspector does not create backups, copy a live store, checkpoint WAL, change journal modes, or establish backup provenance. Producing and reviewing a finalized rollback-journal snapshot is a separate operator backup/review operation; the inspector never creates it. A detached WAL main file is refused even if its sidecars were removed; never remove sidecars to make a live store pass.

The offline profile permits at most 512 MiB of physical main-file bytes so substantial unselected content need not prevent bounded selected-authority intake. All existing row, field, selected-byte, schema, output, and independent 10-second child deadline limits remain fixed. It reads exactly a 100-byte SQLite header to validate page geometry and finalized rollback-journal format. It checks the held descriptor and pathname for size and modification-time changes before and after scanning and refuses `-wal`, `-shm`, and `-journal` presence before opening and after closing SQLite. It does not use SQLite `immutable` mode. Filesystem timestamps and these checks cannot prove exclusive ownership or eliminate a malicious owner's swap-and-restore race.

The larger mode requires a privileged Linux operator invocation with systemd and cgroup v2. It launches only a fresh UUID-named transient system-manager service through fixed `/usr/bin/systemd-run`, with `MemoryMax=256M`, `MemorySwapMax=0`, `TasksMax=32`, `RuntimeMaxSec=10`, `KillMode=control-group`, `NoNewPrivileges=yes`, and `PrivateNetwork=yes`. There is no shell, auto-sudo, service installation, override command, environment opt-in, or production mode change. The service command uses fixed `/usr/bin/env -i` to discard the manager's inherited environment, then the canonical current Node executable, resolved tsx loader, and repository child. V8 old space is separately limited to 128 MiB. Before opening the target, the child verifies its exact `/system.slice/<captured-unit>` cgroup-v2 membership, kernel memory/swap/task limits, NoNewPrivs, and a network namespace different from PID 1. Missing or unsupported containment refuses.

The 256 MiB cgroup limit applies to charged memory, including native SQLite work and relevant page-cache/kernel charges. It is not a mathematically exact RSS ceiling: kernel accounting, reclaim, and temporary overshoot have documented caveats. This is a trusted operator tool, not protection against an adversarial root owner who can change cgroups or the reviewed code. It additionally verifies a 1 MiB suggested SQLite page cache, in-memory temporary storage, disabled cache spill and memory mapping, untrusted schema, and query-only mode. Unsupported settings refuse. A complex schema or query can therefore refuse even below 512 MiB; no temporary disk spill is enabled to make a scan pass. Managed native-memory OOM returns `native_resource_limit`, without private bytes, raw exceptions, or completed evidence.

The parent retains its independent 10-second query envelope, starting after canonical launcher path checks and process spawn. Before returning any report, it inspects, kills, stops, and resets only its captured UUID service and checks that the unit and cgroup are gone. Each fixed systemctl operation has a two-second timeout; cleanup can add up to ten seconds beyond the query envelope. Missing cleanup confirmation refuses `containment_cleanup_unavailable`. The service's own runtime limit and control-group kill provide a fallback if the parent exits; neither is a strict overall ten-second response guarantee. No unrelated service is targeted.

**SQLite heap-limit readback is not containment:** local Node 24.12.0 exposes `DEFAULT_MEMSTATUS=0`, and an independent synthetic allocation confirmed that a reported 4 KiB heap limit did not prevent a 2 MiB allocation. Stock Node's [SQLite build configuration](https://github.com/nodejs/node/blob/main/deps/sqlite/sqlite.gyp) also disables accounting. SQLite documents the [conditions under which heap limits are not enforced](https://www.sqlite.org/c3ref/hard_heap_limit64.html). The Linux profile therefore uses verified kernel containment. Windows and other platforms explicitly refuse `native_limits_unavailable` for the larger mode; their default 64 MiB inspector remains available. Local Windows validation does not establish Linux capacity acceptance.

Successful reports explicitly include `inspectionMode: offline_snapshot` while retaining `unknown_legacy`, no enrollment authorization, and no accepted mode identity. Digests still describe only bounded selected observations. Larger capacity does not establish origin, settlement authenticity, signature validity, or mainnet readiness. The CLI accepts the flag only before one target argument and rejects unknown flags, duplicates, trailing arguments, and missing targets. Programmatic callers may only lower the chosen profile's fixed ceilings; the default profile cannot use the larger ceiling or offline memory controls.

SQLite's [PRAGMA documentation](https://www.sqlite.org/pragma.html) describes the connection controls; its [file format specification](https://www.sqlite.org/fileformat.html#the_database_header) defines header page geometry. The [kernel cgroup-v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html) defines memory and swap accounting. The page cache setting is a suggested cache bound, not a native-memory or total-RSS ceiling.

### Protected backup inspection — 2026-10-01

An authorized operator restored one existing encrypted production backup into a new protected workspace on the original host. The existing restore helper verified authentication and database integrity. The bounded offline inspector then refused `foreign_authority`; it did not complete intake or emit authority evidence. Private before/after verification confirmed unchanged snapshot bytes for that operation.

A separate bounded, read-only diagnostic reproduced the first refusal at a recognized financial network field, rather than unrelated JSON metadata. It preserved the scanner's comparisons and resource limits, verified cleanup of its captured transient unit, and confirmed unchanged snapshot metadata and no sidecars. This diagnostic did not repeat the full-byte verification. No private values, identifiers, counts, digests, paths, or reports are published here.

The refusal establishes a mismatch with the inspector's fixed testnet observations. Existing withdrawal producers use both a configured network label and a canonical network identifier, so a strict string mismatch alone does not establish a different chain. The diagnostic did not disclose the stored value or determine which producer wrote it. It does not establish the stored network's identity, authentic settlement, malicious data, or backup origin. Origin remains unknown; enrollment, mode acceptance, migration, and signing resume remain unauthorized by this inspection. No live database was opened by these inspection operations.

## Evidence and scope

The inspector imports no normal adapter, `getDb`, runtime configuration, signer, SDK, or network client. It opens SQLite read-only with extensions disabled and a held read-only file descriptor, begins one read transaction, and closes it with rollback. It performs no initialization, migrations, enrollment, cache population, integrity repair, or journal activation. It never decrypts content. No plaintext content, prompts, signatures, bearer headers, wallet addresses, nonces, grant epochs, auth hashes, paths, or exception messages appear in the report.

The fixed source allowlist in [storage-provenance-scan.ts](../lib/db/storage-provenance-scan.ts) selects authority fields from payment events, browser authorization intents, retained grants and capacities, session grants, journal bindings/control, withdrawals and withdrawal requests, private research intents/payment confirmations, private creator submissions, A2A requests, and auth/session hash columns. Other tables are counted as uninspected; other columns are skipped. Missing legacy fields and empty/unknown authority envelopes remain classified as unavailable, rather than supplying invented provenance.

Bounded JSON values are parsed in private child memory, and only fixed authority envelope paths are examined: requirements, extra/domain, submission, payment/authorization, confirmation, policy, request, burn intent/spec, and bounded accepts arrays. The inspector checks recognized network, USDC token, Gateway wallet/minter, chain/domain, and integer amount fields against the repository's existing Arc testnet observations. Known foreign authority, malformed recognized authority, invalid journal activation, or session spend exceeding its cap causes refusal. This is partial intake validation: it does not verify signatures, receipts, settlement authenticity, tuple relationships, or complete application schemas. An unsupported serialized shape remains unknown; a successful report is not an attestation that all records belong to testnet or real/offline mode.

The output contains schema and selected-authority SHA-256 digests, coarse selected row/byte counts, fixed table coverage, classifications, journal activation, and WAL/shared-memory presence before and after. Digests cover bounded selected observations, not complete private payloads or all database contents. Matching digests therefore cannot certify backup integrity or authenticate the store. SQLite snapshot completion means the selected scan completed consistently, not that legacy identity is established. Preserve original nonces, epochs, caps, pending rows, and activated journals during any later separately authorized enrollment.

## Resource and filesystem boundaries

| Bound | Maximum |
| --- | ---: |
| Child deadline, including startup | 10 seconds |
| Main SQLite file | 64 MiB |
| Selected rows across tables | 20,000 |
| Selected field | 16 KiB |
| Selected value bytes across rows | 8 MiB |
| Schema objects | 512 |
| Columns per inspected table | 128 |
| Child report stdout | 64 KiB |

The explicit offline profile changes only the main-file ceiling to 512 MiB and adds the memory/filesystem controls described above. It does not increase the selected-evidence bounds in this table.

The helper accepts only lower bounds; CLI bounds are fixed. Table and column names come from trusted literals. Allowlisted views, virtual tables, and generated columns are refused before selecting authority. Schema names/DDL and selected values use size-aware SQL projections so oversized values are not returned to JavaScript before refusal. Metadata is iterated with a column limit. Unselected payload blobs are not fetched. SQLite can still read pages or perform native work internally; these are output/allocation bounds, not a precise native-memory ceiling. Main-file limits do not bound a WAL file's physical size.

Synchronous SQLite cannot be interrupted by JavaScript elapsed checks. The public [inspector](../lib/db/storage-provenance.ts) runs the cooperative internal scanner in a separate process and kills that process at the independent deadline, returning no completed evidence. Process launch/termination and event-loop scheduling can add latency; this is a query-work containment deadline, not a real-time response guarantee. The child receives explicit arguments and a minimal environment (`NODE_ENV=production`, plus Windows `SystemRoot`), with no inherited secrets, `NODE_OPTIONS`, or environment-file loader. Child stderr is discarded, and errors use fixed reason codes.

The target must be absolute, canonical, regular, and present; symlinks/junction ancestors are refused. File identity is checked against the held descriptor and checked around the SQLite snapshot. This detects ordinary replacement, but Node SQLite opens by filename, so the implementation cannot eliminate a malicious local owner's swap-and-restore race. Use a trusted owner and protected intake directory. It is not a sandbox for adversarial local filesystems. No main database is created or opened writable.

SQLite read-only WAL access can create or update coordination sidecars or their metadata, depending on platform and existing files. The report shows their presence, not contents or byte immutability. Synthetic rollback-journal tests measure unchanged main-file bytes, schema, logical rows, and absence of new sidecars. WAL tests verify committed snapshot visibility and unchanged logical payment rows; they do not claim byte immutability for WAL/shared-memory files. Native crashes, locks, unsupported schema, oversized stores, or unavailable evidence fail closed without raw exception output.

## Validation and remaining gates

Focused tests use actual SQLite files for read-only preservation, WAL snapshots, symlinks, replacement/platform file locks, foreign networks and nested authority, malformed JSON/numeric/journal values, virtual/view refusal, oversized blobs, all resource limits, independent child timeout, and sanitized CLI errors. The script receives an explicit TypeScript check because the project configuration excludes `.mts`.

```powershell
npx vitest run lib/db/storage-provenance.test.ts
npx vitest run lib/db/storage-provenance-snapshot.test.ts
npx tsc --noEmit
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions scripts/inspect-storage-provenance.mts
npx eslint lib/db/storage-provenance*.ts scripts/inspect-storage-provenance.mts
```

Reusable identity contracts, explicit legacy enrollment/provenance, application fences before initialization and authority reads, SQLite/Supabase parity, concurrency/restart/restore behavior, operator rollout, and recovery-compatible namespace migration all remain separate M2 gates. This tool does not change the current production mode or payment journals and supplies no mainnet activation mechanism.

Unit tests cover direct uncontained refusal before target open, Windows refusal, invalid headers, detached WAL headers, sidecar rejection and size/mtime changes, fixed ceilings, and exact CLI parsing. The dedicated hosted Linux job pins Node 24.10.0, matching the repository's funding acceptance jobs, and runs `scripts/test-storage-provenance-capacity.mts` under an explicit privileged invocation. It must demonstrate a synthetic 170 MiB unselected blob, default refusal, selected-authority/schema digest equivalence, unchanged main bytes and no new sidecars, retained authority/allocation/deadline refusals, an actual native-pressure OOM kill with no evidence, and cleanup of captured transient services. Failure of systemd/cgroup support fails that job rather than skipping acceptance. These synthetic checks do not authorize a production snapshot or intake.
