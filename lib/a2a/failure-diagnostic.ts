import type { TraceStep } from "../types";
import {
  ReasoningInputLimitError,
  ReasoningOutputValidationError,
  ReasoningTransportError,
} from "../llm/reasoning-engine";
import { ResearchPlanningError } from "../llm/research-plan";
import { ResearchSelectionError } from "../llm/research-selection";
import { ResearchSelectionPartialBatchError } from "../llm/selection-input";

const stages = {
  decompose: true, discover: true, coverage: true, decide: true, fetch: true,
  sufficiency: true, reevaluate: true, synthesize: true, evidence: true,
  adjudicate: true, verdict: true, attribute: true, settle: true, done: true,
} satisfies Record<TraceStep["phase"], true>;

const categories = {
  input_limit: true, planning_refused: true, selection_invalid: true,
  output_invalid: true, provider_timeout: true, provider_network: true,
  provider_rate_limited: true, provider_failure: true, invalid_request: true, unknown: true,
} as const;

export type A2aFailureStage = TraceStep["phase"] | "unknown";
export type A2aFailureCategory = keyof typeof categories;

/** Private accounting metadata only. Never attach the exception or trace contents. */
export interface A2aFailureDiagnostic {
  stage: A2aFailureStage;
  category: A2aFailureCategory;
}

function stage(value: unknown): A2aFailureStage {
  return typeof value === "string" && Object.hasOwn(stages, value)
    ? value as TraceStep["phase"] : "unknown";
}

/** Read only an own data phase; getters, messages, details and hostile proxies are ignored. */
export function a2aTraceStage(step: unknown): A2aFailureStage {
  try {
    if (!step || typeof step !== "object") return "unknown";
    return stage(Object.getOwnPropertyDescriptor(step, "phase")?.value);
  } catch { return "unknown"; }
}

function category(error: unknown): A2aFailureCategory {
  try {
    if (error instanceof ReasoningInputLimitError) return "input_limit";
    if (error instanceof ResearchSelectionError) return "selection_invalid";
    if (error instanceof ResearchPlanningError) return "planning_refused";
    if (error instanceof ReasoningOutputValidationError) return "output_invalid";
    if (error instanceof ResearchSelectionPartialBatchError) {
      // The typed wrapper has already discarded the original exception. Project only
      // its own closed category, never HTTP status, batch count, cause or message.
      const value = Object.getOwnPropertyDescriptor(error, "category")?.value;
      if (value === "network") return "provider_network";
      if (value === "timeout") return "provider_timeout";
      if (value === "rate_limited") return "provider_rate_limited";
      if (value === "provider") return "provider_failure";
      if (value === "invalid_request") return "invalid_request";
      if (value === "input_limit") return "input_limit";
      return "unknown";
    }
    if (error instanceof ReasoningTransportError) {
      const value = Object.getOwnPropertyDescriptor(error, "category")?.value;
      if (value === "timeout") return "provider_timeout";
      if (value === "network") return "provider_network";
    }
  } catch { /* Even a revoked proxy must never replace or expose the original failure. */ }
  return "unknown";
}

/** Classification uses imported types, never exception names, messages or arbitrary HTTP fields. */
export function a2aFailureDiagnostic(error: unknown, lastStage: unknown = "unknown"): A2aFailureDiagnostic {
  return { stage: stage(lastStage), category: category(error) };
}

/** Stable bounded stdout text, safe even when an injected outcome contains extra private fields. */
export function formatA2aFailureDiagnostic(diagnostic: unknown): string {
  let safeStage: A2aFailureStage = "unknown";
  let safeCategory: A2aFailureCategory = "unknown";
  try {
    if (diagnostic && typeof diagnostic === "object") {
      safeStage = stage(Object.getOwnPropertyDescriptor(diagnostic, "stage")?.value);
      const value = Object.getOwnPropertyDescriptor(diagnostic, "category")?.value;
      if (typeof value === "string" && Object.hasOwn(categories, value)) safeCategory = value as A2aFailureCategory;
    }
  } catch { /* Opaque metadata cannot escape via a formatter or interrupt recovery. */ }
  return `stage=${safeStage} category=${safeCategory}`;
}
