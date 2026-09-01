import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import {
  A2A_REVIEW_AFTER_MS,
  type A2aOrder,
  type A2aOrderResolution,
  type A2aResolutionEvidence,
} from "./order";
import { a2aResponseFromRun, quoteFromA2aOrder } from "./result";
import { a2aAmountMicros, creatorResolutionEvidence } from "./payment-evidence";

type ResolutionDb = Pick<
  KeryxDB,
  | "getA2aOrder"
  | "getQueryRun"
  | "listCreatorPaymentAttemptsByQuery"
  | "resolveA2aOrder"
>;

function assertEconomicEvidence(order: A2aOrder, evidence: A2aResolutionEvidence) {
  const creatorCapMicros = a2aAmountMicros(order.creatorBudgetUsdc);
  if (evidence.settledCreatorMicros + evidence.pendingCreatorMicros > creatorCapMicros) {
    throw new Error("creator settlement evidence exceeds the prepaid creator cap");
  }
  if (evidence.simulatedCreatorMicros > 0) {
    throw new Error("a paid A2A order cannot be resolved with simulated creator payments");
  }
}

function assertSavedRunAccounting(run: QueryRun, evidence: A2aResolutionEvidence) {
  const expectedMicros =
    a2aAmountMicros(run.totalToCreators) + a2aAmountMicros(run.pendingSpendUsdc ?? 0);
  const recordedMicros =
    evidence.settledCreatorMicros +
    evidence.pendingCreatorMicros +
    evidence.failedCreatorMicros;
  if (expectedMicros !== recordedMicros) {
    throw new Error("saved QueryRun creator accounting does not match the durable payment ledger");
  }
}

function resolution(
  action: A2aOrderResolution["action"],
  actor: A2aOrderResolution["actor"],
  reason: A2aOrderResolution["reason"],
  evidence: A2aResolutionEvidence,
  resolvedAt: string,
): A2aOrderResolution {
  return { action, actor, reason, evidence, resolvedAt };
}

export type A2aInspectableState =
  | "queued"
  | "processing"
  | "review_required"
  | "completed"
  | "failed";

export interface A2aOrderInspection {
  order: A2aOrder;
  queryRun: QueryRun | null;
  evidence: A2aResolutionEvidence;
  state: A2aInspectableState;
}

/** Verifies that a saved real run's in-memory spend totals are complete in the durable ledger. */
export async function verifiedA2aResponseFromRun(
  db: Pick<KeryxDB, "listCreatorPaymentAttemptsByQuery">,
  order: A2aOrder,
  run: QueryRun,
): Promise<{ response: Record<string, unknown>; evidence: A2aResolutionEvidence }> {
  const attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId);
  const evidence = creatorResolutionEvidence(order, attempts, true);
  assertEconomicEvidence(order, evidence);
  const response = a2aResponseFromRun(run, quoteFromA2aOrder(order));
  assertSavedRunAccounting(run, evidence);
  return { response, evidence };
}

/** Read-only exact-order inspection. Callers must not print the private order/request object. */
export async function inspectA2aOrder(
  db: ResolutionDb,
  id: string,
  nowMs = Date.now(),
): Promise<A2aOrderInspection> {
  const order = await db.getA2aOrder(id);
  if (!order) throw new Error("A2A order not found");
  const [queryRun, attempts] = await Promise.all([
    db.getQueryRun(order.queryId),
    db.listCreatorPaymentAttemptsByQuery(order.queryId),
  ]);
  const evidence = creatorResolutionEvidence(order, attempts, queryRun !== null);
  const startedMs = order.startedAt ? Date.parse(order.startedAt) : Number.NaN;
  const state: A2aInspectableState =
    order.status !== "running"
      ? order.status
      : !order.startedAt
        ? "queued"
        : !Number.isFinite(startedMs) || nowMs - startedMs >= A2A_REVIEW_AFTER_MS
          ? "review_required"
          : "processing";
  return { order, queryRun, evidence, state };
}

/** Repairs only the terminal order metadata from an existing, real, same-id QueryRun. */
export async function repairA2aOrderFromSavedRun(
  db: ResolutionDb,
  order: A2aOrder,
  run: QueryRun,
  actor: A2aOrderResolution["actor"],
  resolvedAt = new Date().toISOString(),
): Promise<A2aOrder> {
  if (order.status !== "running" || !order.startedAt || run.id !== order.queryId) {
    throw new Error("A2A order is not eligible for saved-run repair");
  }
  const { response, evidence } = await verifiedA2aResponseFromRun(db, order, run);
  const changed = await db.resolveA2aOrder(order.id, {
    status: "completed",
    response,
    resolution: resolution(
      "repair_completed",
      actor,
      "saved_real_query_run",
      evidence,
      resolvedAt,
    ),
  });
  const current = await db.getA2aOrder(order.id);
  if (!current) throw new Error("A2A order disappeared during repair");
  if (!changed && current.status !== "completed") {
    throw new Error("A2A order changed before saved-run repair could commit");
  }
  return current;
}

/** Closes only a stale journal-v1 job proven not to have reached a creator payment call. */
export async function closeReviewedA2aOrder(
  db: ResolutionDb,
  id: string,
  resolvedAt = new Date().toISOString(),
): Promise<A2aOrder> {
  const nowMs = Date.parse(resolvedAt);
  if (!Number.isFinite(nowMs)) throw new Error("resolution timestamp is invalid");
  const inspection = await inspectA2aOrder(db, id, nowMs);
  const { order, evidence } = inspection;
  assertEconomicEvidence(order, evidence);
  if (inspection.state !== "review_required" || !order.startedAt) {
    throw new Error("only a stale review_required A2A order can be closed");
  }
  if (inspection.queryRun) {
    throw new Error("a saved QueryRun exists; repair the result instead of closing it");
  }
  if (evidence.executionJournalVersion !== 1) {
    throw new Error("historical A2A order lacks a complete creator-payment boundary journal");
  }
  if (evidence.paymentBoundaryCrossed || evidence.creatorAttempts > 0) {
    throw new Error("creator payment boundary was crossed; the job must remain under review");
  }
  if (evidence.resultSaveBoundaryCrossed) {
    throw new Error("QueryRun persistence started; the job must remain under review");
  }
  const startedBefore = new Date(nowMs - A2A_REVIEW_AFTER_MS).toISOString();
  const changed = await db.resolveA2aOrder(order.id, {
    status: "failed",
    errorCode: "operator_reviewed_no_result",
    startedBefore,
    resolution: resolution(
      "close_failed",
      "operator-cli",
      "no_saved_run_before_execution_boundaries",
      evidence,
      resolvedAt,
    ),
  });
  const current = await db.getA2aOrder(order.id);
  if (!current) throw new Error("A2A order disappeared during operator resolution");
  if (!changed) {
    throw new Error("A2A order or its payment evidence changed before closure could commit");
  }
  return current;
}
