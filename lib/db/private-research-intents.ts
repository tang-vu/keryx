import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema, samePrivateResearchIntent, validatePrivateResearchIntent, type PrivateResearchIntent } from "../a2a/private-research-intent";

export const PRIVATE_RESEARCH_INTENTS_SQL = `
CREATE TABLE IF NOT EXISTS private_research_intents (
  id TEXT PRIMARY KEY CHECK(length(id) = 68 AND substr(id,1,4) = 'prv_' AND substr(id,5) NOT GLOB '*[^a-f0-9]*'),
  payer TEXT NOT NULL CHECK(length(payer) = 42 AND substr(payer,1,2) = '0x' AND substr(payer,3) NOT GLOB '*[^a-f0-9]*'),
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS private_research_intents_payer ON private_research_intents(payer, created_at);
CREATE INDEX IF NOT EXISTS private_research_intents_history ON private_research_intents(payer, created_at DESC, id DESC);
CREATE TRIGGER IF NOT EXISTS private_research_intents_immutable BEFORE UPDATE ON private_research_intents
BEGIN SELECT RAISE(ABORT, 'private research intents are immutable'); END;
`;

export const privateHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: privateResearchIdSchema }).strict();
export type PrivateHistoryCursor = z.infer<typeof privateHistoryCursorSchema>;
export type PrivateHistoryEntry = { intent: PrivateResearchIntent; createdAt: string };

async function historyRow(row: { id: unknown; data: unknown; created_at: unknown }, payer: string): Promise<PrivateHistoryEntry> {
  const id = privateResearchIdSchema.parse(row.id);
  const createdAt = z.string().datetime({ offset: true }).parse(row.created_at);
  let data: unknown;
  try { data = typeof row.data === "string" ? JSON.parse(row.data) : row.data; }
  catch { throw new Error("Invalid stored private research intent"); }
  return { intent: await checkedRow(data, id, payer), createdAt };
}

/** Backend only: 25 entries plus a sentinel; callers must project away signed intent data. */
export async function listSqlitePrivateResearchHistory(db: DatabaseSync, payer: string, before?: PrivateHistoryCursor) {
  const owner = addressSchema.parse(payer).toLowerCase();
  const cursor = before === undefined ? undefined : privateHistoryCursorSchema.parse(before);
  const rows = cursor ? db.prepare(`SELECT id,data,created_at FROM private_research_intents WHERE payer=?
    AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT 26`)
    .all(owner, cursor.createdAt, cursor.createdAt, cursor.id)
    : db.prepare("SELECT id,data,created_at FROM private_research_intents WHERE payer=? ORDER BY created_at DESC,id DESC LIMIT 26").all(owner);
  return Promise.all(rows.map(row => historyRow({ id: row.id, data: row.data, created_at: row.created_at }, owner)));
}

export async function listSupabasePrivateResearchHistory(db: SupabaseClient, payer: string, before?: PrivateHistoryCursor) {
  const owner = addressSchema.parse(payer).toLowerCase();
  const cursor = before === undefined ? undefined : privateHistoryCursorSchema.parse(before);
  let query = db.from("private_research_intents").select("id,data,created_at").eq("payer", owner)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(26);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error("Private research history unavailable");
  return Promise.all(data.map(row => historyRow(row, owner)));
}

function lookup(id: string, payer: string) {
  return { id: privateResearchIdSchema.parse(id), payer: addressSchema.parse(payer).toLowerCase() };
}
async function checkedRow(data: unknown, id: string, payer: string) {
  const intent = await validatePrivateResearchIntent(data);
  if (intent.id !== id || intent.submission.payment.authorization.from !== payer) throw new Error("Private research owner mismatch");
  return intent;
}
function requireOriginal(original: PrivateResearchIntent | null, proposed: PrivateResearchIntent) {
  if (!original || !samePrivateResearchIntent(original, proposed)) throw new Error("Private research reservation conflict");
  return original;
}

export async function getSqlitePrivateResearchIntent(db: DatabaseSync, id: string, payer: string) {
  const key = lookup(id, payer);
  const row = db.prepare("SELECT data FROM private_research_intents WHERE id = ? AND payer = ?").get(key.id, key.payer);
  if (!row) return null;
  let data: unknown;
  try { data = JSON.parse(String(row.data)); } catch { throw new Error("Invalid stored private research intent"); }
  return checkedRow(data, key.id, key.payer);
}
export async function reserveSqlitePrivateResearchIntent(db: DatabaseSync, value: PrivateResearchIntent) {
  const intent = await validatePrivateResearchIntent(value);
  const payer = intent.submission.payment.authorization.from;
  db.prepare("INSERT INTO private_research_intents (id,payer,data) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING")
    .run(intent.id, payer, JSON.stringify(intent));
  return requireOriginal(await getSqlitePrivateResearchIntent(db, intent.id, payer), intent);
}

export async function getSupabasePrivateResearchIntent(db: SupabaseClient, id: string, payer: string) {
  const key = lookup(id, payer);
  const { data, error } = await db.from("private_research_intents").select("data").eq("id", key.id).eq("payer", key.payer).maybeSingle();
  if (error) throw new Error("Private research storage unavailable");
  return data ? checkedRow(data.data, key.id, key.payer) : null;
}
export async function reserveSupabasePrivateResearchIntent(db: SupabaseClient, value: PrivateResearchIntent) {
  const intent = await validatePrivateResearchIntent(value);
  const payer = intent.submission.payment.authorization.from;
  const { error } = await db.from("private_research_intents").upsert({ id: intent.id, payer, data: intent }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Private research storage unavailable");
  return requireOriginal(await getSupabasePrivateResearchIntent(db, intent.id, payer), intent);
}
