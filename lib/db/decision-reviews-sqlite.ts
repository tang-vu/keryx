import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { captureDecisionSchema, decisionReviewSchema, decisionTermsSchema, reviewCohortSchema, reviewIdSchema,
  reviewOwner, reviewVerdictSchema, DecisionReviewError, REVIEW_WAIT_MS, reviewActionSchema, reviewRuleSchema,
  reviewPeriodSchema, decisionReviewMetricsSchema, type DecisionReview, type DecisionReviewsStore, type DecisionReviewMetrics } from "../research/decision-review-types";

export const DECISION_REVIEWS_SQL = `CREATE TABLE IF NOT EXISTS decision_review_records (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, run_id TEXT NOT NULL, network TEXT NOT NULL, created_at TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(length(CAST(input_json AS BLOB))<=8192), state TEXT NOT NULL CHECK(state IN ('observed','held','approved','declined','expired','consumed','cancelled')),
 expires_at TEXT, code_action TEXT NOT NULL CHECK(code_action IN ('BUY','SKIP','CACHE')), code_rule TEXT NOT NULL CHECK(code_rule IN (${reviewRuleSchema.options.map(rule => `'${rule}'`).join(",")})),
 verdict_json TEXT, UNIQUE(wallet,run_id,id)
);
CREATE INDEX IF NOT EXISTS decision_review_owner_run ON decision_review_records(wallet,run_id,created_at,id);
CREATE INDEX IF NOT EXISTS decision_review_period ON decision_review_records(network,created_at);
CREATE TABLE IF NOT EXISTS decision_review_verdicts (
 wallet TEXT NOT NULL, key TEXT NOT NULL, decision_id TEXT NOT NULL, input_json TEXT NOT NULL,
 PRIMARY KEY(wallet,key)
);`;
const shape = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema WHERE tbl_name IN ('decision_review_records','decision_review_verdicts') ORDER BY type,name LIMIT 12").all();
let expected: string | undefined;
function assertShape(db: DatabaseSync) {
  if (!expected) { const ref = new DatabaseSync(":memory:"); try { ref.exec(DECISION_REVIEWS_SQL); expected = JSON.stringify(shape(ref)); } finally { ref.close(); } }
  if (JSON.stringify(shape(db)) !== expected) throw new DecisionReviewError("review_unavailable");
}
function project(row: Record<string, unknown>): DecisionReview {
  const input = captureDecisionSchema.parse(JSON.parse(String(row.input_json)));
  return decisionReviewSchema.parse({ ...input, codeAction: row.code_action, codeRule: row.code_rule,
    initialCodeAction: input.codeAction, initialCodeRule: input.codeRule,
    id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, state: row.state,
    verdict: row.verdict_json === null ? null : JSON.parse(String(row.verdict_json)) });
}
export function createSqliteDecisionReviews(db: DatabaseSync): DecisionReviewsStore {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try { assertOrdinarySqliteResearchAuthority(db); if (shape(db).length) assertShape(db); db.exec(DECISION_REVIEWS_SQL); assertShape(db); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  function tx<T>(write: boolean, action: () => T): T {
    assertOrdinarySqliteResearchAuthority(db); db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { assertOrdinarySqliteResearchAuthority(db); assertShape(db); const out = action(); db.exec("COMMIT"); return out; }
    catch (error) { db.exec("ROLLBACK"); if (error instanceof DecisionReviewError) throw error; throw new DecisionReviewError("review_unavailable"); }
  }
  return decisionReviewsPort(db, tx);
}

// SQLite strips IF NOT EXISTS and the final semicolon when retaining table/index
// SQL. This data-only profile never opens a reference DB or installs a domain.
const nativeDomainShape = canonicalJson([
  { type: "index", name: "decision_review_owner_run", tbl_name: "decision_review_records",
    sql: "CREATE INDEX decision_review_owner_run ON decision_review_records(wallet,run_id,created_at,id)" },
  { type: "index", name: "decision_review_period", tbl_name: "decision_review_records",
    sql: "CREATE INDEX decision_review_period ON decision_review_records(network,created_at)" },
  { type: "index", name: "sqlite_autoindex_decision_review_records_1", tbl_name: "decision_review_records", sql: null },
  { type: "index", name: "sqlite_autoindex_decision_review_records_2", tbl_name: "decision_review_records", sql: null },
  { type: "index", name: "sqlite_autoindex_decision_review_verdicts_1", tbl_name: "decision_review_verdicts", sql: null },
  ...DECISION_REVIEWS_SQL.split(";").map(sql => sql.trim()).filter(sql => sql.startsWith("CREATE TABLE")).map(sql => ({
    type: "table", name: sql.includes("decision_review_records") ? "decision_review_records" : "decision_review_verdicts",
    tbl_name: sql.includes("decision_review_records") ? "decision_review_records" : "decision_review_verdicts",
    sql: sql.replace(" IF NOT EXISTS", ""),
  })),
]);
const nativeContention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
  && "errcode" in error && (error.errcode === 5 || error.errcode === 6);

/** Same selected verified store only. No target DDL, ordinary fallback, raw
 * capability, supplied policy or activation. Exact BEFORE leaves the port absent. */
export function createEnrolledSqliteDecisionReviews(db: DatabaseSync): DecisionReviewsStore | undefined {
  const unavailable = () => new DecisionReviewError("review_unavailable");
  if (arguments.length !== 1) throw unavailable();
  let revoked = false;
  const revoke = () => {
    revoked = true;
    try { db.close(); } catch { /* refusal stays latched even if close fails */ }
  };
  let identity: ReturnType<typeof assertVerifiedSqliteConnection>;
  try { identity = assertVerifiedSqliteConnection(db); } catch { throw unavailable(); }
  const schema = () => {
    if (revoked) throw unavailable();
    assertVerifiedSqliteConnection(db);
    if (identity.authorityMode !== "mainnet-real") throw unavailable();
    assertStorageFences(db, identity);
    const fences = Object.keys(storageFenceStatements(db, identity));
    const excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
      "storage_identity_no_insert", ...fences]);
    const profile = sqliteApplicationSchemaProfile(db, excluded);
    // Source profiles are produced/cached by trusted native opening, not from the
    // caller's shape. Unknown, partial and original-plus-one-domain stores refuse.
    const source = supportedSqliteApplicationProfiles(true);
    const rows = db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
      WHERE tbl_name IN ('decision_review_records','decision_review_verdicts')
      AND name NOT IN (${fences.map(() => "?").join(",")}) ORDER BY type,name LIMIT 8`).all(...fences);
    const present = rows.length !== 0;
    if (present) {
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      if ((profile !== source[1] && profile !== source[3]) || canonicalJson(rows) !== nativeDomainShape) throw unavailable();
    } else if (profile !== source[0] && profile !== source[2]) throw unavailable();
    return { profile, present };
  };
  let admitted: ReturnType<typeof schema>;
  try { admitted = schema(); } catch { revoke(); throw unavailable(); }
  if (!admitted.present) return undefined;
  const check = () => {
    try {
      if (revoked) throw unavailable();
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      // Trusted native opening pins the exact full19 family; the full runtime
      // guard rechecks that pin, identity, manifest, held file and fences.
      assertVerifiedSqliteConnection(db);
    } catch (error) { if (!nativeContention(error)) revoke(); throw error; }
  };
  const writeAccess = () => {
    if (revoked) throw unavailable();
    // Genuine WeakMap metadata only: denied actual readonly writes run zero SQL
    // and preserve the reader. Full runtime/file/identity/manifest guards follow.
    try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
    try { check(); } catch (error) { if (!nativeContention(error)) revoke(); throw unavailable(); }
  };
  function tx<T>(write: boolean, action: () => T): T {
    if (revoked) throw unavailable();
    if (write) { try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); } }
    let started = false, committing = false;
    try {
      check();
      // A failed guarded BEGIN has no journal-owned transaction. The verified
      // connection rolls back its own guard snapshot before propagating a lock.
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); started = true;
      check(); const result = action(); check();
      committing = true; db.exec("COMMIT"); started = false;
      check(); return result;
    } catch (error) {
      const benign = error instanceof DecisionReviewError
        && ["review_conflict", "review_not_found", "review_expired"].includes(error.code);
      // Classify BEFORE cleanup: an unclassified guard failure cannot regain
      // authority when its input is restored. Any COMMIT/after-COMMIT failure is
      // uncertain and never ACKs, even when its error resembles contention.
      if (revoked || committing || (!benign && !nativeContention(error))) { revoke(); throw unavailable(); }
      if (started) {
        try {
          db.exec("ROLLBACK"); started = false;
          if (db.isTransaction) throw unavailable();
          check();
        } catch { revoke(); throw unavailable(); }
      } else if (benign) {
        // Business refusal can only originate inside an acquired journal txn.
        revoke(); throw unavailable();
      }
      if (benign) throw error;
      throw unavailable();
    }
  }
  // Latch internal prepare/get/all/run guard failures before the journal can
  // interpret an error as a business refusal or cleanup sees restored inputs.
  const sql = <T>(action: () => T): T => {
    if (revoked) throw unavailable();
    try { return action(); }
    catch (error) { if (!nativeContention(error)) revoke(); throw error; }
  };
  const guarded = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (query: string) => {
      const statement = sql(() => target.prepare(query));
      return new Proxy(statement, { get(value, key) {
        if (["get", "all", "run"].includes(String(key)))
          return (...args: unknown[]) => sql(() => Reflect.apply(Reflect.get(value, key), value, args));
        throw unavailable();
      } }) as StatementSync;
    };
    throw unavailable();
  } });
  return decisionReviewsPort(guarded, tx, writeAccess);
}

/** Private composition only; SQL, state rules and projection stay shared verbatim. */
function decisionReviewsPort(db: DatabaseSync, tx: <T>(write: boolean, action: () => T) => T,
  beforeWrite?: () => void): DecisionReviewsStore {
  function owned(owner: string, id: string) {
    const row = db.prepare("SELECT * FROM decision_review_records WHERE wallet=? AND id=?").get(reviewOwner(owner), reviewIdSchema.parse(id));
    if (!row) throw new DecisionReviewError("review_not_found");
    return row;
  }
  return Object.freeze({
    async ready() { tx(false, () => undefined); },
    async capture(owner, raw, now) {
      beforeWrite?.();
      const wallet = reviewOwner(owner), input = captureDecisionSchema.parse(raw), id = randomUUID();
      return tx(true, () => {
        const createdAt = new Date(now ?? Date.now()).toISOString();
        const count = db.prepare("SELECT count(*) AS n FROM decision_review_records WHERE wallet=? AND run_id=?").get(wallet, input.runId)!;
        if (Number(count.n) >= 300) throw new DecisionReviewError("review_unavailable");
        db.prepare("INSERT INTO decision_review_records VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, wallet, input.runId, input.terms.network, createdAt,
          canonicalJson(input), "observed", null, input.codeAction, input.codeRule, null);
        return project(owned(wallet, id));
      });
    },
    async begin(owner, id, now) {
      beforeWrite?.();
      return tx(true, () => {
        const at = now ?? Date.now();
        const wallet = reviewOwner(owner), record = project(owned(wallet, id));
        if (record.state !== "observed" || record.expiresAt !== null || !record.reviewFirst || !record.terms.owned || record.codeAction === "SKIP" || record.verdict)
          throw new DecisionReviewError("review_conflict");
        const result = db.prepare("UPDATE decision_review_records SET state='held',expires_at=? WHERE wallet=? AND id=? AND state='observed' AND expires_at IS NULL").run(new Date(at + REVIEW_WAIT_MS).toISOString(), wallet, id);
        if (result.changes !== 1) throw new DecisionReviewError("review_conflict");
        return project(owned(wallet, id));
      });
    },
    async list(owner, runId) {
      const wallet = reviewOwner(owner), run = reviewIdSchema.parse(runId);
      return tx(false, () => { const rows = db.prepare("SELECT * FROM decision_review_records WHERE wallet=? AND run_id=? ORDER BY created_at,id LIMIT 301").all(wallet, run); if (rows.length > 300) throw new DecisionReviewError("review_unavailable"); return rows.map(project); });
    },
    async read(owner, id) { return tx(false, () => { const row = db.prepare("SELECT * FROM decision_review_records WHERE wallet=? AND id=?").get(reviewOwner(owner), reviewIdSchema.parse(id)); return row ? project(row) : null; }); },
    async verdict(owner, raw, now) {
      beforeWrite?.();
      const wallet = reviewOwner(owner), input = reviewVerdictSchema.parse(raw), encoded = canonicalJson(input);
      return tx(true, () => {
        const at = now ?? Date.now();
        const prior = db.prepare("SELECT input_json FROM decision_review_verdicts WHERE wallet=? AND key=?").get(wallet, input.key);
        if (prior) { if (prior.input_json !== encoded) throw new DecisionReviewError("review_conflict"); return project(owned(wallet, input.id)); }
        const record = project(owned(wallet, input.id));
        if (input.context === "gate") {
          if (record.state !== "held") throw new DecisionReviewError("review_conflict");
          if (!record.expiresAt || Date.parse(record.expiresAt) <= at) throw new DecisionReviewError("review_expired");
          db.prepare("UPDATE decision_review_records SET state=? WHERE wallet=? AND id=? AND state='held'").run(input.value === "agree" ? "approved" : "declined", wallet, input.id);
        } else if (["held", "approved"].includes(record.state) || input.expectedCode?.action !== record.codeAction || input.expectedCode?.rule !== record.codeRule) throw new DecisionReviewError("review_conflict");
        const verdict = { value: input.value, ...(input.reason ? { reason: input.reason } : {}), context: input.context,
          codeAction: input.context === "gate" ? record.initialCodeAction : record.codeAction,
          codeRule: input.context === "gate" ? record.initialCodeRule : record.codeRule, createdAt: new Date(at).toISOString() };
        db.prepare("UPDATE decision_review_records SET verdict_json=? WHERE wallet=? AND id=?").run(canonicalJson(verdict), wallet, input.id);
        const result = project(owned(wallet, input.id));
        db.prepare("INSERT INTO decision_review_verdicts VALUES(?,?,?,?)").run(wallet, input.key, input.id, encoded);
        return result;
      });
    },
    async consume(owner, id, rawTerms, now) {
      beforeWrite?.();
      const terms = decisionTermsSchema.parse(rawTerms);
      return tx(true, () => {
        const at = now ?? Date.now();
        const wallet = reviewOwner(owner), record = project(owned(wallet, id));
        if (record.state !== "approved") throw new DecisionReviewError("review_conflict");
        if (!record.expiresAt || Date.parse(record.expiresAt) <= at) throw new DecisionReviewError("review_expired");
        if (canonicalJson(record.terms) !== canonicalJson(terms)) throw new DecisionReviewError("review_conflict");
        const result = db.prepare("UPDATE decision_review_records SET state='consumed' WHERE wallet=? AND id=? AND state='approved'").run(wallet, id);
        if (result.changes !== 1) throw new DecisionReviewError("review_conflict");
        return project(owned(wallet, id));
      });
    },
    async cancel(owner, runId) { beforeWrite?.(); tx(true, () => db.prepare("UPDATE decision_review_records SET state='cancelled' WHERE wallet=? AND run_id=? AND (state IN ('held','approved') OR (state='observed' AND json_extract(input_json,'$.reviewFirst')=1 AND json_extract(input_json,'$.terms.owned')=1 AND code_action<>'SKIP'))").run(reviewOwner(owner), reviewIdSchema.parse(runId))); },
    async expire(owner, id, now) {
      beforeWrite?.();
      tx(true, () => { const at = now ?? Date.now(), record = project(owned(owner, id)); if (record.expiresAt && Date.parse(record.expiresAt) <= at) db.prepare("UPDATE decision_review_records SET state='expired' WHERE wallet=? AND id=? AND state IN ('held','approved')").run(reviewOwner(owner), id); });
    },
    async observe(owner, id, action, rule) {
      beforeWrite?.();
      tx(true, () => { owned(owner, id); db.prepare("UPDATE decision_review_records SET code_action=?,code_rule=?,state=CASE WHEN ?='SKIP' AND state IN ('observed','held','approved') AND json_extract(input_json,'$.reviewFirst')=1 AND json_extract(input_json,'$.terms.owned')=1 THEN 'cancelled' ELSE state END WHERE wallet=? AND id=?")
        .run(reviewActionSchema.parse(action), reviewRuleSchema.parse(rule), action, reviewOwner(owner), id); });
    },
    async metrics(rawNetwork, since, until) {
      const { network } = reviewPeriodSchema.parse({ network: rawNetwork, since, until });
      return tx(false, () => {
        const cohorts: DecisionReviewMetrics["cohorts"] = reviewCohortSchema.options.map(cohort => ({ cohort, decisions: 0, agrees: 0, disagrees: 0, agreementRate: null, modelCodeDifferences: 0, codeRefusals: 0, refusalReasons: {} }));
        const groups = db.prepare(`SELECT json_extract(input_json,'$.cohort') AS cohort, json_extract(input_json,'$.modelAction') AS model,
          code_action AS action, code_rule AS rule, json_extract(verdict_json,'$.value') AS verdict, count(*) AS n
          FROM decision_review_records WHERE network=? AND created_at>=? AND created_at<? GROUP BY cohort,model,action,rule,verdict`).all(network, since, until);
        for (const row of groups) {
          const column = cohorts.find(item => item.cohort === reviewCohortSchema.parse(row.cohort))!, n = Number(row.n);
          const action = reviewActionSchema.parse(row.action), rule = reviewRuleSchema.parse(row.rule);
          column.decisions += n;
          if (row.verdict === "agree") column.agrees += n; else if (row.verdict === "disagree") column.disagrees += n; else if (row.verdict !== null) throw new DecisionReviewError("review_unavailable");
          if (row.model !== null && reviewActionSchema.parse(row.model) !== action) column.modelCodeDifferences += n;
          if (action === "SKIP" && rule !== "model-skip") { column.codeRefusals += n; column.refusalReasons[rule] = (column.refusalReasons[rule] ?? 0) + n; }
        }
        for (const column of cohorts) column.agreementRate = column.agrees + column.disagrees ? column.agrees / (column.agrees + column.disagrees) : null;
        return decisionReviewMetricsSchema.parse({ network, since, until, rule: "captured-owner-decisions-v1", cohorts });
      });
    },
  } satisfies DecisionReviewsStore);
}
