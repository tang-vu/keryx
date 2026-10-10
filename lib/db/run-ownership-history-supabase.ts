import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HistoryError, historyIdSchema, historyWallet } from "../history/personal-history";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { ownershipHistoryOriginal, runOwnershipHistoryQuerySchema, runOwnershipHistoryRowSchema, runOwnershipSchema,
  validateRunOwnershipHistoryRows, type RunOwnershipHistoryStore } from "../run-claims/history";

/** Ordinary owner-private RPCs only; no public REST, native/archive or financial fallback. */
export function createSupabaseRunOwnershipHistory(client: SupabaseClient): RunOwnershipHistoryStore {
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new HistoryError("history_unavailable");
    return data;
  }
  return Object.freeze({
    async list(owner, raw) {
      try {
        const wallet = historyWallet(owner), query = runOwnershipHistoryQuerySchema.parse(raw), { binding } = query;
        const result = z.object({ version: z.literal(1), wallet: z.literal(wallet), binding: runClaimBindingSchema,
          rows: z.array(runOwnershipHistoryRowSchema).max(query.take) }).strict().parse(await call("anonymous_run_claim_history_list_v1", {
          p_wallet: wallet, p_network: binding.network, p_origin: binding.origin, p_filters: query.filters, p_take: query.take,
          p_upper: query.upper ?? null, p_before: query.before ?? null,
        }));
        if (result.binding.network !== binding.network || result.binding.origin !== binding.origin) throw new Error("Binding mismatch");
        return validateRunOwnershipHistoryRows(result.rows, query);
      } catch { throw new HistoryError("history_unavailable"); }
    },
    async read(owner, rawBinding, rawId) {
      try {
        const wallet = historyWallet(owner), binding = runClaimBindingSchema.parse(rawBinding), id = historyIdSchema.parse(rawId);
        const result = z.object({ version: z.literal(1), wallet: z.literal(wallet), binding: runClaimBindingSchema,
          item: z.object({ run: z.unknown(), ownership: runOwnershipSchema }).strict().nullable() }).strict().parse(await call("anonymous_run_claim_history_read_v1", {
          p_wallet: wallet, p_network: binding.network, p_origin: binding.origin, p_run_id: id,
        }));
        if (result.binding.network !== binding.network || result.binding.origin !== binding.origin) throw new Error("Binding mismatch");
        if (!result.item) return null;
        if (Buffer.byteLength(JSON.stringify(result.item.run))>4_000_000) throw new Error("Oversized original");
        const createdAt = z.object({ createdAt: z.string() }).passthrough().parse(result.item.run).createdAt;
        return { run: ownershipHistoryOriginal(result.item.run, wallet, id, createdAt, result.item.ownership), ownership: result.item.ownership };
      } catch { throw new HistoryError("history_unavailable"); }
    },
  } satisfies RunOwnershipHistoryStore);
}
