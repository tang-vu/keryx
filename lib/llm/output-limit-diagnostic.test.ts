import { expect, it } from "vitest";
import { collectOutputLimits, outputLimitText, parseSynthesisOutputLimit, synthesisOutputLimitFromError } from "./output-limit-diagnostic";
import { ReasoningOutputLimitError, ReasoningOutputValidationError } from "./reasoning-engine";
import { reasoningServingText, surfaceReasoning } from "./reasoning-telemetry";

const trace = (stage: "generation" | "review" = "review", outputTokenLimit = 2560) => ({ phase: "synthesize", ts: 1,
  message: "Fixed diagnostic", detail: { reasoningOutputLimit: { stage, outputTokenLimit, body: "PRIVATE" } } });

it("retains a safe stage/ceiling from trace when no serving telemetry exists", () => {
  const result = surfaceReasoning(undefined, [trace()]);
  expect(result.outputLimits).toEqual([{ step: "synthesize", stage: "review", outputTokenLimit: 2560 }]);
  expect(result.reasoning.telemetry).toBe("unavailable");
  expect(reasoningServingText(result)).toContain("evidence review");
  expect(reasoningServingText({ outputLimits: result.outputLimits })).toContain("2,560 tokens");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("deduplicates diagnostic kinds without erasing independent same-cap attempt and inner review observations", () => {
  const result = collectOutputLimits([{ step: "synthesize", engine: "llm:fixture", tier: 0, attempt: 1, startedAt: 1, durationMs: 0,
    outcome: "failed", error: "output_validation", outputTokenLimit: 2560 }], [trace("generation"), trace("review"), trace("generation")]);
  expect(result).toHaveLength(3);
  expect(result.map(item => item.stage)).toEqual(["generation", "review", undefined]);
  const fallbackReview = collectOutputLimits([{ step: "synthesize", engine: "llm:primary", tier: 0, attempt: 1, startedAt: 1, durationMs: 0,
    outcome: "failed", error: "output_validation", outputTokenLimit: 2560 }], [trace("review")]);
  expect(fallbackReview).toEqual([{ step: "synthesize", stage: "review", outputTokenLimit: 2560 },
    { step: "synthesize", outputTokenLimit: 2560 }]);
  expect(outputLimitText(fallbackReview)).toContain("evidence review");
  expect(outputLimitText(fallbackReview)).toContain("; answer preparation (2,560 tokens)");
});

it.each([undefined, {}, { stage: "input", outputTokenLimit: 2560 }, { stage: "review", outputTokenLimit: 0 },
  { stage: "review", outputTokenLimit: "2560" }, { stage: "review", outputTokenLimit: Infinity }])("refuses malformed synthesis detail %s", value => {
  expect(parseSynthesisOutputLimit(value)).toBeUndefined();
  expect(collectOutputLimits([], [{ ...trace(), detail: { reasoningOutputLimit: value } }])).toEqual([]);
});

it("ignores another trace phase, generic503 and arbitrary prose that mentions a token limit", () => {
  expect(collectOutputLimits([], [{ ...trace(), phase: "evidence" }, { phase: "synthesize", message: "2560 tokens", detail: { status: 503 } }])).toEqual([]);
  expect(synthesisOutputLimitFromError(Object.assign(new Error("length"), { outputTokenLimit: 2560 }), "synthesis")).toBeUndefined();
  expect(synthesisOutputLimitFromError(new ReasoningOutputValidationError("private body"), "review")).toBeUndefined();
  expect(synthesisOutputLimitFromError(new ReasoningOutputLimitError(2560), "review")).toEqual({ stage: "review", outputTokenLimit: 2560 });
});

it("does not evaluate a hostile output-token accessor", () => {
  const error = new ReasoningOutputValidationError("private body");
  Object.defineProperty(error, "outputTokenLimit", { get() { throw new Error("must not execute"); } });
  expect(synthesisOutputLimitFromError(error, "review")).toBeUndefined();
});

it("keeps late synthesis diagnostics and discloses earlier uninspected trace steps", () => {
  const result = surfaceReasoning([], [{ ...trace("generation"), detail: { reasoningOutputLimit: { stage: "generation", outputTokenLimit: 1280 } } },
    ...Array.from({ length: 2048 }, () => ({ phase: "discover", ts: 1, message: "No limit" })), trace()]);
  expect(result.outputLimitTraceStepsOmitted).toBe(2);
  expect(result.outputLimits).toEqual([{ step: "synthesize", stage: "review", outputTokenLimit: 2560 }]);
  expect(reasoningServingText(result)).toContain("2 earlier trace steps were not inspected");
  expect(outputLimitText([], "en", 1)).toContain("history is partial");
});

it("text clients reject forged hosted diagnostics rather than interpreting generic HTTP errors", () => {
  expect(outputLimitText([{ step: "synthesize", outputTokenLimit: -1, body: "PRIVATE" }])).toBeNull();
  expect(outputLimitText([{ step: "decide", stage: "review", outputTokenLimit: 2560 }])).toBeNull();
  expect(reasoningServingText({ outputLimits: { body: "PRIVATE" } as never })).not.toContain("PRIVATE");
  const attempts = [{ step: "synthesize" as const, engine: "llm:fixture", tier: 0, attempt: 1, startedAt: 1, durationMs: 0,
    outcome: "failed" as const, error: "output_validation" as const, outputTokenLimit: 2560 }];
  const hosted = Array(2305).fill({ step: "synthesize", outputTokenLimit: -1 });
  Object.defineProperty(hosted, 2304, { get() { throw new Error("Outside the client input bound"); } });
  expect(reasoningServingText({ reasoningAttempts: attempts, outputLimits: hosted })).toContain("2,560 tokens");
});
