/**
 * ResilientEngine — wraps a real LLM engine so a provider failure never kills a live run.
 * Each reasoning call:
 *   1. retries on transient errors (HTTP 429 / 5xx / network) with short backoff, then
 *   2. falls back to the given fallback engine (default: the deterministic HeuristicEngine)
 *      so the run always completes.
 *
 * Fallbacks chain: an Ollama-served pick wraps with fallback = ResilientEngine(DeepSeek),
 * which itself falls back to the heuristic — so an ask ALWAYS answers, in tiers of
 * decreasing capability. The orchestrator still enforces the hard budget cap on top —
 * fallback reasoning only supplies judgment, never moves money. The happy path is
 * unchanged: the primary engine answers on the first attempt.
 */

import { HeuristicEngine } from "./heuristic-engine";
import type {
  AttributeInput,
  DecideInput,
  ReevaluateInput,
  ReevaluateOutput,
  ReasoningEngine,
  SufficiencyInput,
  SufficiencyResult,
  SynthInput,
  SynthResult,
} from "./reasoning-engine";
import type { Decision } from "../types";

const MAX_ATTEMPTS = 3;

/** Transient = worth retrying: rate limits (429), timeouts (408), 5xx, or no status (network). */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true; // network / connection error
  return status === 429 || status === 408 || status >= 500;
}

async function withFallback<T>(
  label: string,
  fallbackName: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await primary();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1))); // 400ms, 800ms
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.warn(`[keryx llm] ${label} fell back to ${fallbackName} after provider failure: ${reason}`);
  return fallback();
}

export class ResilientEngine implements ReasoningEngine {
  readonly name: string;
  private readonly fallback: ReasoningEngine;

  constructor(
    private readonly primary: ReasoningEngine,
    fallback?: ReasoningEngine,
  ) {
    this.name = primary.name;
    this.fallback = fallback ?? new HeuristicEngine();
  }

  private run<T>(label: string, call: (e: ReasoningEngine) => Promise<T>): Promise<T> {
    return withFallback(
      label,
      this.fallback.name,
      () => call(this.primary),
      () => call(this.fallback),
    );
  }

  decompose(question: string): Promise<string[]> {
    return this.run("decompose", (e) => e.decompose(question));
  }

  decide(input: DecideInput): Promise<Decision[]> {
    return this.run("decide", (e) => e.decide(input));
  }

  sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    return this.run("sufficiency", (e) => e.sufficiency(input));
  }

  reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    return this.run("reevaluate", (e) => e.reevaluate(input));
  }

  synthesize(input: SynthInput): Promise<SynthResult> {
    return this.run("synthesize", (e) => e.synthesize(input));
  }

  attribute(input: AttributeInput): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    return this.run("attribute", (e) => e.attribute(input));
  }
}
