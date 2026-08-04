/**
 * ResilientEngine keeps a reasoning step alive without hiding who actually answered it.
 *
 * Each real tier retries transient failures only when no alternate model provider remains. When
 * another real tier is available, one failed attempt rotates immediately instead of multiplying
 * latency against the same unhealthy provider. The deterministic heuristic remains the final
 * tier. Provider-step circuits are durable across server/worker processes, while attempt telemetry
 * stays per engine instance/run.
 */

import { config } from "../config";
import { HeuristicEngine } from "./heuristic-engine";
import type {
  AttributeInput,
  DecideInput,
  ReasoningAttempt,
  ReevaluateInput,
  ReevaluateOutput,
  ReasoningEngine,
  ReasoningStep,
  SufficiencyInput,
  SufficiencyResult,
  SynthInput,
  SynthResult,
} from "./reasoning-engine";
import type { Decision } from "../types";
import {
  memoryReasoningCircuitStore,
  type ReasoningCircuitStore,
} from "./reasoning-circuit-store";

const MAX_ATTEMPTS = 3;

function circuitKey(name: string, step: ReasoningStep): string {
  // JSON keeps the pair unambiguous without NUL: SQLite accepts NUL in TEXT, PostgreSQL does not.
  return JSON.stringify([name, step]);
}

/** Transient means retryable: rate limits, timeouts, 5xx, or a network error with no status. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true;
  return status === 429 || status === 408 || status >= 500;
}

/** A full transport deadline is complete; repeating it only multiplies failover latency. */
function isTimeout(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const name = (err as { name?: string })?.name;
  return status === 408 || name === "TimeoutError" || name === "AbortError";
}

/** Persist only a bounded category/status, never a provider body that may echo request context. */
function errorTelemetry(err: unknown): Pick<ReasoningAttempt, "status" | "error"> {
  const status = (err as { status?: number })?.status;
  const name = (err as { name?: string })?.name;
  if (status === 408 || name === "TimeoutError" || name === "AbortError") {
    return { ...(status ? { status } : {}), error: "timeout" };
  }
  if (status === 429) return { status, error: "rate_limited" };
  if (status !== undefined && status >= 400 && status < 500) {
    return { status, error: "invalid_request" };
  }
  if (status !== undefined) return { status, error: "provider" };
  return { error: "network" };
}

/** Test hook for the hermetic memory store. Production state is cleared only by a real success. */
export function resetReasoningCircuitBreakers(): void {
  memoryReasoningCircuitStore.reset();
}

/** What actually answered: a nested resilient tier reports its own effective result. */
export function effectiveEngineName(engine: ReasoningEngine): string {
  return engine instanceof ResilientEngine ? engine.effectiveName : engine.name;
}

/** Structured attempts from every tier in one run's fallback chain. */
export function reasoningAttempts(engine: ReasoningEngine): ReasoningAttempt[] {
  return engine instanceof ResilientEngine ? engine.telemetry : [];
}

export class ResilientEngine implements ReasoningEngine {
  readonly name: string;
  private readonly fallback: ReasoningEngine;
  private readonly attempts: ReasoningAttempt[] = [];
  /** Reasoning calls the primary engine answered itself. */
  private served = 0;
  /** Calls that had to drop at least one tier. */
  private fell = 0;

  constructor(
    private readonly primary: ReasoningEngine,
    fallback?: ReasoningEngine,
    private readonly tier = 0,
    private readonly circuitStore: ReasoningCircuitStore = memoryReasoningCircuitStore,
  ) {
    this.name = primary.name;
    this.fallback = fallback ?? new HeuristicEngine();
  }

  /**
   * The run label is earned from the tiers that actually served it. It remains compact for public
   * receipts; the full per-attempt history lives in QueryRun.reasoningAttempts.
   */
  get effectiveName(): string {
    if (this.fell === 0) return this.name;
    const answered = effectiveEngineName(this.fallback);
    if (this.served === 0) return `${answered} (fallback from ${this.name})`;
    return `${this.name} + ${answered} on ${this.fell} step${this.fell !== 1 ? "s" : ""}`;
  }

  get telemetry(): ReasoningAttempt[] {
    const nested = this.fallback instanceof ResilientEngine ? this.fallback.telemetry : [];
    return [...this.attempts, ...nested].sort(
      (a, b) => a.startedAt - b.startedAt || a.tier - b.tier || a.attempt - b.attempt,
    );
  }

  private async runFallback<T>(
    label: ReasoningStep,
    call: (engine: ReasoningEngine) => Promise<T>,
  ): Promise<T> {
    if (this.fallback instanceof ResilientEngine) return call(this.fallback);

    const startedAt = Date.now();
    try {
      const out = await call(this.fallback);
      this.attempts.push({
        step: label,
        engine: this.fallback.name,
        tier: this.tier + 1,
        attempt: 1,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "served",
      });
      return out;
    } catch (err) {
      this.attempts.push({
        step: label,
        engine: this.fallback.name,
        tier: this.tier + 1,
        attempt: 1,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: "failed",
        ...errorTelemetry(err),
      });
      throw err;
    }
  }

  private async run<T>(
    label: ReasoningStep,
    call: (engine: ReasoningEngine) => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    // A configured alternate provider is itself the retry. Spend the three-attempt local retry
    // budget only on the last real provider before the heuristic; otherwise rotate after one
    // failure and give the next independent transport a chance.
    const maxAttempts = this.fallback instanceof HeuristicEngine ? MAX_ATTEMPTS : 1;
    const key = circuitKey(this.name, label);
    const circuit = await this.circuitStore.acquire(
      key,
      now,
      maxAttempts * config.llmTimeoutMs + 5_000,
    );
    if (!circuit.allowed) {
      this.attempts.push({
        step: label,
        engine: this.name,
        tier: this.tier,
        attempt: 0,
        startedAt: now,
        durationMs: 0,
        outcome: "circuit-open",
        retryAfterMs: circuit.retryAfterMs,
      });
      this.fell++;
      return this.runFallback(label, call);
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      try {
        const out = await call(this.primary);
        this.attempts.push({
          step: label,
          engine: this.name,
          tier: this.tier,
          attempt,
          startedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: "served",
        });
        await this.circuitStore.succeeded(key);
        this.served++;
        return out;
      } catch (err) {
        lastErr = err;
        this.attempts.push({
          step: label,
          engine: this.name,
          tier: this.tier,
          attempt,
          startedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: "failed",
          ...errorTelemetry(err),
        });
        if (isTimeout(err) || !isTransient(err) || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
      }
    }

    // With a real alternate available, one exhausted call is enough to route later work around
    // this tier. A single-provider deployment keeps the configurable threshold before it falls to
    // deterministic reasoning. Failure streaks survive half-open probes and grow the cooldown.
    await this.circuitStore.failed(key, {
      transient: isTransient(lastErr),
      now: Date.now(),
      failureThreshold:
        this.fallback instanceof HeuristicEngine ? config.llmCircuitFailures : 1,
      baseCooldownMs: config.llmCircuitCooldownMs,
      maxCooldownMs: Math.max(
        config.llmCircuitCooldownMs,
        config.llmCircuitMaxCooldownMs,
      ),
    });
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(
      `[keryx llm] ${label} fell back to ${this.fallback.name} after provider failure: ${reason}`,
    );
    this.fell++;
    return this.runFallback(label, call);
  }

  decompose(question: string): Promise<string[]> {
    return this.run("decompose", (engine) => engine.decompose(question));
  }

  decide(input: DecideInput): Promise<Decision[]> {
    return this.run("decide", (engine) => engine.decide(input));
  }

  sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    return this.run("sufficiency", (engine) => engine.sufficiency(input));
  }

  reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    return this.run("reevaluate", (engine) => engine.reevaluate(input));
  }

  synthesize(input: SynthInput): Promise<SynthResult> {
    return this.run("synthesize", (engine) => engine.synthesize(input));
  }

  attribute(input: AttributeInput): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    return this.run("attribute", (engine) => engine.attribute(input));
  }
}
