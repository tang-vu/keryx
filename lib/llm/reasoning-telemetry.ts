import { z } from "zod";
import type { ReasoningAttempt, ReasoningStep } from "./reasoning-engine";

const reasoningSteps = ["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "attribute"] as const;
const MAX_PUBLIC_REASONING_ATTEMPTS = 256;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reasoningAttemptSchema = z.object({
  step: z.enum(reasoningSteps), engine: z.string().min(1).max(256).refine(value => !/[\r\n\0]/.test(value)),
  tier: count, attempt: count, startedAt: count, durationMs: count,
  outcome: z.enum(["served", "failed", "circuit-open", "input-limited"]), retryAfterMs: count.optional(),
  status: z.number().int().min(100).max(599).optional(),
  error: z.enum(["timeout", "rate_limited", "provider", "network", "invalid_request", "output_validation", "input_limit", "internal"]).optional(),
  inputBounds: z.object({ promptUtf8Bytes: count, requestedOutputTokens: count, maximumCombinedUnits: count }).optional(),
}).refine(value => value.outcome === "circuit-open" ? value.attempt === 0 : value.attempt > 0);

export interface ReasoningServingStep {
  step: ReasoningStep;
  state: "unknown" | "mixed" | "heuristic" | "model";
  /** Every recorded serving engine, including repeated or overlapping passes. */
  servingEngines: string[];
  /** Null when missing/omitted attempts prevent a negative conclusion. */
  fallbackUsed: boolean | null;
}

export interface ReasoningSurface {
  reasoningAttempts: ReasoningAttempt[];
  reasoning: {
    telemetry: "recorded" | "incomplete" | "unavailable";
    attemptsOmitted: number;
    steps: ReasoningServingStep[];
    sourceSelection: ReasoningServingStep;
  };
}

/** The shared bounded public contract. Never infer serving from the aggregate
 * engine, expose provider bodies, or certify model-only serving after omission. */
export function surfaceReasoning(recorded: unknown): ReasoningSurface {
  const input: unknown[] = Array.isArray(recorded) ? recorded : [];
  const attempts: ReasoningAttempt[] = [];
  for (const value of input.slice(0, MAX_PUBLIC_REASONING_ATTEMPTS)) {
    const parsed = reasoningAttemptSchema.safeParse(value);
    if (parsed.success) attempts.push(parsed.data);
  }
  const omitted = input.length - attempts.length;
  const telemetry = omitted || recorded != null && !Array.isArray(recorded) ? "incomplete" as const
    : attempts.length ? "recorded" as const : "unavailable" as const;
  const summarize = (step: ReasoningStep): ReasoningServingStep => {
    const served = attempts.filter(attempt => attempt.step === step && attempt.outcome === "served");
    const servingEngines = [...new Set(served.map(attempt => attempt.engine))];
    const heuristic = servingEngines.includes("heuristic");
    const models = servingEngines.some(engine => engine.startsWith("llm:"));
    const state = telemetry !== "recorded" || !served.length || servingEngines.some(engine => engine !== "heuristic" && !engine.startsWith("llm:"))
      ? "unknown" as const : heuristic && models ? "mixed" as const : heuristic ? "heuristic" as const : "model" as const;
    return { step, state, servingEngines,
      fallbackUsed: served.some(attempt => attempt.tier > 0) ? true : telemetry === "recorded" && served.length > 0 ? false : null };
  };
  return { reasoningAttempts: attempts, reasoning: { telemetry, attemptsOmitted: omitted,
    steps: reasoningSteps.filter(step => attempts.some(attempt => attempt.step === step)).map(summarize),
    sourceSelection: summarize("decide") } };
}

/** Text-only clients consume the same recorded facts; absent history stays unknown. */
export function reasoningServingText(result: Partial<ReasoningSurface>): string {
  const reasoning = result.reasoning;
  if (!reasoning || !Array.isArray(reasoning.steps)) return "Per-step serving tiers: unavailable in this recorded result.";
  if (!reasoning.steps.length) return `Per-step serving tiers: no recorded steps (${reasoning.telemetry} attempt telemetry).`;
  return `Per-step serving tiers (${reasoning.telemetry} attempt telemetry): ` + reasoning.steps.map(step => {
    const engines = step.servingEngines.slice(0, 4).join(" + ") || "none recorded";
    const remainder = step.servingEngines.length > 4 ? ` + ${step.servingEngines.length - 4} more` : "";
    const fallback = step.fallbackUsed === true ? "fallback served" : step.fallbackUsed === false ? "requested tier served" : "fallback use unknown";
    return `${step.step}: ${engines}${remainder} (${step.state}; ${fallback})`;
  }).join("; ");
}
