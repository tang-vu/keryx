/**
 * ResilientEngine — wraps a real LLM engine so a provider failure never kills a live run.
 * Each reasoning call:
 *   1. retries on transient errors (HTTP 429 / 5xx / network) with short backoff, then
 *   2. falls back to the given fallback engine (default: the deterministic HeuristicEngine)
 *      so the run always completes.
 *
 * Fallbacks chain: a non-default pick wraps with fallback = ResilientEngine(Flash),
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

/** What actually answered: an inner ResilientEngine reports its own effective tier, not its hope. */
export function effectiveEngineName(engine: ReasoningEngine): string {
  return engine instanceof ResilientEngine ? engine.effectiveName : engine.name;
}

export class ResilientEngine implements ReasoningEngine {
  readonly name: string;
  private readonly fallback: ReasoningEngine;
  /** Reasoning steps the primary engine answered itself. */
  private served = 0;
  /** Steps that had to drop a tier. */
  private fell = 0;

  constructor(
    private readonly primary: ReasoningEngine,
    fallback?: ReasoningEngine,
  ) {
    this.name = primary.name;
    this.fallback = fallback ?? new HeuristicEngine();
  }

  /**
   * The engine name a run should actually be *labelled* with.
   *
   * `name` is the pick the asker asked for and is fixed at construction — which is exactly how a
   * run whose every step fell back to the heuristic still got stamped `llm:deepseek:…` on its
   * permalink, in the archive and in the API response. A stale model id upstream turned that into
   * days of heuristic answers all presented as model-reasoned. For a product whose claim is that
   * the buy/skip decisions are model-reasoned, the label has to be earned per run.
   *
   * These counters are per-instance, which is only safe because engines are built per run
   * (see lib/llm/index.ts) — a shared instance would blend two askers' runs into one tally.
   */
  get effectiveName(): string {
    if (this.fell === 0) return this.name;
    const answered = effectiveEngineName(this.fallback);
    // Nothing the pick produced survived: lead with the engine that actually answered.
    if (this.served === 0) return `${answered} (fallback from ${this.name})`;
    return `${this.name} + ${answered} on ${this.fell} step${this.fell !== 1 ? "s" : ""}`;
  }

  private async run<T>(label: string, call: (e: ReasoningEngine) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const out = await call(this.primary);
        this.served++; // this step really was answered by the pick — the run may say so
        return out;
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1))); // 400ms, 800ms
      }
    }
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(
      `[keryx llm] ${label} fell back to ${this.fallback.name} after provider failure: ${reason}`,
    );
    this.fell++;
    return call(this.fallback);
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
