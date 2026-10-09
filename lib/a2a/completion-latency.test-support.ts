/** Synthetic timing records only. No provider, settlement or customer acceptance is represented. */
import { a2aResearchPackage, completedA2aServiceReceipt } from "./research-package";
import type { A2aOperationsRow } from "./operations";
import type { QueryRun } from "../types";

export const COMPLETION_FIXTURE_NOW = Date.parse("2026-10-09T00:00:00.000Z");
export function ordinaryCompletion(durationMs: number): A2aOperationsRow {
  const updatedAt = new Date(COMPLETION_FIXTURE_NOW).toISOString();
  const createdAt = new Date(COMPLETION_FIXTURE_NOW - durationMs).toISOString();
  const pkg = a2aResearchPackage("quick");
  const run: QueryRun = { id: "synthetic-timing-only", question: "Synthetic timing fixture; no customer", budget: 0,
    engine: "offline", paymentMode: "offline", subClaims: [], decisions: [], citations: [], answer: "Synthetic, no settlement",
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: updatedAt, durationMs };
  return { status: "completed", createdAt, updatedAt, startedAt: createdAt, executionJournalVersion: 1,
    resolution: null, researchPackage: pkg,
    serviceReceipt: completedA2aServiceReceipt({ researchPackage: pkg, acceptedAt: createdAt, startedAt: createdAt, run }) };
}
export function recoveredCompletion(durationMs: number, fulfillment = false): A2aOperationsRow {
  const row = ordinaryCompletion(durationMs);
  return { ...row, resolution: {
    action: fulfillment ? "fulfill_failed_original" : "repair_completed", actor: "operator-cli",
    reason: fulfillment ? "verified_failed_original_fulfilled" : "saved_real_query_run", resolvedAt: row.updatedAt,
    evidence: { queryRunFound: true, executionJournalVersion: 1 },
    ...(fulfillment ? { fulfillment: Object.fromEntries(["claimId", "originalFailureSha256", "authoritySha256", "providerLedgerSha256", "runSha256"]
      .map(key => [key, "a".repeat(64)])) } : {}),
  } };
}
export function completionFixtureRows(): A2aOperationsRow[] {
  return [ordinaryCompletion(1_000), ordinaryCompletion(3_000), recoveredCompletion(52 * 60 * 60_000),
    recoveredCompletion(5_000, true),
    { status: "completed", createdAt: new Date(COMPLETION_FIXTURE_NOW - 2_000).toISOString(),
      updatedAt: new Date(COMPLETION_FIXTURE_NOW).toISOString(), startedAt: null },
    { status: "completed", createdAt: new Date(COMPLETION_FIXTURE_NOW + 1).toISOString(),
      updatedAt: new Date(COMPLETION_FIXTURE_NOW).toISOString(), startedAt: null }];
}
