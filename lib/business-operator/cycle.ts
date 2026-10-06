import { randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { A2aWorkerOutcome } from "../a2a/run-order";
import type { OperatorDecision, OperatorInventory, OperatorLiquidity } from "./contracts";
import { decideOperatorCycle } from "./decision";

export interface OperatorAuditEvent {
  version: 1; cycleId: string; phase: "decision" | "outcome";
  decision: OperatorDecision; inventory: OperatorInventory | null;
  liquidity: OperatorLiquidity | null; outcome?: A2aWorkerOutcome | null;
}
export interface OperatorCycleDependencies {
  inventory: () => Promise<OperatorInventory>;
  liquidity: () => Promise<OperatorLiquidity | null>;
  run: () => Promise<A2aWorkerOutcome | null>;
  /** Return the decision actually retained, including its original audit time. */
  audit: (event: OperatorAuditEvent) => Promise<OperatorDecision>;
  rememberOutcome?: (outcome: A2aWorkerOutcome | null) => void;
  publish: (decision: OperatorDecision, phase: "decision" | "outcome", outcome?: A2aWorkerOutcome | null) => Promise<void>;
  now: () => number;
  acceptancePaused: () => boolean;
}

/** Observation cannot authorize spending. The existing order claim, execution
 * journal and treasury signer enforce payment authority after this extra gate. */
export async function runOperatorCycle(deps: OperatorCycleDependencies): Promise<A2aWorkerOutcome | null> {
  let inventory: OperatorInventory | null = null;
  let liquidity: OperatorLiquidity | null = null;
  try { inventory = await deps.inventory(); } catch { /* unknown is held below */ }
  const initial = decideOperatorCycle({ inventory, liquidity, nowMs: deps.now(), acceptancePaused: deps.acceptancePaused() });
  // Idle, active, malformed and ambiguous originals do not even call Circle.
  if (initial.reason === "liquidity-unavailable") {
    try { liquidity = await deps.liquidity(); } catch { /* fail closed */ }
    try {
      const latest = await deps.inventory();
      if (canonicalJson({ ...latest, observedAt: undefined }) !== canonicalJson({ ...inventory, observedAt: undefined }))
        inventory = null;
    } catch { inventory = null; }
  }
  const decision = decideOperatorCycle({ inventory, liquidity, nowMs: deps.now(), acceptancePaused: deps.acceptancePaused() });
  const event: OperatorAuditEvent = { version: 1, cycleId: randomUUID(), phase: "decision", decision, inventory, liquidity };
  // A failed durable journal write MUST prevent claiming an original paid job.
  const auditedDecision = await deps.audit(event);
  await deps.publish(auditedDecision, "decision").catch(() => undefined);
  if (decision.action !== "run-next") return null;
  const outcome = await deps.run();
  deps.rememberOutcome?.(outcome);
  // Never retry research because this write/telemetry failed. Original ledger
  // and result-save recovery remain the authority for that already-started job.
  const auditedOutcome = await deps.audit({ ...event, phase: "outcome", outcome });
  await deps.publish(auditedOutcome, "outcome", outcome).catch(() => undefined);
  return outcome;
}
