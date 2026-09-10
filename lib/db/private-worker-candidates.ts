import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema } from "../a2a/private-research-intent";

const candidate = z.object({ id: privateResearchIdSchema, payer: addressSchema });
export type PrivateWorkerCandidate = z.infer<typeof candidate>;
function selection(signer: string, after?: string) {
  return { signer: addressSchema.parse(signer).toLowerCase(), after: after === undefined ? null : privateResearchIdSchema.parse(after) };
}

/** Backend-only hints, NOT execution authority. The executor must revalidate payment,
 * signed policy, treasury and its atomic claim. Restart the sweep after the last page
 * so newly inserted IDs below a previous cursor are eventually considered. */
export async function listSqlitePrivateWorkerCandidates(db: DatabaseSync, signer: string, after?: string) {
  const selected = selection(signer, after);
  const rows = db.prepare(`SELECT i.id,i.payer FROM private_treasury_reservations r
    JOIN private_research_intents i ON i.id=r.job_id
    JOIN private_research_payment_attempts p ON p.id=i.id
    LEFT JOIN private_research_executions e ON e.id=i.id
    WHERE r.signer=? AND p.confirmation IS NOT NULL AND p.settled_at IS NOT NULL
      AND e.id IS NULL AND (? IS NULL OR i.id>?)
    ORDER BY i.id ASC LIMIT 25`).all(selected.signer, selected.after, selected.after);
  return z.array(candidate).max(25).parse(rows);
}

export async function listSupabasePrivateWorkerCandidates(db: SupabaseClient, signer: string, after?: string) {
  const selected = selection(signer, after);
  const { data, error } = await db.rpc("list_private_worker_candidates", { p_signer: selected.signer, p_after: selected.after });
  if (error) throw new Error("Private worker candidates unavailable");
  return z.array(candidate).max(25).parse(data);
}
