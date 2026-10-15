import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { publicQueryRun } from "../research/public-query-run";
import { privacyId, validatePrivacyRun } from "../run-privacy/contracts";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy } from "./storage-identity-connection";

const MAX_ROWS = 2000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const objectDigest = (value: unknown) => digest(canonicalJson(value));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const decision = z.object({ id: privacyId, decision: z.enum(["public", "exclude"]), reason: z.string().trim().min(1).max(500),
  recoveryReviewed: z.literal(true).optional() }).strict();
export const legacyRestorePlanSchema = z.object({
  format: z.literal("keryx-public-research-restore-v1"), identitySha256: sha, schemaSha256: sha, reviewSha256: sha,
  entries: z.array(decision.extend({ originalSha256: sha, relatedSha256: sha }).strict()).min(1).max(MAX_ROWS),
}).strict().refine(plan => new Set(plan.entries.map(row => row.id)).size === plan.entries.length);
export type LegacyRestorePlan = z.infer<typeof legacyRestorePlanSchema>;

function authority(db: DatabaseSync, write = false) {
  assertVerifiedSqliteNativeUserDomainPolicy(db);
  const identity = assertVerifiedSqliteConnection(db, write ? "write" : "read");
  if (identity.authorityMode !== "mainnet-real") throw new Error("Legacy restoration requires the selected mainnet native store");
  return { identitySha256: objectDigest(identity), schemaSha256: digest(sqliteApplicationSchemaProfile(db, new Set())) };
}

function capture(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT id,data,created_at,question,answer,parent_id,asker FROM query_runs WHERE id=?").get(privacyId.parse(id));
  if (!row) return null;
  const raw = String(row.data), original = validatePrivacyRun(JSON.parse(raw), id);
  const state = db.prepare("SELECT visibility,revision,erased FROM run_privacy WHERE run_id=?").get(id) ?? null;
  const audited = Number(db.prepare("SELECT count(*) AS n FROM run_privacy_audit WHERE run_id=?").get(id)?.n);
  const memory = db.prepare("SELECT id,source_scores,sources_read,topics,created_at FROM query_memories WHERE id=?").get(id) ?? null;
  const savedDefault = typeof row.asker === "string"
    ? db.prepare("SELECT visibility FROM run_privacy_defaults WHERE wallet=?").get(row.asker.toLowerCase()) ?? null : null;
  const links = [original.parentId, original.retryOf, row.parent_id].filter((value): value is string => typeof value === "string")
    .filter((value, index, values) => values.indexOf(value) === index).map(linkedId => {
      privacyId.parse(linkedId);
      const linked = db.prepare(`SELECT q.data,p.visibility,p.erased FROM query_runs q
        LEFT JOIN run_privacy p ON p.run_id=q.id WHERE q.id=?`).get(linkedId);
      return linked ? { id: linkedId, original: validatePrivacyRun(JSON.parse(String(linked.data)), linkedId),
        originalSha256: digest(String(linked.data)), visibility: String(linked.visibility ?? "unlisted"), erased: linked.erased === 1 }
        : { id: linkedId, original: null, originalSha256: null, visibility: "missing", erased: false };
    });
  const privateResult = Number(db.prepare(`SELECT count(*) AS n FROM private_research_results
    WHERE CASE WHEN json_valid(serialized_run) THEN json_extract(serialized_run,'$.id') END=?`).get(id)?.n) > 0;
  const privateIntent = Number(db.prepare(`SELECT count(*) AS n FROM private_research_intents
    WHERE id=? OR CASE WHEN json_valid(data) THEN json_extract(data,'$.queryId') END=?
      OR CASE WHEN json_valid(data) THEN json_extract(data,'$.query_id') END=?`).get(id, id, id)?.n) > 0;
  const orders = db.prepare("SELECT id,research_mode,request_data,response_data,resolution_data FROM a2a_orders WHERE query_id=? ORDER BY id").all(id);
  const fulfillmentLinks = db.prepare(`SELECT f.original_id,c.run_sha256,c.completed_at FROM a2a_failed_original_fulfillments f
    LEFT JOIN a2a_fulfillment_completions c ON c.original_id=f.original_id
    LEFT JOIN a2a_orders o ON o.id=f.original_id WHERE o.query_id=? OR f.original_id=? ORDER BY f.original_id`).all(id, id);
  const gaps = db.prepare("SELECT * FROM gap_intents WHERE failed_query_id=? OR retry_run_id=? ORDER BY id").all(id, id);
  const recovery = original.originalFulfillment as { format?: unknown } | null | undefined;
  const unsupportedRecoveryFormat = Object.hasOwn(original, "originalFulfillment") && (!recovery
    || !["keryx-a2a-original-fulfillment-result-v1", "keryx-a2a-original-fulfillment-result-v2"].includes(String(recovery.format)));
  const invalidMetadata = original.createdAt !== row.created_at || original.question !== row.question || original.answer !== row.answer
    || (original.parentId ?? null) !== row.parent_id || unsupportedRecoveryFormat;
  const publicProjection = publicQueryRun(original);
  const related = { memory, links, savedDefault, gaps, fulfillmentLinks, publicProjectionSha256: objectDigest(publicProjection),
    recoveryReference: fulfillmentLinks.length > 0 || Object.hasOwn(original, "originalFulfillment"),
    recordProjection: { createdAt: row.created_at, question: row.question,
    answer: row.answer, parentId: row.parent_id, asker: row.asker }, invalidMetadata,
    privateJobReference: id.startsWith("prv_") || privateResult || privateIntent, orders };
  return { id, original, publicProjection, originalSha256: digest(raw), related, relatedSha256: objectDigest(related), state, audited };
}
type Candidate = NonNullable<ReturnType<typeof capture>>;
export interface LegacyResearchReview {
  format: "keryx-public-research-review-v1";
  identitySha256: string;
  schemaSha256: string;
  cutoff: string;
  candidates: Candidate[];
}

/** Protected operator export only. Callers must never send these originals to public logs or tools. */
export function exportLegacyResearch(db: DatabaseSync, cutoff: string): LegacyResearchReview {
  if (!z.string().datetime().safeParse(cutoff).success) throw new Error("Invalid review cutoff");
  const binding = authority(db);
  db.exec("BEGIN");
  try {
    const ids = db.prepare(`SELECT q.id FROM query_runs q LEFT JOIN run_privacy p ON p.run_id=q.id
      WHERE p.run_id IS NULL AND q.created_at<? ORDER BY q.id LIMIT ?`).all(cutoff, MAX_ROWS + 1);
    if (ids.length > MAX_ROWS) throw new Error("Legacy review exceeds the supported bound");
    const candidates = ids.map(row => capture(db, String(row.id))!);
    authority(db); db.exec("COMMIT");
    return { format: "keryx-public-research-review-v1", ...binding, cutoff, candidates };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Every exported candidate gets a deliberate protected review decision; no automatic approval. */
export function makeLegacyRestorePlan(review: LegacyResearchReview, rawDecisions: unknown): LegacyRestorePlan {
  if (review.format !== "keryx-public-research-review-v1") throw new Error("Invalid legacy review");
  const decisions = z.array(decision).max(MAX_ROWS).parse(rawDecisions);
  const byId = new Map(decisions.map(row => [row.id, row]));
  if (byId.size !== decisions.length || byId.size !== review.candidates.length) throw new Error("Review decisions must cover every candidate exactly once");
  return legacyRestorePlanSchema.parse({ format: "keryx-public-research-restore-v1", identitySha256: review.identitySha256,
    schemaSha256: review.schemaSha256, reviewSha256: objectDigest(review), entries: review.candidates.map(row => {
      const selected = byId.get(row.id);
      if (!selected) throw new Error("Missing review decision");
      if (selected.decision === "public" && (row.state || row.audited || row.related.privateJobReference || row.related.invalidMetadata
        || row.related.savedDefault && row.related.savedDefault.visibility !== "public"))
        throw new Error("A selected original has explicit privacy, an audit or a private-job reference");
      if (selected.decision === "public" && row.related.recoveryReference && !selected.recoveryReviewed)
        throw new Error("A recovery-linked original requires its separate recovery review");
      return { ...selected, originalSha256: row.originalSha256, relatedSha256: row.relatedSha256 };
    }) });
}

function inspect(db: DatabaseSync, plan: LegacyRestorePlan) {
  const binding = authority(db);
  if (binding.identitySha256 !== plan.identitySha256 || binding.schemaSha256 !== plan.schemaSha256)
    throw new Error("Legacy restore target or schema changed");
  const approved = new Set(plan.entries.filter(row => row.decision === "public").map(row => row.id));
  let stale = 0, blocked = 0;
  for (const entry of plan.entries) {
    if (entry.decision !== "public") continue;
    const current = capture(db, entry.id);
    if (!current || current.originalSha256 !== entry.originalSha256 || current.relatedSha256 !== entry.relatedSha256
      || current.state || current.audited) { stale++; continue; }
    if (current.related.privateJobReference || current.related.invalidMetadata
      || current.related.savedDefault && current.related.savedDefault.visibility !== "public"
      || current.related.recoveryReference && !entry.recoveryReviewed || current.related.links.some(link =>
      link.erased || link.visibility !== "public" && !approved.has(link.id))) blocked++;
  }
  return { approved: approved.size, excluded: plan.entries.length - approved.size, stale, blocked };
}

export function inspectLegacyRestorePlan(db: DatabaseSync, rawPlan: unknown) {
  const plan = legacyRestorePlanSchema.parse(rawPlan); authority(db);
  db.exec("BEGIN");
  try { const result = inspect(db, plan); authority(db); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function retainedDigests(db: DatabaseSync) {
  const originals = db.prepare("SELECT id,data FROM query_runs ORDER BY id LIMIT ?").all(MAX_ROWS + 1);
  const payments = db.prepare("SELECT * FROM payment_events ORDER BY id LIMIT 10001").all();
  const defaults = db.prepare("SELECT * FROM run_privacy_defaults ORDER BY wallet LIMIT ?").all(MAX_ROWS + 1);
  const audits = db.prepare("SELECT * FROM run_privacy_audit ORDER BY request_id LIMIT 10001").all();
  if (originals.length > MAX_ROWS || payments.length > 10000 || defaults.length > MAX_ROWS || audits.length > 10000)
    throw new Error("Legacy verification exceeds the supported bound");
  return { originals: objectDigest(originals), payments: objectDigest(payments), defaults: objectDigest(defaults), audits: objectDigest(audits) };
}

/** Insert-only DML on this exact verified store. No schema/default/audit/original/financial edits. */
export function applyLegacyRestorePlan(db: DatabaseSync, rawPlan: unknown, expectedPlanSha256: string) {
  const plan = legacyRestorePlanSchema.parse(rawPlan);
  if (objectDigest(plan) !== sha.parse(expectedPlanSha256)) throw new Error("Legacy restore plan digest changed");
  authority(db, true); db.exec("BEGIN IMMEDIATE");
  try {
    const result = inspect(db, plan);
    if (result.stale || result.blocked) throw new Error("Legacy restore refused: stale or blocked originals; nothing was published");
    const before = retainedDigests(db), now = new Date().toISOString();
    for (const entry of plan.entries) {
      if (entry.decision !== "public") continue;
      const changed = db.prepare(`INSERT INTO run_privacy(run_id,visibility,updated_at)
        SELECT q.id,'public',? FROM query_runs q WHERE q.id=?
          AND NOT EXISTS(SELECT 1 FROM run_privacy p WHERE p.run_id=q.id)
          AND NOT EXISTS(SELECT 1 FROM run_privacy_audit a WHERE a.run_id=q.id)`).run(now, entry.id);
      if (changed.changes !== 1) throw new Error("Legacy restore state changed; nothing was published");
    }
    const after = retainedDigests(db);
    if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Legacy restore altered a retained record; nothing was published");
    authority(db, true); db.exec("COMMIT");
    return { ...result, published: result.approved, planSha256: expectedPlanSha256, before, after };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
