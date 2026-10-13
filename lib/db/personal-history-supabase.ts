import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HistoryError, historyFiltersSchema, historyPositionSchema, historyRowSchema, historyWallet, type PersonalHistoryStore } from "../history/personal-history";
import { historyIdSchema } from "../history/personal-history";
import { historyReceiptSchema } from "../history/owned-history";

/** Ordinary RPC only. Missing source migration or sealed deployment refuses without REST fallback. */
export function createSupabasePersonalHistory(client: SupabaseClient): PersonalHistoryStore {
  return Object.freeze({ async list(owner, query) {
    const wallet = historyWallet(owner), filters = historyFiltersSchema.parse(query.filters);
    if (!Number.isInteger(query.take) || query.take < 1 || query.take > 51) throw new HistoryError("history_unavailable");
    try {
      const { data, error } = await client.rpc("personal_history_read_v1", { p_wallet: wallet, p_filters: filters, p_take: query.take,
        p_upper: query.upper ? historyPositionSchema.parse(query.upper) : null, p_before: query.before ? historyPositionSchema.parse(query.before) : null });
      if (error) throw new Error("RPC unavailable");
      const result = z.object({ wallet: z.literal(wallet), rows: z.array(historyRowSchema).max(query.take) }).strict().parse(data);
      return result.rows;
    } catch { throw new HistoryError("history_unavailable"); }
  }, async receipts(rawId, take) {
    const id = historyIdSchema.parse(rawId);
    if (!Number.isInteger(take) || take < 1 || take > 201) throw new HistoryError("history_unavailable");
    try {
      // Ordinary capability only; no enrolled/native fallback, private journal columns or unbounded fetch.
      const { data, error } = await client.from("payment_events")
        .select("id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,created_at")
        .eq("query_id", id).or("authorization_phase.is.null,authorization_phase.not.in.(prepared,cancelled_unexposed)")
        .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(take).abortSignal(AbortSignal.timeout(15_000));
      if (error || !Array.isArray(data) || data.length > take) throw new Error("Receipt projection unavailable");
      return data.map(row => historyReceiptSchema.parse({ id: row.id, queryId: row.query_id, kind: row.kind,
        sourceId: row.source_id, sourceName: row.source_name, payer: row.payer, payee: row.payee, amountUsdc: row.amount_usdc,
        network: row.network, txHash: row.tx_hash, settled: row.settled, settlementStatus: row.settlement_status, createdAt: row.created_at }));
    } catch { throw new HistoryError("history_unavailable"); }
  } } satisfies PersonalHistoryStore);
}
