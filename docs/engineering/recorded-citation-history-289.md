# Recorded citation history and agent identity

For [issue289](https://github.com/tang-vu/keryx/issues/289), the research trace now
names its actual input: local scores from recorded citation history on the same
subject. `buildDecisionContext` reads the existing query-memory records and
computes citation rate times average citation weight. It performs no ERC-8004
registry read, identity registration or on-chain reputation verification.

The `discover` phase, `{ reputation: true }` detail, model context, score formula,
source ordering and all purchase/payment controls remain unchanged. Missing or
unavailable history still contributes no score or reputation trace and does not
prevent ordinary research. Existing retained reports are not rewritten.

## Supported surfaces and release boundary

Web SSE, hosted API, remote MCP and hosted bots use the shared research runner.
The source CLI imports the same runner. Desktop, the extension and packaged stdio
MCP use hosted research/report handoffs or their existing task and recovery
contracts; they do not embed either changed module in their distributed client
graphs. No new field, adapter, identity input, custody role or client release is
required for this wording change. Root app/version and final deployment remain
part of the owner's combined release; this candidate changes no package or
installer version and claims no synchronized delivery.

The regression drives the actual runner and query-memory scorer with injected
synthetic records. It checks the streamed and retained wording/basis, preserved
90/100 score and unchanged purchase/reward amount. Absent and failed history
reads omit the score while completing the same synthetic purchase/answer path.
The existing query-memory and economic/failure-path runner suites remain relevant.
These checks make no provider, payment, chain or shared-database request.

Local Node24.21.0 validation passed 227 tests across the runner/query-memory
suites, both application and ops-script TypeScript graphs, scoped lint and the
whitespace check. In-memory esbuild graphs for packaged stdio and desktop
helper/renderer/bridge contain neither changed module and write no artifact.
The shared installed dependency closure matches this source after removing only
the two root lockfile version fields; that equivalence is local tooling evidence,
not exact-lock release acceptance. Independent review, actual hosted aggregate
success and the combined deployment/readback remain release gates.

The changed runner/scorer are among the controlled paying-source study's 336
source inputs. Actual offline `--write` followed by `--check` regenerated its
two public artifacts with zero outbound attempts. All 48 trials, outputs,
metrics, corpus and lock binding remain identical; only those two runtime source
pins change in JSON. The regenerated write-up is identical after Git's existing
CRLF/LF normalization. No result or hash was edited by hand.

Issue289 remains open for actual ERC-8004 registration, separate identity-key
custody, customer-verdict-bound reputation events, counterparty registry checks,
public proof and separately authorized testnet/mainnet acceptance. A local score
does not satisfy those gates.
