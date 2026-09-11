import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSqlitePrivateExecution, getSupabasePrivateExecution } from "./private-research-executions";
import { getSqlitePrivateResult, getSupabasePrivateResult } from "./private-research-results";

export const PRIVATE_RESEARCH_INTERRUPTION_SQL = `
CREATE TABLE IF NOT EXISTS private_research_interruptions (
  id TEXT PRIMARY KEY REFERENCES private_research_executions(id),
  worker_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason='worker-interrupted'),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS private_interruption_no_update BEFORE UPDATE ON private_research_interruptions
BEGIN SELECT RAISE(ABORT,'Private interruption is immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_interruption_no_delete BEFORE DELETE ON private_research_interruptions
BEGIN SELECT RAISE(ABORT,'Private interruption is immutable'); END;
`;
export type PrivateResearchInterruption = { reason: "worker-interrupted"; recordedAt: string };
const schema = z.object({ worker_id: z.string().uuid(), reason: z.literal("worker-interrupted"), recorded_at: z.string().datetime({ offset: true }) });
function record(row: unknown, workerId: string): PrivateResearchInterruption {
  const parsed = schema.safeParse(row);
  if (!parsed.success || parsed.data.worker_id !== workerId) throw new Error("Private interruption state unavailable");
  return { reason: parsed.data.reason, recordedAt: parsed.data.recorded_at };
}
export async function getSqlitePrivateInterruption(db: DatabaseSync, id: string, payer: string) {
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim) return null;
  const row = db.prepare("SELECT worker_id,reason,recorded_at FROM private_research_interruptions WHERE id=?").get(id);
  return row ? record(row, claim.workerId) : null;
}
export async function getSupabasePrivateInterruption(db: SupabaseClient, id: string, payer: string) {
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim) return null;
  const { data, error } = await db.from("private_research_interruptions").select("worker_id,reason,recorded_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Private interruption state unavailable");
  return data ? record(data, claim.workerId) : null;
}

/** Operator-only spend fence after quiescence and backup inspection. This records neither
 * a failed payment nor a refund. The original worker's saved result may still be restored. */
export async function interruptSqlitePrivateResearch(db: DatabaseSync, id: string, payer: string, workerId: string) {
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private interruption authority unavailable");
  if (await getSqlitePrivateResult(db, id, payer)) return null;
  db.prepare(`INSERT INTO private_research_interruptions(id,worker_id,reason)
    SELECT e.id,e.worker_id,'worker-interrupted' FROM private_research_executions e
    JOIN private_research_intents i ON i.id=e.id WHERE e.id=? AND e.worker_id=? AND i.payer=?
      AND NOT EXISTS(SELECT 1 FROM private_research_results r WHERE r.id=e.id)
    ON CONFLICT(id) DO NOTHING`).run(id, workerId, payer.toLowerCase());
  const saved = await getSqlitePrivateInterruption(db, id, payer);
  if (!saved && !await getSqlitePrivateResult(db, id, payer)) throw new Error("Private interruption unavailable");
  return saved;
}
export async function interruptSupabasePrivateResearch(db: SupabaseClient, id: string, payer: string, workerId: string) {
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private interruption authority unavailable");
  if (await getSupabasePrivateResult(db, id, payer)) return null;
  const { error } = await db.rpc("interrupt_private_research", { p_id: id, p_payer: payer.toLowerCase(), p_worker_id: workerId });
  if (error) throw new Error("Private interruption unavailable");
  const saved = await getSupabasePrivateInterruption(db, id, payer);
  if (!saved && !await getSupabasePrivateResult(db, id, payer)) throw new Error("Private interruption unavailable");
  return saved;
}
