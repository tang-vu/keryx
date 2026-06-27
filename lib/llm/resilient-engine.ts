/**
 * ResilientEngine — wraps a real LLM engine (Anthropic / DeepSeek) so a transient
 * provider failure never kills a live run. Each reasoning call:
 *   1. retries on transient errors (HTTP 429 / 5xx / network) with short backoff, then
 *   2. falls back to the deterministic HeuristicEngine so the run always completes.
 *
 * The orchestrator still enforces the hard budget cap on top — the heuristic only
 * supplies reasoning, never moves money. The happy path is unchanged: the primary
 * engine answers on the first attempt and the fallback is never touched.
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
  console.warn(`[keryx llm] ${label} fell back to heuristic after provider failure: ${reason}`);
  return fallback();
}

export class ResilientEngine implements ReasoningEngine {
  readonly name: string;
  private readonly fallback = new HeuristicEngine();

  constructor(private readonly primary: ReasoningEngine) {
    this.name = primary.name;
  }

  decompose(question: string): Promise<string[]> {
    return withFallback("decompose", () => this.primary.decompose(question), () => this.fallback.decompose(question));
  }

  decide(input: DecideInput): Promise<Decision[]> {
    return withFallback("decide", () => this.primary.decide(input), () => this.fallback.decide(input));
  }

  sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    return withFallback("sufficiency", () => this.primary.sufficiency(input), () => this.fallback.sufficiency(input));
  }

  reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    return withFallback("reevaluate", () => this.primary.reevaluate(input), () => this.fallback.reevaluate(input));
  }

  synthesize(input: SynthInput): Promise<SynthResult> {
    return withFallback("synthesize", () => this.primary.synthesize(input), () => this.fallback.synthesize(input));
  }

  attribute(input: AttributeInput): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    return withFallback("attribute", () => this.primary.attribute(input), () => this.fallback.attribute(input));
  }
}
