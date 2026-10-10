import type { DatabaseSync } from "node:sqlite";
import type { QueryRun } from "../types";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { publicHistoryIncludes } from "../research-audit/usage-cohort";
import { MAX_USAGE_RUNS, MAX_USAGE_PAYMENTS, projectUsageCorpus, usageWindowSchema, UsageUnavailable,
  type PublicUsageStore, type UsageCorpus, type UsageWindow } from "../usage/contracts";

/** No schema installation, ledger writes, or enrolled adapter fallback. */
export function createSqlitePublicUsage(db: DatabaseSync): PublicUsageStore {
  assertOrdinarySqliteResearchAuthority(db);
  function transaction<T>(action: () => T): T {
    assertOrdinarySqliteResearchAuthority(db); db.exec("BEGIN");
    try { assertOrdinarySqliteResearchAuthority(db); const result = action(); db.exec("COMMIT"); return result; }
    catch { db.exec("ROLLBACK"); throw new UsageUnavailable(); }
  }
  function corpus(raw: UsageWindow): UsageCorpus {
    const window = usageWindowSchema.parse(raw);
    const rows = db.prepare(`SELECT id,created_at,asker,
      CASE WHEN json_valid(data) AND json_type(data,'$.usage')='object' AND length(CAST(json_extract(data,'$.usage') AS BLOB))<=2048
        THEN json_extract(data,'$.usage') END AS usage,
      CASE WHEN json_valid(data) AND json_type(data,'$.provenance')='object' AND length(CAST(json_extract(data,'$.provenance') AS BLOB))<=1024
        THEN json_extract(data,'$.provenance') END AS provenance
      FROM query_runs WHERE created_at>=? AND created_at<? LIMIT ?`).all(window.since, window.until, MAX_USAGE_RUNS + 1);
    if (rows.length > MAX_USAGE_RUNS) throw new UsageUnavailable();
    const payments = db.prepare(`SELECT p.id,p.query_id,p.network,p.kind,p.amount_usdc,p.settled,p.settlement_status,p.tx_hash,p.payee
      FROM payment_events p JOIN query_runs q ON q.id=p.query_id WHERE q.created_at>=? AND q.created_at<? LIMIT ?`)
      .all(window.since, window.until, MAX_USAGE_PAYMENTS + 1);
    if (payments.length > MAX_USAGE_PAYMENTS) throw new UsageUnavailable();
    return { complete: true, window, runs: rows.map(row => ({ id: String(row.id), createdAt: String(row.created_at),
      usage: row.usage ? JSON.parse(String(row.usage)) : null, provenance: row.provenance ? JSON.parse(String(row.provenance)) : null,
      actorId: typeof row.asker === "string" && /^0x[a-fA-F0-9]{40}$/.test(row.asker) ? row.asker : null })),
    payments: payments.map(row => ({ id: String(row.id), queryId: String(row.query_id), network: String(row.network),
      kind: row.kind as UsageCorpus["payments"][number]["kind"], amountUsdc: Number(row.amount_usdc), settled: row.settled === 1,
      settlementStatus: row.settlement_status === null ? null : String(row.settlement_status),
      txHash: row.tx_hash === null ? null : String(row.tx_hash), payee: String(row.payee) })) };
  }
  return Object.freeze({
    async summary(window) { return transaction(() => projectUsageCorpus(corpus(window), window).summary); },
    async history(window, cohort, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
      return transaction(() => {
        const view = projectUsageCorpus(corpus(window), window);
        // Classify/filter the complete bounded window BEFORE selecting a history page.
        const selected = view.runs.filter(run => cohort === "default" ? publicHistoryIncludes(run.classification.cohort)
          : run.classification.cohort === cohort)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
        const read = db.prepare("SELECT data FROM query_runs WHERE id=?");
        return selected.map(row => {
          const value = JSON.parse(String(read.get(row.id)?.data)) as QueryRun;
          if (value.id !== row.id || value.createdAt !== row.createdAt) throw new UsageUnavailable();
          return value;
        });
      });
    },
  } satisfies PublicUsageStore);
}
