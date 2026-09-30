# SQLite storage provenance intake

This keyless inspector produces bounded operator intake evidence for one explicitly selected SQLite file. It does not enroll storage, accept a mode identity, prove legacy origin, or close M2. Every successful report retains `origin: unknown_legacy`, `enrollmentAuthorized: false`, and `modeIdentityAccepted: false`. Supabase inspection and enrollment remain open. See the [storage isolation design](deployment-storage-isolation.md).

Run from a trusted checkout with installed dependencies and Node.js 24, using a canonical absolute path to an existing regular SQLite file:

```powershell
node --import tsx scripts/inspect-storage-provenance.mts D:/operator-intake/synthetic.sqlite
```

Use a protected operator workspace. This implementation has only been exercised against synthetic test databases; no production or private database was inspected. Do not copy private stores into the repository or publish reports automatically. The CLI never discovers a default database or reads environment files. Exit 0 means the selected intake completed, 1 means refusal, and 2 means invalid invocation. Neither success nor a matching testnet field authorizes migration or runtime startup.

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

The helper accepts only lower bounds; CLI bounds are fixed. Table and column names come from trusted literals. Allowlisted views, virtual tables, and generated columns are refused before selecting authority. Schema names/DDL and selected values use size-aware SQL projections so oversized values are not returned to JavaScript before refusal. Metadata is iterated with a column limit. Unselected payload blobs are not fetched. SQLite can still read pages or perform native work internally; these are output/allocation bounds, not a precise native-memory ceiling. Main-file limits do not bound a WAL file's physical size.

Synchronous SQLite cannot be interrupted by JavaScript elapsed checks. The public [inspector](../lib/db/storage-provenance.ts) runs the cooperative internal scanner in a separate process and kills that process at the independent deadline, returning no completed evidence. Process launch/termination and event-loop scheduling can add latency; this is a query-work containment deadline, not a real-time response guarantee. The child receives explicit arguments and a minimal environment (`NODE_ENV=production`, plus Windows `SystemRoot`), with no inherited secrets, `NODE_OPTIONS`, or environment-file loader. Child stderr is discarded, and errors use fixed reason codes.

The target must be absolute, canonical, regular, and present; symlinks/junction ancestors are refused. File identity is checked against the held descriptor and checked around the SQLite snapshot. This detects ordinary replacement, but Node SQLite opens by filename, so the implementation cannot eliminate a malicious local owner's swap-and-restore race. Use a trusted owner and protected intake directory. It is not a sandbox for adversarial local filesystems. No main database is created or opened writable.

SQLite read-only WAL access can create or update coordination sidecars or their metadata, depending on platform and existing files. The report shows their presence, not contents or byte immutability. Synthetic rollback-journal tests measure unchanged main-file bytes, schema, logical rows, and absence of new sidecars. WAL tests verify committed snapshot visibility and unchanged logical payment rows; they do not claim byte immutability for WAL/shared-memory files. Native crashes, locks, unsupported schema, oversized stores, or unavailable evidence fail closed without raw exception output.

## Validation and remaining gates

Focused tests use actual SQLite files for read-only preservation, WAL snapshots, symlinks, replacement/platform file locks, foreign networks and nested authority, malformed JSON/numeric/journal values, virtual/view refusal, oversized blobs, all resource limits, independent child timeout, and sanitized CLI errors. The script receives an explicit TypeScript check because the project configuration excludes `.mts`.

```powershell
npx vitest run lib/db/storage-provenance.test.ts
npx tsc --noEmit
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions scripts/inspect-storage-provenance.mts
npx eslint lib/db/storage-provenance*.ts scripts/inspect-storage-provenance.mts
```

Reusable identity contracts, explicit legacy enrollment/provenance, application fences before initialization and authority reads, SQLite/Supabase parity, concurrency/restart/restore behavior, operator rollout, and recovery-compatible namespace migration all remain separate M2 gates. This tool does not change the current production mode or payment journals and supplies no mainnet activation mechanism.
