import { ReasoningInputLimitError, type LlmCallStage } from "./reasoning-engine";

/** Prospective ordinary work limits, independent of source USDC and retained originals. */
export interface OrdinaryComputeLimits {
  readonly calls: number;
  readonly promptUtf8Bytes: number;
  readonly requestedOutputTokens: number;
}
export const ORDINARY_COMPUTE_LIMITS: OrdinaryComputeLimits = Object.freeze({
  calls: 32,
  promptUtf8Bytes: 1_048_576,
  requestedOutputTokens: 131_072,
});

export type OrdinaryComputeLimit = keyof OrdinaryComputeLimits;
export interface OrdinaryComputeSnapshot {
  limits: OrdinaryComputeLimits;
  admitted: OrdinaryComputeLimits;
}

export class OrdinaryComputeLimitError extends ReasoningInputLimitError {
  constructor(readonly limit: OrdinaryComputeLimit) {
    super(`Research compute limit reached (${limit}); completed reads and payment receipts are retained.`);
  }
}

const stages = new Set<LlmCallStage>([
  "decompose", "decide", "sufficiency", "reevaluate", "synthesize", "evidence-review", "attribute",
]);
const bindings = new WeakMap<object, OrdinaryComputeBudget>();

/** A synchronous shared admission across every real provider/tier in one ordinary run.
 * Failed/unknown attempts retain their complete work allowance. Provider token counters
 * cannot replenish it. These are work bounds, not an invoice or a hard USD cap. */
export class OrdinaryComputeBudget {
  private readonly limits: OrdinaryComputeLimits;
  private admitted = { calls: 0, promptUtf8Bytes: 0, requestedOutputTokens: 0 };

  constructor(limits: OrdinaryComputeLimits = ORDINARY_COMPUTE_LIMITS) {
    if (!limits || Object.keys(limits).sort().join() !== "calls,promptUtf8Bytes,requestedOutputTokens" ||
      Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1))
      throw new RangeError("Invalid ordinary compute limits");
    this.limits = Object.freeze({ ...limits });
  }

  admit(stage: LlmCallStage, system: string, user: string, requestedOutputTokens: number): void {
    if (!stages.has(stage) || typeof system !== "string" || typeof user !== "string" ||
      !Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens < 1)
      throw new RangeError("Invalid ordinary compute request");
    const encoder = new TextEncoder();
    const next = {
      calls: this.admitted.calls + 1,
      promptUtf8Bytes: this.admitted.promptUtf8Bytes + encoder.encode(system).length + encoder.encode(user).length,
      requestedOutputTokens: this.admitted.requestedOutputTokens + requestedOutputTokens,
    };
    for (const key of ["calls", "promptUtf8Bytes", "requestedOutputTokens"] as const) {
      if (!Number.isSafeInteger(next[key]) || next[key] > this.limits[key]) throw new OrdinaryComputeLimitError(key);
    }
    this.admitted = next;
  }

  snapshot(): OrdinaryComputeSnapshot {
    return { limits: { ...this.limits }, admitted: { ...this.admitted } };
  }
}

/** Only the ordinary selector binds freshly constructed providers. A request body,
 * serialized snapshot, direct fixed-model engine or another run cannot mint this binding. */
export function bindOrdinaryComputeBudget(engine: object, budget: OrdinaryComputeBudget): void {
  if (!(budget instanceof OrdinaryComputeBudget)) throw new TypeError("Invalid ordinary compute budget");
  if (bindings.has(engine)) throw new Error("Ordinary engine compute budget already bound");
  bindings.set(engine, budget);
}

export function admitOrdinaryCompute(engine: object, stage: LlmCallStage, system: string, user: string,
  requestedOutputTokens: number): void {
  bindings.get(engine)?.admit(stage, system, user, requestedOutputTokens);
}

/** Read-only diagnostics contain counts and limits only, never prompts, model output or identities. */
export function ordinaryComputeSnapshot(engine: object): OrdinaryComputeSnapshot | undefined {
  return bindings.get(engine)?.snapshot();
}
