# MCP package distribution

The caller-funded stdio package is distributed separately from the hosted remote
MCP endpoint. Candidate package 0.2.0 must pass the clean packaged consumer gate
before release. The public npm package and MCP Registry pointer remain at 0.1.1
until an authenticated npm publication succeeds; a repository version bump is not
a registry publication. This development machine has no authenticated npm session.

After exact-source main CI succeeds, **Publish accepted MCP tarball** builds from
the release tag commit, installs the checked-in dependency closures, packs only
the bundle, README and package manifest, and checks initialize/tools/list in a
clean consumer. The runtime acceptance blocks network and uses a public synthetic
test scalar without creating a wallet or attempting paid research. This proves
package startup and tool inventory, not payment or mainnet readiness.

The workflow attaches `keryx-mcp-0.2.0.tgz` and its `.source.json` manifest to the
matching web release. The manifest records the source commit and SHA-256 and
explicitly records that npm publication is pending. Assets are never overwritten.
Use the verified release tarball as an npm install specification in your MCP client:

```text
npx --yes --package=https://github.com/tang-vu/keryx/releases/download/<release-tag>/keryx-mcp-0.2.0.tgz keryx-mcp
```

Replace `<release-tag>` with the release that contains those verified assets.
Follow the wallet and funding setup in [the package README](../mcp/README.md).
Do not substitute an unpublished npm version in a registry install configuration.
After npm publication, verify the public package bytes and update the registry
manifest separately. The hosted `/mcp` endpoint updates with the web deployment.
