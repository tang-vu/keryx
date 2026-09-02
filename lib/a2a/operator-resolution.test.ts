import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord, QueryRun } from "../types";
import type { A2aOrder } from "./order";
import {
  closeReviewedA2aOrder,
  inspectA2aOrder,
  repairA2aOrderFromSavedRun,
} from "./operator-resolution";
import { a2aResearchPackage } from "./research-package";

const now = "2026-09-01T12:00:00.000Z";

function order(overrides: Partial<A2aOrder> = {}): A2aOrder {
  return {
    id: `a2a_${"a".repeat(64)}`,
    queryId: `a2a_${"a".repeat(64)}`,
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
    request: { question: "private question", origin: "a2a" },
    startedAt: "2026-09-01T11:44:59.000Z",
    workerId: "private-worker",
    executionJournalVersion: 1,
    paymentStartedAt: null,
    resultSavingAt: null,
    response: null,
    errorCode: null,
    resolution: null,
    createdAt: "2026-09-01T11:44:50.000Z",
    updatedAt: "2026-09-01T11:44:59.000Z",
    ...overrides,
  };
}

function payment(
  settlementStatus: PaymentRecord["settlementStatus"],
  amountUsdc = 0.01,
): PaymentRecord {
  return {
    kind: "fetch",
    queryId: order().queryId,
    sourceId: "source",
    sourceName: "Source",
    payer: "0x2",
    payee: "0x3",
    amountUsdc,
    network: "eip155:5042002",
    settled: settlementStatus === "settled",
    settlementStatus,
    createdAt: "2026-09-01T11:45:00.000Z",
  };
}

function savedRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: order().queryId,
    createdAt: now,
    question: "private question",
    budget: 0.05,
    engine: "test",
    trace: [],
    citations: [],
    evidence: [],
    claimCoverage: [],
    answer: "saved answer",
    totalSpent: 0.01,
    totalToCreators: 0.01,
    paymentMode: "real",
    ...overrides,
  } as QueryRun;
}

function fakeDb(initial: A2aOrder, run: QueryRun | null, attempts: PaymentRecord[]) {
  let current = initial;
  const db = {
    getA2aOrder: vi.fn(async () => current),
    getQueryRun: vi.fn(async () => run),
    listCreatorPaymentAttemptsByQuery: vi.fn(async () => attempts),
    resolveA2aOrder: vi.fn(async (_id, update) => {
      current = {
        ...current,
        status: update.status,
        response: update.status === "completed" ? update.response : null,
        errorCode: update.status === "failed" ? update.errorCode : null,
        resolution: update.resolution,
        updatedAt: update.resolution.resolvedAt,
      };
      return true;
    }),
  };
  return db;
}

describe("A2A operator resolution", () => {
  it("repairs only from a saved real run and records integer settlement evidence", async () => {
    const initial = order();
    const db = fakeDb(initial, savedRun(), [payment("settled", 0.01)]);
    const repaired = await repairA2aOrderFromSavedRun(
      db as never,
      initial,
      savedRun(),
      "operator-cli",
      now,
    );
    expect(repaired).toMatchObject({
      status: "completed",
      resolution: {
        action: "repair_completed",
        reason: "saved_real_query_run",
        evidence: { settledCreatorMicros: 10_000, queryRunFound: true },
      },
    });
    expect(db.resolveA2aOrder).toHaveBeenCalledOnce();
  });

  it("refuses simulated saved runs and creator evidence beyond the prepaid cap", async () => {
    const initial = order();
    const offlineDb = fakeDb(initial, savedRun({ paymentMode: "offline" }), []);
    await expect(
      repairA2aOrderFromSavedRun(
        offlineDb as never,
        initial,
        savedRun({ paymentMode: "offline" }),
        "operator-cli",
        now,
      ),
    ).rejects.toThrow("real treasury gateway");
    expect(offlineDb.resolveA2aOrder).not.toHaveBeenCalled();

    const overCap = fakeDb(initial, null, [payment("settled", 0.051)]);
    expect(
      (await inspectA2aOrder(overCap as never, initial.id, Date.parse(now))).evidence,
    ).toMatchObject({ settledCreatorMicros: 51_000 });
    await expect(closeReviewedA2aOrder(overCap as never, initial.id, now)).rejects.toThrow(
      "exceeds the prepaid creator cap",
    );
  });

  it("blocks close after any creator payment evidence or simulated integrity breach", async () => {
    for (const state of ["pending", "simulated"] as const) {
      const initial = order();
      const db = fakeDb(initial, null, [payment(state)]);
      await expect(closeReviewedA2aOrder(db as never, initial.id, now)).rejects.toThrow(
        state === "pending" ? "payment boundary was crossed" : "cannot be resolved with simulated",
      );
      expect(db.resolveA2aOrder).not.toHaveBeenCalled();
    }
  });

  it("closes a stale no-result job with fixed evidence-derived reason and no retry", async () => {
    const initial = order();
    const db = fakeDb(initial, null, []);
    const closed = await closeReviewedA2aOrder(db as never, initial.id, now);
    expect(closed).toMatchObject({
      status: "failed",
      errorCode: "operator_reviewed_no_result",
      resolution: {
        action: "close_failed",
        actor: "operator-cli",
        reason: "no_saved_run_before_execution_boundaries",
        evidence: {
          executionJournalVersion: 1,
          paymentBoundaryCrossed: false,
          resultSaveBoundaryCrossed: false,
          creatorAttempts: 0,
          queryRunFound: false,
        },
      },
    });
    expect(db.resolveA2aOrder).toHaveBeenCalledWith(
      initial.id,
      expect.objectContaining({
        status: "failed",
        startedBefore: "2026-09-01T11:45:00.000Z",
      }),
    );
  });

  it("refuses a recent job and a stale job that has a saved run", async () => {
    const recent = order({ startedAt: "2026-09-01T11:45:01.000Z" });
    await expect(closeReviewedA2aOrder(fakeDb(recent, null, []) as never, recent.id, now)).rejects.toThrow(
      "review_required",
    );
    const stale = order();
    await expect(
      closeReviewedA2aOrder(fakeDb(stale, savedRun(), []) as never, stale.id, now),
    ).rejects.toThrow("repair the result");
  });

  it("keeps historical and payment-started jobs under review", async () => {
    const historical = order({ executionJournalVersion: null });
    await expect(
      closeReviewedA2aOrder(fakeDb(historical, null, []) as never, historical.id, now),
    ).rejects.toThrow("lacks a complete creator-payment boundary journal");

    const started = order({ paymentStartedAt: "2026-09-01T11:45:00.000Z" });
    await expect(
      closeReviewedA2aOrder(fakeDb(started, null, []) as never, started.id, now),
    ).rejects.toThrow("payment boundary was crossed");

    const saving = order({ resultSavingAt: "2026-09-01T11:45:00.000Z" });
    await expect(
      closeReviewedA2aOrder(fakeDb(saving, null, []) as never, saving.id, now),
    ).rejects.toThrow("QueryRun persistence started");
  });

  it("does not repair a saved answer whose payment totals are missing from the ledger", async () => {
    const initial = order({ paymentStartedAt: "2026-09-01T11:45:00.000Z" });
    const db = fakeDb(initial, savedRun(), []);
    await expect(
      repairA2aOrderFromSavedRun(db as never, initial, savedRun(), "operator-cli", now),
    ).rejects.toThrow("does not match the durable payment ledger");
    expect(db.resolveA2aOrder).not.toHaveBeenCalled();
  });
});
