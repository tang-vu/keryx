# Synthetic paused storage rollout rehearsal

This dependent candidate targets the identity-aware source baseline `0c52b0f` (PR #70).
It exercises a narrow SQLite operator evidence lane from the
[storage isolation design](deployment-storage-isolation.md) and
[runtime manifest candidate](runtime-storage-manifest.md). It does not close M2,
authorize production enrollment/cutover, establish funded recovery, or enable mainnet.

Run with Node >=24.10 and the locked dependencies installed:

```sh
node --import tsx --no-warnings scripts/storage-rollout-rehearsal.mts
npx vitest run scripts/storage-rollout-rehearsal.test.ts
```

The CLI accepts no store, manifest, identity, environment-file or other argument. It creates and
removes only its own random synthetic temporary directory. It uses actual SQLite, actual child
processes, the bounded reviewed enrollment/backup helpers, and the identity-verified read-only
connection. No global runtime configuration resolver, adapter initialization, cache decryption, signer, wallet,
network request, service deployment or private database is needed. Child environments contain only
public process settings; neither dotenv nor arbitrary inherited credentials/loaders are loaded.
The internal child additionally requires the explicitly synthetic directory marker and fixed fixture
filenames. These are trusted-host safeguards, not an untrusted-local-owner security boundary.

The successful lane performs this sequence:

1. Create representative legacy application tables with one explicit simulated payment,
   one metadata counter and an inactive browser journal. Grants, login nonces and financial
   authority tables are empty. These are fixed synthetic fixtures, not a full application migration.
2. Start an actual legacy writer which holds an uncommitted counter increment. Send a drain
   command, require its commit/connection-close acknowledgment, observe exit code zero, and
   verify the committed increment before any enrollment. A configuration flag is insufficient.
3. Inspect the complete bounded fixture snapshot keylessly. Explicitly acknowledge only its
   synthetic metadata/simulation classes against the same inspection and expected identity.
   Enroll that eligible legacy fixture; do not infer an identity from its stored rows.
4. Verify unchanged original fixture rows. Create a native verified snapshot containing the same
   immutable identity/fences and original row state. Its receipt never permits signing resumption.
5. Start and exit an admitted read-only candidate child, then start and exit another child with the
   same complete expected identity and selected code digest. Admission and signing remain closed.
   Verify unchanged state, wrong-identity refusal, and unfenced raw-writer refusal.
6. In a separate intentionally ineligible legacy fixture, retain a synthetic original login nonce,
   positive grant cap/spend/epoch and active journal. Inspection reports unresolved authority
   provenance and enrollment refuses even with a supplied attestation. Verify exact original
   selected rows and measured main-file bytes remain unchanged.

The rollback label is **same pinned identity-aware read-only process restart**. The selected code
digest covers the child and identity/manifest/connection/fence modules; it is not a full reproducible
application artifact. There is no released identity-aware predecessor to roll back to. Neither child
starts Next.js or a payment service. This rehearsal therefore does not demonstrate a real writable
adapter startup, production admission controls, signer readiness, predecessor compatibility,
historical funded enrollment, or preservation across a successful funded migration.

The report contains only fixed classifications, aggregates, booleans, selected-code digest and
durations. No target path, UUID, epoch, nonce, cap value, payment payload or exception is printed.
The original-row digest is fixture-only and never an enrollment/CAS proof; enrollment uses the
separate full bounded helper inspection. Main-file byte preservation is measured only in the refused
legacy lane; no blanket WAL/shm or byte-immutable claim is made. Individual child processes have
10-second kill deadlines; enrollment and backup retain their separate 15-second helper deadlines.
The generated fixture rows are bounded to 16 per table and 16 KiB encoded per table. This is not a
general inspector for arbitrary external stores.

Tests also leave admission/signing paused when an old writer never acknowledges drain or when
startup presents another full identity. They verify retained original state and marker without UUID
adoption, marker reset, unfenced repair or automatic signing recovery. Production provenance,
operator-reviewed drain/cutover, separate journals, complete application/recovery validation,
external review and durable funding reconciliation remain open gates.

The drained legacy writer is the controlled synthetic fixture process, not a historical production
application binary. Full writer inventory and production admission/drain coordination remain open.
