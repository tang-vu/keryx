import type { EvalBaseline, EvalReport } from "./types";

export interface RegressionResult {
  passed: boolean;
  failures: string[];
}

export function compareWithBaseline(report: EvalReport, baseline: EvalBaseline): RegressionResult {
  const failures: string[] = [];
  if (report.corpusFingerprint !== baseline.corpusFingerprint) {
    failures.push("corpus fingerprint changed; regenerate the reviewed baseline explicitly");
  }
  if (report.engine !== baseline.engine) {
    failures.push(`baseline engine is ${baseline.engine}, report engine is ${report.engine}`);
  }
  if (report.hardFailureCount > 0) failures.push(`${report.hardFailureCount} hard safety failure(s)`);
  if (report.score < baseline.score - baseline.maxScoreRegression) {
    failures.push(`suite score ${report.score.toFixed(2)} regressed below ${(baseline.score - baseline.maxScoreRegression).toFixed(2)}`);
  }
  for (const result of report.cases) {
    const expected = baseline.cases[result.caseId];
    if (expected === undefined) {
      failures.push(`case ${result.caseId} has no reviewed baseline`);
    } else if (result.score < expected - baseline.maxScoreRegression) {
      failures.push(`${result.caseId} score ${result.score.toFixed(2)} regressed below ${(expected - baseline.maxScoreRegression).toFixed(2)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

export function baselineFromReport(report: EvalReport, maxScoreRegression = 2): EvalBaseline {
  return {
    schemaVersion: report.schemaVersion,
    corpusFingerprint: report.corpusFingerprint,
    engine: report.engine,
    maxScoreRegression,
    score: report.score,
    cases: Object.fromEntries(report.cases.map((result) => [result.caseId, result.score])),
  };
}
