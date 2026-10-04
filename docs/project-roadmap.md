# Keryx roadmap

The current acceptance map is the [product and mainnet delivery plan](./mainnet-delivery-plan.md).
It covers buyer, creator, developer, operator, research-quality, economics, and
mainnet release work. [DECISIONS.md](../DECISIONS.md) records why the architecture
changed; [project-changelog.md](./project-changelog.md) records what shipped.

The [Tameion 2026 plan](./tameion-2026.md) sets the September 27–October 10 event
direction and its proposed Operator, Windows desktop, CLI, and pilot work. Its
checklist is a plan, not release evidence; the acceptance map above remains in force.
The [staged shared Rust engine migration](./rust-engine-migration.md) records the
authorized evaluation, current read-only slice and domain cutover gates. It does not
change the production payment authority or complete a Tauri desktop migration.

## Current priorities

Production is on mainnet as observed October 4, 2026. Use the
[post-launch update flow](mainnet-update-flow.md) for subsequent releases and the
[24-task internal workload / 12-item backlog](research-workload.md) for proactive
product work. Internal evaluation is separate from independent customer demand.

1. Validate repeat paid research with independently funded buyers and useful
   sources controlled by their creators.
2. Improve answer quality and show the source decisions, evidence, and exact
   creator payments in a short reviewer journey.
3. Rehearse recovery, reconciliation, backup restore, and deployment rollback.
4. Measure costs against actual bills and receipts before changing prices or
   claiming operating profit.
5. Maintain the deployed mainnet service through reviewed updates, isolated
   offline/testnet validation and bounded mainnet acceptance where authorized.
   Deployment does not close the remaining product/usefulness or financial gates.

The former long-range roadmap and version table are preserved in
[Git history](https://github.com/tang-vu/keryx/blob/742454a/docs/project-roadmap.md).
They are historical, not current deadlines.
