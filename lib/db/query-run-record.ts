import type { DatabaseSync } from "node:sqlite";
import type { QueryRun } from "../types";
import { runEvidenceMetrics } from "./dashboard-metrics";
import { economicsRunSample } from "../economics/testnet-economics";
import { recordedRunProvenance } from "../research/run-provenance";

/** One application record mapping. Recovery uses insert-only, never the ordinary overwrite path. */
export function writeSqliteQueryRun(db: DatabaseSync, run: QueryRun, replace: boolean): void {
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
