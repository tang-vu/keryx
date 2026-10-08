import { expect, it } from "vitest";
import type { ReasoningAttempt } from "./reasoning-engine";
import { surfaceReasoning, reasoningServingText, reasoningOutputLimitText } from "./reasoning-telemetry";
import { ReasoningOutputLimitError } from "./reasoning-engine";

it("shows every actual per-step serving tier in a mixed model/heuristic run", () => {
  const attempt = (step: ReasoningAttempt["step"], engine: string, tier: number,
    outcome: ReasoningAttempt["outcome"]): ReasoningAttempt => ({ step, engine, tier, outcome,
      attempt: outcome === "circuit-open" ? 0 : 1, startedAt: 1, durationMs: 0 });
  const result = surfaceReasoning([
    attempt("decompose", "llm:deepseek:deepseek-v4-flash", 0, "served"),
    attempt("decide", "llm:deepseek:deepseek-v4-flash", 0, "circuit-open"),
    attempt("decide", "llm:cloudflare:llama", 2, "input-limited"),
    attempt("decide", "heuristic", 3, "served"),
    attempt("decide", "llm:deepseek:deepseek-v4-flash", 0, "served"),
  ]);
  expect(result.reasoning.telemetry).toBe("recorded");
  expect(result.reasoning.steps).toEqual([
    { step: "decompose", state: "model", servingEngines: ["llm:deepseek:deepseek-v4-flash"], fallbackUsed: false },
    { step: "decide", state: "mixed", servingEngines: ["heuristic", "llm:deepseek:deepseek-v4-flash"], fallbackUsed: true },
  ]);
  expect(result.reasoning.sourceSelection).toEqual(result.reasoning.steps[1]);
  expect(reasoningServingText(result)).toContain("decide: heuristic + llm:deepseek:deepseek-v4-flash (mixed; fallback served)");
});

it("preserves typed request-local and transport classifications with only bounded input metadata", () => {
  const attempt = { step: "decide", engine: "llm:cloudflare:llama", tier: 1, attempt: 1, outcome: "input-limited", startedAt: 1,
    durationMs: 0, error: "input_limit", prompt: "synthetic-private-body",
    inputBounds: { promptUtf8Bytes: 23000, requestedOutputTokens: 8192, maximumCombinedUnits: 23000, body: "synthetic-private-body" },
  } as unknown as ReasoningAttempt;
  const result = surfaceReasoning([attempt,
    { ...attempt, inputBounds: undefined, outcome: "failed", error: "output_validation" },
    { ...attempt, inputBounds: undefined, outcome: "failed", error: "timeout" },
    { ...attempt, inputBounds: undefined, outcome: "failed", error: "internal" }]);
  expect(result.reasoning.telemetry).toBe("recorded");
  expect(result.reasoningAttempts[0]).toMatchObject({ outcome: "input-limited", error: "input_limit",
    inputBounds: { promptUtf8Bytes: 23000, requestedOutputTokens: 8192, maximumCombinedUnits: 23000 } });
  expect(result.reasoningAttempts.map(attempt => attempt.error)).toEqual(["input_limit", "output_validation", "timeout", "internal"]);
  expect(result.reasoning.sourceSelection).toMatchObject({ state: "unknown", servingEngines: [], fallbackUsed: null });
  expect(JSON.stringify(result)).not.toContain("synthetic-private-body");
  expect(result).not.toHaveProperty("reasoningTelemetry"); expect(result).not.toHaveProperty("reasoningServing");
});

it("marks missing history unavailable without inferring serving from an engine label", () => {
  expect(surfaceReasoning(undefined)).toEqual({ reasoningAttempts: [], reasoning: {
    telemetry: "unavailable", attemptsOmitted: 0, steps: [],
    sourceSelection: { step: "decide", state: "unknown", servingEngines: [], fallbackUsed: null },
  } });
  expect(reasoningServingText({})).toContain("unavailable");
});

it("marks malformed bounds incomplete instead of certifying a primary-only prefix", () => {
  const attempt: ReasoningAttempt = { step: "decide", engine: "llm:deepseek:model", tier: 0, attempt: 1,
    outcome: "served", startedAt: 1, durationMs: 0 };
  const result = surfaceReasoning([attempt, { ...attempt, error: "input_limit", outcome: "input-limited",
    inputBounds: { promptUtf8Bytes: -1, requestedOutputTokens: 8192, maximumCombinedUnits: 23000 } }]);
  expect(result.reasoningAttempts).toEqual([attempt]);
  expect(result.reasoning).toMatchObject({ telemetry: "incomplete", attemptsOmitted: 1,
    sourceSelection: { state: "unknown", servingEngines: [attempt.engine], fallbackUsed: null } });
  expect(reasoningServingText(result)).toContain("incomplete attempt telemetry");
  expect(reasoningServingText(result)).toContain("fallback use unknown");
});

it("shows an explicit output stop across text clients without reinterpreting historical 503s", () => {
  const attempt: ReasoningAttempt = { step: "synthesize", engine: "llm:deepseek:model", tier: 0, attempt: 1,
    outcome: "failed", error: "output_validation", outputTokenLimit: 2560, startedAt: 1, durationMs: 0 };
  const result = surfaceReasoning([Object.assign({}, attempt, { body: "synthetic private truncated output" }),
    { ...attempt, engine: "heuristic", outcome: "served", tier: 1, error: undefined, outputTokenLimit: undefined }]);
  expect(result.reasoningAttempts[0]).toEqual(attempt);
  expect(reasoningServingText(result)).toContain("answer preparation (2,560 tokens)");
  expect(reasoningOutputLimitText(result.reasoningAttempts, "vi")).toContain("thu hẹp câu hỏi");
  expect(JSON.stringify(result)).not.toContain("synthetic private truncated output");
  expect(reasoningOutputLimitText([{ ...attempt, outputTokenLimit: undefined, status: 503 }])).toBeNull();
  expect(reasoningOutputLimitText(undefined)).toBeNull();
  expect(reasoningOutputLimitText([])).toBeNull();
});

it.each([0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, "2560", null])("refuses malformed output ceiling %s", outputTokenLimit => {
  const attempt = { step: "synthesize", engine: "llm:deepseek:model", tier: 0, attempt: 1,
    outcome: "failed", error: "output_validation", outputTokenLimit, startedAt: 1, durationMs: 0 };
  const result = surfaceReasoning([attempt]);
  expect(result.reasoning).toMatchObject({ telemetry: "incomplete", attemptsOmitted: 1 });
  expect(reasoningOutputLimitText(result.reasoningAttempts)).toBeNull();
});

it.each(["served", "input-limited", "circuit-open"])("refuses output-stop metadata on a %s attempt", outcome => {
  const result = surfaceReasoning([{ step: "synthesize", engine: "llm:deepseek:model", tier: 0, attempt: outcome === "circuit-open" ? 0 : 1,
    outcome, error: "output_validation", outputTokenLimit: 2560, startedAt: 1, durationMs: 0 }]);
  expect(result.reasoning.telemetry).toBe("incomplete");
  expect(result.reasoningAttempts).toEqual([]);
});

it("bounds output-stop guidance while keeping the full bounded structured history", () => {
  const attempts = Array.from({ length: 256 }, (_, index) => ({ step: "synthesize", engine: "llm:deepseek:model", tier: 0,
    attempt: 1, outcome: "failed", error: "output_validation", outputTokenLimit: index + 1, startedAt: index, durationMs: 0 }));
  const result = surfaceReasoning(attempts);
  expect(result.reasoningAttempts).toHaveLength(256);
  expect(reasoningOutputLimitText(attempts)).toContain("248 other limits in telemetry");
  expect(reasoningOutputLimitText(attempts)!.length).toBeLessThan(800);
});

it.each([0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid typed output limit %s", limit => {
  expect(() => new ReasoningOutputLimitError(limit)).toThrow(RangeError);
});
