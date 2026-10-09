import type { StudyCorpus } from "./contract";
import type { StudyTrial } from "./runner";
import { BUDGETS, PRICES, canonical, sha256 } from "./contract";

export interface StudyArtifact {
  version: 1; corpusSha256: string; runtimeSources: Record<string, string>; unresolvedSourceInputs: string[]; lockSha256: string;
  design: { engine: "heuristic"; mode: "offline"; network: "eip155:5042002"; modelCalls: 0; searchCalls: 0;
    citationPoolRatio: 0.5; attentionLimit: 4; reevaluateRounds: 1; freshStoreAndCachePerTrial: true };
  outboundAttempts: number; canonicalOmissions: string[]; trials: StudyTrial[];
}
export function artifact(corpus: StudyCorpus, trials: StudyTrial[], inputs: { files: Record<string, string>; unresolved: string[] }, lockSha256: string,
  outboundAttempts: number): StudyArtifact {
  if (trials.length !== 48 || new Set(trials.map(trial => trial.id)).size !== 48 || outboundAttempts !== 0)
    throw new Error("Incomplete or unsafe study matrix");
  return { version: 1, corpusSha256: sha256(canonical(corpus)), runtimeSources: inputs.files, unresolvedSourceInputs: inputs.unresolved, lockSha256,
    design: { engine: "heuristic", mode: "offline", network: "eip155:5042002", modelCalls: 0, searchCalls: 0,
      citationPoolRatio: 0.5, attentionLimit: 4, reevaluateRounds: 1, freshStoreAndCachePerTrial: true }, outboundAttempts,
    canonicalOmissions: ["QueryRun.createdAt", "QueryRun.durationMs", "TraceStep.ts", "PaymentRecord.id", "PaymentRecord.createdAt", "TraceStep.detail.PaymentRecord.id", "TraceStep.detail.PaymentRecord.createdAt"], trials };
}
function fraction(numerator: number, denominator: number): string {
  return denominator === 0 ? "not measured (0 observations)" : `${numerator}/${denominator} (${(100 * numerator / denominator).toFixed(1)}%)`;
}
function summarize(trials: StudyTrial[]) {
  const sum = (fn: (trial: StudyTrial) => number) => trials.reduce((total, trial) => total + fn(trial), 0);
  const policyChanges = sum(trial => trial.proposals.flat().filter(proposal => trial.output.decisions.some(decision =>
    (decision.assetId ?? decision.sourceId) === (proposal.assetId ?? proposal.sourceId) && decision.action !== proposal.action)).length);
  return { reads: sum(trial => trial.metrics.actualReads), paid: sum(trial => trial.metrics.paidReads),
    claims: fraction(sum(t => t.metrics.literalReadBoundClaimRate.numerator), sum(t => t.metrics.literalReadBoundClaimRate.denominator)),
    facts: fraction(sum(t => t.metrics.requiredFactCompleteness.numerator), sum(t => t.metrics.requiredFactCompleteness.denominator)),
    citations: fraction(sum(t => t.metrics.literalReadBoundCitationRate.numerator), sum(t => t.metrics.literalReadBoundCitationRate.denominator)),
    toll: String(trials.reduce((total, trial) => total + BigInt(trial.metrics.fetchMicro), BigInt(0))),
    reward: String(trials.reduce((total, trial) => total + BigInt(trial.metrics.citationMicro), BigInt(0))), policyChanges };
}
export function renderStudy(result: StudyArtifact, corpus: StudyCorpus): string {
  const row = (label: string, trials: StudyTrial[]) => {
    const s = summarize(trials);
    return `| ${label} | ${trials.length} | ${s.reads} / ${s.paid} | ${s.claims} | ${s.facts} | ${s.citations} | ${s.toll} / ${s.reward} | ${s.policyChanges} |`;
  };
  const overall = summarize(result.trials);
  const concentration = result.trials.filter(trial => trial.metrics.rewardHhi !== null);
  const mean = (field: "rewardHhi" | "topRewardShare") => concentration.length === 0 ? "not measured (no reward-bearing trials)"
    : (concentration.reduce((total, trial) => { const ratio = trial.metrics[field]!; return total + Number(ratio.numerator) / Number(ratio.denominator); }, 0) / concentration.length).toFixed(4);
  return `# Paying for sources: a controlled offline fixture study (2026-10-09)

This is a reproducible **48-trial synthetic study**, using Keryx's actual \`runAgent\`, \`HeuristicEngine\` and \`OfflineGateway\`. All questions, documents, wallets and outputs are fictional and publicly published here. No private question or real user behavior is sampled. No payment settles: every recorded payment is \`simulated\`, \`settled: false\`, with \`txHash: null\` on the isolated Arc testnet profile. These amounts are not traction or creator earnings.

## Observed fixture results

Across 48 trials, ${overall.paid} paid fixture reads cost ${overall.toll} simulated micro-USDC in tolls, and ${overall.reward} simulated micro-USDC was allocated as citation rewards. Required-fact completeness was ${overall.facts}; literal read-bound claim coverage was ${overall.claims}. These are lexical closed-fixture measurements, not semantic correctness or open-domain supported-claim estimates.

Each budget row contains the same four questions at all three prices (12 trials). Each price row contains the same four questions at all four budgets (16 trials). Read counts include free reads; paid reads count actual simulated fetch payments, rather than BUY proposals.

| Budget (micro-USDC) | Trials | Reads / paid reads | Literal read-bound claims | Required facts | Literal read-bound citations | Toll / citation micro-USDC | Initial proposal/final action changes |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: |
${BUDGETS.map(budget => row(budget, result.trials.filter(trial => trial.budgetMicro === budget))).join("\n")}

| Paid catalogue price (micro-USDC) | Trials | Reads / paid reads | Literal read-bound claims | Required facts | Literal read-bound citations | Toll / citation micro-USDC | Initial proposal/final action changes |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: |
${PRICES.map(price => row(price, result.trials.filter(trial => trial.paidPriceMicro === price))).join("\n")}

Price response in this matrix is the observed number of paid reads under the existing hard budget, attention, portfolio and sufficiency policies. It is not general willingness to pay, nor an estimated demand curve. The heuristic's initial lexical value proposals, actual reevaluation inputs/outputs and the written policy are retained separately. The action-change column counts initial decide proposals whose final action differs, not reevaluation recommendations. Changes include free-source BUY-to-CACHE normalization; CACHE on a free source does not imply a pre-existing cache hit. A final BUY can remain unread after an early stop. No alternate-policy counterfactual was run, so which policy gives the better semantic answer is **not measured**. The hard budget constraint was checked using integer micro-USDC in all 48 trials.

Citation reward concentration uses **citation legs only**, grouped by creator source; tolls are excluded. ${concentration.length}/48 trials had nonzero citation rewards. Mean per-trial top-source share was ${mean("topRewardShare")}; mean per-trial HHI was ${mean("rewardHhi")}. Every exact numerator/denominator and per-source amount is retained in the JSON; zero-reward trials have null concentration. This fixed extractive engine and tiny corpus can favor redundant or stale records. The Lumen fixture deliberately contains a conflicting free threshold. Literal quotation can pass while the required fact is absent; a quotation is not entailment or truth.

## Fixed protocol and ground truth

- Four fixed publicly published fictional questions, each with two authored required facts and four retained source bodies (one free, three priced). Bodies, titles, summaries, URLs and order are constant across the matrix. The paid catalogue price is 1000, 4000 or 12000 micro-USDC per item; budgets are 0, 6000, 18000 or 60000 micro-USDC. No result is hand-authored.
- Actual deep-mode orchestration, fixed heuristic engine, attention limit 4, at most one reevaluation round, citation pool ratio 0.5, model allowance 0, search allowance 0. Observe engine methods by delegating to their original implementation unchanged. Public discovery is disabled by an explicit job-scoped effect strategy.
- A new real SQLite \`:memory:\` store and empty cache are created for **each** trial. Only declared local read methods are exposed to the pipeline. The complete effects strategy owns local cache and simulated ledger; notifications, activation and memory sinks are isolated no-ops. Query history is never persisted. No \`getDb\`, live gateway or dependency factory is called.
- A fresh worker process uses a closed environment, forces offline/testnet, blanks Supabase and model credentials before dynamic runtime imports, and denies outbound HTTP, fetch, sockets, DNS, TLS, UDP and WebSockets. Any attempted outbound call fails the whole study, even if application code catches its error. Observed outbound attempts: ${result.outboundAttempts}.
- Retained UTF-8 body SHA-256 and Keryx's exact article content-version tuple are checked before every run. A literal evidence row must match actual read marker, creator, item, URL, content version and body hash, quote bytes present in both retained and read bodies, an actual answer quote/marker and matching citation. Paid rows additionally require the exact simulated fetch receipt for this run/item/version.
- Literal claim coverage is the fraction of actual decomposed claims with such a row. Completeness is the fraction of the two declared facts whose exact literal appears in the delivered answer and in a verified quote from a declared fact-bearing document. Citation quality here means the fraction of actual citations with such a verified row; a zero denominator is null, not zero or perfect. These checks do **not** test paraphrase entailment, calibration, broader factual correctness, semantic unsupported claims or false-supported rate.
- Exact sums use BigInt micro-USDC. Non-finite, negative, unsafe or greater-than-six-decimal legacy numbers are refused instead of rounded. Simulated spend must equal the actual run total and remain within budget. Settled or pending records and non-null transactions are refused.

| Question | Required fact literals | Fixture boundary |
| --- | --- | --- |
${corpus.questions.map(question => `| ${question.id}: ${question.question} | ${question.facts.map(fact => fact.literal).join(" ")} | ${question.description} |`).join("\n")}

Exploration's causal effect is **not measured**: this version of \`runAgent\` has no separate exploration-allowance input. No replacement agent or policy was invented. Live LLM behavior/cost, external-search behavior, real settlement, creator response, repeated human questions and open-domain semantic quality are also **not measured**. The sample is four authored cases × four budgets × three prices, with one deterministic run per cell; there is no stochastic repetition, uncertainty interval or population inference.

## Reproduce and inspect

Use the supported Node.js runtime and pinned npm 11.19.0 lockfile installation, then:

\`\`\`sh
npm run eval:paying-source-study -- --check
npm run eval:paying-source-study -- --write
\`\`\`

The bounded CLI runs all 48 actual trials in a fresh process (128 KiB corpus ceiling, 120-second deadline, 4 MiB output ceiling). \`--check\` compares canonical output **and this generated write-up** exactly after Git CRLF-to-LF text normalization; it does not ignore other byte/value differences. \`--write\` replaces only these two public study artifacts after all checks pass. It accepts no model, provider, corpus, wallet, private-input or arbitrary-output option. Both commands deny outbound study I/O; neither spends funds or touches a shared database.

- [Retained corpus and authored facts](../../fixtures/evals/studies/paying-source-corpus-v1.json)
- [Actual canonical synthetic outputs, proposals, reads, simulated ledger and metrics](../../fixtures/evals/studies/paying-source-results-v1.json)
- [Launcher](../../scripts/eval-paying-source-study.mts), [actual pipeline runner](../../lib/evals/paying-source-study/runner.ts), [literal rubric](../../lib/evals/paying-source-study/rubric.ts), [report generator](../../lib/evals/paying-source-study/report.ts)

Corpus canonical SHA-256: \`${result.corpusSha256}\`. Lock SHA-256: \`${result.lockSha256}\`. The JSON pins ${Object.keys(result.runtimeSources).length} application source files reachable by static literal relative/\`@/\` imports, exports and imports/requires from the launcher, including potential unexecuted branches. The TypeScript syntax walker does not prove a complete executed dependency graph; ${result.unresolvedSourceInputs.length} unresolved/nonliteral forms are listed in the JSON, and arbitrary filesystem reads/generated code are outside this source boundary. Source and lock hashes normalize CRLF to LF to match Git's text across Windows/Linux; no other source transformation occurs. Node built-ins use the declared supported runtime; package dependency bytes are bounded by the lockfile, not independently audited here. Relevant source/dependency changes require actual reproduction and review of the newly generated artifact, rather than waiving a drift. Canonicalization omits only ${result.canonicalOmissions.map(field => `\`${field}\``).join(", ")}; answer, decision, quote, policy trace and payment values are actual outputs. Numeric rates in tables are rounded only for display; exact counts/ratios and integer amounts are retained.

## Surface and acceptance boundaries

This is a shared offline evaluation and public report. README and Proof link to it; the CLI reproduces it. Web/desktop research, API, remote and stdio MCP, extensions and bots gain **no new research or payment authority**, tool, quota, enrollment or custody behavior. Existing runtime and rewards policy remain authoritative. No study claim asserts a deployed or published version.

This source candidate does not close issue #302 by itself. Exact-source local reproduction, focused regressions, both TypeScript graphs, lint, default production build, required hosted CI, independent review and the applicable synchronized release gates must be recorded separately. Full issue closure and broader value-of-paying/semantic claims remain open until their required evidence exists.
`;
}
