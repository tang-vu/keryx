import { describe, expect, it } from "vitest";
import { compareWithBaseline } from "./regression";
import type { EvalBaseline, EvalReport } from "./types";

const report = { schemaVersion: 1, corpusFingerprint: "abc", engine: "heuristic", generatedAt: new Date(0).toISOString(), caseCount: 1, passed: true, score: 90, hardFailureCount: 0, metrics: {}, cases: [{ caseId: "a", score: 90, hardFailures: [] }] } as unknown as EvalReport;
const baseline: EvalBaseline = { schemaVersion: 1, corpusFingerprint: "abc", engine: "heuristic", maxScoreRegression: 2, score: 91, cases: { a: 91 } };

describe("agent eval regression policy", () => {
  it("allows bounded score noise", () => expect(compareWithBaseline(report, baseline)).toEqual({ passed: true, failures: [] }));
  it("rejects unreviewed corpus changes", () => expect(compareWithBaseline({ ...report, corpusFingerprint: "changed" }, baseline).failures[0]).toMatch(/fingerprint changed/));
  it("rejects per-case regressions", () => expect(compareWithBaseline({ ...report, cases: [{ ...report.cases[0]!, score: 80 }] }, baseline).failures).toContain("a score 80.00 regressed below 89.00"));
});
