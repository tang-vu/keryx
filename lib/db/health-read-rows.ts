import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { summarizeA2aOperations, type A2aOperationsRow } from "../a2a/operations";
import { dashboardMetricsFromSqliteRows, readSqliteRecordedAccounts, SQLITE_DASHBOARD_INPUT_ROWS } from "./dashboard-metric-rows";
import { publicHealthSyncKeys, type PublicHealthSnapshot } from "./public-health-snapshot";

/** One fixed read statement, using the original native values and JSON guards.
 * Callers supply only the captured clock and the registry's configured boolean.
 * The verified connection still guards prepare and all; no handle/result cache. */
export async function readSqlitePublicHealthSnapshot(
  db: DatabaseSync, nowMs: number, includeRegistry: boolean,
): Promise<PublicHealthSnapshot> {
  const keys = publicHealthSyncKeys(includeRegistry);
  const since = new Date(nowMs - 24 * 60 * 60_000).toISOString();
  const statement = db.prepare(`${SQLITE_DASHBOARD_INPUT_ROWS}
    UNION ALL SELECT 4,status,created_at,updated_at,started_at,execution_journal_version,
      CASE WHEN json_valid(package_data) THEN package_data END,
      CASE WHEN json_valid(response_data) THEN CASE WHEN json_type(response_data,'$.serviceReceipt')='object'
        THEN json_extract(response_data,'$.serviceReceipt') END END,
      CASE WHEN resolution_data IS NULL THEN 'null'
        WHEN json_valid(resolution_data) THEN resolution_data ELSE '{}' END,
      NULL,NULL,NULL,NULL
      FROM a2a_orders WHERE status='running' OR updated_at>=?
    UNION ALL SELECT 5,key,value,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
      FROM sync_state WHERE key IN (${keys.map(() => "?").join(",")})`);
  statement.setReturnArrays(true);
  const rows = statement.all(since, ...keys) as unknown as SQLOutputValue[][];
  const metrics: SQLOutputValue[][] = [], jobs: A2aOperationsRow[] = [];
  const syncState = new Map<string, string | null>(keys.map(key => [key, null]));
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 13) throw new Error("Unexpected public-health row layout");
    const group = Number(row[0]);
    if (group >= 0 && group <= 3) metrics.push(row);
    else if (group === 4) jobs.push({
      status: row[1] as A2aOperationsRow["status"], createdAt: String(row[2]), updatedAt: String(row[3]),
      startedAt: row[4] == null ? null : String(row[4]), executionJournalVersion: row[5],
      researchPackage: row[6] == null ? undefined : JSON.parse(String(row[6])),
      serviceReceipt: row[7] == null ? undefined : JSON.parse(String(row[7])),
      resolution: JSON.parse(String(row[8])),
    });
    else if (group === 5) syncState.set(String(row[1]), row[2] as string);
    else throw new Error("Unexpected public-health source");
  }
  return {
    metrics: { ...dashboardMetricsFromSqliteRows(metrics), recordedAccounts: readSqliteRecordedAccounts(db) },
    jobs: summarizeA2aOperations(jobs, nowMs, true), syncState,
  };
}
