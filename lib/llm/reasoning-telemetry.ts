import type { ReasoningAttempt, ReasoningStep } from "./reasoning-engine";

export interface ReasoningServingStep {
  step: ReasoningStep;
  /** Every serving engine for this step, including repeated selection/assessment passes. */
  engines: string[];
  tiers: number[];
  degraded: boolean;
  heuristic: boolean;
}

export interface ReasoningSurface {
  reasoningTelemetry: "recorded" | "unavailable";
  reasoningAttempts: ReasoningAttempt[];
  reasoningServing: ReasoningServingStep[];
}

const steps = new Set<ReasoningStep>(["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "attribute"]);
const errors = new Set<ReasoningAttempt["error"]>(["timeout", "rate_limited", "provider", "network", "invalid_request", "output_validation", "input_limit", "internal"]);
const outcomes = new Set<ReasoningAttempt["outcome"]>(["served", "failed", "circuit-open", "input-limited"]);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Public allowlist projection: no exceptions, bodies, prompts or arbitrary historical fields. */
export function surfaceReasoning(attempts?: readonly ReasoningAttempt[]): ReasoningSurface {
  if (!Array.isArray(attempts)) return { reasoningTelemetry: "unavailable", reasoningAttempts: [], reasoningServing: [] };
  const reasoningAttempts: ReasoningAttempt[] = attempts.flatMap(attempt => {
    if (!attempt || !steps.has(attempt.step) || !outcomes.has(attempt.outcome) || typeof attempt.engine !== "string" ||
      attempt.engine.length > 200 || !nonnegative(attempt.tier) || !nonnegative(attempt.attempt) ||
      !nonnegative(attempt.startedAt) || !nonnegative(attempt.durationMs)) return [];
    const bounds = attempt.inputBounds;
    return [{ step: attempt.step, engine: attempt.engine, tier: attempt.tier, attempt: attempt.attempt,
      startedAt: attempt.startedAt, durationMs: attempt.durationMs, outcome: attempt.outcome,
      ...(nonnegative(attempt.retryAfterMs) ? { retryAfterMs: attempt.retryAfterMs } : {}),
      ...(nonnegative(attempt.status) && attempt.status >= 100 && attempt.status <= 599 ? { status: attempt.status } : {}),
      ...(errors.has(attempt.error) ? { error: attempt.error } : {}),
      ...(bounds && nonnegative(bounds.promptUtf8Bytes) && nonnegative(bounds.requestedOutputTokens) &&
        nonnegative(bounds.maximumCombinedUnits) ? { inputBounds: {
          promptUtf8Bytes: bounds.promptUtf8Bytes, requestedOutputTokens: bounds.requestedOutputTokens,
          maximumCombinedUnits: bounds.maximumCombinedUnits,
        } } : {}),
    }];
  });
  const byStep = new Map<ReasoningStep, ReasoningServingStep>();
  for (const attempt of reasoningAttempts) {
    let serving = byStep.get(attempt.step);
    if (!serving) {
      serving = { step: attempt.step, engines: [], tiers: [], degraded: false, heuristic: false };
      byStep.set(attempt.step, serving);
    }
    if (attempt.outcome !== "served") { serving.degraded = true; continue; }
    if (!serving.engines.includes(attempt.engine)) serving.engines.push(attempt.engine);
    if (!serving.tiers.includes(attempt.tier)) serving.tiers.push(attempt.tier);
    serving.degraded ||= attempt.tier > 0;
    serving.heuristic ||= attempt.engine === "heuristic";
  }
  return { reasoningTelemetry: "recorded", reasoningAttempts, reasoningServing: [...byStep.values()] };
}

export function reasoningServingText(result: Partial<ReasoningSurface>): string {
  if (result.reasoningTelemetry !== "recorded" || !Array.isArray(result.reasoningServing)) return "Per-step serving tiers: unavailable in this recorded result.";
  if (result.reasoningServing.length === 0) return "Per-step serving tiers: no recorded steps.";
  return "Per-step serving tiers: " + result.reasoningServing.map(step =>
    `${step.step}: ${step.engines.join(" + ") || "no served tier"}${step.degraded ? " (degraded)" : ""}`).join("; ");
}
