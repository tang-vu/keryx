import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import type { A2aOrder } from "../a2a/order";
import type { PaymentRecord } from "../types";
import { a2aResearchPackage } from "../a2a/research-package";

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
  researchPackage: a2aResearchPackage("deep"),
  status: "running",
  transaction: "circle-transfer",
  request: { question: "q", origin: "a2a" },
  startedAt: "2026-08-29T00:00:00.000Z",
  workerId: "request:a2a_order",
  executionJournalVersion: 1,
  paymentStartedAt: null,
  resultSavingAt: null,
  response: null,
  errorCode: null,
  resolution: null,
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

  it("atomically claims a queued job once and never reclaims a started job", async () => {
    const queued = {
      ...order,
      id: "a2a_queued",
      queryId: "a2a_queued",
      authorizationId: "0xqueued",
      transaction: "circle-queued",
      startedAt: null,
      workerId: null,
    };
    await db.createA2aOrder(queued);
    const [left, right] = await Promise.all([
      db.claimNextA2aOrder("worker-left", "2026-08-29T00:04:00.000Z"),
      db.claimNextA2aOrder("worker-right", "2026-08-29T00:04:00.000Z"),
    ]);
    const claimed = left ?? right;
    expect(claimed).toMatchObject({ id: queued.id, startedAt: "2026-08-29T00:04:00.000Z" });
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect(await db.claimNextA2aOrder("worker-late", "2026-08-29T00:05:00.000Z")).toBeNull();
  });

  it("journals the first creator-payment boundary before gateway work can begin", async () => {
    const journaled = {
      ...order,
      id: "a2a_journaled",
      queryId: "a2a_journaled",
      authorizationId: "0xjournaled",
      transaction: "circle-journaled",
    };
    await db.createA2aOrder(journaled);
    expect(
      await db.markA2aOrderPaymentStarted(journaled.id, "2026-08-29T00:00:10.000Z"),
    ).toBe(true);
    expect(
      await db.markA2aOrderPaymentStarted(journaled.id, "2026-08-29T00:00:20.000Z"),
    ).toBe(true);
    expect(await db.getA2aOrder(journaled.id)).toMatchObject({
      executionJournalVersion: 1,
      paymentStartedAt: "2026-08-29T00:00:10.000Z",
    });
  });

  it("lets the QueryRun-save checkpoint win atomically over a stale close", async () => {
    const saving = {
      ...order,
      id: "a2a_result_saving",
      queryId: "a2a_result_saving",
      authorizationId: "0xresult-saving",
      transaction: "circle-result-saving",
    };
    await db.createA2aOrder(saving);
    expect(
      await db.markA2aOrderResultSaving(saving.id, "2026-08-29T00:15:00.000Z"),
    ).toBe(true);
    expect(await db.getA2aOrder(saving.id)).toMatchObject({
      status: "running",
      resultSavingAt: "2026-08-29T00:15:00.000Z",
    });
    expect(
      await db.resolveA2aOrder(saving.id, {
        status: "failed",
        errorCode: "operator_reviewed_no_result",
        startedBefore: "2026-08-29T00:05:00.000Z",
        resolution: {
          action: "close_failed",
          actor: "operator-cli",
          reason: "no_saved_run_before_execution_boundaries",
          evidence: {
            executionJournalVersion: 1,
            paymentBoundaryCrossed: false,
            resultSaveBoundaryCrossed: false,
            creatorAttempts: 0,
            settledCreatorMicros: 0,
            pendingCreatorMicros: 0,
            failedCreatorMicros: 0,
            simulatedCreatorMicros: 0,
            queryRunFound: false,
          },
          resolvedAt: "2026-08-29T00:20:00.000Z",
        },
      }),
    ).toBe(false);
    expect(await db.getA2aOrder(saving.id)).toMatchObject({ status: "running" });
  });

  it("atomically stores reviewed failure evidence and refuses ambiguous payment rows", async () => {
    const stale = {
      ...order,
      id: "a2a_reviewed",
      queryId: "a2a_reviewed",
      authorizationId: "0xreviewed",
      transaction: "circle-reviewed",
      startedAt: "2026-08-29T00:00:00.000Z",
    };
    await db.createA2aOrder(stale);
    const resolution = {
      action: "close_failed" as const,
      actor: "operator-cli" as const,
      reason: "no_saved_run_before_execution_boundaries" as const,
      evidence: {
        executionJournalVersion: 1 as const,
        paymentBoundaryCrossed: false,
        resultSaveBoundaryCrossed: false,
        creatorAttempts: 0,
        settledCreatorMicros: 0,
        pendingCreatorMicros: 0,
        failedCreatorMicros: 0,
        simulatedCreatorMicros: 0,
        queryRunFound: false,
      },
      resolvedAt: "2026-08-29T00:20:00.000Z",
    };
    expect(
      await db.resolveA2aOrder(stale.id, {
        status: "failed",
        errorCode: "operator_reviewed_no_result",
        startedBefore: "2026-08-29T00:05:00.000Z",
        resolution,
      }),
    ).toBe(true);
    expect(await db.getA2aOrder(stale.id)).toMatchObject({
      status: "failed",
      errorCode: "operator_reviewed_no_result",
      resolution,
    });

    const ambiguous = {
      ...stale,
      id: "a2a_ambiguous",
      queryId: "a2a_ambiguous",
      authorizationId: "0xambiguous",
      transaction: "circle-ambiguous",
      status: "running" as const,
      resolution: null,
      paymentStartedAt: null,
    };
    await db.createA2aOrder(ambiguous);
    await db.recordPayment({
      id: "pending-a2a-creator",
      kind: "fetch",
      queryId: ambiguous.queryId,
      sourceId: "source",
      sourceName: "Source",
      payer: ambiguous.payee,
      payee: ambiguous.payer,
      amountUsdc: 0.01,
      network: "eip155:5042002",
      settled: false,
      settlementStatus: "pending",
      createdAt: "2026-08-29T00:01:00.000Z",
    });
    expect(
      await db.resolveA2aOrder(ambiguous.id, {
        status: "failed",
        errorCode: "operator_reviewed_no_result",
        startedBefore: "2026-08-29T00:05:00.000Z",
        resolution: { ...resolution, resolvedAt: "2026-08-29T00:21:00.000Z" },
      }),
    ).toBe(false);
    expect(await db.getA2aOrder(ambiguous.id)).toMatchObject({ status: "running" });
  });

  it("marks legacy running rows started so migration cannot accidentally rerun creator spend", async () => {
    const legacyFile = path.join(os.tmpdir(), `keryx-a2a-legacy-${process.pid}.sqlite`);
    const legacyRaw = new DatabaseSync(legacyFile);
    legacyRaw.exec(`
      CREATE TABLE a2a_orders (
        id TEXT PRIMARY KEY, query_id TEXT NOT NULL UNIQUE, authorization_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, payer TEXT NOT NULL, payee TEXT NOT NULL,
        amount_usdc REAL NOT NULL, creator_budget_usdc REAL NOT NULL,
        service_fee_usdc REAL NOT NULL, research_mode TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
        transaction_id TEXT NOT NULL, response_data TEXT, error_code TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO a2a_orders VALUES (
        'a2a_legacy','a2a_legacy','0xlegacy','legacy-hash',
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        0.1,0.05,0.05,'deep','running','circle-legacy',NULL,NULL,
        '2026-08-28T00:00:00.000Z','2026-08-28T00:01:00.000Z'
      );
    `);
    legacyRaw.close();

    const migrated = new SqliteAdapter(legacyFile);
    try {
      await migrated.init();
      expect(await migrated.getA2aOrder("a2a_legacy")).toMatchObject({
        request: null,
        startedAt: "2026-08-28T00:01:00.000Z",
        workerId: "legacy",
      });
      expect(await migrated.claimNextA2aOrder("worker", "2026-09-01T00:00:00.000Z")).toBeNull();
    } finally {
      migrated.close();
      for (const suffix of ["", "-wal", "-shm"])
        fs.rmSync(legacyFile + suffix, { force: true });
    }
  });
});
