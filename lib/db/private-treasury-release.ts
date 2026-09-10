import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";
import { getSqlitePrivateResult, getSupabasePrivateResult } from "./private-research-results";
import { getSqlitePrivateTreasury, getSupabasePrivateTreasury } from "./private-treasury-capacity";
import { listSqlitePrivateCreatorSubmissions, listSupabasePrivateCreatorSubmissions } from "./private-creator-submissions";

export const PRIVATE_TREASURY_RELEASE_SQL = `
CREATE TABLE IF NOT EXISTS private_treasury_releases (
  job_id TEXT PRIMARY KEY REFERENCES private_treasury_reservations(job_id),
  amount_micros INTEGER NOT NULL CHECK(amount_micros >= 0 AND amount_micros <= 500000),
  released_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS private_treasury_release_no_update BEFORE UPDATE ON private_treasury_releases
BEGIN SELECT RAISE(ABORT,'Private treasury release is immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_treasury_release_no_delete BEFORE DELETE ON private_treasury_releases
BEGIN SELECT RAISE(ABORT,'Private treasury release is immutable'); END;
`;

const amount = z.union([z.number().int().min(0).max(500000), z.string().regex(/^(0|[1-9]\d{0,5})$/)])
  .transform(value => BigInt(value)).refine(value => value <= BigInt(500000));
export type PrivateTreasuryRelease = { amountMicros: string; newlyReleased: boolean };

/** Only uncommitted budget can be returned. Confirmed, pending, processing and failed-
 * observed submissions all remain charged against the lifetime ceiling. A durable result
 * seals further creator admission; a worker claim, expiry or local deletion does not. */
async function releasable(
  signer: string,
  reservation: Awaited<ReturnType<typeof getSqlitePrivateTreasury>>,
  submissions: Awaited<ReturnType<typeof listSqlitePrivateCreatorSubmissions>>,
) {
  if (!reservation || reservation.signer !== signer) throw new Error("Private treasury release authority unavailable");
  const used = submissions.reduce((sum, leg) => {
    if (leg.data.submission.payer !== signer) throw new Error("Private treasury release accounting mismatch");
    return sum + BigInt(leg.data.submission.amountMicros);
  }, BigInt(0));
  const remaining = BigInt(reservation.amountMicros) - used;
  if (remaining < BigInt(0)) throw new Error("Private treasury release accounting mismatch");
  return remaining;
}

export async function releaseSqlitePrivateTreasury(db: DatabaseSync, id: string, payer: string, signer: string): Promise<PrivateTreasuryRelease | null> {
  const selected = addressSchema.parse(signer).toLowerCase();
  if (!await getSqlitePrivateResult(db, id, payer)) return null;
  const expected = await releasable(selected, await getSqlitePrivateTreasury(db, id, payer),
    await listSqlitePrivateCreatorSubmissions(db, id, payer));
  // One write statement; no read/check/write window. Sealed submissions are immutable.
  const inserted = db.prepare(`INSERT INTO private_treasury_releases(job_id,amount_micros)
    SELECT r.job_id,r.amount_micros-COALESCE((SELECT SUM(s.amount_micros) FROM private_creator_submissions s WHERE s.job_id=r.job_id),0)
    FROM private_treasury_reservations r JOIN private_research_results q ON q.id=r.job_id
    JOIN private_research_intents i ON i.id=r.job_id
    WHERE r.job_id=? AND r.signer=? AND i.payer=? ON CONFLICT(job_id) DO NOTHING`)
    .run(id, selected, payer.toLowerCase());
  const row = db.prepare("SELECT amount_micros FROM private_treasury_releases WHERE job_id=?").get(id);
  if (!row || amount.parse(row.amount_micros) !== expected) throw new Error("Private treasury release accounting mismatch");
  return { amountMicros: expected.toString(), newlyReleased: inserted.changes === 1 };
}

export async function releaseSupabasePrivateTreasury(db: SupabaseClient, id: string, payer: string, signer: string): Promise<PrivateTreasuryRelease | null> {
  const selected = addressSchema.parse(signer).toLowerCase();
  if (!await getSupabasePrivateResult(db, id, payer)) return null;
  const expected = await releasable(selected, await getSupabasePrivateTreasury(db, id, payer),
    await listSupabasePrivateCreatorSubmissions(db, id, payer));
  const { data, error } = await db.rpc("release_private_treasury", { p_id: id, p_payer: payer.toLowerCase(), p_signer: selected });
  if (error || typeof data !== "boolean") throw new Error("Private treasury release unavailable");
  const saved = await db.from("private_treasury_releases").select("amount_micros").eq("job_id", id).maybeSingle();
  if (saved.error || !saved.data || amount.parse(saved.data.amount_micros) !== expected) throw new Error("Private treasury release accounting mismatch");
  return { amountMicros: expected.toString(), newlyReleased: data };
}
