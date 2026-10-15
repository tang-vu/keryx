import { expect, it, vi } from "vitest";
import type { PaymentRecord } from "../types";
import { syntheticA2aOriginal } from "../db/a2a-original-fixture";
import type { A2aOrder } from "./order";
import { createPaidJobAlertObserver, PAID_JOB_ALERT_ATTEMPT_LIMIT, type PaidJobAlert } from "./paid-job-alert-observer";

const network = "eip155:5042002";
const original = syntheticA2aOriginal().order;
const accepted = Date.parse(original.createdAt);
function fixture(count = 1) {
  const orders: A2aOrder[] = Array.from({ length: count }, (_, index) => {
    const order = syntheticA2aOriginal(index + 1).order;
    return { ...order, request: { ...order.request!, network }, status: "failed" as const, errorCode: "research_failed" };
  });
  const pending: PaymentRecord = { id: "synthetic-private-leg", queryId: orders[0].id, kind: "fetch", sourceId: "synthetic-private-source",
    sourceName: "synthetic-private-name", payer: orders[0].payee, payee: `0x${"33".repeat(20)}`, amountUsdc: 0.001,
    network, settled: false, settlementStatus: "pending", authorizationId: "synthetic-private-nonce",
    authorizationExpiresAt: new Date(accepted + 2000).toISOString(), createdAt: new Date(accepted + 1000).toISOString() };
  orders[0] = { ...orders[0], startedAt: new Date(accepted + 500).toISOString(),
    paymentStartedAt: pending.createdAt, updatedAt: pending.createdAt };
  const state = new Map<string, string>();
  const methods = { listUnfinishedA2aOrders: vi.fn(async () => ({ orders, unreadable: 0, truncated: false })),
    listCreatorPaymentAttemptsByQuery: vi.fn(async (id: string) => id === orders[0].id ? [pending] : []),
    getSyncState: vi.fn(async (key: string) => state.get(key) ?? null),
    setSyncState: vi.fn(async (key: string, value: string) => { state.set(key, value); }) };
  const db = new Proxy(methods, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    throw new Error("Observer attempted an unauthorized operation");
  } });
  let now = accepted + 180_001;
  const channel = { ready: vi.fn(() => true), send: vi.fn(async (_alert: PaidJobAlert) => true) };
  const create = (enabled?: boolean) => createPaidJobAlertObserver({ db, channel, network, payee: orders[0].payee,
    enabled, clock: () => now });
  return { orders, pending, state, methods, channel, create, setNow: (value: number) => { now = value; } };
}

it("defaults OFF and refuses an unbound channel before any observation or metadata write", async () => {
  const f = fixture();
  expect(await f.create().observe()).toMatchObject({ status: "disabled", coverage: "not-observed" });
  expect(f.channel.ready).not.toHaveBeenCalled();
  f.channel.ready.mockReturnValue(false);
  expect(await f.create(true).observe()).toMatchObject({ status: "unbound", coverage: "not-observed" });
  for (const method of Object.values(f.methods)) expect(method).not.toHaveBeenCalled();
  expect(f.channel.send).not.toHaveBeenCalled();
});

it("observes a failed original crossing its own target without a customer GET or changing an expired pending leg", async () => {
  const f = fixture(), before = structuredClone({ orders: f.orders, pending: f.pending });
  const observer = f.create(true);
  f.setNow(accepted + 180_000);
  expect(await observer.observe()).toMatchObject({ overdue: 0, acknowledged: 0,
    predeadlineAttention: { needsReview: 1, acknowledged: 1 } });
  f.setNow(accepted + 180_001);
  expect(await observer.observe()).toMatchObject({ status: "observed", overdue: 1, acknowledged: 0, suppressed: 1, unknown: 0 });
  expect(f.channel.send).toHaveBeenCalledOnce();
  const alert = f.channel.send.mock.calls[0][0];
  expect(alert.original).toMatchObject({ operationalState: "failed", payment: { network, reference: f.orders[0].transaction },
    escalation: { state: "within_target", creatorPaymentState: "pending_recorded", failureCode: "research_failed", remedy: "none" } });
  expect(JSON.stringify(alert)).not.toMatch(/synthetic-private|authorizationId|workerId|requestHash|question|response/);
  expect({ orders: f.orders, pending: f.pending }).toEqual(before);
  expect([...f.state.keys()][0]).toMatch(/^paidJobDeadlineAlert:[a-f0-9]{64}$/);
  expect(JSON.stringify([...f.state.values()])).not.toContain(f.orders[0].id);
  // Retained metadata survives a new observer/process instance; stage changes cannot rearm it.
  f.orders[0].resultSavingAt = f.pending.createdAt;
  expect(await f.create(true).observe()).toMatchObject({ suppressed: 1, acknowledged: 0, unknown: 0 });
  expect(f.channel.send).toHaveBeenCalledOnce();
});

it.each(["refused", "thrown"])("holds %s delivery without reporting acknowledgment or automatically resending", async mode => {
  const f = fixture();
  if (mode === "thrown") f.channel.send.mockRejectedValue(new Error("synthetic-private-channel-secret"));
  else f.channel.send.mockResolvedValue(false);
  expect(await f.create(true).observe()).toMatchObject({ acknowledged: 0, unknown: 1 });
  expect(await f.create(true).observe()).toMatchObject({ suppressed: 1, unknown: 1 });
  expect(f.channel.send).toHaveBeenCalledOnce();
  expect(JSON.stringify([...f.state.values()])).not.toContain("synthetic-private-channel-secret");
});

it("reserves durably before transport and holds a crash or failed acknowledgment write", async () => {
  const f = fixture();
  f.channel.send.mockImplementation(async () => {
    expect(JSON.parse([...f.state.values()][0]).phase).toBe("attempted");
    return true;
  });
  f.methods.setSyncState.mockImplementationOnce(async (key, value) => { f.state.set(key, value); })
    .mockRejectedValueOnce(new Error("synthetic post-send storage refusal"));
  expect(await f.create(true).observe()).toMatchObject({ status: "unavailable" });
  expect(await f.create(true).observe()).toMatchObject({ suppressed: 1, unknown: 1 });
  expect(f.channel.send).toHaveBeenCalledOnce();
  const beforeSend = fixture();
  beforeSend.methods.setSyncState.mockRejectedValue(new Error("synthetic reservation refusal"));
  expect(await beforeSend.create(true).observe()).toMatchObject({ status: "unavailable" });
  expect(beforeSend.channel.send).not.toHaveBeenCalled();
});

it("does not replay malformed retained state or assert delivery with a regressed acknowledgment clock", async () => {
  const f = fixture();
  f.channel.send.mockImplementation(async () => { f.setNow(accepted); return true; });
  expect(await f.create(true).observe()).toMatchObject({ unknown: 1, acknowledged: 0 });
  const key = [...f.state.keys()][0]; f.state.set(key, "corrupt"); f.setNow(accepted + 200_000);
  expect(await f.create(true).observe()).toMatchObject({ suppressed: 1, unknown: 1 });
  expect(f.channel.send).toHaveBeenCalledOnce();
});

it("coalesces overlapping heartbeat/loop observations and drains an ongoing transport", async () => {
  const f = fixture(); let finish!: (delivered: boolean) => void;
  f.channel.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const observer = f.create(true), one = observer.observe(), two = observer.observe();
  expect(two).toBe(one);
  await vi.waitFor(() => expect(f.channel.send).toHaveBeenCalledOnce());
  let drained = false; const drain = observer.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  finish(true); await one; await drain; expect(drained).toBe(true);
});

it("bounds attempts per observation and never promotes capped or untimed data to complete coverage", async () => {
  const f = fixture(PAID_JOB_ALERT_ATTEMPT_LIMIT + 1), observer = f.create(true);
  expect(await observer.observe()).toMatchObject({ acknowledged: PAID_JOB_ALERT_ATTEMPT_LIMIT, deferred: 1, coverage: "partial" });
  expect(await observer.observe()).toMatchObject({ acknowledged: 1, suppressed: PAID_JOB_ALERT_ATTEMPT_LIMIT });
  f.methods.listUnfinishedA2aOrders.mockResolvedValue({ orders: f.orders, unreadable: 1, truncated: true });
  expect(await observer.observe()).toMatchObject({ coverage: "partial" });
});

it("refuses missing references and never observes creator legs for another provider/profile", async () => {
  const f = fixture(4);
  f.orders[0].transaction = "";
  f.orders[1].request!.network = "eip155:5042";
  f.orders[2].payee = `0x${"44".repeat(20)}`;
  f.orders[3].request = null;
  expect(await f.create(true).observe()).toMatchObject({ overdue: 1, deferred: 1, coverage: "partial" });
  expect(f.methods.listCreatorPaymentAttemptsByQuery).toHaveBeenCalledExactlyOnceWith(f.orders[0].id);
  expect(f.channel.send).not.toHaveBeenCalled(); expect(f.state.size).toBe(0);
});
