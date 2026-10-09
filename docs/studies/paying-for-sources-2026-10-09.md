# Paying for sources: a controlled offline fixture study (2026-10-09)

This is a reproducible **48-trial synthetic study**, using Keryx's actual `runAgent`, `HeuristicEngine` and `OfflineGateway`. All questions, documents, wallets and outputs are fictional and publicly published here. No private question or real user behavior is sampled. No payment settles: every recorded payment is `simulated`, `settled: false`, with `txHash: null` on the isolated Arc testnet profile. These amounts are not traction or creator earnings.

## Observed fixture results

Across 48 trials, 42 paid fixture reads cost 161000 simulated micro-USDC in tolls, and 504000 simulated micro-USDC was allocated as citation rewards. Required-fact completeness was 30/96 (31.3%); literal read-bound claim coverage was 96/96 (100.0%). These are lexical closed-fixture measurements, not semantic correctness or open-domain supported-claim estimates.

Each budget row contains the same four questions at all three prices (12 trials). Each price row contains the same four questions at all four budgets (16 trials). Read counts include free reads; paid reads count actual simulated fetch payments, rather than BUY proposals.

| Budget (micro-USDC) | Trials | Reads / paid reads | Literal read-bound claims | Required facts | Literal read-bound citations | Toll / citation micro-USDC | Initial proposal/final action changes |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: |
| 0 | 12 | 12 / 0 | 24/24 (100.0%) | 6/24 (25.0%) | 12/12 (100.0%) | 0 / 0 | 36 |
| 6000 | 12 | 19 / 7 | 24/24 (100.0%) | 7/24 (29.2%) | 13/13 (100.0%) | 7000 / 36000 | 35 |
| 18000 | 12 | 26 / 14 | 24/24 (100.0%) | 8/24 (33.3%) | 14/14 (100.0%) | 35000 / 108000 | 34 |
| 60000 | 12 | 33 / 21 | 24/24 (100.0%) | 9/24 (37.5%) | 15/15 (100.0%) | 119000 / 360000 | 33 |

| Paid catalogue price (micro-USDC) | Trials | Reads / paid reads | Literal read-bound claims | Required facts | Literal read-bound citations | Toll / citation micro-USDC | Initial proposal/final action changes |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: |
| 1000 | 16 | 37 / 21 | 32/32 (100.0%) | 11/32 (34.4%) | 19/19 (100.0%) | 21000 / 168000 | 45 |
| 4000 | 16 | 30 / 14 | 32/32 (100.0%) | 10/32 (31.3%) | 18/18 (100.0%) | 56000 / 168000 | 46 |
| 12000 | 16 | 23 / 7 | 32/32 (100.0%) | 9/32 (28.1%) | 17/17 (100.0%) | 84000 / 168000 | 47 |

Price response in this matrix is the observed number of paid reads under the existing hard budget, attention, portfolio and sufficiency policies. It is not general willingness to pay, nor an estimated demand curve. The heuristic's initial lexical value proposals, actual reevaluation inputs/outputs and the written policy are retained separately. The action-change column counts initial decide proposals whose final action differs, not reevaluation recommendations. Changes include free-source BUY-to-CACHE normalization; CACHE on a free source does not imply a pre-existing cache hit. A final BUY can remain unread after an early stop. No alternate-policy counterfactual was run, so which policy gives the better semantic answer is **not measured**. The hard budget constraint was checked using integer micro-USDC in all 48 trials.

Citation reward concentration uses **citation legs only**, grouped by creator source; tolls are excluded. 36/48 trials had nonzero citation rewards. Mean per-trial top-source share was 0.9167; mean per-trial HHI was 0.9167. Every exact numerator/denominator and per-source amount is retained in the JSON; zero-reward trials have null concentration. This fixed extractive engine and tiny corpus can favor redundant or stale records. The Lumen fixture deliberately contains a conflicting free threshold. Literal quotation can pass while the required fact is absent; a quotation is not entailment or truth.

## Fixed protocol and ground truth

- Four fixed publicly published fictional questions, each with two authored required facts and four retained source bodies (one free, three priced). Bodies, titles, summaries, URLs and order are constant across the matrix. The paid catalogue price is 1000, 4000 or 12000 micro-USDC per item; budgets are 0, 6000, 18000 or 60000 micro-USDC. No result is hand-authored.
- Actual deep-mode orchestration, fixed heuristic engine, attention limit 4, at most one reevaluation round, citation pool ratio 0.5, model allowance 0, search allowance 0. Observe engine methods by delegating to their original implementation unchanged. Public discovery is disabled by an explicit job-scoped effect strategy.
- A new real SQLite `:memory:` store and empty cache are created for **each** trial. Only declared local read methods are exposed to the pipeline. The complete effects strategy owns local cache and simulated ledger; notifications, activation and memory sinks are isolated no-ops. Query history is never persisted. No `getDb`, live gateway or dependency factory is called.
- A fresh worker process uses a closed environment, forces offline/testnet, blanks Supabase and model credentials before dynamic runtime imports, and denies outbound HTTP, fetch, sockets, DNS, TLS, UDP and WebSockets. Any attempted outbound call fails the whole study, even if application code catches its error. Observed outbound attempts: 0.
- Retained UTF-8 body SHA-256 and Keryx's exact article content-version tuple are checked before every run. A literal evidence row must match actual read marker, creator, item, URL, content version and body hash, quote bytes present in both retained and read bodies, an actual answer quote/marker and matching citation. Paid rows additionally require the exact simulated fetch receipt for this run/item/version.
- Literal claim coverage is the fraction of actual decomposed claims with such a row. Completeness is the fraction of the two declared facts whose exact literal appears in the delivered answer and in a verified quote from a declared fact-bearing document. Citation quality here means the fraction of actual citations with such a verified row; a zero denominator is null, not zero or perfect. These checks do **not** test paraphrase entailment, calibration, broader factual correctness, semantic unsupported claims or false-supported rate.
- Exact sums use BigInt micro-USDC. Non-finite, negative, unsafe or greater-than-six-decimal legacy numbers are refused instead of rounded. Simulated spend must equal the actual run total and remain within budget. Settled or pending records and non-null transactions are refused.

| Question | Required fact literals | Fixture boundary |
| --- | --- | --- |
| meridian: What is Meridian reservoir capacity? When did Meridian reservoir open? | Meridian reservoir capacity is 42 million liters. Meridian reservoir opened on 12 May 2024. | A useful free fact and a complementary paid fact. |
| aurora: What is Aurora beacon battery lifetime? What is Aurora beacon service interval? | Aurora beacon battery lifetime is 18 months. Aurora beacon service interval is 90 days. | A free hardware fact and a paid maintenance fact. |
| cedar: What is Cedar archive backup frequency? What is Cedar archive retention period? | Cedar archive backup frequency is every 6 hours. Cedar archive retention period is 35 days. | The free overview omits both required facts; complementary paid records hold them. |
| lumen: What is Lumen sensor alarm threshold? What is Lumen sensor calibration interval? | Lumen sensor alarm threshold is 70 units. Lumen sensor calibration interval is 14 days. | A stale free threshold conflicts with the retained required-fact record; no conflict detection is assumed. |

Exploration's causal effect is **not measured**: this version of `runAgent` has no separate exploration-allowance input. No replacement agent or policy was invented. Live LLM behavior/cost, external-search behavior, real settlement, creator response, repeated human questions and open-domain semantic quality are also **not measured**. The sample is four authored cases × four budgets × three prices, with one deterministic run per cell; there is no stochastic repetition, uncertainty interval or population inference.

## Reproduce and inspect

Use the supported Node.js runtime and pinned npm 11.19.0 lockfile installation, then:

```sh
npm run eval:paying-source-study -- --check
npm run eval:paying-source-study -- --write
```

The bounded CLI runs all 48 actual trials in a fresh process (128 KiB corpus ceiling, 120-second deadline, 4 MiB output ceiling). `--check` compares canonical output **and this generated write-up** exactly after Git CRLF-to-LF text normalization; it does not ignore other byte/value differences. `--write` replaces only these two public study artifacts after all checks pass. It accepts no model, provider, corpus, wallet, private-input or arbitrary-output option. Both commands deny outbound study I/O; neither spends funds or touches a shared database.

- [Retained corpus and authored facts](../../fixtures/evals/studies/paying-source-corpus-v1.json)
- [Actual canonical synthetic outputs, proposals, reads, simulated ledger and metrics](../../fixtures/evals/studies/paying-source-results-v1.json)
- [Launcher](../../scripts/eval-paying-source-study.mts), [actual pipeline runner](../../lib/evals/paying-source-study/runner.ts), [literal rubric](../../lib/evals/paying-source-study/rubric.ts), [report generator](../../lib/evals/paying-source-study/report.ts)

Corpus canonical SHA-256: `a61a6e74dd97ba536780a4a9f63842d379526ba5516b7f723f6205539113fa57`. Lock SHA-256: `41bbceaa7c51287c2d38d57d58d5acce3e233c7603b816f557c635de84a2479a`. The JSON pins 328 application source files reachable by static literal relative/`@/` imports, exports and imports/requires from the launcher, including potential unexecuted branches. The TypeScript syntax walker does not prove a complete executed dependency graph; 0 unresolved/nonliteral forms are listed in the JSON, and arbitrary filesystem reads/generated code are outside this source boundary. Source and lock hashes normalize CRLF to LF to match Git's text across Windows/Linux; no other source transformation occurs. Node built-ins use the declared supported runtime; package dependency bytes are bounded by the lockfile, not independently audited here. Relevant source/dependency changes require actual reproduction and review of the newly generated artifact, rather than waiving a drift. Canonicalization omits only `QueryRun.createdAt`, `QueryRun.durationMs`, `TraceStep.ts`, `PaymentRecord.id`, `PaymentRecord.createdAt`, `TraceStep.detail.PaymentRecord.id`, `TraceStep.detail.PaymentRecord.createdAt`; answer, decision, quote, policy trace and payment values are actual outputs. Numeric rates in tables are rounded only for display; exact counts/ratios and integer amounts are retained.

## Surface and acceptance boundaries

This is a shared offline evaluation and public report. README and Proof link to it; the CLI reproduces it. Web/desktop research, API, remote and stdio MCP, extensions and bots gain **no new research or payment authority**, tool, quota, enrollment or custody behavior. Existing runtime and rewards policy remain authoritative. No study claim asserts a deployed or published version.

This source candidate does not close issue #302 by itself. Exact-source local reproduction, focused regressions, both TypeScript graphs, lint, default production build, required hosted CI, independent review and the applicable synchronized release gates must be recorded separately. Full issue closure and broader value-of-paying/semantic claims remain open until their required evidence exists.
