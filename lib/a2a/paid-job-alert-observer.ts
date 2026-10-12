import { createHash } from "node:crypto";
import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { paidJobEscalationQueue, type PaidJobEscalationEntry } from "./overdue-escalation-queue";

export const PAID_JOB_ALERT_SCAN_LIMIT = 50;
export const PAID_JOB_ALERT_ATTEMPT_LIMIT = 4;
const prefix = "paidJobDeadlineAlert:";
const retainedState = z.object({
  schema: z.literal("keryx-paid-job-alert-v1"),
  incidentId: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(["attempted", "acknowledged", "unknown"]),
  observedAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
}).strict();

/** Private ops event only: no question, payer, authorization, worker or saved answer. */
export interface PaidJobAlert {
  incidentId: string;
  original: PaidJobEscalationEntry;
}
export interface PaidJobAlertChannel {
  ready(): boolean;
  /** True acknowledges the configured transport, not a person's receipt or customer delivery. */
  send(alert: PaidJobAlert): Promise<boolean>;
}
type ObserverDb = Pick<KeryxDB, "listUnfinishedA2aOrders" | "listCreatorPaymentAttemptsByQuery" | "getSyncState" | "setSyncState">;
export interface PaidJobAlertObservation {
  status: "disabled" | "unbound" | "observed" | "unavailable";
  coverage: "not-observed" | "complete" | "partial";
  overdue: number;
  acknowledged: number;
  suppressed: number;
  unknown: number;
  deferred: number;
}
const empty = (status: PaidJobAlertObservation["status"]): PaidJobAlertObservation => ({
  status, coverage: "not-observed", overdue: 0, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0,
});

/** Call ONLY under the existing A2A worker's single-host writer lock. No timer, claim,
 * research, reconciliation, financial write or customer notification is introduced.
 * Reserve before transport; crash/partial delivery never authorizes an automatic resend. */
export function createPaidJobAlertObserver(options: {
  db: ObserverDb; network: string; payee: string; channel: PaidJobAlertChannel;
  enabled?: boolean; clock?: () => number;
}) {
  let pending: Promise<PaidJobAlertObservation> | null = null;
  const clock = options.clock ?? Date.now;
  async function run(nowMs: number): Promise<PaidJobAlertObservation> {
    if (options.enabled !== true) return empty("disabled");
    if (!options.channel.ready()) return empty("unbound");
    if (!["eip155:5042", "eip155:5042002"].includes(options.network) || !/^0x[0-9a-fA-F]{40}$/.test(options.payee))
      return empty("unavailable");
    // The original storage scan remains bounded/truncation-aware. Do not export or read
    // creator legs for another profile/provider, or infer a missing recorded network.
    const scopedDb: Pick<ObserverDb, "listUnfinishedA2aOrders" | "listCreatorPaymentAttemptsByQuery"> = {
      listUnfinishedA2aOrders: async limit => {
        if (!options.db.listUnfinishedA2aOrders) throw new Error("Unfinished observation unavailable");
        const read = await options.db.listUnfinishedA2aOrders(limit);
        let unscoped = 0;
        const orders = read.orders.filter(order => {
          if (!["eip155:5042", "eip155:5042002"].includes(order.request?.network ?? "") ||
            typeof order.payee !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(order.payee)) { unscoped++; return false; }
          return order.request!.network === options.network && order.payee.toLowerCase() === options.payee.toLowerCase();
        });
        return { ...read, orders, unreadable: read.unreadable + unscoped };
      },
      listCreatorPaymentAttemptsByQuery: queryId => options.db.listCreatorPaymentAttemptsByQuery(queryId),
    };
    const queue = await paidJobEscalationQueue(scopedDb, nowMs, PAID_JOB_ALERT_SCAN_LIMIT);
    const result: PaidJobAlertObservation = { ...empty("observed"),
      coverage: queue.truncated || queue.unreadable || queue.timingUnavailable.length ? "partial" : "complete",
      overdue: queue.overdue.length };
    let attempts = 0;
    for (const original of queue.overdue) {
      // One incident for this original/network, even if its retained stage or timestamps change.
      const incidentId = createHash("sha256").update(`${options.network}/${original.orderId}/completion-target`).digest("hex");
      const key = prefix + incidentId;
      const previous = await options.db.getSyncState(key);
      if (previous !== null) {
        let acknowledged = false;
        try {
          const state = retainedState.parse(JSON.parse(previous));
          acknowledged = state.incidentId === incidentId && state.phase === "acknowledged" &&
            state.acknowledgedAt !== null && Date.parse(state.acknowledgedAt) >= Date.parse(state.observedAt) &&
            Date.parse(state.acknowledgedAt) <= nowMs;
        } catch { /* A corrupt, empty or crashed reservation is held, never replayed. */ }
        result.suppressed++;
        if (!acknowledged) result.unknown++;
        continue;
      }
      if (!original.payment.reference || original.payment.amountMicros === null || attempts >= PAID_JOB_ALERT_ATTEMPT_LIMIT) {
        result.deferred++; result.coverage = "partial"; continue;
      }
      const reservation = { schema: "keryx-paid-job-alert-v1" as const, incidentId,
        phase: "attempted" as const, observedAt: queue.observedAt, acknowledgedAt: null };
      // A failed write prevents sending. An ambiguous committed write is found next tick.
      await options.db.setSyncState(key, JSON.stringify(reservation));
      attempts++;
      let delivered = false;
      try { delivered = await options.channel.send({ incidentId, original }) === true; }
      catch { /* Do not leak a private channel or response body. */ }
      const ackMs = clock();
      const acknowledged = delivered && Number.isSafeInteger(ackMs) && ackMs >= nowMs &&
        Number.isFinite(new Date(ackMs).getTime());
      await options.db.setSyncState(key, JSON.stringify({ ...reservation,
        phase: acknowledged ? "acknowledged" : "unknown",
        acknowledgedAt: acknowledged ? new Date(ackMs).toISOString() : null }));
      if (acknowledged) result.acknowledged++; else result.unknown++;
    }
    return result;
  }
  return {
    observe(nowMs: number = clock()): Promise<PaidJobAlertObservation> {
      if (pending) return pending;
      pending = run(nowMs).catch(() => empty("unavailable")).finally(() => { pending = null; });
      return pending;
    },
    async drain(): Promise<void> { await pending; },
  };
}
