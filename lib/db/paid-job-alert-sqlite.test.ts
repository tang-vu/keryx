import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import { createPaidJobAlertObserver } from "../a2a/paid-job-alert-observer";

it("retains a private alert reservation across a physical SQLite reopen without mutating the original order or pending leg", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-job-alert-")), file = join(directory, "offline.sqlite");
  let db = new SqliteAdapter(file);
  const { order } = syntheticA2aOriginal();
  order.status = "failed"; order.errorCode = "research_failed";
  order.startedAt = order.createdAt; order.paymentStartedAt = order.createdAt;
  const leg = { id: "synthetic-alert-pending-leg", kind: "fetch" as const, queryId: order.id,
    sourceId: "synthetic-source", sourceName: "Synthetic only", payer: order.payee, payee: order.payer,
    amountUsdc: 0.001, network: order.request!.network!, settled: false, settlementStatus: "pending" as const,
    authorizationExpiresAt: new Date(Date.parse(order.createdAt) + 1000).toISOString(), createdAt: order.createdAt };
  const now = Date.parse(order.createdAt) + 180_001, send = vi.fn(async () => true);
  const observe = () => createPaidJobAlertObserver({ db, network: order.request!.network!, payee: order.payee,
    enabled: true, clock: () => now, channel: { ready: () => true, send } });
  try {
    await db.init(); await db.createA2aOrder(order); await db.recordPayment(leg);
    const before = { order: await db.getA2aOrder(order.id), legs: await db.listCreatorPaymentAttemptsByQuery(order.id) };
    expect(await observe().observe()).toMatchObject({ acknowledged: 1, overdue: 1 });
    db.close(); db = new SqliteAdapter(file);
    expect(await observe().observe()).toMatchObject({ suppressed: 1, acknowledged: 0, unknown: 0 });
    expect(send).toHaveBeenCalledOnce();
    expect({ order: await db.getA2aOrder(order.id), legs: await db.listCreatorPaymentAttemptsByQuery(order.id) }).toEqual(before);
    expect((await db.listCreatorPaymentAttemptsByQuery(order.id))[0].settlementStatus).toBe("pending");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
