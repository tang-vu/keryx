import type { DatabaseSync } from "node:sqlite";
import type { QueryRun } from "../types";
import { runEvidenceMetrics } from "./dashboard-metrics";
import { economicsRunSample } from "../economics/testnet-economics";
import { recordedRunProvenance } from "../research/run-provenance";
import { z } from "zod";
import { PrivacyError, privacyId, privacyReadsActive, requirePrivacy, visibilitySchema,
  type PrivacyStage, type RunVisibility } from "../run-privacy/contracts";
import { assertRunPrivacySchema } from "./run-privacy-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy,
  assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";

const publicationSchema = z.object({ visibility: visibilitySchema }).strict();
interface QueryRunCreation {
  publication?: { visibility: RunVisibility };
  privacy: PrivacyStage;
  enrolled: boolean;
}

/** Only saveQueryRun supplies creation intent. The three-argument insert-only
 * recovery writer below deliberately retains the existing trigger policy. */
function writeCreation(db: DatabaseSync, run: QueryRun, creation: QueryRunCreation): void {
  const publication = creation.publication === undefined ? undefined : publicationSchema.parse(creation.publication);
  if (!privacyReadsActive(creation.privacy)) {
    if (publication) throw new PrivacyError("privacy_unavailable");
    writeSqliteQueryRun(db, run, true);
    return;
  }
  requirePrivacy(creation.privacy);
  const id = privacyId.parse(run.id);
  const guard = () => {
    if (creation.enrolled) {
      assertVerifiedSqliteWritePolicy(db);
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      if (assertVerifiedSqliteConnection(db, "write").authorityMode !== "mainnet-real")
        throw new PrivacyError("privacy_unavailable");
    } else assertRunPrivacySchema(db);
  };
  guard();
  const ownTransaction = !db.isTransaction;
  db.exec(ownTransaction ? "BEGIN IMMEDIATE" : "SAVEPOINT query_run_creation");
  try {
    guard();
    // Both checks run under the writer lock. An orphan sidecar is retained policy,
    // too; neither a resave nor a reused ID can reinterpret it as new publication.
    const existing = db.prepare("SELECT 1 FROM query_runs WHERE id=?").get(id);
    const retained = db.prepare("SELECT 1 FROM run_privacy WHERE run_id=?").get(id);
    let visibility: RunVisibility | undefined;
    if (!existing && !retained) {
      const asker = run.asker?.toLowerCase();
      const saved = asker && /^0x[a-f0-9]{40}$/.test(asker)
        ? db.prepare("SELECT visibility FROM run_privacy_defaults WHERE wallet=?").get(asker) : undefined;
      visibility = publication?.visibility ?? visibilitySchema.parse(saved?.visibility ?? "public");
    }
    // Keep the original mapping, provenance and JSON byte representation intact.
    writeSqliteQueryRun(db, run, true);
    if (visibility !== undefined) {
      const result = db.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=? AND revision=0 AND erased=0")
        .run(visibility, id);
      if (Number(result.changes) !== 1) throw new PrivacyError("privacy_unavailable");
    }
    guard();
    db.exec(ownTransaction ? "COMMIT" : "RELEASE query_run_creation");
  } catch (error) {
    db.exec(ownTransaction ? "ROLLBACK" : "ROLLBACK TO query_run_creation; RELEASE query_run_creation");
    throw error;
  }
}

/** One application record mapping. Recovery uses insert-only, never the ordinary overwrite path. */
export function writeSqliteQueryRun(db: DatabaseSync, run: QueryRun, replace: boolean, creation?: QueryRunCreation): void {
  if (creation !== undefined) {
    if (!replace) throw new PrivacyError("privacy_unavailable");
    writeCreation(db, run, creation);
    return;
  }
  run = recordedRunProvenance(run);
  const evidence = runEvidenceMetrics(run), economics = economicsRunSample(run);
  db.prepare(`INSERT ${replace ? "OR REPLACE " : ""}INTO query_runs (
    id,created_at,question,budget,engine,total_spent,total_to_creators,answer,data,
    parent_id,asker,origin,duration_ms,payment_mode,payment_attempts,settled_payments,
    confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count,economics_data
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.id, run.createdAt, run.question, run.budget,
    run.engine, run.totalSpent, run.totalToCreators, run.answer, JSON.stringify(run), run.parentId ?? null,
    run.asker?.toLowerCase() ?? null, run.origin ?? "engine", run.durationMs ?? null, run.paymentMode ?? null,
    run.paymentAttempts ?? null, run.settledPayments ?? null, run.confidence?.level ?? null, run.mcpClient ?? null,
    evidence.evidenceClaimCount, evidence.groundedClaimCount, evidence.rewardedCitationCount,
    economics ? JSON.stringify(economics) : null);
}
