import { collectRun } from "../agent";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { a2aRequestHash, type A2aOrder, type A2aOrderRequest } from "./order";
import { a2aResponseFromRun, quoteFromA2aOrder } from "./result";

type A2aWorkerDb = Pick<
  KeryxDB,
  "claimNextA2aOrder" | "getA2aOrder" | "completeA2aOrder" | "failA2aOrder"
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

  let response: Record<string, unknown>;
  try {
    const run = await (options.collector ?? collectRun)({
      question: request.question,
      budget: order.creatorBudgetUsdc,
      researchMode: order.researchMode,
      queryId: order.queryId,
      origin: request.origin,
      fundingOwner: "treasury",
      model: request.model,
    });
    response = a2aResponseFromRun(run, quoteFromA2aOrder(order));
  } catch {
    await db.failA2aOrder(order.id, "research_failed", new Date().toISOString()).catch(() => false);
    return { id: order.id, status: "failed", errorCode: "research_failed" };
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
