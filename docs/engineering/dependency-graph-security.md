# Security of locked dependency graphs

The production dependency gate covers the application production graph. A broader
audit found high advisories in development dependencies and the separate Worker
tool graphs, plus URI/IP parser advisories in the repository MCP lock. Those
graphs must be checked separately; a green production-only audit does not cover
every package in the repository.

This change keeps existing direct dependency versions, Hardhat 2, SDK versions,
compiler settings, deployed Worker code/configuration and package/release versions. Exact
overrides and regenerated locks select the patched dependencies:

| Graph | Resolution |
| --- | --- |
| Application development tools | Undici 5 consumers use 6.29.1; adm-zip 0.6.1; serialize-javascript 7.1.3; tmp 0.2.7 |
| Repository MCP | fast-uri 3.1.9; ip-address 10.7.4 |
| Monitor toolchain | Undici 7.30.1 |
| Source-upkeep toolchain | Undici 7.30.1; Zod 4.6.7 |

The transitive Undici and serializer changes cross major versions. Lock
resolution alone cannot establish compatibility. Existing contract tests,
Hardhat/verification HTTP clients, ZIP extraction, temporary-file cleanup,
serialization, MCP builds/consumers and Worker builds/runtime checks remain
required. The existing reviewed Zod compatibility backport still applies to
application/MCP libraries; the upkeep configuration keeps its native Zod 4 API.
The MCP development graph also declares the existing root TypeScript 5.9.3
compiler. Without that explicit optional peer, TypeScript assigns the same Viem
version different package identities across the two installed graphs. Operational
types must pass with both graphs present; no signer cast or type exclusion is used.

Patch sources include the maintainers' [Undici response-crash advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c),
[Zod collection-bound fix](https://github.com/colinhacks/zod/pull/6652),
[fast-uri encoded-scheme advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg),
[ip-address zone-suffix advisory](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-rxp7-6hxx-x8q5),
and [tmp type-confusion follow-up](https://github.com/raszi/node-tmp/security/advisories/GHSA-7c78-jf6q-g5cm).
The first temporary resolution selected tmp 0.2.6, whose follow-up advisory was
still high; the final candidate uses 0.2.7. No force-fix or unreviewed Hardhat/SDK
major migration is used.

## Repeatable coverage

The existing production high-severity gate remains. The full checks lane also
installs the three affected subgraphs with lifecycle scripts disabled, applies
the existing trusted validation backport, runs behavior/failure-path controls,
then audits all six repository lockfiles, including development dependencies.
The metadata command is:

```sh
node scripts/audit-dependency-graphs.mjs --npm-cli /absolute/path/to/npm/bin/npm-cli.js --out /audit/output
```

It uses pinned npm 11.19.0, two bounded child processes, manifest-only copies,
empty npm credential configuration and the public npm registry. It installs or
fixes nothing. Original JSON/stderr and source input hashes are retained under a
unique output run. Malformed/missing reports, unknown counts, changed inputs,
network/CLI failures and any high/critical finding refuse acceptance. Low and
moderate counts stay visible. CI retains the audit originals even on failure.

The prototype root graph still reports low/moderate findings, including
production-marked dependency chains. They are not all development-only, and a
lockfile flag does not prove exploit reachability. Some proposed upstream fixes
would change Circle/wallet SDK or tooling majors. Preserve custody, signing,
receipt, registry and private-data gates while assessing those paths; this change
does not claim that every known or unknown vulnerability has been removed.

Repository MCP overrides and locks describe this repository's tested graph.
External package consumers resolve and retain their own graph; the packed
consumer check must inspect its actual installed dependencies. No existing
consumer lock is silently rewritten and no new package version is published by
this source change.
The clean-consumer check verifies every installed URI/IP parser against its
patched version floor and exercises encoded-scheme refusal and bounded IPv6
rejection using those installed copies. Existing signing, response-loss and
keyless recovery assertions still run against the actual packed executable.

All local installs/builds use private canonical `.local` directories. In the local
source-upkeep check, CF correctly refused a junction as portable build output.
The unchanged inputs are therefore built in an ordinary staged directory and
the unchanged workerd test reads that accepted bundle. The portability check is
not disabled. Hosted CI builds in its own ordinary checkout.
Likewise, npm correctly omitted a junction-backed `dist` from the first local
archive, and the consumer refused its missing provenance file. The local package
check therefore stages byte-identical qualified executable, provenance and
package files in an ordinary directory before packing. Hosted CI uses its
ordinary build directory. The first failed archive and log are retained locally.

Deployment, product/package publication, a new schedule, funding or budget
renewal, and resuming the paused infrastructure migration remain outside this
source increment. Required full PR/domain/native and exact-main checks, source
review and serialized merge remain before source acceptance.
