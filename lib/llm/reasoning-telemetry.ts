import { z } from "zod";
import type { ReasoningAttempt, ReasoningStep } from "./reasoning-engine";
import { collectOutputLimits, MAX_OUTPUT_LIMIT_TRACE_STEPS, outputLimitText, type OutputLimitDiagnostic } from "./output-limit-diagnostic";

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
  outputTokenLimit: count.min(1).optional(),
}).refine(value => value.outcome === "circuit-open" ? value.attempt === 0 : value.attempt > 0)
  .refine(value => value.outputTokenLimit === undefined || value.outcome === "failed" && value.error === "output_validation");

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
  /** Optional explicit stops from recorded attempts or retained synthesis trace. */
  outputLimits?: OutputLimitDiagnostic[];
  outputLimitTraceStepsOmitted?: number;
  reasoning: {
    telemetry: "recorded" | "incomplete" | "unavailable";
    attemptsOmitted: number;
    steps: ReasoningServingStep[];
    sourceSelection: ReasoningServingStep;
  };
}

/** The shared bounded public contract. Never infer serving from the aggregate
 * engine, expose provider bodies, or certify model-only serving after omission. */
export function surfaceReasoning(recorded: unknown, trace?: unknown): ReasoningSurface {
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
  const outputLimits = collectOutputLimits(attempts, trace);
  const traceStepsOmitted = Array.isArray(trace) ? Math.max(0, trace.length - MAX_OUTPUT_LIMIT_TRACE_STEPS) : 0;
  return { reasoningAttempts: attempts, ...(outputLimits.length ? { outputLimits } : {}),
    ...(traceStepsOmitted ? { outputLimitTraceStepsOmitted: traceStepsOmitted } : {}), reasoning: { telemetry, attemptsOmitted: omitted,
    steps: reasoningSteps.filter(step => attempts.some(attempt => attempt.step === step)).map(summarize),
    sourceSelection: summarize("decide") } };
}

/** Text-only clients consume the same recorded facts; absent history stays unknown. */
export function reasoningServingText(result: Partial<ReasoningSurface>): string {
  const attemptLimits = surfaceReasoning(result.reasoningAttempts).outputLimits ?? [];
  const hostedLimits = Array.isArray(result.outputLimits) ? result.outputLimits.slice(0, 2304) : [];
  const limit = outputLimitText([...attemptLimits, ...hostedLimits], "en", result.outputLimitTraceStepsOmitted);
  const withLimit = (message: string) => message + (limit ? `\n${limit}` : "");
  const reasoning = result.reasoning;
  if (!reasoning || !Array.isArray(reasoning.steps)) return withLimit("Per-step serving tiers: unavailable in this recorded result.");
  if (!reasoning.steps.length) return withLimit(`Per-step serving tiers: no recorded steps (${reasoning.telemetry} attempt telemetry).`);
  const serving = `Per-step serving tiers (${reasoning.telemetry} attempt telemetry): ` + reasoning.steps.map(step => {
    const engines = step.servingEngines.slice(0, 4).join(" + ") || "none recorded";
    const remainder = step.servingEngines.length > 4 ? ` + ${step.servingEngines.length - 4} more` : "";
    const fallback = step.fallbackUsed === true ? "fallback served" : step.fallbackUsed === false ? "requested tier served" : "fallback use unknown";
    return `${step.step}: ${engines}${remainder} (${step.state}; ${fallback})`;
  }).join("; ");
  return withLimit(serving);
}

/** A proven response stop, never inferred from token usage, a generic 503 or missing history. */
export function reasoningOutputLimitText(recorded: unknown, language: "en" | "vi" = "en", trace?: unknown): string | null {
  const result = surfaceReasoning(recorded, trace);
  return outputLimitText(result.outputLimits, language, result.outputLimitTraceStepsOmitted);
}
