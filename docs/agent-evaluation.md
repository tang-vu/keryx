# Agent evaluation harness

Keryx treats reasoning quality and payment safety as separate dimensions. The harness runs the
real `runAgent` orchestration over a versioned frozen corpus, but gives every case a fresh SQLite
in-memory database and `OfflineGateway`. It neither reads production data nor possesses a route to
Circle settlement. The grader additionally rejects a run if any payment is settled, pending, has a
transaction id, or is not explicitly labelled `simulated`.

## Commands

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
