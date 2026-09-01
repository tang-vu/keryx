import { collectRun } from "../agent";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { a2aRequestHash, type A2aOrder, type A2aOrderRequest } from "./order";
import { verifiedA2aResponseFromRun } from "./operator-resolution";

type A2aWorkerDb = Pick<
  KeryxDB,
  | "claimNextA2aOrder"
  | "getA2aOrder"
  | "completeA2aOrder"
  | "failA2aOrder"
  | "markA2aOrderPaymentStarted"
  | "markA2aOrderResultSaving"
  | "listCreatorPaymentAttemptsByQuery"
>;

type A2aCollector = (input: Parameters<typeof collectRun>[0]) => Promise<QueryRun>;

interface A2aRunOptions {
  collector?: A2aCollector;
  expectedPayee?: string;
  onClaim?: (order: A2aOrder) => Promise<void> | void;
}

export interface A2aWorkerOutcome {
  id: string;
  status: "completed" | "failed" | "recovery_pending";
  errorCode?: "invalid_order_data" | "research_failed";
}

function validRequest(order: A2aOrder, expectedPayee?: string): A2aOrderRequest | null {
  const request = order.request;
  if (
    !request ||
    typeof request.question !== "string" ||
    request.question.length === 0 ||
    (request.origin !== "a2a" && request.origin !== "engine") ||
    (request.model !== undefined && typeof request.model !== "string")
  ) {
    return null;
  }
  if (order.executionJournalVersion !== 1 || order.paymentStartedAt !== null) return null;
  const micro = (amount: number) => Math.round(amount * 1e6);
  const creatorMicros = micro(order.creatorBudgetUsdc);
  const feeMicros = micro(order.serviceFeeUsdc);
  const totalMicros = micro(order.amountUsdc);
  if (
    !Number.isFinite(order.amountUsdc) ||
    !Number.isFinite(order.creatorBudgetUsdc) ||
    !Number.isFinite(order.serviceFeeUsdc) ||
    !Number.isInteger(order.amountUsdc * 1e6) ||
    !Number.isInteger(order.creatorBudgetUsdc * 1e6) ||
    !Number.isInteger(order.serviceFeeUsdc * 1e6) ||
    creatorMicros <= 0 ||
    feeMicros <= 0 ||
    totalMicros !== creatorMicros + feeMicros ||
    (expectedPayee && order.payee.toLowerCase() !== expectedPayee.toLowerCase())
  ) {
    return null;
  }
  const hash = a2aRequestHash({
    question: request.question,
    creatorBudgetUsdc: order.creatorBudgetUsdc,
    serviceFeeUsdc: order.serviceFeeUsdc,
    researchMode: order.researchMode,
    model: request.model,
  });
  return hash === order.requestHash && order.id === order.queryId ? request : null;
}

/** Runs one already-claimed job. A failed/ambiguous started job is terminal and never requeued. */
export async function runClaimedA2aOrder(
  db: A2aWorkerDb,
  order: A2aOrder,
  options: A2aRunOptions = {},
): Promise<A2aWorkerOutcome> {
  const request = validRequest(order, options.expectedPayee);
  if (!request) {
    await db.failA2aOrder(order.id, "invalid_order_data", new Date().toISOString());
    return { id: order.id, status: "failed", errorCode: "invalid_order_data" };
  }

  let run: QueryRun;
  try {
    run = await (options.collector ?? collectRun)({
      question: request.question,
      budget: order.creatorBudgetUsdc,
      researchMode: order.researchMode,
      queryId: order.queryId,
      origin: request.origin,
      fundingOwner: "treasury",
      model: request.model,
      onCreatorPaymentBoundary: async () => {
        if (!(await db.markA2aOrderPaymentStarted(order.id, new Date().toISOString()))) {
          throw new Error("A2A creator-payment boundary could not be journaled");
        }
      },
      onQueryRunSaveBoundary: async () => {
        if (!(await db.markA2aOrderResultSaving(order.id, new Date().toISOString()))) {
          throw new Error("A2A QueryRun-save boundary could not be journaled");
        }
      },
    });
  } catch {
    await db.failA2aOrder(order.id, "research_failed", new Date().toISOString()).catch(() => false);
    return { id: order.id, status: "failed", errorCode: "research_failed" };
  }

  let response: Record<string, unknown>;
  try {
    const current = await db.getA2aOrder(order.id);
    if (!current || current.status !== "running") {
      throw new Error("A2A order changed before its saved run could be verified");
    }
    response = (await verifiedA2aResponseFromRun(db, current, run)).response;
  } catch {
    // The QueryRun is durable, but a missing/mismatched creator ledger cannot produce an honest
    // receipt. Keep the order recoverable; never rerun research or overwrite it as failed.
    return { id: order.id, status: "recovery_pending" };
  }

  // collectRun persisted its QueryRun before returning. A missing/ambiguous order-completion write
  // must stay repairable by GET/replay; marking it failed here would hide an answer after creator
  // payments may already have settled.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await db.completeA2aOrder(order.id, response, new Date().toISOString())) {
        return { id: order.id, status: "completed" };
      }
      // A prior attempt may have committed even if its response was lost.
      if ((await db.getA2aOrder(order.id))?.status === "completed") {
        return { id: order.id, status: "completed" };
      }
    } catch {
      // Retry only this idempotent metadata transition; never rerun collectRun or creator spends.
    }
    if (attempt < 2) await delay(100 * (attempt + 1));
  }
  return { id: order.id, status: "recovery_pending" };
}

/** Atomically claims at most one queued order, then drains it before claiming another. */
export async function runNextA2aOrder(
  db: A2aWorkerDb,
  workerId: string,
  options: A2aRunOptions = {},
): Promise<A2aWorkerOutcome | null> {
  const order = await db.claimNextA2aOrder(workerId, new Date().toISOString());
  if (!order) return null;
  try {
    await options.onClaim?.(order);
  } catch {
    // A heartbeat/telemetry write is never allowed to strand an already-claimed paid job.
  }
  return runClaimedA2aOrder(db, order, options);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
