import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSqlitePrivatePayment, getSupabasePrivatePayment } from "./private-research-payments";

export const PRIVATE_RESEARCH_EXECUTIONS_SQL = `
CREATE TABLE IF NOT EXISTS private_research_executions (
  id TEXT PRIMARY KEY REFERENCES private_research_payment_attempts(id),
  worker_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

/** Backend-only claim identity. Never expose worker IDs in account/result projections. */
export type PrivateExecutionClaim = { id: string; workerId: string; startedAt: string };
const rowSchema = z.object({ worker_id: z.string().uuid(), started_at: z.string().datetime({ offset: true }) });
function readClaim(id: string, row: unknown): PrivateExecutionClaim {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid private execution state");
  return { id, workerId: parsed.data.worker_id, startedAt: parsed.data.started_at };
}

export async function getSqlitePrivateExecution(db: DatabaseSync, id: string, payer: string) {
  const payment = await getSqlitePrivatePayment(db, id, payer);
  if (payment?.status !== "settled") return null;
  const row = db.prepare("SELECT worker_id,started_at FROM private_research_executions WHERE id = ?").get(id);
  return row ? readClaim(id, row) : null;
}

/** Only a fresh insert plus validated readback grants execution; replay is never a lease renewal. */
export async function claimSqlitePrivateExecution(db: DatabaseSync, id: string, payer: string): Promise<PrivateExecutionClaim | null> {
  const payment = await getSqlitePrivatePayment(db, id, payer);
  if (payment?.status !== "settled") throw new Error("Settled private payment unavailable");
  const workerId = randomUUID();
  const inserted = db.prepare(`INSERT INTO private_research_executions(id,worker_id)
    SELECT p.id,? FROM private_research_payment_attempts p JOIN private_research_intents i ON i.id=p.id
    WHERE p.id=? AND i.payer=? AND p.confirmation IS NOT NULL AND p.settled_at IS NOT NULL
    ON CONFLICT(id) DO NOTHING`).run(workerId, id, payment.confirmation.payer);
  if (inserted.changes !== 1) return null;
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution claim unavailable");
  return claim;
}

export async function getSupabasePrivateExecution(db: SupabaseClient, id: string, payer: string) {
  const payment = await getSupabasePrivatePayment(db, id, payer);
  if (payment?.status !== "settled") return null;
  const { data, error } = await db.from("private_research_executions").select("worker_id,started_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Private execution storage unavailable");
  return data ? readClaim(id, data) : null;
}

export async function claimSupabasePrivateExecution(db: SupabaseClient, id: string, payer: string): Promise<PrivateExecutionClaim | null> {
  const payment = await getSupabasePrivatePayment(db, id, payer);
  if (payment?.status !== "settled") throw new Error("Settled private payment unavailable");
  const workerId = randomUUID();
  const { data, error } = await db.rpc("claim_private_research_execution", {
    p_id: id, p_payer: payment.confirmation.payer, p_worker_id: workerId,
  });
  if (error || typeof data !== "boolean") throw new Error("Private execution claim unavailable");
  if (!data) return null;
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution claim unavailable");
  return claim;
}
