import { collectRun } from "../agent";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import {
  a2aRequestHash,
  legacyA2aRequestHash,
  type A2aOrder,
  type A2aOrderRequest,
} from "./order";
import { verifiedA2aResponseFromRun } from "./operator-resolution";
import { exactA2aMicros } from "./amount-micros";
import { a2aFailureDiagnostic, a2aTraceStage, type A2aFailureDiagnostic, type A2aFailureStage } from "./failure-diagnostic";
import { configuredResearchAllowance } from "../research/research-allowance";
import { canaryOriginalClaim, canaryExecutionPaused, assertCanaryCreatorPayment, assertCanaryOriginalReserved } from "../business-operator/canary-policy";
import {
  isSupportedA2aResearchPackage,
  type A2aResearchPackage,
} from "./research-package";

type A2aWorkerDb = Pick<
  KeryxDB,
  | "claimNextA2aOrder"
  | "getA2aOrder"
  | "getQueryRun"
  | "completeA2aOrder"
  | "failA2aOrder"
  | "markA2aOrderPaymentStarted"
  | "markA2aOrderResultSaving"
  | "listCreatorPaymentAttemptsByQuery"
> & Partial<Pick<KeryxDB, "operatorPublicSnapshot">>;

type A2aCollector = (input: Parameters<typeof collectRun>[0], options?: Parameters<typeof collectRun>[1]) => Promise<QueryRun>;

interface A2aRunOptions {
  /** Trusted operator rollout flag, never accepted from a paid request body. */
  answerFormat?: "decision-brief";
  collector?: A2aCollector;
  expectedPayee?: string;
  onClaim?: (order: A2aOrder) => Promise<void> | void;
}

export interface A2aWorkerOutcome {
  id: string;
  status: "completed" | "failed" | "recovery_pending";
  errorCode?: "invalid_order_data" | "research_failed";
  /** Private Operator audit/worker diagnostic; excluded from field-built public responses. */
  diagnostic?: A2aFailureDiagnostic;
}

function existingOutcome(order: A2aOrder): A2aWorkerOutcome | null {
  if (order.status === "completed" || order.status === "failed") return { id: order.id, status: order.status };
  if (order.status !== "running" || !order.startedAt || !order.workerId ||
    order.paymentStartedAt !== null || order.resultSavingAt !== null ||
    order.response !== null || order.errorCode !== null || order.resolution !== null) {
    return { id: order.id, status: "recovery_pending" };
  }
  return null;
}

function validRequest(
  order: A2aOrder,
  expectedPayee?: string,
): { request: A2aOrderRequest; executionLimits?: A2aResearchPackage["execution"] } | null {
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
  if (
    order.executionJournalVersion !== 1 ||
    order.paymentStartedAt !== null ||
    order.resultSavingAt !== null ||
    (order.researchPackage !== null &&
      !isSupportedA2aResearchPackage(order.researchPackage, order.researchMode))
  ) {
    return null;
  }
  const creatorMicros = exactA2aMicros(order.creatorBudgetUsdc);
  const feeMicros = exactA2aMicros(order.serviceFeeUsdc);
  const totalMicros = exactA2aMicros(order.amountUsdc);
  if (
    totalMicros === null ||
    creatorMicros === null ||
    feeMicros === null ||
    creatorMicros <= 0 ||
    feeMicros <= 0 ||
    totalMicros !== creatorMicros + feeMicros ||
    (expectedPayee && order.payee.toLowerCase() !== expectedPayee.toLowerCase())
  ) {
    return null;
  }
  const hashInput = {
    question: request.question,
    creatorBudgetUsdc: order.creatorBudgetUsdc,
    serviceFeeUsdc: order.serviceFeeUsdc,
    researchMode: order.researchMode,
    model: request.model,
  };
  const hash = order.researchPackage
    ? a2aRequestHash({ ...hashInput, researchPackage: order.researchPackage })
    : legacyA2aRequestHash(hashInput);
  return hash === order.requestHash && order.id === order.queryId
    ? {
        request,
        ...(order.researchPackage
          ? { executionLimits: { ...order.researchPackage.execution } }
          : {}),
      }
    : null;
}

/** Runs one already-claimed job. A failed/ambiguous started job is terminal and never requeued. */
export async function runClaimedA2aOrder(
  db: A2aWorkerDb,
  order: A2aOrder,
  options: A2aRunOptions = {},
): Promise<A2aWorkerOutcome> {
  const existing = existingOutcome(order);
  if (existing) return existing;
  const valid = validRequest(order, options.expectedPayee);
  if (!valid) {
    await db.failA2aOrder(order.id, "invalid_order_data", new Date().toISOString());
    return { id: order.id, status: "failed", errorCode: "invalid_order_data" };
  }
  const { request, executionLimits } = valid;

  // A direct caller must prove this is still its claimed original and has no saved result.
  // Read failures hold execution; recovery reads may repair it, never repeat paid research.
  try {
    const current = await db.getA2aOrder(order.id);
    if (!current) return { id: order.id, status: "recovery_pending" };
    const currentOutcome = existingOutcome(current);
    if (currentOutcome) return currentOutcome;
    if (current.queryId !== order.queryId || current.requestHash !== order.requestHash ||
      current.payer.toLowerCase() !== order.payer.toLowerCase() ||
      current.workerId !== order.workerId || current.startedAt !== order.startedAt ||
      !validRequest(current, options.expectedPayee) || await db.getQueryRun(order.queryId)) {
      return { id: order.id, status: "recovery_pending" };
    }
  } catch { return { id: order.id, status: "recovery_pending" }; }

  let run: QueryRun;
  let lastStage: A2aFailureStage = "unknown";
  try {
    run = await (options.collector ?? collectRun)({
      question: request.question,
      budget: order.creatorBudgetUsdc,
      researchMode: order.researchMode,
      queryId: order.queryId,
      origin: request.origin,
      fundingOwner: "treasury",
      asker: order.payer,
      provenance: { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" },
      model: request.model,
      ...(options.answerFormat ? { answerFormat: options.answerFormat } : {}),
      ...(executionLimits ? { executionLimits } : {}),
      onCreatorPaymentBoundary: async () => {
        assertCanaryCreatorPayment();
        if (!(await db.markA2aOrderPaymentStarted(order.id, new Date().toISOString()))) {
          throw new Error("A2A creator-payment boundary could not be journaled");
        }
      },
      onQueryRunSaveBoundary: async () => {
        if (!(await db.markA2aOrderResultSaving(order.id, new Date().toISOString()))) {
          throw new Error("A2A QueryRun-save boundary could not be journaled");
        }
      },
    }, { onStep: (step) => { lastStage = a2aTraceStage(step); } });
  } catch (error) {
    const diagnostic = a2aFailureDiagnostic(error, lastStage);
    let failed = false;
    try { failed = await db.failA2aOrder(order.id, "research_failed", new Date().toISOString()) === true; }
    catch { /* Keep the captured safe diagnostic; a failed write never retries research. */ }
    if (!failed) {
      // A lost write response may have committed. Observe once; never repeat the
      // transition or claim a failed state from a false/ambiguous write result.
      try {
        const current = await db.getA2aOrder(order.id);
        failed = current?.id === order.id && current.queryId === order.queryId &&
          current.requestHash === order.requestHash && current.status === "failed";
      } catch { /* The original stays explicitly recoverable when observation fails. */ }
    }
    return { id: order.id, status: failed ? "failed" : "recovery_pending", errorCode: "research_failed", diagnostic };
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
  // Keep already-paid queued originals untouched until ordinary execution is restored.
  // A finite web allowance cannot turn their confirmed debit into research_failed.
  if (configuredResearchAllowance()) return null;
  const original = canaryOriginalClaim();
  if (!original && canaryExecutionPaused()) return null;
  if (original) {
    assertCanaryOriginalReserved();
    if (!db.operatorPublicSnapshot) throw new Error("Finite original catalog capability unavailable");
    const catalog = await db.operatorPublicSnapshot(Date.now());
    if (catalog.creatorCatalog.registered !== 0) return null;
  }
  const order = await db.claimNextA2aOrder(workerId, new Date().toISOString(), original);
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
