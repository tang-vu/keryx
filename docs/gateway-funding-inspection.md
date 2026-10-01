# Read-only Gateway funding inspection

This staged Operator tool inspects an already installed SQLite `testnet-real`
funding operation. It does not enroll storage, create a database, load keys,
reserve funds, sign, broadcast, resume signing, or change protected receipt facts.
Deployment and funded migration acceptance remain open; this document does not
authorize inspecting private production data or cutting over production.

Run from the repository with existing, reviewed, absolute canonical file paths:

```powershell
npm run funding:inspect -- --storage-manifest "D:/reviewed/storage.json" --operation-manifest "D:/reviewed/funding-operation.json"
```

The default performs no network requests. Add `--current-availability` to request
current Circle testnet availability after validating a protected successful
original deposit. There is no endpoint override, implicit manifest discovery,
runtime bootstrap, or environment-file loading. Duplicate flags and positional
arguments are rejected. These example paths are placeholders, not generated
manifests or enrollment instructions.

The operation file is a canonical JSON `keryx-funding-operation-locator-v1`
object containing `format`, `storageManifestDigest`, `identityDigest`,
`operationId`, `installedPolicyDigest`, `backendBindingDigest`, and
`finalityPolicyDigest`. Digests are 64 lowercase hexadecimal characters;
`operationId` is UUIDv4. The storage manifest digest hashes the canonical parsed
deployment object, and the identity digest binds its full storage identity.
Both files must be canonical UTF-8 JSON, with at most one final newline and
8 KiB per file. The locator selects an installed operation; it grants no
provenance, enrollment, signing, or spending authority. Obtain its values from
the reviewed installation record rather than guessing or rewriting history.

Successful output is bounded JSON with format
`keryx-funding-inspection-report-v1`, `readOnly: true`, and
`signingResumeAuthorized: false`. It reports original reservation states,
retained exposure, role caps, and nonce barriers. It omits raw transactions,
transaction hashes, addresses, private paths, keys, and authorization digests.
The tool loads the complete installed snapshot twice and refuses publication
if the operation, namespaces, or original slots changed during inspection.

Availability is `not-requested`, `unknown`, or
`observed-available-meets-minimum`. The last state requires fresh opaque
readiness evidence and reports the observed available and required minimum
micro-USDC amounts. An outage or unavailable evidence remains unknown. A
current available balance is not attributed deposit credit, settled creator
revenue, future solvency, or permission to sign or spend. Inspection does not
refund caps, replace originals, or reopen uncertain payment attempts.

The helper enforces a native monotonic 20-second budget around guards and
asynchronous work. The supported CLI runs it in a child with a 30-second total
envelope and bounded 8 KiB input/output. Its 128 MiB V8 heap setting does not
bound native SQLite RSS. Failure prints a fixed redacted message and exits
nonzero. Read-only SQLite access may use WAL coordination sidecars; it does
not imply filesystem immutability. Trusted local filesystem and host identity
assumptions still apply. A copied or restored database is not automatically
adopted or authorized by this command.

Local acceptance includes 13 native cases, project TypeScript, strict script
TypeScript, and scoped lint. The pinned Node 24.10.0 workflow checks Linux and
Windows; exact-head CI must pass before accepting the candidate. These checks
are synthetic installed-operation evidence, not a funded production inspection,
mainnet approval, external audit, or completed migration.
