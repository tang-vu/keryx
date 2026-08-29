import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import type { A2aOrder } from "../a2a/order";
import type { PaymentRecord } from "../types";

const dbFile = path.join(os.tmpdir(), `keryx-a2a-orders-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

const order: A2aOrder = {
  id: "a2a_order",
  queryId: "a2a_order",
  authorizationId: "0xnonce",
  requestHash: "request-hash",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amountUsdc: 0.1,
  creatorBudgetUsdc: 0.05,
  serviceFeeUsdc: 0.05,
  researchMode: "deep",
  status: "running",
  transaction: "circle-transfer",
  response: null,
  errorCode: null,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function inbound(): PaymentRecord {
  return {
    id: "inbound_a2a_order",
    kind: "inbound",
    queryId: order.queryId,
    sourceId: "a2a",
    sourceName: "A2A caller",
    payer: order.payer,
    payee: order.payee,
    amountUsdc: order.amountUsdc,
    txHash: order.transaction,
    authorizationId: order.authorizationId,
    network: "eip155:5042002",
    settled: true,
    settlementStatus: "settled",
    createdAt: order.createdAt,
  };
}

describe("SQLite A2A order idempotency", () => {
  it("inserts one inbound row and one authorization claim", async () => {
    expect(await db.recordPaymentOnce(inbound())).toBe(true);
    expect(await db.recordPaymentOnce(inbound())).toBe(false);

    const first = await db.createA2aOrder(order);
    const replay = await db.createA2aOrder(order);
    expect(first.created).toBe(true);
    expect(replay).toEqual({ created: false, order });
  });

  it("allows exactly one terminal compare-and-set", async () => {
    expect(await db.completeA2aOrder(order.id, { status: "completed" }, "2026-08-29T00:01:00.000Z")).toBe(true);
    expect(await db.completeA2aOrder(order.id, { status: "completed" }, "2026-08-29T00:02:00.000Z")).toBe(false);
    expect(await db.failA2aOrder(order.id, "late_failure", "2026-08-29T00:03:00.000Z")).toBe(false);
  });

  it("allows exactly one winner when two workers claim the same authorization", async () => {
    const concurrent = {
      ...order,
      id: "a2a_concurrent",
      queryId: "a2a_concurrent",
      authorizationId: "0xconcurrent",
      transaction: "circle-concurrent",
    };
    const [left, right] = await Promise.all([
      db.createA2aOrder(concurrent),
      db.createA2aOrder(concurrent),
    ]);
    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(left.order).toEqual(right.order);
  });
});
