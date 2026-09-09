import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { privateCreatorSubmissionSchema, listSqlitePrivateCreatorSubmissions, listSupabasePrivateCreatorSubmissions,
  type PrivateCreatorSubmissionRecord } from "./private-creator-submissions";

const schema = z.object({
  source: z.literal("circle-facilitator-success"),
  transaction: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  submission: privateCreatorSubmissionSchema.shape.submission,
}).strict();
/** Internal trusted transport observation; never accept this envelope from an HTTP caller. */
export type PrivateCreatorConfirmation = z.infer<typeof schema>;
export type PrivateCreatorConfirmationRecord = { confirmation: PrivateCreatorConfirmation; settledAt: string };
function checked(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid private creator confirmation");
  return parsed.data;
}
function matched(confirmation: PrivateCreatorConfirmation, attempt: PrivateCreatorSubmissionRecord) {
  if (JSON.stringify(confirmation.submission) !== JSON.stringify(attempt.data.submission)) throw new Error("Private creator confirmation mismatch");
}
function nonce(value: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("Invalid private creator authorization");
  return value.toLowerCase();
}
function readRow(row: { data: unknown; settled_at: unknown }, attempt: PrivateCreatorSubmissionRecord): PrivateCreatorConfirmationRecord {
  try {
    const confirmation = checked(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
    matched(confirmation, attempt);
    return { confirmation, settledAt: z.string().datetime({ offset: true }).parse(row.settled_at) };
  } catch { throw new Error("Invalid private creator confirmation state"); }
}
function requireOriginal(saved: PrivateCreatorConfirmationRecord | null, expected: PrivateCreatorConfirmation) {
  if (!saved || JSON.stringify(saved.confirmation) !== JSON.stringify(expected)) throw new Error("Private creator confirmation conflict");
  return saved;
}

export const PRIVATE_CREATOR_CONFIRMATIONS_SQL = `
CREATE TABLE IF NOT EXISTS private_creator_confirmations (
  authorization_id TEXT PRIMARY KEY REFERENCES private_creator_submissions(authorization_id),
  data TEXT NOT NULL,
  settled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
export async function getSqlitePrivateCreatorConfirmation(db: DatabaseSync, id: string, payer: string, authorizationId: string) {
  const key = nonce(authorizationId);
  const attempt = (await listSqlitePrivateCreatorSubmissions(db, id, payer)).find(row => row.data.submission.authorizationId === key);
  if (!attempt) return null;
  const row = db.prepare("SELECT data,settled_at FROM private_creator_confirmations WHERE authorization_id=?").get(key);
  return row ? readRow({ data: row.data, settled_at: row.settled_at }, attempt) : null;
}
export async function confirmSqlitePrivateCreator(db: DatabaseSync, id: string, payer: string, workerId: string, value: PrivateCreatorConfirmation) {
  const confirmation = checked(value);
  const key = confirmation.submission.authorizationId;
  const attempt = (await listSqlitePrivateCreatorSubmissions(db, id, payer)).find(row => row.data.submission.authorizationId === key);
  if (!attempt || attempt.workerId !== workerId) throw new Error("Private creator submission unavailable");
  matched(confirmation, attempt);
  db.prepare(`INSERT INTO private_creator_confirmations(authorization_id,data)
    SELECT s.authorization_id,? FROM private_creator_submissions s JOIN private_research_intents i ON i.id=s.job_id
    WHERE s.job_id=? AND s.worker_id=? AND i.payer=? AND s.authorization_id=? ON CONFLICT(authorization_id) DO NOTHING`)
    .run(JSON.stringify(confirmation), id, workerId, payer.toLowerCase(), key);
  return requireOriginal(await getSqlitePrivateCreatorConfirmation(db, id, payer, key), confirmation);
}

export async function getSupabasePrivateCreatorConfirmation(db: SupabaseClient, id: string, payer: string, authorizationId: string) {
  const key = nonce(authorizationId);
  const attempt = (await listSupabasePrivateCreatorSubmissions(db, id, payer)).find(row => row.data.submission.authorizationId === key);
  if (!attempt) return null;
  const { data, error } = await db.from("private_creator_confirmations").select("data,settled_at").eq("authorization_id", key).maybeSingle();
  if (error) throw new Error("Private creator confirmation storage unavailable");
  return data ? readRow(data, attempt) : null;
}
export async function confirmSupabasePrivateCreator(db: SupabaseClient, id: string, payer: string, workerId: string, value: PrivateCreatorConfirmation) {
  const confirmation = checked(value);
  const key = confirmation.submission.authorizationId;
  const attempt = (await listSupabasePrivateCreatorSubmissions(db, id, payer)).find(row => row.data.submission.authorizationId === key);
  if (!attempt || attempt.workerId !== workerId) throw new Error("Private creator submission unavailable");
  matched(confirmation, attempt);
  const { error } = await db.rpc("confirm_private_creator_submission", { p_id: id, p_payer: payer.toLowerCase(), p_worker_id: workerId, p_confirmation: confirmation });
  if (error) throw new Error("Private creator confirmation storage unavailable");
  return requireOriginal(await getSupabasePrivateCreatorConfirmation(db, id, payer, key), confirmation);
}
