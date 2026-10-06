import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { A2aWorkerOutcome } from "../a2a/run-order";
import { operatorBusinessStatusSchema, operatorDecisionSchema, type OperatorBusinessStatus, type OperatorDecision } from "./contracts";

export const BUSINESS_OPERATOR_STATE_KEY = "businessOperator";
const heartbeatSchema = z.object({ version: z.literal(1), network: z.enum(["eip155:5042", "eip155:5042002"]),
  observedAt: z.string().datetime(), decision: operatorDecisionSchema, auditRecorded: z.literal(true),
  state: z.enum(["idle", "working", "held", "review"]),
}).strict();

export async function publishOperatorHeartbeat(db: Pick<KeryxDB, "setSyncState">, network: string,
  decision: OperatorDecision, phase: "decision" | "outcome", outcome?: A2aWorkerOutcome | null) {
  const state = outcome?.status === "recovery_pending" ? "review" : phase === "outcome" ? "idle" :
    decision.action === "run-next" ? "working" : decision.action === "hold" ? "held" : decision.action;
  await db.setSyncState(BUSINESS_OPERATOR_STATE_KEY, JSON.stringify(heartbeatSchema.parse({ version: 1, network,
    observedAt: new Date().toISOString(), decision, state, auditRecorded: true })));
}

/** Public responses are rebuilt field by field; no arbitrary sync-state document,
 * exact treasury books, journal path, signer, question or order ID escapes. */
export async function readOperatorStatus(db: Pick<KeryxDB, "getSyncState" | "operatorPublicSnapshot">,
  network: string, nowMs = Date.now()): Promise<OperatorBusinessStatus> {
  const results = await Promise.allSettled([db.getSyncState(BUSINESS_OPERATOR_STATE_KEY), db.operatorPublicSnapshot(nowMs)]);
  let operator: OperatorBusinessStatus["operator"] = { state: "unavailable", observedAt: null, decision: null, auditRecorded: false };
  if (results[0].status === "fulfilled" && results[0].value) {
    try {
      const h = heartbeatSchema.parse(JSON.parse(results[0].value));
      if (h.network === network) {
        const age = nowMs - Date.parse(h.observedAt);
        operator = { state: age < 0 || age > 120_000 ? "stale" : h.state,
          observedAt: h.observedAt, decision: h.decision, auditRecorded: h.auditRecorded };
      }
    } catch { /* unknown, never an invented idle state */ }
  }
  return operatorBusinessStatusSchema.parse({ version: 1, network, operator,
    ...(results[1].status === "fulfilled" ? results[1].value : { jobs: null, creatorCatalog: { registered: null } }) });
}
