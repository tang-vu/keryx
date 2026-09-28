# Contributing to Keryx

Keryx is a citation-toll reading agent with real testnet payment paths. Keep
source decisions, spend, pending state and creator settlement visible and accurate.
The [architecture decisions](./DECISIONS.md), [current Tameion plan](./docs/tameion-2026.md)
and [release gates](./docs/mainnet-delivery-plan.md) provide context; old plans
and counts are historical until code and evidence confirm them.

## Change workflow

1. Create a focused feature branch for one logically complete update.
2. Implement the change with proportionate tests and accurate documentation or
   changelog notes. Keep builds and checks reproducible.
3. Commit with a descriptive conventional subject, such as
   `feat(operator): add read-only task inspection` or
   `fix(buyer): preserve pending recovery state`, and push the branch.
4. Open a pull request. Explain the concrete problem, resulting behavior,
   relevant validation, limitations and rollback considerations. Link the
   applicable decision or gate when changing authority or payment behavior.
5. Pass the required CI checks and review, then merge to `main`. A merged
   user-visible product update follows the repository's deployment, health
   verification and product-update process.

## Local checks

Use Node.js 20.18.2 or newer and `npm install`. Run checks that match the risk:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Routing, server/client boundary, configuration and dependency changes need a
production build. Payment, authentication, database and contract changes need
focused tests and TypeScript checks. Contract changes also need
`npm run test:contracts`. The [Rust engine candidate](./docs/rust-engine-migration.md)
has its own native and differential commands and an Ubuntu/Windows CI gate.

Do not commit environment files, keys, private task or payment data, generated
artifacts, or unrelated worktree changes. Never fabricate settlement evidence;
label synthetic, pending and unknown states honestly. Mainnet activation and
real-fund spending require explicit owner authorization.
