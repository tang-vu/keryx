import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";

const amount = z.union([z.string().regex(/^(0|[1-9]\d{0,11})$/), z.number().int().nonnegative().max(999999999999)])
  .transform(value => BigInt(value));
const rowSchema = z.object({ capacity: amount, allocated: amount, committed: amount, confirmed: amount, invalid: amount });
function summary(row: unknown) {
  if (row === undefined || row === null) return null;
  const value = rowSchema.parse(row);
  if (value.invalid !== BigInt(0) || value.capacity === BigInt(0) || value.confirmed > value.committed
    || value.committed > value.allocated || value.allocated > value.capacity) throw new Error("Private treasury accounting mismatch");
  return { capacityMicros: value.capacity.toString(), allocatedMicros: value.allocated.toString(),
    unallocatedMicros: (value.capacity - value.allocated).toString(), committedMicros: value.committed.toString(),
    confirmedMicros: value.confirmed.toString(), unresolvedOrProcessingMicros: (value.committed - value.confirmed).toString(),
    conservativeBackingMicros: (value.capacity - value.confirmed).toString(),
    observation: "database-recorded" as const, chainFinalityVerified: false as const };
}
export type PrivateTreasurySummary = NonNullable<ReturnType<typeof summary>>;

/** One SQL snapshot; operator-only accounting, never live balance or spend authority.
 * Pending/processing legs never reduce the conservative backing amount. */
export async function getSqlitePrivateTreasurySummary(db: DatabaseSync, signer: string) {
  const selected = addressSchema.parse(signer).toLowerCase();
  const row = db.prepare(`WITH legs AS (
    SELECT s.amount_micros,
      CASE WHEN
        json_extract(s.data,'$.submission.amountMicros') IS NOT CAST(s.amount_micros AS TEXT) OR
        json_extract(s.data,'$.submission.payer') IS NOT r.signer OR
        (c.authorization_id IS NOT NULL AND (
        json_extract(c.data,'$.submission') IS NOT json_extract(s.data,'$.submission') OR
        NOT (COALESCE(json_extract(c.data,'$.source'),'')='circle-facilitator-success' OR
          (COALESCE(json_extract(c.data,'$.source'),'')='circle-transfer-search' AND
           COALESCE(json_extract(c.data,'$.transferStatus'),'') IN ('received','batched','confirmed','completed')))
      )) THEN 1 ELSE 0 END AS invalid,
      CASE WHEN json_extract(c.data,'$.source')='circle-facilitator-success' OR
        (json_extract(c.data,'$.source')='circle-transfer-search' AND json_extract(c.data,'$.transferStatus') IN ('confirmed','completed'))
      THEN s.amount_micros ELSE 0 END AS confirmed
    FROM private_treasury_reservations r JOIN private_creator_submissions s ON s.job_id=r.job_id
    LEFT JOIN private_creator_confirmations c ON c.authorization_id=s.authorization_id WHERE r.signer=?
  ) SELECT p.capacity_micros AS capacity,
    COALESCE((SELECT SUM(amount_micros) FROM private_treasury_reservations WHERE signer=p.signer),0) AS allocated,
    COALESCE((SELECT SUM(amount_micros) FROM legs),0) AS committed,
    COALESCE((SELECT SUM(confirmed) FROM legs),0) AS confirmed,
    COALESCE((SELECT SUM(invalid) FROM legs),0) AS invalid
    FROM private_treasury_pools p WHERE p.signer=?`).get(selected, selected);
  return summary(row);
}

export async function getSupabasePrivateTreasurySummary(db: SupabaseClient, signer: string) {
  const { data, error } = await db.rpc("private_treasury_summary", { p_signer: addressSchema.parse(signer).toLowerCase() });
  if (error || !Array.isArray(data) || data.length > 1) throw new Error("Private treasury summary unavailable");
  return summary(data[0]);
}
