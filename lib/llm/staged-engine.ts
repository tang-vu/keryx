import type { ReasoningEngine } from "./reasoning-engine";
import { effectiveEngineName, reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { readSelectionDiagnostics } from "./research-selection";

/** Explicit ordinary research option. Each tier retains its own transport and circuits. */
export class StagedEngine implements ReasoningEngine {
  private readonly invoked = new Set<ReasoningEngine>();

  constructor(private readonly routine: ReasoningEngine, private readonly synthesis: ReasoningEngine) {}

  get name() {
    const engines = this.invoked.size ? [...this.invoked] : [this.routine, this.synthesis];
    return [...new Set(engines.map(effectiveEngineName))].join(" + ");
  }
  get usage() { return [...this.invoked].flatMap(reasoningUsage); }
  get calls(): ReasoningEngine["calls"] {
    const calls = [...this.invoked].map(reasoningCalls);
    return calls.every(value => value !== undefined) ? calls.flatMap(value => value!) : undefined;
  }
  get telemetry() { return [...this.invoked].flatMap(reasoningAttempts).sort((a, b) => a.startedAt - b.startedAt); }
  get selectionDiagnostics() { return [...this.invoked].flatMap(readSelectionDiagnostics); }

  private use(engine: ReasoningEngine) { this.invoked.add(engine); return engine; }
  decompose(...args: Parameters<ReasoningEngine["decompose"]>) { return this.use(this.routine).decompose(...args); }
  decide(...args: Parameters<ReasoningEngine["decide"]>) { return this.use(this.routine).decide(...args); }
  sufficiency(...args: Parameters<ReasoningEngine["sufficiency"]>) { return this.use(this.routine).sufficiency(...args); }
  reevaluate(...args: Parameters<ReasoningEngine["reevaluate"]>) { return this.use(this.routine).reevaluate(...args); }
  synthesize(...args: Parameters<ReasoningEngine["synthesize"]>) { return this.use(this.synthesis).synthesize(...args); }
  attribute(...args: Parameters<ReasoningEngine["attribute"]>) { return this.use(this.routine).attribute(...args); }
}
