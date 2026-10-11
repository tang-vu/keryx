/** Explicit, isolated ordinary SQLite schema. Never an application factory. */
import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "../db/run-claims-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import type { QueryRun } from "../types";
export function deliveryFixture() {
  const sql = new DatabaseSync(":memory:");
  installSqliteApplicationSchema(sql); sql.exec(RUN_CLAIMS_SQL);
  // Mutable test observer delegates to the frozen real port; production freeze
  // remains intact and every successful operation executes actual SQLite logic.
  const store = { ...createSqliteRunClaims(sql) };
  const run = (id: string, extra: Partial<QueryRun> = {}): QueryRun => ({ id, question: "Synthetic private delivery", budget: 0,
    engine: "heuristic", subClaims: [], decisions: [], citations: [], answer: "Saved synthetic answer", totalSpent: 0,
    totalToCreators: 0, trace: [], createdAt: new Date().toISOString(), paymentMode: "offline", ...extra });
  const save = (id: string, extra: Partial<QueryRun> = {}) => { const value = run(id, extra); writeSqliteQueryRun(sql, value, false); return value; };
  return { sql, store, db: { runClaims: store }, run, save };
}
