# Contributing to Keryx

Keryx is a research agent with cited reports, visible source decisions and USDC
creator rewards. Public production uses Arc mainnet. Local testnet and offline
fixtures are separate environments; keep their labels and payment evidence intact.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use the
[issue chooser](https://github.com/tang-vu/keryx/issues/new/choose) for bugs,
accessibility barriers and feature requests. Report vulnerabilities privately
under the [security policy](SECURITY.md); use [support](SUPPORT.md) for account or
installation help. English and Vietnamese reports are welcome.

The repository does not currently have a repository-wide license. Read the
[licensing scope](docs/licensing.md) before reusing code or contributing material.

## Change workflow

1. Search existing issues and pull requests, then create a focused branch for one
   logically complete update. Explain larger changes in an issue before investing
   substantial work. See the [architecture decisions](DECISIONS.md) for context.
2. Implement the change with proportionate tests and accurate documentation or
   changelog notes. Keep builds and checks reproducible.
3. Commit with a descriptive conventional subject, such as
   `feat(operator): add read-only task inspection` or
   `fix(buyer): preserve pending recovery state`, and push the branch.
4. Open a pull request. Explain the concrete problem, resulting behavior,
   relevant validation, limitations and rollback considerations. Link the
   applicable decision or gate when changing authority or payment behavior.
5. Maintainers review the completed outcome and require successful applicable CI
   before merging. Follow the [validation and release workflow](docs/development-workflow.md).
   Maintainers coordinate deployment separately; merging a PR is not proof that a
   server, package or installed app has been updated.

When sharing a checkout with another development session, follow the
[session coordination workflow](docs/engineering/multi-session-coordination.md).
Use an isolated worktree and claim paths and mutable resources before editing.

## Local checks

Use **Node.js 24.22.1** and **npm 11.19.0**, matching CI. Other admitted Node
versions are defined in [package.json](package.json); older versions with known
security issues are not suitable. Install the locked graph with `npm ci`.
On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

For local development, copy [.env.example](.env.example) to the ignored
`.env.local`. Use a fresh isolated environment, set both `KERYX_NETWORK` and
`NEXT_PUBLIC_KERYX_NETWORK` to `arcTestnet`, and set `KERYX_FORCE_OFFLINE=1` for
spending-free fixtures. Leave provider credentials, wallet secrets and shared
Supabase credentials unset. Do not reuse production storage or custody. Inspect
the actual environment before running a command; some operational scripts load
environment files explicitly. `npm run dev` starts the web development server on
port 3939; concurrent sessions need their own ports and mutable output directories.

Start with focused checks for the changed behavior. The usual commands are:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run typecheck` checks both application and operational-script TypeScript.
Routing, server/client boundaries, configuration and dependency changes need a
production build. Payment, authentication, storage, contracts and shared interfaces
need failure-path tests and source review. Contract changes also need
`npm run test:contracts`. The [Rust engine candidate](./docs/rust-engine-migration.md)
has its own native and differential commands and an Ubuntu/Windows CI gate.
Run applicable checks once for the current source and inputs; repeat after
relevant changes or failures. Hosted required checks remain mandatory.

For UI changes, follow the [accessibility statement](ACCESSIBILITY.md): check
keyboard access and focus, accessible names, responsive layout and relevant
assistive technology. Describe what was actually tested and any remaining gaps.
When a public request, result or export changes, review web, Windows desktop,
CLI, API, remote/stdio MCP, extension and bot adapters within their documented roles.

Do not commit environment files, keys, private task or payment data, generated
artifacts, or unrelated worktree changes. Never fabricate settlement evidence;
label synthetic, pending and unknown states honestly. Preserve source-owned payees,
integer micro-USDC accounting, spend caps, single-use authorizations and original-job
recovery. Development and review do not authorize mainnet activation, real-fund
spending, new funding, recurring jobs or changes to custody.

Keep PR descriptions concrete: the problem, resulting behavior, checks and remaining
limitations. Include screenshots for visible changes when useful. Submit only work
you have the right to contribute; retain third-party attribution and license notices.
