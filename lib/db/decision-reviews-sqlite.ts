import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
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
  function owned(owner: string, id: string) {
    const row = db.prepare("SELECT * FROM decision_review_records WHERE wallet=? AND id=?").get(reviewOwner(owner), reviewIdSchema.parse(id));
    if (!row) throw new DecisionReviewError("review_not_found");
    return row;
  }
  return Object.freeze({
    async ready() { tx(false, () => undefined); },
    async capture(owner, raw, now) {
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
    async cancel(owner, runId) { tx(true, () => db.prepare("UPDATE decision_review_records SET state='cancelled' WHERE wallet=? AND run_id=? AND (state IN ('held','approved') OR (state='observed' AND json_extract(input_json,'$.reviewFirst')=1 AND json_extract(input_json,'$.terms.owned')=1 AND code_action<>'SKIP'))").run(reviewOwner(owner), reviewIdSchema.parse(runId))); },
    async expire(owner, id, now) {
      tx(true, () => { const at = now ?? Date.now(), record = project(owned(owner, id)); if (record.expiresAt && Date.parse(record.expiresAt) <= at) db.prepare("UPDATE decision_review_records SET state='expired' WHERE wallet=? AND id=? AND state IN ('held','approved')").run(reviewOwner(owner), id); });
    },
    async observe(owner, id, action, rule) {
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
