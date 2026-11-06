import type { DatabaseSync } from "node:sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteSelectedApplicationPolicy } from "./storage-identity-connection";
import { privacyId, validatePrivacyRun } from "../run-privacy/contracts";
import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import type { QueryRun } from "../types";
import { captureLedgerRun, plain } from "../operator-ledger/capture";
import { ledgerRunCursor, type PublicLedgerRunCursor, type PublicLedgerRunReader } from "../operator-ledger/native-pages";

const unavailable = () => new Error("Public ledger native metadata unavailable");

/** Same persisted source/item flags and fingerprint demotion as the full SQLite
 * run reader, executed synchronously inside the bounded native read snapshot. */
function recordedRun(db: DatabaseSync, run: QueryRun): QueryRun {
  const references = [...run.citations, ...run.decisions, ...(Array.isArray(run.evidence) ? run.evidence : [])];
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
  return demoteSyntheticEvidence({ ...run, citations: run.citations.map(mark), decisions: run.decisions.map(mark),
    ...(Array.isArray(run.evidence) ? { evidence: run.evidence.map(mark) } : {}) });
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
  return Object.freeze({ page(query) {
    let began = false;
    try {
      if (!plain(query) || Object.keys(query).some(key => !["take", "before"].includes(key)) ||
        !Number.isSafeInteger(query.take) || query.take < 1 || query.take > 32 ||
        query.before !== undefined && !ledgerRunCursor(query.before)) throw unavailable();
      check(); db.exec("BEGIN"); began = true; check();
      const args: Array<string | number> = [];
      let filter = "";
      if (query.before) { filter = " AND (q.created_at<? OR (q.created_at=? AND q.id<?))";
        args.push(query.before.createdAt, query.before.createdAt, query.before.id); }
      args.push(query.take);
      // Sort/materialize identifiers only. Even iterate() of an ORDER BY data
      // query can retain every original in SQLite's temporary sorter.
      const ids = db.prepare(`SELECT q.id,q.created_at FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE p.visibility='public' AND p.erased=0${filter} ORDER BY q.created_at DESC,q.id DESC LIMIT ?`).all(...args);
      const read = db.prepare(`SELECT q.data FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE q.id=? AND p.visibility='public' AND p.erased=0`);
      const snapshots = ids.map(row => {
        const id = privacyId.parse(row.id), record = read.get(id);
        if (!record || typeof record.data !== "string") throw unavailable();
        const run = validatePrivacyRun(JSON.parse(record.data), id);
        if (run.createdAt !== row.created_at) throw unavailable();
        const snapshot = captureLedgerRun(recordedRun(db, run));
        // Detach retained strings from the much larger original JSON backing
        // store. Only the bounded metadata serialization survives this row.
        return snapshot ? JSON.parse(JSON.stringify(snapshot)) as typeof snapshot : null;
      });
      const last = ids.at(-1);
      const before: PublicLedgerRunCursor | null = last ? { id: String(last.id), createdAt: String(last.created_at) } : null;
      if (before && !ledgerRunCursor(before)) throw unavailable();
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
      return { snapshots, before };
    } catch (error) {
      if (began) { try { db.exec("ROLLBACK"); } catch { retire(); } }
      return fail(error);
    }
  } } satisfies PublicLedgerRunReader);
}
