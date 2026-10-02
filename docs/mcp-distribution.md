# MCP package distribution

The caller-funded stdio package is distributed separately from the hosted remote
MCP endpoint. Candidate package 0.4.1 must pass the clean packaged consumer gate
before release. The documented October 2 npm version observation was 0.3.2; it
does not establish the candidate's publication or MCP Registry pointer. New npm
integrity/provenance and registry readback remain gates. Publication uses the
owner-configured OIDC trusted publisher; a repository version bump is not release
evidence. See [publishing](npm-publishing.md).

After exact-source main CI succeeds, **Publish accepted MCP tarball** builds from
the release tag commit, installs the checked-in dependency closures, packs only
the bundle, README and package manifest, and checks a clean installed consumer.
The acceptance blocks live network access and uses disposable synthetic signing
credentials with mocked RPC, Circle and merchant responses. It checks keyless
initialize/tools/status without wallet creation, an actual SDK-signed synthetic
purchase, retained original response-loss state without a second debit, and
new-process keyless GET-only recovery. These are package and local recovery
checks; they do not demonstrate live settlement or mainnet readiness.

The workflow attaches `keryx-mcp-0.4.1.tgz` and its `.source.json` manifest to the
matching web release. The manifest records the source commit and SHA-256 and
explicitly records that npm publication is pending. Assets are never overwritten.
Use the verified release tarball as an npm install specification in your MCP client:

```text
npx --yes --package=https://github.com/tang-vu/keryx/releases/download/<release-tag>/keryx-mcp-0.4.1.tgz keryx-mcp
```

Replace `<release-tag>` with the release that contains those verified assets.
Follow the wallet and funding setup in [the package README](../mcp/README.md).
Version 0.4.1 retains the requirement for existing owner-provisioned wallet custody,
an explicit trusted merchant policy and the documented supported Node range.
Status remains keyless; changing a registry version does not provision or recover
a wallet. Preserve existing payment journals during migration, including ambiguous
attempts; never repeat a payment to make a new package look healthy.
Do not substitute an unpublished npm version in a registry install configuration.
After npm publication, verify the public package bytes and update the registry
manifest separately. The hosted `/mcp` endpoint updates with the web deployment.
