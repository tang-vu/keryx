# Publishing keryx-mcp

Use npm Trusted Publishing with GitHub Actions, rather than a local npm login or
a stored publish token. The public npm package is built from the committed `mcp/`
source using the root build tooling and the pinned `mcp/package-lock.json`
dependency closure. The root app is private and is never published.

The user confirmed this OIDC publishing preference on 2026-10-02.
The owner also confirmed saving the exact trusted-publisher connection that day.
Successful workflow publication and registry provenance remain the verification gate;
the account-setting confirmation alone does not establish a published package.

## One-time connection

In the `keryx-mcp` npm package settings, add a GitHub Actions trusted publisher:

| npm field | Exact value |
| --- | --- |
| Organization or user | `tang-vu` |
| Repository | `keryx` |
| Workflow filename | `publish-mcp.yml` |
| Environment | `npm` |

Choose **Allow npm publish**, then save the connection. This authorizes direct
publishing to the default `latest` tag. Saving this account setting is a manual
owner step; committing the workflow does not configure npm trust.

Create the GitHub repository environment `npm` and restrict its deployment
branches to `main`. The workflow independently refuses other refs and repos.
No `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or npm login is needed. Only the publish job
receives `id-token: write`; dependency installation and package construction run
in a separate job without OIDC publishing permission.

## Release

1. Update `mcp/package.json` and package documentation in the reviewed release PR.
2. Merge the PR and wait for successful `CI` on that exact current `main` commit.
3. Run **Publish MCP to npm** from `main`, entering the committed package version:

   ```sh
   gh workflow run publish-mcp.yml --ref main -f version=0.4.2
   ```

The manual workflow checks the current main commit and its successful push CI,
uses a GitHub-hosted runner with Node `24.21.0` and npm `11.19.0`, installs with
root `npm ci` and `npm --prefix mcp ci --ignore-scripts`, builds the MCP bundle,
checks its syntax and hermetic MCP discovery, and verifies the package name,
version, repository, and exact three-file archive contents. Before uploading,
`mcp/scripts/test-packed.mjs` installs that exact tarball into a clean consumer and
tests synthetic signing, payment-response loss, and recovery with live network
requests blocked. Dependency installation can fetch npm package bytes; synthetic
payment acceptance never sends funds. It uploads the archive plus
integrity metadata as a retained release artifact. The publish job checks its
SHA-256 checksum and publishes that exact archive with provenance, then checks
the registry version and tarball integrity. It does not rebuild during publish.

There is no automatic PR, tag, or push publication to npm. The existing
`mcp-release.yml` workflow separately provides an exact-source, acceptance-tested
GitHub release tarball and source manifest when its release and CI gates pass.
That fallback explicitly records `npmRegistryPublished: false`; a GitHub asset
does not establish successful npm OIDC authentication or registry publication.

npm versions are immutable:
for a later release, commit a new version and repeat the reviewed process. A
failed post-publish verification may still mean npm accepted the version; inspect
the registry and workflow logs before retrying. Verify the published package and
provenance before claiming MCP distribution is synchronized with the web release.

Official requirements and connection instructions:
[npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/).
