import { expect, it } from "vitest";
import type { ReasoningAttempt } from "./reasoning-engine";
import { surfaceReasoning, reasoningServingText } from "./reasoning-telemetry";

it("shows every actual per-step serving tier in a mixed model/heuristic run", () => {
  const attempt = (step: ReasoningAttempt["step"], engine: string, tier: number,
    outcome: ReasoningAttempt["outcome"]): ReasoningAttempt => ({ step, engine, tier, outcome, attempt: 1, startedAt: 1, durationMs: 0 });
  const result = surfaceReasoning([
    attempt("decompose", "llm:deepseek:deepseek-v4-flash", 0, "served"),
    attempt("decide", "llm:deepseek:deepseek-v4-flash", 0, "circuit-open"),
    attempt("decide", "llm:cloudflare:llama", 2, "input-limited"),
    attempt("decide", "heuristic", 3, "served"),
    attempt("decide", "llm:deepseek:deepseek-v4-flash", 0, "served"),
  ]);
  expect(result.reasoningTelemetry).toBe("recorded");
  expect(result.reasoningServing).toEqual([
    { step: "decompose", engines: ["llm:deepseek:deepseek-v4-flash"], tiers: [0], degraded: false, heuristic: false },
    { step: "decide", engines: ["heuristic", "llm:deepseek:deepseek-v4-flash"], tiers: [3, 0], degraded: true, heuristic: true },
  ]);
  expect(reasoningServingText(result)).toContain("decide: heuristic + llm:deepseek:deepseek-v4-flash (degraded)");
});

it("projects only bounded telemetry fields and marks missing history unavailable", () => {
  const attempt = { step: "decide", engine: "heuristic", tier: 1, attempt: 1, outcome: "served", startedAt: 1,
    durationMs: 0, error: "synthetic-private-body", prompt: "synthetic-private-body",
    inputBounds: { promptUtf8Bytes: 23000, requestedOutputTokens: 8192, maximumCombinedUnits: 23000, body: "synthetic-private-body" },
  } as unknown as ReasoningAttempt;
  expect(JSON.stringify(surfaceReasoning([attempt]))).not.toContain("synthetic-private-body");
  expect(surfaceReasoning(undefined)).toEqual({ reasoningTelemetry: "unavailable", reasoningAttempts: [], reasoningServing: [] });
  expect(reasoningServingText({})).toContain("unavailable");
});
