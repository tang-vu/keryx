# MCP package distribution

## Paid-question preflight candidate - October 8, 2026

App 0.27.32/stdio MCP 0.4.9 align new paid questions with the API's shared 2000-character
canonical bound before custody/funding. The package, lockfile and repository-owned
Registry descriptor select 0.4.9 together. The existing operational TypeScript
check now includes the stdio entry point, buyer and buyer regressions, so ordinary
CI checks their imported graph. Hosted MCP 0.3.5 and desktop 0.4.10 retain the parent
candidate's roles. This does not establish package, registry or installer publication;
packed acceptance, coordinated release and exact-source public readback remain
gates. See [scope and acceptance](engineering/mcp-question-preflight.md).

## Free bibliography candidate - October 8, 2026

Candidate app0.27.25/hosted MCP0.3.5 and stdio0.4.8 add shared paper_lookup with
a retained-catalog default, explicit provider search and keyless GET transport.
Desktop0.4.10 retains its reduced private Operator role. Public bibliography v1,
human CLI and existing research/payment adapters retain their documented roles.
Packed consumer and CI acceptance precede publication; registry/npm bytes, hosted
health and installer readback remain separate gates. See
[scope and release boundaries](engineering/free-paper-lookup.md). Earlier dated
observations below remain historical.

## Earlier dated observations

The **0.26.20 source-selection candidate** adds hosted request-local diagnostic
text on terminal `isError` results; remote protocol stays **0.3.1**. Its actual
stdio runtime graph retains all 31 canonical Git input blobs from 0.26.18, so
caller-funded package **0.4.5** needs no new npm identity. The Operator helper's
46 project inputs and renderer/bridge inputs are also unchanged. Fresh release
archives and their exact-source manifests still require separate CI/public
readback; unchanged runtime inputs do not establish artifact publication or an
installed-client upgrade. See [scope and remaining gates](engineering/source-selection-2026-10-05.md).

The 0.26.17 bounded-planning/context candidate updates hosted research and caller-only
error guidance while retaining remote MCP protocol **0.3.1**. Its changed modules are
outside the caller-funded stdio package's 31-file runtime graph. Keep accepted **0.4.5**
bytes and 0.26.15 source provenance; no new npm identity/publication is needed for this
hosted change. Verify deployed health and public package versions independently.
See [surface audit and live gates](engineering/research-planning-2026-10-05.md).

The current source selects caller-funded MCP **0.4.5**, retaining the hosted
`reasoning` contract and adding typed failure/input-limit categories and
per-original scope/status. Its exact-source archive, npm bytes/provenance,
Registry publication and installer remain separate readback gates.

October 5 public readback at `04:30:40.677Z` confirmed **0.4.4** on npm and in the
official MCP Registry's exact/latest manifest. It corrects Monthly runtime guidance
and forwards recorded reasoning metadata. Its npm bytes match the tarball in
[v0.26.12](https://github.com/tang-vu/keryx/releases/tag/v0.26.12), source
`a85bc1b6f75138ede9980d1123d5449a0da9693f`, SHA-256
`74b3e2c564b4100fc3ac9e0d170096e77999b6db16da8f180c001d3f0f5a1f77`.
The repository's manual release workflow succeeded using npm Trusted Publishing and
short-lived GitHub OIDC namespace authentication. This supersedes the earlier stale
server 0.2.0 / npm 0.1.1 catalog observation without rewriting historical packages.
Hosted remote MCP independently advances to **0.3.1** in the app **0.26.16 candidate**
to preserve zero source budgets; its exact deployed version remains a separate gate.

The caller-funded stdio package is distributed separately from the hosted remote
MCP endpoint. On October 4, 2026, public npm readback confirmed **0.4.3**, and
[GitHub v0.26.8](https://github.com/tang-vu/keryx/releases/tag/v0.26.8) supplies the
0.4.3 tarball and source manifest from `1297d43f7c1a8356ceccac061b1cba65b93d2819`.
Its SHA-256 is `61f80f78537dad116392aa08ddb7e46ac71433cc158f85a0deedeedbcc604e8d`.
npm reports integrity `sha512-XUC+4Wamxj9ahCVenlx4iB6NoB7LunXAhdTx+1hrpMQItsJVn1GKDRNiP7MdzhK7x2++MkilAqJ/eaaMBsEJjw==`
and a SLSA provenance attestation. The immutable release manifest retains
`npmRegistryPublished: false` from artifact creation; the later public npm
observation establishes subsequent publication without rewriting that manifest.
See [current deployment/distribution evidence](mainnet-status.md) and
[publishing](npm-publishing.md).

Version 0.4.3 forwards the retained hosted answer and existing structured evidence
without synthesizing independent assertions or changing the transport contract. The
qualified-excerpt hosted behavior requires an accepted hosted deployment of the repair.
Research targets/gaps are explicitly quoted and labelled; High target coverage does not
prove each assertion or complete useful synthesis. The Low/incomplete boundary, accepted
citation rewards and original paid-fetch/settlement/receipt identities are retained.
Public service maintenance remains an independent live gate; preparing a package does
not deploy, activate a network or establish live research quality. Artifact publication
can complete while runtime maintenance remains held; check verified release assets and
registry integrity/provenance readback for artifact status separately from hosted health.

After exact-source main CI succeeds, **Publish accepted MCP tarball** builds from
the release tag commit, installs the checked-in dependency closures, packs only
the bundle, README and package manifest, and checks a clean installed consumer.
The acceptance blocks live network access and uses disposable synthetic signing
credentials with mocked RPC, Circle and merchant responses. It checks keyless
initialize/tools/status without wallet creation, an actual SDK-signed synthetic
purchase, retained original response-loss state without a second debit, and
new-process keyless GET-only recovery. These are package and local recovery
checks; they do not demonstrate live settlement or mainnet readiness.

For this release target, the workflow attaches `keryx-mcp-0.4.5.tgz` and its `.source.json` manifest to the
matching web release. The manifest records the source commit, SHA-256 and
publication status at artifact creation. Assets are never overwritten.
After verifying publication for this target, use the package or release tarball as an npm install specification
in your MCP client:

```text
npx --yes --package=keryx-mcp@0.4.5 keryx-mcp
npx --yes --package=https://github.com/tang-vu/keryx/releases/download/v0.26.15/keryx-mcp-0.4.5.tgz keryx-mcp
```

Follow the wallet and funding setup in [the package README](../mcp/README.md).
Public production uses mainnet; set BOTH `KERYX_NETWORK=arc` and
`NEXT_PUBLIC_KERYX_NETWORK=arc` in the client's secure local environment.
Version 0.4.3 retains the requirement for existing owner-provisioned wallet custody,
an explicit trusted merchant policy and the documented supported Node range.
Status remains keyless; changing a registry version does not provision or recover
a wallet. Preserve existing payment journals during migration, including ambiguous
attempts; never repeat a payment to make a new package look healthy.
Do not substitute an unpublished npm version in a registry install configuration.
After npm publication, verify the public package bytes and update the registry
manifest separately. The hosted `/mcp` endpoint updates with the web deployment.
