import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";
import { getSqlitePrivateResearchIntent, getSupabasePrivateResearchIntent } from "./private-research-intents";

const capacity = z.string().regex(/^[1-9]\d{0,11}$/);
const policySchema = z.object({ signer: addressSchema, capacityMicros: capacity }).strict();
export type PrivateTreasuryPolicy = z.infer<typeof policySchema>;
export type PrivateTreasuryReservation = { signer: string; amountMicros: string };
function reservation(row: Record<string, unknown> | undefined, amount: number): PrivateTreasuryReservation | null {
  if (!row) return null;
  const signer = addressSchema.parse(row.signer).toLowerCase();
  if (row.signer !== signer || Number(row.amount_micros) !== amount) throw new Error("Private treasury reservation conflict");
  return { signer, amountMicros: String(amount) };
}
export async function getSqlitePrivateTreasury(db: DatabaseSync, id: string, payer: string) {
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) return null;
  return reservation(db.prepare("SELECT signer,amount_micros FROM private_treasury_reservations WHERE job_id=?").get(id),
    Math.round(intent.submission.request.budget * 1e6));
}
export async function getSupabasePrivateTreasury(db: SupabaseClient, id: string, payer: string) {
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) return null;
  const { data, error } = await db.from("private_treasury_reservations").select("signer,amount_micros").eq("job_id", id).maybeSingle();
  if (error) throw new Error("Private treasury reservation unavailable");
  return reservation(data ?? undefined, Math.round(intent.submission.request.budget * 1e6));
}
export const PRIVATE_TREASURY_CAPACITY_SQL = `
CREATE TABLE IF NOT EXISTS private_treasury_pools (
  signer TEXT PRIMARY KEY, capacity_micros INTEGER NOT NULL CHECK(capacity_micros > 0 AND capacity_micros <= 999999999999)
);
CREATE TABLE IF NOT EXISTS private_treasury_reservations (
  job_id TEXT PRIMARY KEY REFERENCES private_research_intents(id),
  signer TEXT NOT NULL REFERENCES private_treasury_pools(signer),
  amount_micros INTEGER NOT NULL CHECK(amount_micros > 0 AND amount_micros <= 500000)
);
CREATE INDEX IF NOT EXISTS private_treasury_reservations_signer ON private_treasury_reservations(signer);
`;

function policy(value: PrivateTreasuryPolicy) {
  const parsed = policySchema.parse(value);
  return { signer: parsed.signer.toLowerCase(), capacityMicros: parsed.capacityMicros };
}
function matched(row: Record<string, unknown> | undefined, signer: string, amount: number) {
  if (!row) return false;
  if (row.signer !== signer || Number(row.amount_micros) !== amount) throw new Error("Private treasury reservation conflict");
  return true;
}

/** Allocation from an immutable operator-funded ceiling, NOT a live balance or
 * rolling window. Sealed jobs may release only never-committed budget. No automatic refill.
 * Caller must establish a dedicated signer and verified backing before configuring its ceiling. */
export async function reserveSqlitePrivateTreasury(db: DatabaseSync, id: string, payer: string, value: PrivateTreasuryPolicy) {
  const selected = policy(value);
  const intent = await getSqlitePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const amount = Math.round(intent.submission.request.budget * 1e6);
  db.prepare("INSERT INTO private_treasury_pools(signer,capacity_micros) VALUES(?,?) ON CONFLICT(signer) DO NOTHING")
    .run(selected.signer, Number(selected.capacityMicros));
  const pool = db.prepare("SELECT capacity_micros FROM private_treasury_pools WHERE signer=?").get(selected.signer);
  if (String(pool?.capacity_micros) !== selected.capacityMicros) throw new Error("Private treasury capacity policy conflict");
  db.prepare(`INSERT INTO private_treasury_reservations(job_id,signer,amount_micros)
    SELECT ?,p.signer,? FROM private_treasury_pools p WHERE p.signer=? AND ? <= p.capacity_micros -
      (SELECT coalesce(sum(r.amount_micros-coalesce(x.amount_micros,0)),0)
        FROM private_treasury_reservations r LEFT JOIN private_treasury_releases x ON x.job_id=r.job_id WHERE r.signer=p.signer)
    ON CONFLICT(job_id) DO NOTHING`).run(id, amount, selected.signer, amount);
  return matched(db.prepare("SELECT signer,amount_micros FROM private_treasury_reservations WHERE job_id=?").get(id), selected.signer, amount);
}

export async function reserveSupabasePrivateTreasury(db: SupabaseClient, id: string, payer: string, value: PrivateTreasuryPolicy) {
  const selected = policy(value);
  const intent = await getSupabasePrivateResearchIntent(db, id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const { error, data } = await db.rpc("reserve_private_treasury", { p_id: id, p_payer: intent.submission.payment.authorization.from,
    p_signer: selected.signer, p_capacity: selected.capacityMicros });
  if (error || typeof data !== "boolean") throw new Error("Private treasury reservation unavailable");
  if (!data) return false;
  const result = await db.from("private_treasury_reservations").select("signer,amount_micros").eq("job_id", id).maybeSingle();
  if (result.error || !result.data) throw new Error("Private treasury reservation unavailable");
  return matched(result.data, selected.signer, Math.round(intent.submission.request.budget * 1e6));
}
