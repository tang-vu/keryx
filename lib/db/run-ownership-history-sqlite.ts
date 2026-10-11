import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HistoryError, historyIdSchema, historyWallet } from "../history/personal-history";
import { RUN_OWNERSHIP_METHODS, RUN_SURFACES } from "../research/run-provenance";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { ownershipHistoryOriginal, runOwnershipHistoryQuerySchema, runOwnershipHistoryRowSchema, runOwnershipSchema,
  summarizeOwnershipOriginal, validateRunOwnershipHistoryRows, type RunOwnershipHistoryStore } from "../run-claims/history";
import { assertSqliteRunClaimsSchema } from "./run-claims-sqlite";

const maxOriginalBytes = 4_000_000;
const provenance = `CASE WHEN json_type(q.data,'$.provenance')='object'
  AND (SELECT count(*) FROM json_each(q.data,'$.provenance'))=3
  AND json_type(q.data,'$.provenance.version') IN ('integer','real') AND json_extract(q.data,'$.provenance.version')=1
  AND json_extract(q.data,'$.provenance.surface') IN (${RUN_SURFACES.map(value => `'${value}'`).join(",")})
  AND json_extract(q.data,'$.provenance.ownershipMethod') IN (${RUN_OWNERSHIP_METHODS.map(value => `'${value}'`).join(",")})
  THEN json_extract(q.data,'$.provenance') ELSE NULL END`;
// A single PK join deduplicates ownership. A claimed association remains valid
// after ticket expiry, but never grants access to a replaced/changed original.
const ownerPredicate = `(q.asker=? OR (q.asker IS NULL AND c.claimed_wallet=? AND c.claimed_at IS NOT NULL
  AND c.completed_at=q.created_at AND json_type(q.data)='object'
  AND json_extract(q.data,'$.id')=q.id AND json_extract(q.data,'$.createdAt')=q.created_at
  AND json_type(q.data,'$.asker') IS NULL AND json_type(q.data,'$.originalFulfillment') IS NULL
  AND json_type(q.data,'$.askerFunded') IS NOT 'true' AND json_extract(q.data,'$.fundingOwner') IS NOT 'browser'
  AND NOT EXISTS(SELECT 1 FROM a2a_orders WHERE query_id=q.id)
  AND keryx_claim_history_sha(q.data)=c.original_sha256))`;
const join = `FROM query_runs q LEFT JOIN anonymous_run_claims c ON c.run_id=q.id AND c.network=? AND c.origin=?`;

/** Exact existing claim domain only. Connection-local pure functions install no schema or data. */
export function createSqliteRunOwnershipHistory(db: DatabaseSync): RunOwnershipHistoryStore {
  assertSqliteRunClaimsSchema(db);
  db.function("keryx_claim_history_sha", { deterministic: true }, value => typeof value === "string" && Buffer.byteLength(value)<=maxOriginalBytes
    ? createHash("sha256").update(value).digest("hex") : null);
  db.function("keryx_claim_history_summary", { deterministic: true }, (value, owner, id, createdAt, claimedAt) => {
    try {
      if (typeof value !== "string" || Buffer.byteLength(value)>maxOriginalBytes || typeof owner !== "string"
        || typeof id !== "string" || typeof createdAt !== "string") return null;
      const ownership = runOwnershipSchema.parse(claimedAt === null ? { method: "recorded", claimedAt: null }
        : { method: "claimed", claimedAt: new Date(Number(claimedAt)).toISOString() });
      return JSON.stringify(summarizeOwnershipOriginal(ownershipHistoryOriginal(JSON.parse(value), owner, id, createdAt, ownership)));
    } catch { return null; }
  });
  return Object.freeze({
    async list(owner, raw) {
      try {
        assertSqliteRunClaimsSchema(db);
        const wallet = historyWallet(owner), query = runOwnershipHistoryQuerySchema.parse(raw), { binding, filters } = query;
        const where = [ownerPredicate], args: (string | number)[] = [wallet, binding.network, binding.origin, wallet, wallet];
        for (const [position, exclusive] of [[query.upper, false], [query.before, true]] as const) if (position) {
          where.push(`(q.created_at < ? OR (q.created_at = ? AND q.id ${exclusive ? "<" : "<="} ? COLLATE BINARY))`);
          args.push(position.createdAt, position.createdAt, position.id);
        }
        if (filters.from) { where.push("q.created_at >= ?"); args.push(filters.from); }
        if (filters.to) { where.push("q.created_at <= ?"); args.push(filters.to); }
        if (filters.search !== undefined) { where.push("instr(json_extract(q.data,'$.question'),?)>0"); args.push(filters.search); }
        if (filters.surface) { where.push(`coalesce(json_extract((${provenance}),'$.surface'),'unknown')=?`); args.push(filters.surface); }
        if (filters.funding) { where.push(`(json_type(q.data,'$.askerFunded')='true') ${filters.funding === "browser-recorded" ? "IS TRUE" : "IS NOT TRUE"}`); }
        args.push(query.take);
        const rows = db.prepare(`SELECT q.id,q.created_at,
          CASE WHEN q.asker IS NOT NULL THEN NULL ELSE c.claimed_at END AS claimed_at,
          keryx_claim_history_summary(CASE WHEN length(CAST(q.data AS BLOB))<=${maxOriginalBytes} THEN q.data END,?,q.id,q.created_at,CASE WHEN q.asker IS NOT NULL THEN NULL ELSE c.claimed_at END) AS summary
          ${join} WHERE ${where.join(" AND ")} ORDER BY q.created_at DESC,q.id COLLATE BINARY DESC LIMIT ?`).all(...args);
        return validateRunOwnershipHistoryRows(rows.map(row => runOwnershipHistoryRowSchema.parse({ ...JSON.parse(String(row.summary)),
          ownership: row.claimed_at === null ? { method: "recorded", claimedAt: null }
            : { method: "claimed", claimedAt: new Date(Number(row.claimed_at)).toISOString() } })), query);
      } catch { throw new HistoryError("history_unavailable"); }
    },
    async read(owner, rawBinding, rawId) {
      try {
        assertSqliteRunClaimsSchema(db);
        const wallet = historyWallet(owner), binding = runClaimBindingSchema.parse(rawBinding), id = historyIdSchema.parse(rawId);
        const row = db.prepare(`SELECT q.id,q.created_at,CASE WHEN length(CAST(q.data AS BLOB))<=${maxOriginalBytes} THEN q.data END AS data,
          CASE WHEN q.asker IS NOT NULL THEN NULL ELSE c.claimed_at END AS claimed_at
          ${join} WHERE q.id=? AND ${ownerPredicate}`).get(binding.network, binding.origin, id, wallet, wallet);
        if (!row) return null;
        const ownership = runOwnershipSchema.parse(row.claimed_at === null ? { method: "recorded", claimedAt: null }
          : { method: "claimed", claimedAt: new Date(Number(row.claimed_at)).toISOString() });
        return { run: ownershipHistoryOriginal(JSON.parse(String(row.data)), wallet, String(row.id), String(row.created_at), ownership), ownership };
      } catch { throw new HistoryError("history_unavailable"); }
    },
  } satisfies RunOwnershipHistoryStore);
}
