# Offline research decision audit contracts

This coherent toolkit prepares source outcomes for issues
[249](https://github.com/tang-vu/keryx/issues/249),
[298](https://github.com/tang-vu/keryx/issues/298),
[299](https://github.com/tang-vu/keryx/issues/299) and
[301](https://github.com/tang-vu/keryx/issues/301). It changes no deployed agent,
database, public metrics, source ranking or payment policy. Integration and
release gates remain open; the operational release45 main freeze still applies.

## Local use and input trust

```powershell
node --import tsx scripts/research-audit.mts record examples/research-audit/read-input.json
node --import tsx scripts/research-audit.mts verify retained-record.json <separately-retained-sha256>
node --import tsx scripts/research-audit.mts cohort cohort-facts.json
node --import tsx scripts/research-audit.mts usage usage-corpus.json
node --import tsx scripts/research-audit.mts score purchase-corpus.json
node --import tsx scripts/research-audit.mts learn learning-corpus.json
```

Use the repository's supported Node runtime and pinned installer. The CLI loads
no environment, application configuration, DB, gateway, provider or HTTP client.
It reads one regular local JSON file, capped at2MiB including growth, and writes
a JSON result. Errors omit private input and paths. Unix no-follow is used when
available. Collections are limited to2000rows; identifiers to256characters;
policy identifiers are tighter. Contract fields are checked at runtime without
coercing object IDs, string booleans or fractional-micro amounts.
Legacy Number amounts above safe integer micro precision and negative zero are
refused; canonical authoritative integer strings retain their separate30digit bound.

`record` emits a record/hash pair; save only its `record` member as the verification
file and retain the hash separately. `verify` requires that hash and exits1 on
failure. The example is synthetic policy input, never a source/payment offer.
A record and hash rewritten together can be self-consistent. Hashing proves
integrity/replay against a retained digest, not independent actor, source,
publisher, model or Circle truth. Supplied corpus facts need a trusted adapter
and reviewer. Keep private identifiers and research in private local files.

| Command | Contract exported from `lib/research-audit/` |
| --- | --- |
| cohort | `CohortFacts`: actor, funding, scripted |
| usage | network, canonical UTC since/until, `AuditUsageRun[]`, recorded payments |
| score | network, completed recorded run, recorded payments |
| learn | sourceId, exact topic label, observations, expectedValue |

## Cohort accounting —249

Execution channel cannot identify outside users or independent funding. Unknown
history stays unknown. Scripted/team activity never qualifies as independent
payers. An outside user with sponsored funding retains both labels. Treasury/
team-funded payments never qualify as independently paid use.

Summary columns always separate outside/team/scripted/unknown. Network and UTC
period are explicit. The period counts runs created since inclusive/until
exclusive; settled rows are attributed to those runs, not claimed to have settled
in that period. A supplied/paginated sample is never labelled all-time production
usage. People require supplied verified pseudonymous actor IDs; anonymous runs
create no person count. A person can appear in multiple cohorts, so columns must
not be silently summed as unique people. Acceptance and first-answer latency
show their observed sample sizes; completion/duration/feedback are no substitute.

Money uses exact micro-USDC strings from deduplicated, identified real-settled
rows with settlement references on the selected network. Pending/simulated/
failed/unproved legacy/fractional-micro rows are excluded. Zero-value rows cannot
establish a paying run or paid creator and are excluded. Funding subdivisions
remain separate from user cohort. Creators are distinct fetch/citation payees,
not source names or inbound recipients. Conflicting duplicate identities refuse.
The history helper excludes scripted runs by default and supports outside-only;
existing public history does not call it yet.

Open gates: trusted write-time stamps in both adapters, verified payer-funding
evidence, conservative historical backfill, complete production aggregates,
public page/API/history adapters and deployed counting-rule acceptance.

## Purchase outcomes —298

BUY decisions, access payments and citations join on exact source/item/version,
query and network. Source-level/different-version matches cannot claim a purchase
contributed. Unknown identities stay unscored. Planned BUY/reward, pending and
simulated payments are not settled purchases/rewards. Duplicate payment IDs
cannot inflate money; conflicting IDs/decisions refuse regardless of order.

Hit rate is scored settled access purchases with a recorded exact-version
citation divided by scored purchases. Uncited access spend is a descriptive
amount, not expert causal regret. Contribution is recorded citation weight,
not fresh factual reassessment. Calibration bands compare expected value with
binary citation occurrence; expected value is not assumed to be a probability.
Missing samples return null. Missed value and cost per supported claim remain
null because no counterfactual reads or expert assessment occur.

Open gates: structured write-time inputs/durable adapters, independently reviewed
outcomes, public sample/period/cohort presentation, separately approved evaluation
allowance and accepted regression margins. This CLI cannot spend user/evaluation
budget or change rewards.

## Bounded source learning —299

Only independently classified/funded outside observations qualify. Unknown
ownership, malformed wallets, known source owners, team/scripted/sponsored
traffic, other topics and duplicate runs are excluded. Ownership is a reviewed
supplied fact, not discovered by this helper. Common-control/Sybil resistance
requires an authenticated production adapter and manipulation monitoring.
Conflicting observations for the same source/topic/run refuse.
The caller must aggregate multiple exact article purchases into one reviewed
source/topic/run observation. Here `bought` counts those independent run
observations, not access-payment or article count; one run cannot amplify the sample.

The record exposes bought/cited counts, exact rational average price, recorded
contribution, Beta(1,1) smoothed citation rate and a descriptive uncertainty
proxy. These are not scientific confidence bounds or calibrated truth. Fewer
than five independent purchases leave advisory value unchanged. Each update
is bounded to0.1 and explains the record. Tests show falling/rising advisory
value for uncited/cited sources, not a measured live purchase-rate experiment.

An explicitly supplied budget/fraction partitions exact integer units, flooring
the exploration portion. Reservations cannot exceed the remaining partition.
No default allowance, persistent/atomic reservation, signer, automatic purchase
or promotion of model SKIP exists here. Hard budget/session/payee/price/evidence
rules remain separate and authoritative.

Open gates: offered/cache/free-read observations, verified ownership/cohort
adapters, persistent atomic exploration, anomaly monitoring, live ranking and
the identical public source-page/API record.

## Canonical replay —301

`bounded-read-admission-v1` is a prospective pure subpolicy, not replay of the
whole deployed orchestrator/portfolio. Its closed record keeps an opaque
candidate ID, exact integer price/budget/ceiling, attention, admitted flags,
model-proposed action and deterministic result/rule. Question/rationale/URL/body/
raw-model-text fields are refused. BUY/SKIP/CACHE/STOP/ESCALATE are supported.
Only BUY reserves its exact price; the function performs no signing, mutation,
payee selection, fetching, settlement or reward allocation. Admission flags
remain assertions until a trusted adapter binds them to actual authority.

Fixed canonical ordering produces SHA256 independent of object-key order.
Verification checks the separately retained digest and deterministic replay.
Unknown schemas/policies, malformed/accessor properties and changed records
refuse. Browser Web Crypto performs the same offline verification without a
Keryx request. Retain v1 and its corpus when defining successors; do not silently
change historical version semantics.
The API is browser-safe; actual browser parity and the report verify control are
still untested/unintegrated gates. Node Web Crypto tests do not establish either.

Open gates: all actual decision/stop/escalation capture, preceding portfolio/
preview/eligibility rules, exact source/payee/policy-state bindings, durable
ordinary storage, privacy-reviewed public projection, record downloads, report
offline verify control and separately authorized on-chain anchoring.

## Surfaces and validation

CLI owns the local command. Web/browser, API, remote/stdio MCP, desktop,
extensions and bots do not yet expose/persist these contracts. Browser-safe
pure modules contain no Node/application/provider imports; only the CLI has
filesystem I/O. Immutable receipts, native/sealed projections, storage schema,
package/installer versions and deployed authority stay unchanged.

Focused fixtures, both TypeScript graphs, scoped lint, independent review and
full applicable hosted exact-head CI are source gates. Runtime integration and
deployed/package acceptance are future gates. All four issues remain open.
