import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HistoryError, historyFiltersSchema, historyPositionSchema, historyRowSchema, historyWallet, type PersonalHistoryStore } from "../history/personal-history";

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
  } } satisfies PersonalHistoryStore);
}
