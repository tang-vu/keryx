import { createHash } from "node:crypto";
import type { ReasoningEngine, SufficiencyInput, SufficiencyResult } from "./reasoning-engine";
import { effectiveEngineName, reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { readSelectionDiagnostics } from "./research-selection";

/** Ordinary run-local reuse sits outside provider circuits: a cache hit is not supplier health. */
export class CoverageReuseEngine implements ReasoningEngine {
  private previous?: { key: string; result: SufficiencyResult };
  constructor(private readonly inner: ReasoningEngine) {}
  get name() { return effectiveEngineName(this.inner); }
  get usage() { return reasoningUsage(this.inner); }
  get calls() { return reasoningCalls(this.inner); }
  get telemetry() { return reasoningAttempts(this.inner); }
  get selectionDiagnostics() { return readSelectionDiagnostics(this.inner); }
  decompose(...args: Parameters<ReasoningEngine["decompose"]>) { return this.inner.decompose(...args); }
  decide(...args: Parameters<ReasoningEngine["decide"]>) { return this.inner.decide(...args); }
  reevaluate(...args: Parameters<ReasoningEngine["reevaluate"]>) { return this.inner.reevaluate(...args); }
  synthesize(...args: Parameters<ReasoningEngine["synthesize"]>) { return this.inner.synthesize(...args); }
  attribute(...args: Parameters<ReasoningEngine["attribute"]>) { return this.inner.attribute(...args); }
  async sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (this.previous?.key === key) return structuredClone(this.previous.result);
    const before = new Set((reasoningCalls(this.inner) ?? []).map(call => call.id));
    const result = await this.inner.sufficiency(input);
    // A heuristic fallback after a supplier failure must not become cached model coverage.
    if ((reasoningCalls(this.inner) ?? []).some(call => !before.has(call.id) && call.stage === "sufficiency" && call.outcome === "returned"))
      this.previous = { key, result: structuredClone(result) };
    return result;
  }
}
