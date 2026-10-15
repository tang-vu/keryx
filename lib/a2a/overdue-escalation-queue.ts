import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import { A2A_REVIEW_AFTER_MS, type A2aOrder } from "./order";
import { originalOrderPayment, paidJobEscalation } from "./overdue-status";
import { originalOrderPaymentSchema, paidJobEscalationSchema } from "./overdue-types";
import { jobTargetNeedsReview } from "../operator/job-targets";

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
  predeadlineAttention: z.array(entrySchema).default([]),
  overdue: z.array(entrySchema),
  timingUnavailable: z.array(entrySchema),
  attentionNeeded: z.boolean(),
  evaluation: z.literal("on_observation"),
  authority: z.literal("read_only"),
  notification: z.literal("none"),
  recoveryObservation: z.enum(["read", "unavailable", "not_read"]).default("not_read"),
}).strict().refine(value => value.attentionNeeded ===
  (value.predeadlineAttention.length > 0 || value.overdue.length > 0 || value.timingUnavailable.length > 0 || value.unreadable > 0 || value.truncated), {
  message: "Attention state is inconsistent",
}).refine(value => value.scanned === value.withinTarget + value.predeadlineAttention.length + value.overdue.length + value.timingUnavailable.length + value.unreadable, {
  message: "Scanned count is inconsistent",
}).refine(value => value.scanned <= value.scanLimit, {
  message: "Scanned count exceeds its bound",
}).refine(value => value.predeadlineAttention.every(entry => entry.escalation.state === "within_target" &&
  jobTargetNeedsReview(entry.escalation, entry.operationalState)) &&
  value.overdue.every(entry => entry.escalation.state === "overdue") &&
  value.timingUnavailable.every(entry => entry.escalation.state === "unavailable"), {
  message: "Attention entries conflict with their observed timing",
});
export type PaidJobEscalationQueue = z.infer<typeof paidJobEscalationQueueSchema>;

type QueueDb = Pick<KeryxDB, "listUnfinishedA2aOrders" | "listCreatorPaymentAttemptsByQuery"> & Partial<Pick<KeryxDB, "getSyncState">>;
type RecoveryScope = { network: string; payee: string };
const retainedRecoverySchema = z.object({
  workerId: z.string().min(1).max(256), status: z.literal("recovery_pending"),
  orderId: z.string().regex(/^a2a_[a-f0-9]{64}$/), updatedAt: z.string().datetime({ offset: true }),
}).strict();

/** This projection uses millisecond clocks. Refuse finer precision instead of
 * truncating a reversed/future instant, and check the local calendar before parsing. */
function recoveryTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, , offset] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    offset === "-00:00" || offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const time = Date.parse(value);
  return Number.isSafeInteger(time) ? time : null;
}

/** Project the existing worker record only onto its exact owned original. No age
 * threshold, payment checkpoint or absent evidence establishes a recovery hold. */
export function retainedRecoveryMatches(order: A2aOrder, retained: unknown, scope: RecoveryScope | undefined, nowMs: number): boolean {
  const parsed = retainedRecoverySchema.safeParse(retained);
  if (!parsed.success || !scope || order.status !== "running" || !order.startedAt ||
    order.id !== order.queryId || parsed.data.orderId !== order.id || parsed.data.workerId !== order.workerId ||
    !["eip155:5042", "eip155:5042002"].includes(scope.network) || order.request?.network !== scope.network ||
    !/^0x[0-9a-fA-F]{40}$/.test(scope.payee) || typeof order.payee !== "string" || order.payee.toLowerCase() !== scope.payee.toLowerCase()) return false;
  const [accepted, started, updated, held] = [order.createdAt, order.startedAt, order.updatedAt, parsed.data.updatedAt].map(recoveryTime);
  return accepted !== null && started !== null && updated !== null && held !== null && Number.isSafeInteger(nowMs) &&
    accepted <= started && started <= updated && updated <= held && held <= nowMs;
}

function operationalState(order: A2aOrder, nowMs: number): PaidJobEscalationEntry["operationalState"] {
  if (order.status === "failed") return "failed";
  if (!order.startedAt) return "queued";
  const started = Date.parse(order.startedAt);
  return !Number.isFinite(started) || nowMs - started >= A2A_REVIEW_AFTER_MS ? "review_required" : "processing";
}

/** Observe every unfinished paid original against its own accepted target and list those that
 * need a person, with the original order, payment reference and last recorded stage.
 *
 * Read-only by construction: bounded originals, their attention-worthy recorded creator legs,
 * and an optional exact-owner projection of the existing worker sync record. It never claims, requeues, retries, signs, buys,
 * reconciles, releases a hold, refunds or notifies. A pending leg stays pending however old. */
export async function paidJobEscalationQueue(db: QueueDb, nowMs: number, limit = UNFINISHED_A2A_ORDER_SCAN_LIMIT, scope?: RecoveryScope): Promise<PaidJobEscalationQueue> {
  const scanLimit = unfinishedA2aOrderLimit(limit);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isFinite(new Date(nowMs).getTime())) throw new Error("Observation time is invalid");
  if (typeof db.listUnfinishedA2aOrders !== "function") throw new Error("Unfinished A2A order observation is not supported by this storage");
  const read = await db.listUnfinishedA2aOrders(scanLimit);
  let retainedRecovery: unknown = null;
  let recoveryObservation: PaidJobEscalationQueue["recoveryObservation"] = "not_read";
  if (scope && read.orders.some(order => order.status === "running" && order.workerId && order.startedAt)) {
    try {
      if (typeof db.getSyncState !== "function") throw new Error("Recovery observation unavailable");
      const raw = await db.getSyncState("a2aWorker");
      if (raw !== null && Buffer.byteLength(raw, "utf8") > 2048) throw new Error("Recovery observation exceeds source bound");
      retainedRecovery = raw === null ? null : JSON.parse(raw);
      recoveryObservation = "read";
    } catch { recoveryObservation = "unavailable"; }
  }
  const overdue: PaidJobEscalationEntry[] = [], predeadlineAttention: PaidJobEscalationEntry[] = [], timingUnavailable: PaidJobEscalationEntry[] = [];
  let withinTarget = 0, unreadable = read.unreadable;
  for (const order of read.orders) {
    try {
      if ((order.status !== "running" && order.status !== "failed") || order.id !== order.queryId ||
        !/^a2a_[a-f0-9]{64}$/.test(order.id)) { unreadable += 1; continue; }
      let escalation = paidJobEscalation(order, nowMs), creatorEvidence: PaidJobEscalationEntry["creatorEvidence"] = "not_read";
      const held = retainedRecoveryMatches(order, retainedRecovery, scope, nowMs);
      const state = held ? "review_required" : operationalState(order, nowMs);
      // Before the target, unknown/invalid start evidence is not a recovery hold.
      // Preserve the old operational classifier for overdue/untimed originals.
      const predeadlineReview = escalation.state === "within_target" &&
        jobTargetNeedsReview(escalation, held ? "review_required" : order.status === "failed" ? "failed" : undefined);
      if (escalation.state === "within_target" && !predeadlineReview) { withinTarget += 1; continue; }
      if (escalation.state === "overdue" || predeadlineReview) {
        let attempts: PaymentRecord[] | null = null;
        try { attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId); creatorEvidence = "read"; }
        catch { creatorEvidence = "unavailable"; }
        escalation = paidJobEscalation(order, nowMs, attempts);
      }
      // An unfinished row is never `completed`; anything else unexpected is counted, not hidden.
      if (escalation.state !== "overdue" && escalation.state !== "unavailable" && !predeadlineReview) { unreadable += 1; continue; }
      const entry = entrySchema.parse({ orderId: order.id, researchMode: order.researchMode,
        operationalState: state, payment: originalOrderPayment(order), escalation, creatorEvidence });
      (predeadlineReview ? predeadlineAttention : escalation.state === "overdue" ? overdue : timingUnavailable).push(entry);
    } catch { unreadable += 1; }
  }
  return paidJobEscalationQueueSchema.parse({
    schema: PAID_JOB_ESCALATION_QUEUE_SCHEMA, observedAt: new Date(nowMs).toISOString(), scanLimit,
    scanned: read.orders.length + read.unreadable, truncated: read.truncated, unreadable, withinTarget, predeadlineAttention, overdue, timingUnavailable,
    attentionNeeded: predeadlineAttention.length > 0 || overdue.length > 0 || timingUnavailable.length > 0 || unreadable > 0 || read.truncated,
    evaluation: "on_observation", authority: "read_only", notification: "none",
    recoveryObservation,
  });
}
