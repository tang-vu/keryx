import type { DatabaseSync } from "node:sqlite";
import type { QueryRun } from "../types";
import type { RunPrivacyStore } from "../run-privacy/contracts";
import { privacyId, validatePrivacyRun } from "../run-privacy/contracts";
import { parseRunUsage } from "../research/usage-provenance";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteSelectedApplicationPolicy } from "./storage-identity-connection";
import { createEnrolledSqliteRunPrivacy, isEnrolledSqlitePrivacyContention } from "./run-privacy-sqlite";
import { publicHistoryIncludes } from "../research-audit/usage-cohort";
import { MAX_USAGE_RUNS, MAX_USAGE_PAYMENTS, projectUsageCorpus, publishedUsageHistory, usageWindowSchema, UsageUnavailable,
  type PublicUsageStore, type UsageCorpus, type UsageWindow } from "../usage/contracts";

/** No schema installation, ledger writes, or enrolled adapter fallback. */
export function createSqlitePublicUsage(db: DatabaseSync, privacy?: () => RunPrivacyStore): PublicUsageStore {
  const active=!!privacy || process.env.KERYX_RUN_PRIVACY_ENABLED==="true";
  assertOrdinarySqliteResearchAuthority(db);
  function transaction<T>(action: () => T): T {
    assertOrdinarySqliteResearchAuthority(db); db.exec("BEGIN");
    try { assertOrdinarySqliteResearchAuthority(db); const result = action(); db.exec("COMMIT"); return result; }
    catch { db.exec("ROLLBACK"); throw new UsageUnavailable(); }
  }
  return publicUsagePort(db, transaction, active, privacy);
}

/** Genuine selected application connection only. No configuration, raw handle,
 * clock, writer policy, schema repair or caller-supplied privacy capability. */
export function createEnrolledSqlitePublicUsage(db: DatabaseSync): PublicUsageStore {
  if (arguments.length !== 1) throw new UsageUnavailable();
  const active = process.env.KERYX_RUN_PRIVACY_ENABLED === "true";
  let refused = false, admitted = false, privacy: RunPrivacyStore | undefined;
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const retire = () => { refused = true; if (admitted) { try { db.close(); } catch { /* permanently refused even if close fails */ } } };
  const check = () => {
    if (refused) throw new UsageUnavailable();
    if (!active && process.env.KERYX_RUN_PRIVACY_ENABLED === "true") throw new UsageUnavailable();
    assertVerifiedSqliteSelectedApplicationPolicy(db);
    assertVerifiedSqliteConnection(db);
    admitted = true;
  };
  const fail = (error: unknown): never => {
    if (!contention(error) && !isEnrolledSqlitePrivacyContention(error)) retire();
    throw new UsageUnavailable();
  };
  try { check(); } catch (error) { fail(error); }

  // A snapshot grants read consistency only, including on readonly connections.
  // Keep the actual SQLite error until the outer request boundary classifies it.
  function snapshot<T>(action: () => T): T {
    let began = false;
    try {
      check(); db.exec("BEGIN"); began = true; check();
      const value = action(); check(); db.exec("COMMIT"); began = false; check(); return value;
    } catch (error) {
      if (began) { try { db.exec("ROLLBACK"); } catch { retire(); throw new UsageUnavailable(); } }
      throw error;
    }
  }
  async function readSnapshot<T>(action: () => Promise<T>): Promise<T> {
    // Native anonymous read/list execute their SQL before their first await.
    // End that snapshot before yielding: concurrent requests on this genuine
    // connection cannot overlap BEGINs, and the next read can see revocation.
    const pending = snapshot(() => {
      const result = action();
      // A later synchronous snapshot/cleanup guard can fail before we await
      // this native promise. Observe its rejection without replacing its value.
      void result.catch(() => {}); return result;
    });
    const value = await pending; check(); return value;
  }
  const nativePrivacy = () => {
    check();
    if (!active) throw new UsageUnavailable();
    if (!privacy) {
      // Lazy full19 admission: summary still qualifies the exact BEFORE family.
      // Even an empty history window must qualify this same native connection.
      const native = createEnrolledSqliteRunPrivacy(db);
      privacy = Object.freeze({ ...native, async list(query) {
        const rows = await readSnapshot(() => native.list(query)); check();
        if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length > query.take) throw new UsageUnavailable();
        return rows;
      } } satisfies RunPrivacyStore);
    }
    return privacy;
  };
  type Candidate = Pick<QueryRun, "id" | "createdAt" | "usage">;
  // Native-only composition: ordinary/shared projector and SQL bodies below
  // stay intact. Classify the same complete bounded metadata/economic window.
  function publishedView(raw: UsageWindow) {
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
    return projectUsageCorpus({ complete: true, window, runs: rows.map(row => ({ id: String(row.id), createdAt: String(row.created_at),
      usage: row.usage ? JSON.parse(String(row.usage)) : null, provenance: row.provenance ? JSON.parse(String(row.provenance)) : null,
      actorId: typeof row.asker === "string" && /^0x[a-fA-F0-9]{40}$/.test(row.asker) ? row.asker : null })),
    payments: payments.map(row => ({ id: String(row.id), queryId: String(row.query_id), network: String(row.network),
      kind: row.kind as UsageCorpus["payments"][number]["kind"], amountUsdc: Number(row.amount_usdc), settled: row.settled === 1,
      settlementStatus: row.settlement_status === null ? null : String(row.settlement_status),
      txHash: row.tx_hash === null ? null : String(row.tx_hash), payee: String(row.payee) })) }, window);
  }
  async function publishedSelection(window: UsageWindow, cohort: "default" | NonNullable<QueryRun["usage"]>["cohort"], limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
    const view = snapshot(() => publishedView(window)), reader = nativePrivacy();
    await reader.list({ take: 1, ids: [] }); check(); // Full19 admission even when empty.
    const selected = view.runs.filter(row => cohort === "default" ? publicHistoryIncludes(row.classification.cohort)
      : row.classification.cohort === cohort).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const candidates: Candidate[] = [];
    for (let start = 0; start < selected.length; start += 100) {
      const batch = selected.slice(start, start + 100), expected = new Map(batch.map(row => [row.id, row]));
      const rows = await reader.list({ take: batch.length, ids: batch.map(row => row.id) }); check();
      for (const run of rows) {
        const original = expected.get(run.id), usage = view.classifications.get(run.id);
        if (!original || run.createdAt !== original.createdAt
          || JSON.stringify(parseRunUsage(run.usage)) !== JSON.stringify(usage)) throw new UsageUnavailable();
        // Retain identity/time/usage expectations only, never a privacy verdict
        // or whole population bodies. Withdrawn selections consume bounded work.
        candidates.push({ id: run.id, createdAt: original.createdAt, usage });
      }
    }
    return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  function revalidate(candidates: readonly Candidate[], limit: number, published = false) {
    if (candidates.length > MAX_USAGE_RUNS || new Set(candidates.map(row => row.id)).size !== candidates.length)
      throw new UsageUnavailable();
    // After the caller's LAST await, one owned read transaction sees current
    // PUBLIC bodies and their metadata together. No awaits or refill inside it.
    assertVerifiedSqliteNativeUserDomainPolicy(db);
    return snapshot(() => {
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      const runs: QueryRun[] = []; let windowRuns = 0;
      for (let start = 0; start < candidates.length; start += 100) {
        const batch = candidates.slice(start, start + 100), expected = new Map(batch.map(row => [row.id, row]));
        const ids = batch.map(row => privacyId.parse(row.id)), publishedBatch: QueryRun[] = [];
        const rows = db.prepare(`SELECT q.data,q.id,q.created_at,p.visibility,p.revision,p.erased,
          CASE WHEN json_valid(q.data) AND json_type(q.data,'$.usage')='object'
            AND length(CAST(json_extract(q.data,'$.usage') AS BLOB))<=2048
            THEN json_extract(q.data,'$.usage') END AS usage
          FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
          WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?))
          ORDER BY q.created_at DESC,q.id DESC LIMIT ?`).all(JSON.stringify(ids), batch.length);
        if (rows.length > batch.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new UsageUnavailable();
        for (const row of rows) {
          if (typeof row.id !== "string" || typeof row.created_at !== "string") throw new UsageUnavailable();
          const original = expected.get(row.id), run = validatePrivacyRun(JSON.parse(String(row.data)), row.id);
          if (!original || row.created_at !== original.createdAt || run.createdAt !== row.created_at
            || row.visibility !== "public" || row.erased !== 0 || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
            || JSON.stringify(parseRunUsage(run.usage)) !== JSON.stringify(parseRunUsage(original.usage))
            || JSON.stringify(parseRunUsage(run.usage)) !== JSON.stringify(parseRunUsage(row.usage ? JSON.parse(String(row.usage)) : null)))
            throw new UsageUnavailable();
          windowRuns++;
          if (published) publishedBatch.push(run);
          else if (runs.length < limit) runs.push(run);
        }
        // Restore the published comparator before sampling; history keeps SQL order.
        for (const run of publishedBatch.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)))
          if (runs.length < limit) runs.push(run);
      }
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      return { windowRuns, runs };
    });
  }
  const port = publicUsagePort(db, snapshot, active, nativePrivacy);
  const wrapped = Object.create(null) as PublicUsageStore;
  for (const name of ["summary", "history", "publishedHistory"] as const) {
    Object.defineProperty(wrapped, name, { enumerable: true, value: async (...args: unknown[]) => {
      try {
        if (name === "publishedHistory" && active) {
          check();
          const [window, cohort, limit] = args as Parameters<NonNullable<PublicUsageStore["publishedHistory"]>>;
          const candidates = await publishedSelection(window, cohort, limit); check();
          return revalidate(candidates, limit, true);
        }
        check(); const result = await Reflect.apply(port[name]!, port, args); check();
        if (name === "history" && active) {
          const rows = result as QueryRun[];
          return revalidate(rows, rows.length).runs;
        }
        return result;
      }
      catch (error) { return fail(error); }
    } });
  }
  return Object.freeze(wrapped);
}

/** Whole ordinary read/projector bodies; authority composition stays private. */
function publicUsagePort(db: DatabaseSync, transaction: <T>(action: () => T) => T,
  active: boolean, privacy?: () => RunPrivacyStore): PublicUsageStore {
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
    async publishedHistory(window, cohort, limit) {
      if (!active || !privacy) throw new UsageUnavailable();
      const view = transaction(() => projectUsageCorpus(corpus(window), window));
      return publishedUsageHistory(view, privacy(), cohort, limit);
    },
    async history(window, cohort, limit) {
      if (!active) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
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
      }); }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
      const selected = transaction(() => {
        const view = projectUsageCorpus(corpus(window), window);
        // Classify/filter the complete bounded window BEFORE selecting a history page.
        const rows=view.runs.filter(run => cohort === "default" ? publicHistoryIncludes(run.classification.cohort)
          : run.classification.cohort === cohort)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        return {rows,classifications:view.classifications};
      });
      if (!privacy) throw new UsageUnavailable();
      const rows=await privacy().list({take:limit,ids:selected.rows.map(row => row.id)});
      for(const run of rows) {
        if(!selected.rows.some(value=>value.id===run.id&&value.createdAt===run.createdAt)
          || JSON.stringify(parseRunUsage(run.usage))!==JSON.stringify(selected.classifications.get(run.id)))throw new UsageUnavailable();
      }
      return rows;
    },
  } satisfies PublicUsageStore);
}
