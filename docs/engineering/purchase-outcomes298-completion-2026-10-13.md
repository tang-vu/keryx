# Issue 298 — retained offline evaluation and bound release comparison

This candidate extends the already merged purchase outcome scorer, structured
initial decision basis, public aggregate and bounded skip planner. It adds no
payment rail, model assessment, storage schema, production activation or scheduler.
The existing citation/settlement scorer and public contracts retain their current
behavior. [Original scope and counting rules](purchase-outcomes-298.md) still apply.

## Retained skipped-source evaluation

`scripts/eval-retained-purchase-skips.mts` consumes a local, minimized JSON file
after a completed run. `evaluateRetainedSkips` uses the existing deterministic
`planCounterfactualSample` with a fixed seed and these versioned limits:

| Bound | Fixed allowance |
| --- | --- |
| Selected exact-version skipped sources | At most 8 |
| Sum of selected quoted access prices | At most 20,000 micro-USDC, **sampling accounting only** |
| Entire input | 1 MiB |
| All retained body bytes combined | 512 KiB UTF-8 |
| Independent reference literals | At most 64, each at most 2,048 UTF-16 code units |

Actual spend is always zero. The evaluator has no injected reader, user budget,
signer, Gateway, provider, model, database or reward capability. It reads only
the provided retained bodies, never a URL or source endpoint. A missing exact
body produces `retained-body-missing`; it cannot trigger a paid read or funding
fallback. Results always carry `rewardEligible: false`. This is an offline
alternative under the present no-spend instruction, not an activated evaluation
wallet or proof of live counterfactual payment isolation.

The closed input contract is `keryx-offline-counterfactual-input-v1`:

- `run`: `id`, `completedAt`, `answer`, minimized `decisions` and `observedReads`.
  Each decision has `sourceId`, optional `itemId`/`contentVersion`, `action`,
  `price` and optional `external`. Each observed read has the exact source,
  item and version. Populate exclusions from retained access, read and citation
  observations, including gap purchases whose initial row remained SKIP.
- `reference`: `claims` with distinct `id` and `literal`, and `sha256` of UTF-8
  `JSON.stringify(claims)` in the declared order, with each row's fields in
  `id`, `literal` order. The reference must be retained independently of the
  evaluated runner. A digest binds content; it does not authenticate independence,
  factual truth or an expert's judgment.
- `snapshots`: exact `sourceId`, `itemId`, `contentVersion`, `body`, `bodySha256`
  of the exact UTF-8 body, and `capturedAt` at or after `completedAt`.

All inputs are copied and bounded before the first await. Conflicting skip
quotes, incomplete identities and external listings retain the planner's
exclusions. Observed exact reads conservatively exclude a candidate even when
its initial decision says SKIP. The evaluator validates every supplied body,
including unselected bodies, before evaluating the sample. Duplicate snapshot
identities, stale capture times, corrupted hashes and over-limit content refuse.

The result states the selected sample, unavailable-body count, quoted allowance,
input and reference digests, and missing reference literal IDs found in each
selected body. The selected-sample literal miss rate is null for an empty or
incomplete sample. A literal already present in the delivered answer does not
count as missed. A found reference counts once across sampled sources. Raw answer,
reference literals and source bodies are omitted from the output.

Literal occurrence is a reproducible diagnostic. It does not establish semantic
support, entailment, broader missed value, expert quality or a population estimate.
In particular, no current model is asked to grade its own answer. Supplied record
provenance and completeness still require root review.

```sh
node --import tsx scripts/eval-retained-purchase-skips.mts retained-input.json
```

Exit 0 means a complete nonempty selected sample was assessed, even if it found
no missing literals. Exit 2 retains an empty/incomplete sample; exit 3 refuses
invalid input. The command opens one bounded local file, loads no environment
files and refuses URL/UNC selectors. It writes its result to stdout only.

## Release-bound flagging

The existing `check:purchase-regression` remains unchanged. The additional
`scripts/check-purchase-release.mts` compares saved aggregates under a closed
`keryx-purchase-release-policy-v1` file. The file records:

- Baseline and candidate full source commits, exact aggregate file SHA-256 hashes
  and retained input SHA-256 hashes.
- One network, the explicitly selected cohorts, and every comparison margin:
  `maxHitRateDrop`, `maxCalibrationGapRise`, `minScoredPurchases`.

The caller separately pins the reviewed policy hash, actual candidate source
and retained input hash. Both artifacts must declare that same input. Changing
source, file formatting/content, inputs, cohorts or margins requires a new policy
hash and review. Both aggregate network and UTC populations must match. Existing
aggregate schema, derived-count and counting-rule validation still applies.

```sh
node --import tsx scripts/check-purchase-release.mts policy.json baseline.json candidate.json \
  --policy-sha256 <reviewed-policy-hash> \
  --candidate-source <actual-full-candidate-commit> \
  --input-sha256 <reviewed-retained-input-hash>
```

All selected cohorts are required. Worsening beyond an explicit margin flags the
candidate. Small samples, incomplete populations, unscorable runs or unscored BUYs
cannot produce a pass. A flagged cohort remains visible even if another is not
evaluable. Exit 0 means a bound comparison passes, 1 flags worsening, 2 withholds
acceptance and 3 refuses invalid/unbound files. The receipt always states
`deploymentAuthorized: false`.

This policy pin is a content binding, not a signature or an attestation that an
aggregate was produced from its declared input/source. Root review and actual CI
must prove that provenance. **No release margin has been agreed by this worker.**
The `0.05`/`0.05`/`20` values in synthetic tests only exercise boundaries. A real
assessment requires an agreed corpus/cohorts/margins and review of the actual
pinned policy and producer provenance. This command remains a standalone offline
diagnostic. It is not installed as an additional release64 gate and supplies no
new release policy, activation or deployment authority.

## Original criteria and remaining ownership

| Original criterion | Current source / remaining gate |
| --- | --- |
| Every decision records value, price, budget, alternative and reason in both adapters | Initial ordinary plans already have `Decision.basis` and adapter round-trip coverage. Dynamic recommendations/gap reads remain incomplete; exact producer seam proposed to root/301/276. No shared producer edits in this candidate. |
| Outcomes derive from citations and settlements | Existing exact-version scorer counts matching recorded real settled access/rewards and retained citations. Pending/simulated/failed/mismatched rows cannot enter settled scores. No new self-assessment. Recorded bookkeeping is not new chain verification. |
| Public sample, period and rule | Existing `/purchase-outcomes` and API state bounded cohort samples, UTC window, coverage and rules. Public question-type splits and cost per independently supported claim remain unmeasured. Privacy/archives/profile owners retain their paths. |
| Fixed counterfactual allowance and no user spending | Existing allowance tests plus this fixed, retained-body-only evaluator provide source-level offline isolation. Actual owned corpus/reference assessment, input completeness and independent review remain gates; synthetic tests are not real trials. |
| Release worsening beyond agreed margin flagged before deployment | Bound offline comparison is implemented. Agreed policy/corpus, provenance, subprocess qualification and root pre-deploy wiring remain open. No existing gate was removed. |

The producer proposal is intentionally narrow: retain each actual reevaluation
decision as a separate versioned event with its actual remaining fetch cap,
alternative or explicit absence, exact identity, recorded prediction availability
and result action. A successful gap BUY must enter purchase scoring once. The
current hardcoded zero in `captureRecommendation` is not a measured prediction
and must not silently enter calibration. Keep the initial planning basis intact.
Root/301/276 must accept and compose that seam before edits.

## Surface and acceptance handoff

The new executable surfaces are offline maintainer CLIs. Web/public API,
desktop, extension, hosted/stdio MCP and bots continue to use the existing report
and pooled contracts, with their current private/public roles. They gain no
counterfactual reader or spending capability. Learning299 and all production,
financial, custody, Operator, profile/privacy and archival authority remain owned.

Root/source-library must add both new `.mts` commands to the existing operations
TypeScript graph after source admission. This worker does not edit that claimed
configuration, shared CI, package versions, release scripts or deploy admission.
No package/installer/installed/production identity is claimed by local checks.

The donor is the old `cli-outcomes298-20261013` worktree at
`ec5f39c9750dfc9e80e66edd41348ca6034c01c3`. Its nine raw/blob source pins,
17 declared inputs and eight retained evidence pins were verified before adoption
into the isolated current worktree based on
`ae298ff41c239b292a043b3442df33f1701a4b99`. The evaluator/planner, scorer,
projector, aggregate, portable JSON, exact-unit and reachable cohort/window
contracts match the donor. Package and Vitest inputs changed; old acceptance
cannot qualify this current candidate. No current contract or producer is replaced.

The donor's final **22 tests in four files** and scoped TypeScript graph are
historical evidence for that old source only. The old native `index.lock`
permission denial and fork/esbuild `spawn EPERM` failures remain retained, with
both CLI qualifications unrun. This source worker runs no test, compiler, app,
producer, DB, build or Git writer and makes no denial retry or alternate-runner
attempt. Current checks are **UNRUN**, including the changed test fixtures.

Current release fixtures now pass full synthetic decision/citation/settlement
records through the existing projector and scorer rather than asserting a partial
report type. Positive exact access prices, recorded settlement status, matching
source/item/version and all count/cohort bindings are retained. These synthetic
records are not real payment evidence. No decision basis or actor population is
invented. Unknown predictions are refused by the existing v1 projector and
unscorable runs withhold a comparator pass; no zero or initial-SKIP prediction
is substituted. Public missed value, question-type and supported-claim measures
remain null.

Both CLI subprocess fixtures invoke the actual documented source entrypoints
using the installed `tsx` loader, with isolated temporary output and no supplied
provider credentials. Separate esbuild graph assertions remain planned checks,
not a bundled replacement for the command's input/output/exit qualification.
They exercise completed, missing/partial/empty and observed-read samples; hash,
UTF-8/BOM, schema, local-file and capability refusals; explicit release exits
0/1/2/3 and retained-evaluation exits 0/2/3. Parent must run these on its ordinary
authorized runner and record the actual outcome.

The source handoff, raw donor/current/input pins, forward patch and whole inverse
are retained in ROOT's `refill-successors-20261013-67/`
`worker-completePurchaseOutcomes298Current/review-or-handoff`. Parent owns focused
checks, operations-graph inclusion, independent current review, native checkpoint,
PR and required aggregate/domain CI for NEXTcohort. No version, merge, deployment
or issue closure occurs in this worker. Original issue298 stays OPEN.

## Parent acceptance on the current source — 2026-10-14

The ordinary parent ran the current four files: 19 behavior/CLI cases passed; two graph assertions exposed duplicate approved external imports. The two corrected graph cases subsequently passed with every edge checked against the unchanged approved modules and the exact unique set required. Other 19 passing calls were reused on unchanged source. Scoped types passed using the existing operations configuration; both new commands and their fixtures are now explicitly included in that graph.

The old native failures and the initial parent graph/type-control failures remain retained. No full local suite/build or study producer was repeated. All 417 existing study source pins and the lock remain physically unchanged; these offline tools are outside that closure. Required hosted CI and ROOT next-cohort delivery remain pending. No corpus independence, agreed real release margins, financial authority, production activation or original issue298 closure is inferred.
