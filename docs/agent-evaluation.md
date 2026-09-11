# Agent evaluation harness

Keryx treats reasoning quality and payment safety as separate dimensions. The harness runs the
real `runAgent` orchestration over a versioned frozen corpus, but gives every case a fresh SQLite
in-memory database and `OfflineGateway`. It neither reads production data nor possesses a route to
Circle settlement. The grader additionally rejects a run if any payment is settled, pending, has a
transaction id, or is not explicitly labelled `simulated`.

## Commands

Since v0.22.56, final confidence also requires the final sufficiency conclusion.
High coverage with an insufficient final result stays Low. Regression tests hold
valid quotes and numeric coverage constant while changing the final conclusion, and
verify that the confidence/notice changes without altering citation rewards or total
spend. This is a consistency guarantee between assessment and presentation, not an
independent factual-quality guarantee.

Since v0.22.55, JSON-engine early stopping requires coverage >= 0.7 for every target,
a nonempty supported answer, known source markers and an explicit empty list of missing
requested parts. A high numeric score with a reported gap cannot stop reading. Unknown
or malformed assessments fail this stopping check without rewriting coverage/reward
scores. Source and spend caps still bound further reads. The heuristic baseline has
its own explicit offline policy; it is not evidence of live model sufficiency.

The September 11 regression exercises the actual agent loop with deterministic JSON
assessments: partial/high-score-with-gap first reads continue, a complete second read
stops before a third affordable source, and total spend stays within the supplied cap.
A separate live model diagnostic of the fictional internal-versus-external metrics case
returned insufficient (0.1 on each target) and correctly explained the absent external
cohort and measured p95. That single model-only sample is not independent review or
end-to-end quality acceptance.

```bash
npm run eval:agent
npm run eval:agent -- --case multi-claim-portfolio
npm run eval:agent -- --model <catalog-model-id> --no-baseline
```

The default suite uses the deterministic heuristic engine, compares against the reviewed baseline,
and is a CI gate. `--model` is an explicit local comparison run: it may call configured providers,
but still uses the isolated corpus and offline payment path. Model runs do not compare themselves
to the heuristic baseline.

Each run writes a full JSON report under `.artifacts/evals/` (gitignored). Scores cover citation
precision/recall, read precision/recall, expected decisions, evidence-bounded claim coverage,
evidence yield, and spend efficiency. Budget, payment provenance, forbidden reads, unexpected
citations, and scenario coverage floors are hard failures rather than score deductions.

## Corpus and baselines

Cases live in `lib/evals/corpus.ts`. The corpus SHA-256 binds the baseline to the exact questions,
paid bodies, prices, and expectations, so editing a test to make a regression disappear cannot
silently keep CI green.

After intentionally changing and reviewing the corpus or expected default behavior:

```bash
npm run eval:agent -- --write-baseline
git diff -- evals/baselines/heuristic.json
```

Commit a new baseline only after inspecting the per-case artifact. The baseline permits a two-point
score regression; hard safety failures always fail regardless of score. Duration is reported for
diagnostics but excluded from the deterministic CI score. The CLI refuses to write a baseline from
a suite containing any hard safety failure.

The harness deliberately has no LLM-as-judge in its safety or groundedness path. A future semantic
judge may be added as a secondary, non-authoritative metric, but it must never decide whether a
payment, quote, citation, or budget constraint is valid.

## English model boundary diagnostics

The separate [four-case fictional boundary corpus](./engineering/research-boundaries-2026-09-11.md)
covers confounded benchmarks, absent customer metrics, conflicting policy copies and
instructions embedded in sources. It does not change the heuristic baseline. Use
`node --import tsx scripts/eval-research-boundary-corpus.mts --check` without network,
or explicitly select `--live` for configured model calls and private report artifacts.
Review answer prose, citations and ledger against the case criteria; neither completion
nor a model coverage number is an automatic semantic pass. CI validates fixtures only.
