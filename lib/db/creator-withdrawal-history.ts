import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { validateWithdrawalRequest, withdrawalIdSchema, withdrawalOwnerSchema } from "../gateway/withdrawal-request";

const time = z.string().max(40).datetime({ offset: true });
export const withdrawalHistoryCursorSchema = z.object({ createdAt: time, id: withdrawalIdSchema }).strict();
export type WithdrawalHistoryCursor = z.infer<typeof withdrawalHistoryCursorSchema>;
export type WithdrawalHistoryEntry = { id: string; owner: string; createdAt: string;
  amountMicros: string; maxFeeMicros: string; recipient: string };
export type WithdrawalHistoryPage = { requests: WithdrawalHistoryEntry[]; nextCursor: WithdrawalHistoryCursor | null };

function selection(owner: string, cursor: WithdrawalHistoryCursor | undefined, limit: number) {
  return { owner: withdrawalOwnerSchema.parse(owner), cursor: cursor === undefined ? undefined : withdrawalHistoryCursorSchema.parse(cursor),
    limit: z.number().int().min(1).max(25).parse(limit) };
}
async function project(rows: unknown[], owner: string, limit: number): Promise<WithdrawalHistoryPage> {
  try {
    if (rows.length > limit + 1) throw new Error("Withdrawal history page unavailable");
    const requests: WithdrawalHistoryEntry[] = [], seen = new Set<string>();
    for (const raw of rows) {
      const row = z.object({ id: withdrawalIdSchema, owner: withdrawalOwnerSchema, created_at: time, data: z.unknown() }).parse(raw);
      const record = await validateWithdrawalRequest(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
      if (row.owner !== owner || record.owner !== owner || record.id !== row.id || seen.has(row.id)) throw new Error("Withdrawal history owner or identity mismatch");
      seen.add(row.id);
      requests.push({ id: record.id, owner, createdAt: row.created_at, amountMicros: record.request.burnIntent.spec.value,
        maxFeeMicros: record.request.burnIntent.maxFee, recipient: record.policy.recipient });
    }
    const page = requests.slice(0, limit), last = page.at(-1);
    return { requests: page, nextCursor: requests.length > limit && last ? { createdAt: last.createdAt, id: last.id as WithdrawalHistoryCursor["id"] } : null };
  } catch { throw new Error("Withdrawal history storage unavailable"); }
}

/** Owner-scoped metadata only. No signature/attestation exposure, transfer attempt,
 * inferred settlement or migration. Timestamp plus id preserves equal-time paging. */
export async function listSqliteWithdrawalHistory(db: DatabaseSync, owner: string, cursor?: WithdrawalHistoryCursor, limit = 25) {
  const selected = selection(owner, cursor, limit);
  const rows = selected.cursor
    ? db.prepare(`SELECT id,owner,created_at,data FROM creator_withdrawal_requests WHERE owner=?
      AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(selected.owner, selected.cursor.createdAt, selected.cursor.createdAt, selected.cursor.id, selected.limit + 1)
    : db.prepare(`SELECT id,owner,created_at,data FROM creator_withdrawal_requests WHERE owner=?
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(selected.owner, selected.limit + 1);
  return project(rows, selected.owner, selected.limit);
}

export async function listSupabaseWithdrawalHistory(db: SupabaseClient, owner: string, cursor?: WithdrawalHistoryCursor, limit = 25) {
  const selected = selection(owner, cursor, limit);
  let query = db.from("creator_withdrawal_requests").select("id,owner,created_at,data").eq("owner", selected.owner)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(selected.limit + 1);
  if (selected.cursor) {
    // Strict datetime and hex schemas exclude PostgREST filter syntax injection.
    const { createdAt, id } = selected.cursor;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error("Withdrawal history storage unavailable");
  return project(data, selected.owner, selected.limit);
}
