import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryRun } from "../types";
import { parseRunUsage } from "../research/usage-provenance";
import { publicHistoryIncludes } from "../research-audit/usage-cohort";
import { projectUsageCorpus, UsageUnavailable, usageWindowSchema, type PublicUsageStore, type UsageWindow } from "../usage/contracts";

/** Ordinary service-role RPC only. Missing migration/errors never select a REST/native fallback. */
export function createSupabasePublicUsage(client: SupabaseClient): PublicUsageStore {
  async function view(raw: UsageWindow) {
    const window = usageWindowSchema.parse(raw);
    try {
      const { data, error } = await client.rpc("public_usage_window_v1", { p_window: window })
        .abortSignal(AbortSignal.timeout(15000));
      if (error) throw new UsageUnavailable();
      return projectUsageCorpus(data, window);
    } catch { throw new UsageUnavailable(); }
  }
  return Object.freeze({
    async summary(window) { return (await view(window)).summary; },
    async history(window, cohort, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
      const snapshot = await view(window);
      const selected = snapshot.runs.filter(run => cohort === "default" ? publicHistoryIncludes(run.classification.cohort)
        : run.classification.cohort === cohort)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
      if (!selected.length) return [];
      // Metadata snapshot chooses the page first. Recheck each later body identity/time/cohort;
      // this read is not advertised as the same database snapshot as the summary RPC.
      const { data, error } = await client.from("query_runs").select("id,created_at,data").in("id", selected.map(run => run.id))
        .limit(limit).abortSignal(AbortSignal.timeout(15000));
      if (error || !Array.isArray(data) || data.length !== selected.length) throw new UsageUnavailable();
      return selected.map(row => {
        const found = data.find(value => value.id === row.id);
        if (!found || found.data?.id !== row.id || found.data?.createdAt !== row.createdAt) throw new UsageUnavailable();
        if (JSON.stringify(parseRunUsage(found.data.usage)) !== JSON.stringify(snapshot.classifications.get(row.id)))
          throw new UsageUnavailable();
        return found.data as QueryRun;
      });
    },
  } satisfies PublicUsageStore);
}
