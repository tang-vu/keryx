# Explicit runtime storage candidate

This candidate implements part of the [storage isolation design](deployment-storage-isolation.md).
It does not close M2, enroll existing production data, activate mainnet, or authorize a deployment.
Supabase SQL integration, migration of legacy synthetic test fixtures, complete candidate validation,
and reviewed production provenance/cutover remain release gates.

The server requires `KERYX_STORAGE_MANIFEST`, an absolute canonical path to an existing nonsecret
regular file. Its maximum size is 8192 bytes. The file contains exactly the canonical sorted JSON
representation of `{format, identity, backend}`, optionally followed by one newline. Duplicate JSON
keys, malformed UTF-8, unknown fields, symbolic link ancestors and credential URLs refuse with fixed
errors. These checks mitigate ordinary file replacement; they do not establish a race-free filesystem
boundary against an untrusted local owner.

`format` is `keryx-storage-deployment-v1`. `identity` contains the complete separately reviewed
`StorageIdentity`: deployment/storage/enrollment UUIDs, exact testnet network, explicit
`testnet-real` or `testnet-offline` mode, code-pinned profile digest, enrollment timestamp and
provenance-document digest. No field is inferred from a key, LLM provider, `NODE_ENV`, database marker,
or `KERYX_FORCE_OFFLINE`. Never fill these fields by labeling an existing funded or unknown legacy store.

The backend is exactly one of:

- `{kind:"sqlite", databasePath:"<absolute canonical existing enrolled file>"}`. A supplied
  `KERYX_SQLITE_PATH` must exactly match. Normal startup never creates or enrolls a missing file.
- `{kind:"supabase", url:"https://<selected-project-origin>"}`. The URL contains no credentials,
  path, query or fragment. Runtime `NEXT_PUBLIC_SUPABASE_URL` must exactly match and the selected
  service credential must be present. Partial credentials never choose SQLite as a fallback.

The runtime resolver pins the complete manifest and its path for its module/process lifetime and
revalidates configuration and SQLite target existence before subsequent factory/cache/authority use.
Replacement by another valid manifest refuses; drain and stop the process before any reviewed
configuration change, then restart. A separately injected verified adapter must expose its guarded
identity and match the complete pinned identity before gateway or private bootstrap authority is selected.
Same-mode foreign stores are refused. Real mode with forced offline refuses. Real treasury operations
without a signer refuse; an authorized browser co-sign operation may remain available without that
treasury key. Cache encryption follows checked storage mode and requires its own content key in real mode.
Retained gateway handles recheck the full binding on each public operation and address/mode access;
factory-created gateways also check near signing and submission/funding boundaries. These checks do
not cancel an already-started SDK call or retract a signature/broadcast. Operator rollout still requires
draining active payment operations before changing configuration or stopping the process.

`inspectStorageDeploymentManifest` has a narrower, keyless artifact role: it validates an explicit
expected manifest and available SQLite ancestors even if the original source has been lost. It does
not accept, open, enroll or activate that source, require runtime signing credentials, or authorize
offline simulation. The runtime resolver still requires the existing enrolled target.

`npm run build` explicitly provisions a fresh synthetic offline fixture and uses it for Next static
generation. The child process receives selected public OS/build settings, empty known secret variables,
disabled payment/worker features and the fixture manifest/path/mode. Installed Next dotenv loading
cannot replace already-defined masked values. The fixture is removed after the child exits. Build
does not initialize or migrate selected production storage. Deployment storage admission must be
validated separately, read-only, before starting production authority.

Application SQLite requires Node **24.10.0 or newer** for `node:sqlite` authorizer support; missing native
capabilities refuse. CI already selects Node 24. Root's keyless `node --version` observation on
2026-10-01 reported production Node v24.16.0. This is runtime compatibility evidence, not cutover approval.

Application backup uses a distinct verified read-only snapshot capability, never generic SQL `ATTACH`
or `VACUUM INTO`. The source must match the runtime manifest. Exact identity/fences/integrity and
snapshot lineage are verified before packaging.
The verified helper currently limits the database file to **64 MiB**, with additional bounded row and
field scans; this is stricter than the older packaging ceiling of 256 MiB. Operators must plan for
bounded refusal rather than assume a 256 MiB application store is accepted.
A helper failure retains an uncertain protected copy and creates `snapshot-review-required.json`;
subsequent snapshot names are blocked until operator
inspection. No automatic retry or signing resumption is authorized. Successful local snapshots keep a
local-only `.lineage.json` sidecar; encryption/R2 upload does not carry that sidecar as authenticated
remote lineage. Restore instead authenticates the encrypted input, retains a quarantine copy, verifies
its exact expected identity, and produces a separate fresh verified SQLite copy with new lineage.
The restore receipt always sets `signingResumeAuthorized:false`; it does not adopt the output as runtime
storage or grant authority to a clone. Distinct withdrawal/browser/Operator journals retain their own
existing namespace policies and are not automatically enrolled as application stores.

Fresh real withdrawal-drill application storage requires an explicit reviewed expected manifest
targeting that exact new store and real-testnet identity. The script never invents provenance or adopts
a stored identity. No real drill, private database read, enrollment, funding or deployment was performed
for this candidate.

Focused evidence includes canonical manifest/parser refusals, changed-manifest lifecycle refusals,
actual same-mode and cross-mode foreign SQLite adapter binding, no-key real treasury refusal, synthetic
withdrawal-original recovery, isolated Next dotenv masking, actual separate-process encrypted
backup/restore, and an actual native-copy lost-acknowledgment regression. The migrated 2500-row archive
benchmark produced equal 50-entry digests: sampled streaming heap 44,558,240 bytes versus bulk
241,441,912 bytes. These are selected synthetic checks, not complete release acceptance.
