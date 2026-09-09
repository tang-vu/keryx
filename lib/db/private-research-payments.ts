import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { privatePaymentConfirmation, privatePaymentState, requirePrivatePaymentConfirmation, type PrivatePaymentConfirmation } from "../a2a/private-payment-state";
import { getSqlitePrivateResearchIntent, getSupabasePrivateResearchIntent } from "./private-research-intents";

export const PRIVATE_RESEARCH_PAYMENTS_SQL = `
CREATE TABLE IF NOT EXISTS private_research_payment_attempts (
  id TEXT PRIMARY KEY REFERENCES private_research_intents(id),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmation TEXT,
  settled_at TEXT,
  CHECK ((confirmation IS NULL) = (settled_at IS NULL))
);
`;

export async function getSqlitePrivatePayment(db: DatabaseSync, id: string, payer: string) {
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) return null;
  const row = db.prepare("SELECT started_at,confirmation,settled_at FROM private_research_payment_attempts WHERE id = ?").get(id);
  if (!row) return null;
  let confirmation: unknown = null;
  try { if (row.confirmation !== null) confirmation = JSON.parse(String(row.confirmation)); }
  catch { throw new Error("Invalid private payment state"); }
  return privatePaymentState({ ...row, started_at: row.started_at, settled_at: row.settled_at, confirmation }, intent);
}
export async function claimSqlitePrivatePayment(db: DatabaseSync, id: string, payer: string) {
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const result = db.prepare(`INSERT INTO private_research_payment_attempts (id)
    SELECT id FROM private_research_intents WHERE id = ? AND payer = ? ON CONFLICT(id) DO NOTHING`)
    .run(id, intent.submission.payment.authorization.from);
  const state = await getSqlitePrivatePayment(db, id, payer);
  if (!state) throw new Error("Private payment claim unavailable");
  return { claimed: result.changes === 1 && state.status === "pending", state };
}
export async function confirmSqlitePrivatePayment(db: DatabaseSync, id: string, payer: string, value: PrivatePaymentConfirmation) {
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const confirmation = privatePaymentConfirmation(value, intent);
  db.prepare(`UPDATE private_research_payment_attempts SET confirmation = ?, settled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ? AND confirmation IS NULL`).run(JSON.stringify(confirmation), id);
  return requirePrivatePaymentConfirmation(await getSqlitePrivatePayment(db, id, payer), confirmation);
}

export async function getSupabasePrivatePayment(db: SupabaseClient, id: string, payer: string) {
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) return null;
  const { data, error } = await db.from("private_research_payment_attempts").select("started_at,confirmation,settled_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Private payment storage unavailable");
  return data ? privatePaymentState(data, intent) : null;
}
export async function claimSupabasePrivatePayment(db: SupabaseClient, id: string, payer: string) {
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const { data, error } = await db.rpc("claim_private_research_payment", { p_id: id, p_payer: intent.submission.payment.authorization.from });
  if (error || typeof data !== "boolean") throw new Error("Private payment claim unavailable");
  const state = await getSupabasePrivatePayment(db, id, payer);
  if (!state) throw new Error("Private payment claim unavailable");
  return { claimed: data && state.status === "pending", state };
}
export async function confirmSupabasePrivatePayment(db: SupabaseClient, id: string, payer: string, value: PrivatePaymentConfirmation) {
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const confirmation = privatePaymentConfirmation(value, intent);
  const { error } = await db.rpc("confirm_private_research_payment", { p_id: id, p_payer: intent.submission.payment.authorization.from, p_confirmation: confirmation });
  if (error) throw new Error("Private payment storage unavailable");
  return requirePrivatePaymentConfirmation(await getSupabasePrivatePayment(db, id, payer), confirmation);
}
