import type { ReasoningEngine } from "../llm/reasoning-engine";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { OfflineGateway } from "../payments/offline-gateway";
import { collectRun } from "../agent";
import { AGENT_EVAL_CORPUS, corpusFingerprint } from "./corpus";
import { aggregateMetrics, assertOnlySimulatedPayments, gradeAgentRun } from "./grader";
import { EVAL_SCHEMA_VERSION, type AgentEvalCase, type EvalReport } from "./types";

export async function runAgentEvaluation(options: {
  engine: ReasoningEngine;
  cases?: AgentEvalCase[];
  onCase?: (caseId: string, index: number, total: number) => void;
}): Promise<EvalReport> {
  const cases = options.cases ?? AGENT_EVAL_CORPUS;
  const results = [];

  for (let index = 0; index < cases.length; index++) {
    const testCase = cases[index]!;
    options.onCase?.(testCase.id, index, cases.length);
    const db = new SqliteAdapter(":memory:");
    try {
      await db.init();
      for (const entry of testCase.sources) {
        await db.upsertSource(entry.source);
        await db.addItems(entry.items);
      }
      const gateway = new OfflineGateway(db);
      const run = await collectRun(
        {
          question: testCase.question,
          budget: testCase.budget,
          researchMode: testCase.researchMode ?? "quick",
          origin: "engine",
          queryId: `eval-${testCase.id}`,
        },
        {
          deps: {
            engine: options.engine,
            db,
            gateway,
            // Deep-mode production runs probe Circle's live marketplace. The frozen harness never
            // crosses that boundary, regardless of environment configuration.
            discoverExternal: async () => [],
          },
        },
      );
      // listPaymentsByQuery intentionally exposes citation payouts only. The harness reconciles
      // the complete isolated ledger, including access tolls.
      const payments = (await db.listPayments(1_000)).filter((payment) => payment.queryId === run.id);
      assertOnlySimulatedPayments(payments);
      results.push(gradeAgentRun(testCase, { run, payments }));
    } finally {
      db.close();
    }
  }

  const hardFailureCount = results.reduce((sum, result) => sum + result.hardFailures.length, 0);
  return {
    schemaVersion: EVAL_SCHEMA_VERSION,
    corpusFingerprint: corpusFingerprint(cases),
    engine: options.engine.name,
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    passed: hardFailureCount === 0,
    score:
      results.length === 0
        ? 0
        : Math.round(
            (results.reduce((sum, result) => sum + result.score, 0) / results.length) * 100,
          ) / 100,
    hardFailureCount,
    metrics: aggregateMetrics(results),
    cases: results,
  };
}
