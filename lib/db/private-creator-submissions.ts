import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BUYER_NETWORK, BUYER_USDC, addressSchema } from "../buyer/protocol";
import { getSqlitePrivateExecution, getSupabasePrivateExecution } from "./private-research-executions";

export const privateCreatorSubmissionSchema = z.object({
  kind: z.enum(["fetch", "citation"]), sourceId: z.string().min(1).max(256), itemId: z.string().min(1).max(256).nullable(),
  submission: z.object({
    authorizationId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform(v => v.toLowerCase()),
    authorizationExpiresAt: z.string().datetime({ offset: true }),
    payer: addressSchema.transform(v => v.toLowerCase()), payee: addressSchema.transform(v => v.toLowerCase()),
    amountMicros: z.string().regex(/^[1-9]\d{0,6}$/).refine(v => Number(v) <= 1_000_000),
    network: z.literal(BUYER_NETWORK), asset: addressSchema.transform(v => v.toLowerCase()).refine(v => v === BUYER_USDC.toLowerCase()),
  }).strict(),
}).strict();
export type PrivateCreatorSubmission = z.infer<typeof privateCreatorSubmissionSchema>;
export type PrivateCreatorSubmissionRecord = { jobId: string; legId: string; workerId: string; startedAt: string; data: PrivateCreatorSubmission };
function checked(value: unknown) {
  const parsed = privateCreatorSubmissionSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid private creator submission");
  return parsed.data;
}
function legId(data: PrivateCreatorSubmission) {
  return createHash("sha256").update(JSON.stringify([data.kind, data.sourceId, data.itemId, data.submission.payee])).digest("hex");
}
function readRow(jobId: string, workerId: string, row: Record<string, unknown>): PrivateCreatorSubmissionRecord {
  try {
    const data = checked(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
    const key = legId(data);
    if (row.leg_id !== key || row.worker_id !== workerId || row.authorization_id !== data.submission.authorizationId
      || Number(row.amount_micros) !== Number(data.submission.amountMicros)) throw new Error("Mismatch");
    const startedAt = z.string().datetime({ offset: true }).parse(row.started_at);
    return { jobId, legId: key, workerId, startedAt, data };
  } catch { throw new Error("Invalid private creator ledger state"); }
}

export const PRIVATE_CREATOR_SUBMISSIONS_SQL = `
CREATE TABLE IF NOT EXISTS private_creator_submissions (
  job_id TEXT NOT NULL REFERENCES private_research_executions(id),
  leg_id TEXT NOT NULL, worker_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL UNIQUE,
  amount_micros INTEGER NOT NULL CHECK(amount_micros > 0 AND amount_micros <= 1000000),
  data TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(job_id,leg_id)
);
`;

export async function listSqlitePrivateCreatorSubmissions(db: DatabaseSync, id: string, payer: string) {
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim) return [];
  return db.prepare("SELECT leg_id,worker_id,authorization_id,amount_micros,data,started_at FROM private_creator_submissions WHERE job_id=? ORDER BY started_at,leg_id")
    .all(id).map(row => readRow(id, claim.workerId, row));
}
export async function admitSqlitePrivateCreatorSubmission(db: DatabaseSync, id: string, payer: string, workerId: string, value: PrivateCreatorSubmission) {
  const data = checked(value); // Copies scalars before asynchronous owner verification.
  const claim = await getSqlitePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution authority unavailable");
  const key = legId(data), amount = Number(data.submission.amountMicros);
  const result = db.prepare(`INSERT INTO private_creator_submissions(job_id,leg_id,worker_id,authorization_id,amount_micros,data)
    SELECT e.id,?,?,?,?,? FROM private_research_executions e JOIN private_research_intents i ON i.id=e.id
    WHERE e.id=? AND e.worker_id=? AND i.payer=?
      AND NOT EXISTS(SELECT 1 FROM private_research_results r WHERE r.id=e.id)
      AND NOT EXISTS(SELECT 1 FROM private_research_interruptions x WHERE x.id=e.id)
      AND COALESCE((SELECT SUM(s.amount_micros) FROM private_creator_submissions s WHERE s.job_id=e.id),0)+?
        <= CAST(round(json_extract(i.data,'$.submission.request.budget')*1000000) AS INTEGER)
    ON CONFLICT DO NOTHING`).run(key, workerId, data.submission.authorizationId, amount, JSON.stringify(data), id, workerId, payer.toLowerCase(), amount);
  if (result.changes !== 1) return false;
  const saved = (await listSqlitePrivateCreatorSubmissions(db, id, payer)).find(row => row.legId === key);
  if (!saved || JSON.stringify(saved.data) !== JSON.stringify(data)) throw new Error("Private creator admission unavailable");
  return true;
}

export async function listSupabasePrivateCreatorSubmissions(db: SupabaseClient, id: string, payer: string) {
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim) return [];
  const { data, error } = await db.from("private_creator_submissions").select("leg_id,worker_id,authorization_id,amount_micros,data,started_at").eq("job_id", id).order("started_at").order("leg_id");
  if (error || !Array.isArray(data)) throw new Error("Private creator storage unavailable");
  return data.map(row => readRow(id, claim.workerId, row));
}
export async function admitSupabasePrivateCreatorSubmission(db: SupabaseClient, id: string, payer: string, workerId: string, value: PrivateCreatorSubmission) {
  const data = checked(value);
  const claim = await getSupabasePrivateExecution(db, id, payer);
  if (!claim || claim.workerId !== workerId) throw new Error("Private execution authority unavailable");
  const key = legId(data);
  const { data: inserted, error } = await db.rpc("admit_private_creator_submission", { p_id: id, p_payer: payer.toLowerCase(),
    p_worker_id: workerId, p_leg_id: key, p_authorization_id: data.submission.authorizationId, p_amount_micros: Number(data.submission.amountMicros), p_data: data });
  if (error || typeof inserted !== "boolean") throw new Error("Private creator admission unavailable");
  if (!inserted) return false;
  const saved = (await listSupabasePrivateCreatorSubmissions(db, id, payer)).find(row => row.legId === key);
  if (!saved || JSON.stringify(saved.data) !== JSON.stringify(data)) throw new Error("Private creator admission unavailable");
  return true;
}
