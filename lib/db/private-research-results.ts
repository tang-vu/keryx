import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { QueryRun } from "../types";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import { getSqlitePrivateResearchIntent, getSupabasePrivateResearchIntent } from "./private-research-intents";
import { getSqlitePrivateExecution, getSupabasePrivateExecution } from "./private-research-executions";

export const PRIVATE_RESEARCH_RESULTS_SQL = `
CREATE TABLE IF NOT EXISTS private_research_results (
  id TEXT PRIMARY KEY REFERENCES private_research_executions(id),
  serialized_run TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

/** Opaque backend snapshot, not an authenticated HTTP response or a settlement receipt. */
export type PrivateResearchResult = { id: string; format: "query-run-v1"; serializedRun: string; savedAt: string };
const snapshotSchema = z.string().min(2).max(4 * 1024 * 1024);
// Validate routing/request identity here; consumers must validate their own result projection.
const identitySchema = z.object({
  id: z.string(), question: z.string(), budget: z.number().finite(),
  researchMode: z.enum(["quick", "deep"]), answer: z.string(),
});
function checkedSnapshot(serializedRun: unknown, intent: PrivateResearchIntent): string {
  try {
    const snapshot = snapshotSchema.parse(serializedRun);
    const run = identitySchema.parse(JSON.parse(snapshot));
    const request = intent.submission.request;
    if (run.id !== intent.id || run.question !== request.question || run.budget !== request.budget
      || run.researchMode !== request.researchMode) throw new Error("Mismatch");
    return snapshot;
  } catch { throw new Error("Private research result mismatch"); }
}
function readResult(row: { serialized_run: unknown; saved_at: unknown }, intent: PrivateResearchIntent): PrivateResearchResult {
  const savedAt = z.string().datetime({ offset: true }).safeParse(row.saved_at);
  if (!savedAt.success) throw new Error("Invalid private result state");
  return { id: intent.id, format: "query-run-v1", serializedRun: checkedSnapshot(row.serialized_run, intent), savedAt: savedAt.data };
}
function snapshotRun(run: QueryRun) {
  // Copy before any asynchronous authorization lookup; never persist a caller-mutated object.
  try { return snapshotSchema.parse(JSON.stringify(run)); }
  catch { throw new Error("Private research result mismatch"); }
}
function requireOriginal(result: PrivateResearchResult | null, snapshot: string) {
  if (!result || result.serializedRun !== snapshot) throw new Error("Private research result conflict");
  return result;
}

export async function getSqlitePrivateResult(db: DatabaseSync, id: string, payer: string) {
  if (!await getSqlitePrivateExecution(db, id, payer)) return null;
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const row = db.prepare("SELECT serialized_run,saved_at FROM private_research_results WHERE id=?").get(id);
  return row ? readResult({ serialized_run: row.serialized_run, saved_at: row.saved_at }, intent) : null;
}
export async function saveSqlitePrivateResult(db: DatabaseSync, id: string, payer: string, workerId: string, run: QueryRun) {
  const snapshot = snapshotRun(run);
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution authority unavailable");
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  checkedSnapshot(snapshot, intent);
  db.prepare(`INSERT INTO private_research_results(id,serialized_run)
    SELECT e.id,? FROM private_research_executions e JOIN private_research_intents i ON i.id=e.id
    WHERE e.id=? AND e.worker_id=? AND i.payer=? ON CONFLICT(id) DO NOTHING`)
    .run(snapshot, id, workerId, intent.submission.payment.authorization.from);
  return requireOriginal(await getSqlitePrivateResult(db, id, payer), snapshot);
}

export async function getSupabasePrivateResult(db: SupabaseClient, id: string, payer: string) {
  if (!await getSupabasePrivateExecution(db, id, payer)) return null;
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const { data, error } = await db.from("private_research_results").select("serialized_run,saved_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Private result storage unavailable");
  return data ? readResult(data, intent) : null;
}
export async function saveSupabasePrivateResult(db: SupabaseClient, id: string, payer: string, workerId: string, run: QueryRun) {
  const snapshot = snapshotRun(run);
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution authority unavailable");
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  checkedSnapshot(snapshot, intent);
  const { error } = await db.rpc("save_private_research_result", {
    p_id: id, p_payer: intent.submission.payment.authorization.from, p_worker_id: workerId, p_serialized_run: snapshot,
  });
  if (error) throw new Error("Private result storage unavailable");
  return requireOriginal(await getSupabasePrivateResult(db, id, payer), snapshot);
}
