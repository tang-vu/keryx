import type { DatabaseSync } from "node:sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteSelectedApplicationPolicy } from "./storage-identity-connection";
import { privacyId, validatePrivacyRun } from "../run-privacy/contracts";
import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import type { QueryRun } from "../types";
import { captureLedgerRun } from "../operator-ledger/capture";
import { LEDGER_RUN_LIMIT } from "../operator-ledger/contracts";
import type { PublicLedgerRunReader } from "../operator-ledger/native-runs";

const unavailable = () => new Error("Public ledger native metadata unavailable");

/** Same persisted source/item flags and fingerprint demotion as the full SQLite
 * run reader, executed synchronously inside the bounded native read snapshot. */
function recordedRuns(db: DatabaseSync, runs: QueryRun[]): QueryRun[] {
  const references = runs.flatMap(run => [...run.citations, ...run.decisions, ...(Array.isArray(run.evidence) ? run.evidence : [])]);
  const sourceIds = [...new Set(references.map(item => item.sourceId))];
  const itemIds = [...new Set(references.flatMap(item => item.itemId ? [item.itemId] : []))];
  const flags = new Set<string>();
  for (const [table, ids] of [["sources", sourceIds], ["source_items", itemIds]] as const) {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      if (batch.some(id => id.length > 256)) throw unavailable();
      const rows = db.prepare(`SELECT id${table === "source_items" ? ",source_id" : ""} FROM ${table} WHERE evidence_provenance='synthetic-demo' AND id IN (${batch.map(() => "?").join(",")})`).all(...batch);
      for (const row of rows) flags.add(table === "sources" ? `source:${row.id}` : `item:${row.source_id}:${row.id}`);
    }
  }
  const mark = <T extends { sourceId: string; itemId?: string }>(item: T): T =>
    flags.has(`source:${item.sourceId}`) || item.itemId && flags.has(`item:${item.sourceId}:${item.itemId}`)
      ? { ...item, evidenceProvenance: "synthetic-demo" } : item;
  return runs.map(run => demoteSyntheticEvidence({ ...run, citations: run.citations.map(mark), decisions: run.decisions.map(mark),
    ...(Array.isArray(run.evidence) ? { evidence: run.evidence.map(mark) } : {}) }));
}

/** Genuine selected full native user-domain connection only. Fresh full checks
 * surround every synchronous snapshot; no cached admission/visibility, ordinary
 * constructor, caller guard, schema installation or financial capability. */
export function createEnrolledSqlitePublicLedgerRuns(db: DatabaseSync): PublicLedgerRunReader {
  if (arguments.length !== 1) throw unavailable();
  let refused = false, admitted = false;
  const retire = () => { refused = true; if (admitted) { try { db.close(); } catch { /* permanently refused */ } } };
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const check = () => {
    if (refused || process.env.KERYX_RUN_PRIVACY_ENABLED !== "true") throw unavailable();
    assertVerifiedSqliteSelectedApplicationPolicy(db);
    assertVerifiedSqliteNativeUserDomainPolicy(db);
    assertVerifiedSqliteConnection(db);
    admitted = true;
  };
  const fail = (error: unknown): never => { if (!contention(error)) retire(); throw unavailable(); };
  try { check(); } catch (error) { fail(error); }
  return Object.freeze({ read(limit) {
    let began = false;
    try {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > LEDGER_RUN_LIMIT + 1) throw unavailable();
      check(); db.exec("BEGIN"); began = true; check();
      // Sort/materialize identifiers only. Even iterate() of an ORDER BY data
      // query can retain every original in SQLite's temporary sorter.
      const ids = db.prepare(`SELECT q.id,q.created_at FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE p.visibility='public' AND p.erased=0 ORDER BY q.created_at DESC,q.id DESC LIMIT ?`).all(limit);
      // A verified statement also rechecks full native authority on every call.
      // Read at most four originals per call, never the complete 251-body slice.
      // The SQL byte guard bounds raw allocation before Node parses anything.
      const read = db.prepare(`SELECT q.id,CASE WHEN typeof(q.data)='text' AND length(CAST(q.data AS BLOB))<=4000000
        THEN q.data END AS data FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?))`);
      const snapshots: Array<ReturnType<typeof captureLedgerRun>> = [];
      for (let offset = 0; offset < ids.length; offset += 4) {
        const group = ids.slice(offset, offset + 4), keys = group.map(row => privacyId.parse(row.id));
        const records = read.all(JSON.stringify(keys));
        if (records.length !== group.length || new Set(records.map(row => row.id)).size !== records.length) throw unavailable();
        const byId = new Map(records.map(row => [row.id, row.data]));
        const runs = group.map(row => {
          const id = privacyId.parse(row.id), original = byId.get(id);
          if (typeof original !== "string") throw unavailable();
          const run = validatePrivacyRun(JSON.parse(original), id);
          if (run.createdAt !== row.created_at) throw unavailable();
          return run;
        });
        // Same page-local provenance lookup as the existing full-run projector.
        // Retain no originals or permission verdicts between these fixed batches.
        for (const run of recordedRuns(db, runs)) {
          const snapshot = captureLedgerRun(run);
          // Detach retained strings from original JSON backing stores.
          snapshots.push(snapshot ? JSON.parse(JSON.stringify(snapshot)) as typeof snapshot : null);
        }
      }
      check(); db.exec("COMMIT"); began = false; check();
      // Withdrawals committed during the finite snapshot cannot retain copied
      // public metadata. This fresh query carries IDs only, never original bodies.
      if (ids.length) {
        const visible = new Set(db.prepare(`SELECT q.id FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
          WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?))`)
          .all(JSON.stringify(ids.map(row => row.id))).map(row => row.id));
        ids.forEach((row, index) => { if (!visible.has(row.id)) snapshots[index] = null; });
        check();
      }
      return snapshots;
    } catch (error) {
      if (began) { try { db.exec("ROLLBACK"); } catch { retire(); } }
      return fail(error);
    }
  } } satisfies PublicLedgerRunReader);
}
