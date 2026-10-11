import { describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import { syntheticA2aOriginal } from "../db/a2a-original-fixture";
import { a2aResearchPackage } from "./research-package";
import { decodeUnfinishedA2aOrders, paidJobEscalationQueue, unfinishedA2aOrderLimit } from "./overdue-escalation-queue";

const original = syntheticA2aOriginal().order;
const accepted = Date.parse(original.createdAt);
const pending: PaymentRecord = { id: "private-leg", queryId: original.id, kind: "fetch", sourceId: "private-source",
  sourceName: "Private source", payer: original.payee, payee: `0x${"33".repeat(20)}`, amountUsdc: 0.001,
  network: original.request!.network!, settled: false, settlementStatus: "pending", authorizationId: "PRIVATE_NONCE",
  authorizationExpiresAt: new Date(accepted + 2000).toISOString(), createdAt: new Date(accepted + 1000).toISOString() };

function reader(orders = [original], extra = {}) {
  const list = vi.fn().mockResolvedValue({ orders, unreadable: 0, truncated: false, ...extra });
  const legs = vi.fn().mockResolvedValue([pending]);
  const db = new Proxy({ listUnfinishedA2aOrders: list, listCreatorPaymentAttemptsByQuery: legs }, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Observation tried an unauthorized operation: ${String(key)}`);
    },
  });
  return { db, list, legs };
}

describe("private overdue original observation", () => {
  it("escalates an expired-but-pending original without retrying or changing payment evidence", async () => {
    const started = { ...original, startedAt: new Date(accepted + 500).toISOString(),
      paymentStartedAt: pending.createdAt, updatedAt: pending.createdAt };
    const before = structuredClone({ started, pending });
    const { db, list, legs } = reader([started]);
    const queue = await paidJobEscalationQueue(db, accepted + 180_001, 10);
    expect(queue).toMatchObject({ scanned: 1, attentionNeeded: true, evaluation: "on_observation", authority: "read_only", notification: "none" });
    expect(queue.overdue).toHaveLength(1);
    expect(queue.overdue[0]).toMatchObject({ orderId: original.id, operationalState: "processing", creatorEvidence: "read",
      payment: { reference: original.transaction, amountMicros: "30000" },
      escalation: { state: "overdue", creatorPaymentState: "pending_recorded", lastRecordedStage: "creator_payment_boundary", remedy: "none" } });
    expect(list).toHaveBeenCalledExactlyOnceWith(10);
    expect(legs).toHaveBeenCalledExactlyOnceWith(original.id);
    expect({ started, pending }).toEqual(before);
    expect(JSON.stringify(queue)).not.toMatch(/PRIVATE_NONCE|private-leg|private-source|question|authorizationId|workerId|requestHash|response/);
  });

  it("includes queue time and failed undelivered originals while preserving per-package targets", async () => {
    const deep = { ...syntheticA2aOriginal(2).order, researchMode: "deep" as const, researchPackage: a2aResearchPackage("deep") };
    const failed = { ...original, status: "failed" as const, errorCode: "research_failed" };
    const { db, legs } = reader([failed, deep]);
    legs.mockResolvedValue([]);
    const queue = await paidJobEscalationQueue(db, accepted + 180_001);
    expect(queue.withinTarget).toBe(1);
    expect(queue.overdue[0]).toMatchObject({ orderId: failed.id, operationalState: "failed",
      escalation: { lastRecordedStage: "queued", failureCode: "research_failed", creatorPaymentState: "no_creator_call_recorded" } });
    expect(legs).toHaveBeenCalledExactlyOnceWith(failed.id);
    expect((await paidJobEscalationQueue(reader().db, accepted + 180_000)).attentionNeeded).toBe(false);
  });

  it("keeps uncertain evidence conservative when creator-leg observation fails", async () => {
    const { db, legs } = reader([{ ...original, startedAt: pending.createdAt, paymentStartedAt: pending.createdAt, updatedAt: pending.createdAt }]);
    legs.mockRejectedValue(new Error("PRIVATE_CONNECTION_DETAIL"));
    const queue = await paidJobEscalationQueue(db, accepted + 180_001);
    expect(queue.overdue[0]).toMatchObject({ creatorEvidence: "unavailable", escalation: { creatorPaymentState: "payment_boundary_crossed" } });
    expect(JSON.stringify(queue)).not.toContain("PRIVATE_CONNECTION_DETAIL");
  });

  it("never reports a truncated, unreadable or untimed queue as requiring no attention", async () => {
    const { db, legs } = reader([{ ...original, researchPackage: null }], { unreadable: 2, truncated: true });
    const queue = await paidJobEscalationQueue(db, accepted + 180_001);
    expect(queue).toMatchObject({ attentionNeeded: true, scanned: 3, unreadable: 2, truncated: true, withinTarget: 0, overdue: [] });
    expect(queue.timingUnavailable[0]).toMatchObject({ creatorEvidence: "not_read", escalation: { state: "unavailable" } });
    expect(legs).not.toHaveBeenCalled();
    expect((await paidJobEscalationQueue(reader([], { truncated: true }).db, accepted)).attentionNeeded).toBe(true);
  });

  it("counts foreign/completed rows as unreadable before looking up another query", async () => {
    const { db, legs } = reader([{ ...original, queryId: "foreign" }, { ...original, status: "completed" }]);
    expect(await paidJobEscalationQueue(db, accepted + 180_001)).toMatchObject({ scanned: 2, unreadable: 2, attentionNeeded: true, overdue: [] });
    expect(legs).not.toHaveBeenCalled();
  });

  it("refuses unsupported storage, failed queue reads and invalid observation bounds", async () => {
    await expect(paidJobEscalationQueue({} as KeryxDB, accepted)).rejects.toThrow("not supported");
    const { db, list } = reader();
    list.mockRejectedValue(new Error("synthetic failed queue read"));
    await expect(paidJobEscalationQueue(db, accepted)).rejects.toThrow("synthetic failed queue read");
    list.mockClear();
    for (const limit of [0, 501, 1.5, NaN]) {
      expect(() => unfinishedA2aOrderLimit(limit)).toThrow();
      await expect(paidJobEscalationQueue(db, accepted, limit)).rejects.toThrow();
    }
    for (const time of [-1, NaN, Infinity, 1.5]) await expect(paidJobEscalationQueue(db, time)).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  it("counts corrupt rows, validates original identity and consumes only the bounded slice", () => {
    const decode = vi.fn((row: typeof original | null) => { if (!row) throw new Error("corrupt"); return row; });
    const read = decodeUnfinishedA2aOrders([original, null, { ...original, queryId: "foreign" }, original], 3, decode);
    expect(read).toEqual({ orders: [original], unreadable: 2, truncated: true });
    expect(decode).toHaveBeenCalledTimes(3);
  });
});
