import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import { A2A_REVIEW_AFTER_MS, type A2aOrder } from "./order";
import { originalOrderPayment, paidJobEscalation } from "./overdue-status";
import { originalOrderPaymentSchema, paidJobEscalationSchema } from "./overdue-types";

/** One bounded observation. A fuller queue reports `truncated` instead of presenting a sample as whole. */
export const UNFINISHED_A2A_ORDER_SCAN_LIMIT = 500;
export const PAID_JOB_ESCALATION_QUEUE_SCHEMA = "urn:keryx:paid-job-escalation-queue:1" as const;

export interface UnfinishedA2aOrders {
  /** Oldest accepted first, at most the requested bound. */
  orders: A2aOrder[];
  /** Stored unfinished rows that could not be decoded. Counted so they cannot silently disappear. */
  unreadable: number;
  /** More unfinished rows exist than were returned (including a server row cap). */
  truncated: boolean;
}

export function unfinishedA2aOrderLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > UNFINISHED_A2A_ORDER_SCAN_LIMIT) throw new Error("Unfinished A2A order limit is invalid");
  return limit;
}

/** Shared adapter decode: callers fetch `bound + 1` rows so truncation is observed, not assumed. */
export function decodeUnfinishedA2aOrders<Row>(rows: readonly Row[], bound: number, decode: (row: Row) => A2aOrder): UnfinishedA2aOrders {
  unfinishedA2aOrderLimit(bound);
  const orders: A2aOrder[] = [];
  let unreadable = 0;
  for (const row of rows.slice(0, bound)) {
    try {
      const order = decode(row);
      if ((order.status === "running" || order.status === "failed") && order.id === order.queryId &&
        /^a2a_[a-f0-9]{64}$/.test(order.id)) orders.push(order); else unreadable += 1;
    } catch { unreadable += 1; }
  }
  return { orders, unreadable, truncated: rows.length > bound };
}

const entrySchema = z.object({
  orderId: z.string().regex(/^a2a_[a-f0-9]{64}$/),
  researchMode: z.enum(["quick", "deep"]),
  operationalState: z.enum(["queued", "processing", "review_required", "failed"]),
  payment: originalOrderPaymentSchema,
  escalation: paidJobEscalationSchema,
  /** `unavailable` means the creator-leg read failed; the payment description stays conservative. */
  creatorEvidence: z.enum(["read", "unavailable", "not_read"]),
}).strict();
export type PaidJobEscalationEntry = z.infer<typeof entrySchema>;

/** Private operator packet. It carries original references for a person and must not be published. */
export const paidJobEscalationQueueSchema = z.object({
  schema: z.literal(PAID_JOB_ESCALATION_QUEUE_SCHEMA),
  observedAt: z.string().datetime(),
  scanLimit: z.number().int().positive().max(UNFINISHED_A2A_ORDER_SCAN_LIMIT),
  scanned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  unreadable: z.number().int().nonnegative(),
  withinTarget: z.number().int().nonnegative(),
  overdue: z.array(entrySchema),
  timingUnavailable: z.array(entrySchema),
  attentionNeeded: z.boolean(),
  evaluation: z.literal("on_observation"),
  authority: z.literal("read_only"),
  notification: z.literal("none"),
}).strict().refine(value => value.attentionNeeded ===
  (value.overdue.length > 0 || value.timingUnavailable.length > 0 || value.unreadable > 0 || value.truncated), {
  message: "Attention state is inconsistent",
}).refine(value => value.scanned === value.withinTarget + value.overdue.length + value.timingUnavailable.length + value.unreadable, {
  message: "Scanned count is inconsistent",
}).refine(value => value.scanned <= value.scanLimit, {
  message: "Scanned count exceeds its bound",
});
export type PaidJobEscalationQueue = z.infer<typeof paidJobEscalationQueueSchema>;

type QueueDb = Pick<KeryxDB, "listUnfinishedA2aOrders" | "listCreatorPaymentAttemptsByQuery">;

function operationalState(order: A2aOrder, nowMs: number): PaidJobEscalationEntry["operationalState"] {
  if (order.status === "failed") return "failed";
  if (!order.startedAt) return "queued";
  const started = Date.parse(order.startedAt);
  return !Number.isFinite(started) || nowMs - started >= A2A_REVIEW_AFTER_MS ? "review_required" : "processing";
}

/** Observe every unfinished paid original against its own accepted target and list those that
 * need a person, with the original order, payment reference and last recorded stage.
 *
 * Read-only by construction: the only storage calls are the unfinished-order read and, for an
 * overdue original, its recorded creator legs. It never claims, requeues, retries, signs, buys,
 * reconciles, releases a hold, refunds or notifies. A pending leg stays pending however old. */
export async function paidJobEscalationQueue(db: QueueDb, nowMs: number, limit = UNFINISHED_A2A_ORDER_SCAN_LIMIT): Promise<PaidJobEscalationQueue> {
  const scanLimit = unfinishedA2aOrderLimit(limit);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isFinite(new Date(nowMs).getTime())) throw new Error("Observation time is invalid");
  if (typeof db.listUnfinishedA2aOrders !== "function") throw new Error("Unfinished A2A order observation is not supported by this storage");
  const read = await db.listUnfinishedA2aOrders(scanLimit);
  const overdue: PaidJobEscalationEntry[] = [], timingUnavailable: PaidJobEscalationEntry[] = [];
  let withinTarget = 0, unreadable = read.unreadable;
  for (const order of read.orders) {
    try {
      if ((order.status !== "running" && order.status !== "failed") || order.id !== order.queryId ||
        !/^a2a_[a-f0-9]{64}$/.test(order.id)) { unreadable += 1; continue; }
      let escalation = paidJobEscalation(order, nowMs), creatorEvidence: PaidJobEscalationEntry["creatorEvidence"] = "not_read";
      if (escalation.state === "within_target") { withinTarget += 1; continue; }
      if (escalation.state === "overdue") {
        let attempts: PaymentRecord[] | null = null;
        try { attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId); creatorEvidence = "read"; }
        catch { creatorEvidence = "unavailable"; }
        escalation = paidJobEscalation(order, nowMs, attempts);
      }
      // An unfinished row is never `completed`; anything else unexpected is counted, not hidden.
      if (escalation.state !== "overdue" && escalation.state !== "unavailable") { unreadable += 1; continue; }
      const entry = entrySchema.parse({ orderId: order.id, researchMode: order.researchMode,
        operationalState: operationalState(order, nowMs), payment: originalOrderPayment(order), escalation, creatorEvidence });
      (escalation.state === "overdue" ? overdue : timingUnavailable).push(entry);
    } catch { unreadable += 1; }
  }
  return paidJobEscalationQueueSchema.parse({
    schema: PAID_JOB_ESCALATION_QUEUE_SCHEMA, observedAt: new Date(nowMs).toISOString(), scanLimit,
    scanned: read.orders.length + read.unreadable, truncated: read.truncated, unreadable, withinTarget, overdue, timingUnavailable,
    attentionNeeded: overdue.length > 0 || timingUnavailable.length > 0 || unreadable > 0 || read.truncated,
    evaluation: "on_observation", authority: "read_only", notification: "none",
  });
}
