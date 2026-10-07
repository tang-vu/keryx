# Updating Keryx after the mainnet launch

October 4, 2026: the owner confirmed production is on mainnet and requested a
self-directed workload plus a repeatable update flow. The observed release is
b71789b (app 0.26.5; MCP/desktop publication is recorded separately). Recheck live
health and distribution for every release; versions here are a dated observation.

Production stays on mainnet. Development and destructive fault injection stay
isolated. Mainnet deployment does not grant unlimited internal research, signatures,
funding or new automatic schedules. Existing authorized limits persist; absent
a documented applicable allowance, paid acceptance waits for a finite scope/budget.

## Which environment owns which work?

| Work | Environment | What a pass establishes |
| --- | --- | --- |
| Documentation, UI fixtures, pure logic, evidence/recovery regressions | Local/CI, synthetic transport and data, no live keys | The checked behavior, not useful live research or real settlement |
| Discovery, original-document reading, model/output comparison | Isolated staging with reviewed provider quota and request count | Observed source/output behavior; zero source USDC still has model/search costs |
| Registration, x402, funding, withdrawals, disconnects, duplicate submissions and uncertain settlement | Offline adverse fixtures first; isolated Arc testnet for vendor integration | Testnet integration at the recorded SDK/profile; not mainnet readiness by itself |
| Mainnet signature/domain/endpoint differences | Mainnet-profile synthetic acceptance, read-only live observations, then a bounded funded canary when authorized | Only the exact checked mainnet path |
| Production after deployment | Read-only health, page/API shape, retained-original inspection by default | Deployed commit/profile and recovery compatibility; no implied new payment |
| Real useful paid workflow | Mainnet, known legitimate buyer/source and finite approved envelope | Exact observed delivery and settlement; internal use stays internal |

A staging hostname, provider allowance and funding are not provisioned by this
document. Verify availability before claiming staging or testnet acceptance.
Use the same source candidate with explicit environment-specific builds and
matched network labels. Browser-public configuration can be compiled into the
bundle: a testnet browser bundle must not be reused as a mainnet bundle.

Separate databases, storage manifests/identities, registry deployments, keys,
session custody, caches, journals and telemetry. Never load production keys or
a writable production database into staging, reuse a mainnet authorization on
testnet, or convert historical testnet records into mainnet balances/traction.
Use synthetic data, or separately reviewed sanitized read-only evidence, for
offline reproduction. No shadow production payment is permitted.

## Release sequence

1. **Specify one outcome.** Pick a bounded backlog item, its task IDs and acceptance
   criteria from [the workload](research-workload.md). Record the baseline, affected
   surfaces, proposed change and residual limitations. Preserve the evidence
   ledger, [sentence-cited summary contract](engineering/cited-summary-2026-10-06.md)
   and excerpt/gap fallback. The owner's October 6 decision superseded D-300's
   unconditional excerpt-only delivery; broader comparisons, recommendations and
   checklists still require their separately reviewed assertion-completeness and
   actual-usefulness gates. The reviewed decision brief remains disabled.
2. **Branch from current origin/main.** Fetch/prune; preserve unrelated changes and
   active worktrees. Develop on a focused branch. Do not push changes directly to
   main. Record network, schema, custody and public-contract impact.
3. **Validate locally and in CI.** Run focused behavior/failure checks, required
   TypeScript/lint/build/contract checks in proportion to the change, and all
   required repository CI. Payment/auth/storage changes require independent review.
   Test both supported network profiles where the changed behavior depends on them.
4. **Exercise staging where applicable.** Use original public documents for research
   usefulness, and testnet for real vendor/payment integration. Record exact
   source/version, observed limits, provider cost and result. HTTP success, model
   scores and testnet settlement are not user acceptance.
5. **Review and merge the PR.** Address findings, pass required checks and verify the
   actual merged tree. Standing workflow authorization covers routine merge. A
   failed acceptance gate remains open rather than being relabeled as complete.
6. **Prepare one serialized release.** Inspect actual production commit, network,
   sealed storage identity/schema, role configuration, held workers/schedulers and
   pending originals. Select the reviewed deployment mode and rollback/forward-fix
   plan before running the deployment. Re-read origin/main immediately before
   deployment; if another change landed, verify the combined release and checks.
7. **Deploy current origin/main with npm run redeploy.** Follow the
   [deployment guide](deployment-guide.md). The current mainnet runtime uses
   reviewed role configuration and deliberately held schedules. A bare default
   redeploy can rewrite cron or use a legacy launcher; preserve the reviewed
   inputs and do not copy a historical invocation without validating its bindings.
   The reviewed-role path requires the operator to positively stop/drain web
   and A2A before source sync/build; the helper validates that state rather than
   performing the stop. Plan a maintenance window rather than promising a
   zero-downtime release.
   The Node redeploy launcher forwards and reads back the four reviewed
   maintenance controls and optional economic-migration pair through Windows
   `WSLENV`, without translating native Linux paths. Partial controls or a lost
   value refuse before deployment begins. Keep all reviewed values explicit;
   this transport check does not drain roles or create supplier authority.
   Storage/custody/policy changes require their explicit migration procedure,
   verified backups and positive drain of all affected writers/signers.
   The [same-original fulfillment transition](operator-original-fulfillment.md)
   uses the protected six-field redeploy migration config with its distinct
   `keryx-redeploy-original-fulfillment-migration-v1` format. Under the held-writer
   maintenance boundary, new source builds first and its fixed native migration
   runs before any new role starts. A migration attempt forbids automatic old-source
   rollback; do not substitute startup schema repair or restart the predecessor.
8. **Verify hosted and distributed delivery.** Match public health to the merged
   commit and expected network; inspect safe UI/API behavior and worker readiness.
   Check schemas/identities and retained-original recovery as applicable. Publish
   fresh package/installer identities only when bytes/contracts change; verify
   actual downloaded integrity, provenance and versions. Do not claim all surfaces
   are synchronized from a web health response alone.
9. **Run a funded mainnet canary only if required and authorized.** Specify purpose,
   caller/source/payee, maximum operation count, fees/gas/source USDC, expiry and
   stop conditions. Preserve any previously granted finite allowance; do not ask
   again for the same authorized action. A timeout or missing response stops new
   paid attempts and triggers original-bound observation, never blind repayment.
   Keep newly changed financial behavior within the reviewed bounded release scope
   until its required canary passes; use only existing validated isolation controls
   or maintenance, not an assumed feature flag or imaginary traffic router.
   A schema/financial release cannot claim funded acceptance from no-spend checks.
10. **Close the release.** After a user-visible product deploy succeeds, publish the
    concise Arc Canteen product update under the standing workflow. Keep internal,
    sponsored, testnet, independent and real paid figures separate. Archive and
    verify private handoff/custody/release evidence, then remove only the proven
    merged local branch/worktree. Preserve remote refs and ambiguous/active work.

## Release scope and recovery

Documentation-only changes need content/link validation, review and required CI,
then merge. They do not change product runtime, need a new installer/version, or
require a production redeploy/product announcement merely to serve identical code.

UI-only changes need responsive/interaction checks and the production build.
They normally need no paid canary. Shared research changes need grounded-output,
empty/partial result and export/adapter checks. Public API changes require
compatibility coverage. Payment, signing, storage and contracts need focused
failure/concurrency/replay tests, migration/restore evidence where relevant and
independent review. Testnet success alone does not cover mainnet profile bindings.

Reviewed-role deploys retain the prior build and do not automatically roll back
on a failed health check. Once a migration is attempted, uncertainty can include
committed DDL; keep writers held and inspect the original receipt before resuming.
An old binary may refuse the new sealed schema. Prefer a reviewed forward fix or
explicit compatible rollback. Never restore an old financial snapshot over newer
authorizations, nonces, deposits or liabilities. Feature flags may stop new entry,
but they must not erase originals or make incompatible schemas safe.

## Supported surfaces

| Surface | Required impact decision |
| --- | --- |
| Web and public/private APIs | Answer/evidence/payment state, schema and compatibility |
| Remote MCP and OpenAI-compatible API | Shared hosted output and sponsored admission |
| Buyer/Operator CLI and stdio MCP | Network-bound custody, original recovery, packed distribution |
| Windows desktop | Task/receipt/export and reviewed buyer handoff; installer only when affected |
| Browser extension | Thin API/listing handoff; package only when affected |
| Telegram, Discord and Slack | Shared hosted behavior, honest states and retained dispatch links |

Each PR/release records affected checks and intentional unchanged/handoff roles;
no automatic expansion into native signing or a scheduler. The workload itself
adds no runtime, payment, network selector or adapter contract.
