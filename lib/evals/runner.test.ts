import { describe, expect, it } from "vitest";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { AGENT_EVAL_CORPUS, corpusFingerprint } from "./corpus";
import { runAgentEvaluation } from "./runner";

describe("agent evaluation runner", () => {
  it("runs the production orchestrator hermetically in deep mode", async () => {
    const report = await runAgentEvaluation({
      engine: new HeuristicEngine(),
      cases: [AGENT_EVAL_CORPUS[2]!], // deep mode would probe the live marketplace in production
    });
    expect(report.passed).toBe(true);
    expect(report.hardFailureCount).toBe(0);
    expect(report.cases[0]!.summary.readSourceIds.sort()).toEqual(["stable-budget", "x402"]);
  });

  it("binds the baseline to the complete frozen corpus", () => {
    expect(corpusFingerprint()).toMatch(/^[a-f0-9]{64}$/);
    expect(corpusFingerprint(AGENT_EVAL_CORPUS.slice(0, -1))).not.toBe(corpusFingerprint());
  });
});
