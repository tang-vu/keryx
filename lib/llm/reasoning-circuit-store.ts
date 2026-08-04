/**
 * Provider circuit state that survives the process which observed a failure.
 *
 * Production dispatches come from the Next server and from short-lived volume workers. A module
 * Map therefore cannot protect the next worker from a provider that just spent a full timeout
 * failing. The durable store uses the shared Keryx DB; its memory mirror is a fail-degraded path
 * for a DB outage and the hermetic default used by direct ResilientEngine unit tests.
 */

import { getDb } from "../db";
import type {
  KeryxDB,
  ReasoningCircuitDecision,
  ReasoningCircuitRecord,
} from "../db/keryx-db";

export interface ReasoningCircuitFailurePolicy {
  transient: boolean;
  now: number;
  failureThreshold: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

export interface ReasoningCircuitStore {
  acquire(key: string, now: number, probeLeaseMs: number): Promise<ReasoningCircuitDecision>;
  failed(key: string, policy: ReasoningCircuitFailurePolicy): Promise<ReasoningCircuitRecord>;
  succeeded(key: string): Promise<void>;
}

function boundedError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

export class MemoryReasoningCircuitStore implements ReasoningCircuitStore {
  private readonly states = new Map<string, ReasoningCircuitRecord>();

  async acquire(
    key: string,
    now: number,
    probeLeaseMs: number,
  ): Promise<ReasoningCircuitDecision> {
    const state = this.states.get(key);
    if (!state || (state.openUntil === 0 && state.probeUntil <= now)) {
      return { allowed: true, retryAfterMs: 0 };
    }
    if (state.openUntil > now || state.probeUntil > now) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, Math.max(state.openUntil, state.probeUntil) - now),
      };
    }

    state.probeUntil = now + probeLeaseMs;
    state.updatedAt = now;
    return { allowed: true, retryAfterMs: 0 };
  }

  async failed(
    key: string,
    policy: ReasoningCircuitFailurePolicy,
  ): Promise<ReasoningCircuitRecord> {
    const previous = this.states.get(key)?.failures ?? 0;
    const failures = policy.transient
      ? previous + 1
      : Math.max(previous + 1, policy.failureThreshold);
    const exponent = Math.max(0, Math.min(20, failures - policy.failureThreshold));
    const maxCooldownMs = Math.max(policy.baseCooldownMs, policy.maxCooldownMs);
    const cooldown = Math.min(
      maxCooldownMs,
      policy.baseCooldownMs * 2 ** exponent,
    );
    const record: ReasoningCircuitRecord = {
      key,
      failures,
      openUntil: failures >= policy.failureThreshold ? policy.now + cooldown : 0,
      probeUntil: 0,
      updatedAt: policy.now,
    };
    this.states.set(key, record);
    return { ...record };
  }

  async succeeded(key: string): Promise<void> {
    this.states.delete(key);
  }

  /** Mirror a successful durable write so a later DB outage degrades to the same known state. */
  remember(record: ReasoningCircuitRecord): void {
    this.states.set(record.key, { ...record });
  }

  reset(): void {
    this.states.clear();
  }
}

/**
 * DB-backed store with an in-memory safety net. Store failures never turn a successful provider
 * response into a failed reasoning step; they only reduce circuit sharing until persistence is
 * reachable again.
 */
export class DurableReasoningCircuitStore implements ReasoningCircuitStore {
  constructor(
    private readonly loadDb: () => Promise<KeryxDB> = getDb,
    private readonly fallback = new MemoryReasoningCircuitStore(),
  ) {}

  async acquire(
    key: string,
    now: number,
    probeLeaseMs: number,
  ): Promise<ReasoningCircuitDecision> {
    try {
      const db = await this.loadDb();
      return await db.acquireReasoningCircuit(key, now, probeLeaseMs);
    } catch (err) {
      console.error(
        `[keryx llm] durable circuit read failed; using process memory: ${boundedError(err)}`,
      );
      return this.fallback.acquire(key, now, probeLeaseMs);
    }
  }

  async failed(
    key: string,
    policy: ReasoningCircuitFailurePolicy,
  ): Promise<ReasoningCircuitRecord> {
    try {
      const db = await this.loadDb();
      const record = await db.recordReasoningCircuitFailure(
        key,
        policy.transient,
        policy.now,
        policy.failureThreshold,
        policy.baseCooldownMs,
        policy.maxCooldownMs,
      );
      this.fallback.remember(record);
      return record;
    } catch (err) {
      console.error(
        `[keryx llm] durable circuit write failed; using process memory: ${boundedError(err)}`,
      );
      return this.fallback.failed(key, policy);
    }
  }

  async succeeded(key: string): Promise<void> {
    await this.fallback.succeeded(key);
    try {
      const db = await this.loadDb();
      await db.clearReasoningCircuit(key);
    } catch (err) {
      console.error(`[keryx llm] durable circuit clear failed: ${boundedError(err)}`);
    }
  }
}

/** Shared by every engine chain built in this process; the DB joins it to other processes. */
export const durableReasoningCircuitStore = new DurableReasoningCircuitStore();

/** Direct ResilientEngine callers/tests keep the old hermetic process-local behavior. */
export const memoryReasoningCircuitStore = new MemoryReasoningCircuitStore();
