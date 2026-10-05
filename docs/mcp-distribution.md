# MCP package distribution

The 0.4.5 candidate retains the single hosted `reasoning` contract and remote
protocol 0.3.0 from v0.26.12, adding typed failure/input-limit categories and
per-original scope/status. It uses a distinct package identity from 0.4.4.
Verify exact-source archive, npm bytes/provenance and installer separately.

The October 5 v0.26.12 correction selected package 0.4.4 and added manual official
MCP Registry publication with short-lived GitHub OIDC. The then-observed registry
server0.2.0 pointed to npm0.1.1; that dated inventory is independent of npm/GitHub.
The current source manifest selects0.4.5. Registry publication/readback remain
separate gates after its exact npm bytes are verified.

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
npx --yes --package=https://github.com/tang-vu/keryx/releases/download/v0.26.13/keryx-mcp-0.4.5.tgz keryx-mcp
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
