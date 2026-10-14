import type { DatabaseSync, StatementSync } from "node:sqlite";
import { HistoryError, historyIdSchema, historyWallet } from "../history/personal-history";
import { RUN_OWNERSHIP_METHODS, RUN_SURFACES } from "../research/run-provenance";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { ownershipHistoryOriginal, runOwnershipHistoryQuerySchema, runOwnershipHistoryRowSchema, runOwnershipSchema,
  validateRunOwnershipHistoryRows, type RunOwnershipHistoryStore } from "../run-claims/history";
import { assertSqliteRunClaimsSchema } from "./run-claims-sqlite";
import { installRunOwnershipFunctions } from "./run-ownership-functions";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy } from "./storage-identity-connection";

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
  installRunOwnershipFunctions(db);
  return ownershipPort(db, () => assertSqliteRunClaimsSchema(db));
}

/** Fixed pure SQL projections were installed by trusted native opening. This
 * factory registers no function, opens no DB, and accepts no custom guard. */
export function createEnrolledSqliteRunOwnershipHistory(db: DatabaseSync): RunOwnershipHistoryStore {
  const unavailable = () => new HistoryError("history_unavailable");
  if (arguments.length !== 1) throw unavailable();
  assertVerifiedSqliteNativeUserDomainPolicy(db);
  const identity = assertVerifiedSqliteConnection(db);
  if (identity.authorityMode !== "mainnet-real") throw unavailable();
  let refused = false;
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const retire = () => { refused = true; db.close(); };
  const check = () => {
    if (refused) throw unavailable();
    try { assertVerifiedSqliteNativeUserDomainPolicy(db); assertVerifiedSqliteConnection(db); }
    catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  const sql = <T>(action: () => T): T => {
    if (refused) throw unavailable();
    try { return action(); } catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  const guarded = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (query: string) => {
      const statement = sql(() => target.prepare(query));
      return new Proxy(statement, { get(value, key) {
        if (["get", "all"].includes(String(key))) return (...args: unknown[]) => sql(() => Reflect.apply(Reflect.get(value, key), value, args));
        throw unavailable();
      } }) as StatementSync;
    };
    throw unavailable();
  } });
  const port = ownershipPort(guarded, check);
  return Object.freeze({
    async list(owner, query) {
      check();
      try { if (runOwnershipHistoryQuerySchema.parse(query).binding.network !== identity.network) throw unavailable(); }
      catch { throw unavailable(); }
      const result = await port.list(owner, query); check(); return result;
    },
    async read(owner, binding, id) {
      check();
      try { if (runClaimBindingSchema.parse(binding).network !== identity.network) throw unavailable(); }
      catch { throw unavailable(); }
      const result = await port.read(owner, binding, id); check(); return result;
    },
  } satisfies RunOwnershipHistoryStore);
}

/** Private constructor composition; callers cannot supply an authority guard. */
function ownershipPort(db: DatabaseSync, guard: () => void): RunOwnershipHistoryStore {
  return Object.freeze({
    async list(owner, raw) {
      try {
        guard();
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
        guard();
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
