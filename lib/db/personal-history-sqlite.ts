import type { DatabaseSync } from "node:sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { parseRunProvenance, RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "../research/run-provenance";
import { HistoryError, historyFiltersSchema, historyPositionSchema, historyRowSchema, historyWallet, type PersonalHistoryStore } from "../history/personal-history";

/** Reads only an allowlist projection. Never selects answer, private fulfillment or raw data. */
export function createSqlitePersonalHistory(db: DatabaseSync): PersonalHistoryStore {
  return Object.freeze({ async list(owner, query) {
    assertOrdinarySqliteResearchAuthority(db);
    const wallet = historyWallet(owner), filters = historyFiltersSchema.parse(query.filters);
    if (!Number.isInteger(query.take) || query.take < 1 || query.take > 51) throw new HistoryError("history_unavailable");
    const where = ["asker = ?"], args: (string | number)[] = [wallet];
    for (const [position, exclusive] of [[query.upper, false], [query.before, true]] as const) if (position) {
      const value = historyPositionSchema.parse(position);
      where.push(`(created_at < ? OR (created_at = ? AND id ${exclusive ? "<" : "<="} ? COLLATE BINARY))`);
      args.push(value.createdAt, value.createdAt, value.id);
    }
    if (filters.from) { where.push("created_at >= ?"); args.push(filters.from); }
    if (filters.to) { where.push("created_at <= ?"); args.push(filters.to); }
    if (filters.search !== undefined) { where.push("instr(question, ?) > 0"); args.push(filters.search); }
    // A malformed historical snapshot remains unknown; origin and client labels are not authority.
    const snapshot = `CASE WHEN json_type(data,'$.provenance')='object'
      AND (SELECT count(*) FROM json_each(data,'$.provenance'))=3
      AND json_type(data,'$.provenance.version') IN ('integer','real') AND json_extract(data,'$.provenance.version')=1
      AND json_extract(data,'$.provenance.surface') IN (${RUN_SURFACES.map(value => `'${value}'`).join(",")})
      AND json_extract(data,'$.provenance.ownershipMethod') IN (${RUN_OWNERSHIP_METHODS.map(value => `'${value}'`).join(",")})
      THEN json_extract(data,'$.provenance') ELSE NULL END`;
    if (filters.surface) { where.push(`coalesce(json_extract((${snapshot}),'$.surface'),'unknown') = ?`); args.push(filters.surface); }
    if (filters.funding) where.push(`(json_type(data,'$.askerFunded')='true') ${filters.funding === "browser-recorded" ? "IS TRUE" : "IS NOT TRUE"}`);
    args.push(query.take);
    const rows = db.prepare(`SELECT id,created_at,question,asker,total_spent,total_to_creators,payment_mode,parent_id,
      (${snapshot}) AS provenance,json_extract(data,'$.asker') AS recorded_asker,
      json_type(data,'$.askerFunded') AS funded FROM query_runs WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC,id COLLATE BINARY DESC LIMIT ?`).all(...args);
    try { return rows.map(row => {
      if (row.asker !== wallet || row.recorded_asker !== null && (typeof row.recorded_asker !== "string" || row.recorded_asker.toLowerCase() !== wallet)) throw new Error("Owner mismatch");
      return historyRowSchema.parse({ id: row.id, createdAt: row.created_at, question: row.question,
        provenance: typeof row.provenance === "string" ? parseRunProvenance(JSON.parse(row.provenance)) ?? null : null,
        funding: row.funded === "true" ? "browser-recorded" : "other-or-unknown", recordedSpendUsdc: row.total_spent,
        recordedCreatorAllocationUsdc: row.total_to_creators, paymentMode: row.payment_mode, isFollowUp: row.parent_id !== null });
    }); } catch { throw new HistoryError("history_unavailable"); }
  } } satisfies PersonalHistoryStore);
}
