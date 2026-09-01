import { describe, expect, it, vi } from "vitest";
import { a2aRequestHash, type A2aOrder } from "./order";
import { runClaimedA2aOrder } from "./run-order";

function claimedOrder(): A2aOrder {
  const request = { question: "What changed?", origin: "a2a" as const, model: "test-model" };
  return {
    id: "a2a_claimed",
    queryId: "a2a_claimed",
    authorizationId: "0xnonce",
    requestHash: a2aRequestHash({
      question: request.question,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      model: request.model,
    }),
    payer: "0x1111111111111111111111111111111111111111",
    payee: "0x2222222222222222222222222222222222222222",
    amountUsdc: 0.1,
    creatorBudgetUsdc: 0.05,
    serviceFeeUsdc: 0.05,
    researchMode: "deep",
    status: "running",
    transaction: "circle-transfer",
    request,
    startedAt: "2026-09-01T00:00:00.000Z",
    workerId: "worker",
    executionJournalVersion: 1,
    paymentStartedAt: null,
    resultSavingAt: null,
    response: null,
    errorCode: null,
    resolution: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("durable A2A worker", () => {
  it("revalidates the paid request and completes a real treasury run", async () => {
    let current = claimedOrder();
    const db = {
      completeA2aOrder: vi.fn().mockResolvedValue(true),
      getA2aOrder: vi.fn(async () => current),
      failA2aOrder: vi.fn().mockResolvedValue(true),
      markA2aOrderPaymentStarted: vi.fn(async (_id, at) => {
        current = { ...current, paymentStartedAt: at };
        return true;
      }),
      markA2aOrderResultSaving: vi.fn(async (_id, at) => {
        current = { ...current, resultSavingAt: at };
        return true;
      }),
      listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([]),
    };
    const collector = vi.fn(async (input) => {
      await input.onCreatorPaymentBoundary?.();
      await input.onQueryRunSaveBoundary?.();
      return {
        id: input.queryId!,
        answer: "answer",
        citations: [],
        evidence: [],
        claimCoverage: [],
        totalToCreators: 0,
        engine: "heuristic",
        paymentMode: "real" as const,
      };
    });

    const outcome = await runClaimedA2aOrder(db as never, claimedOrder(), {
      collector: collector as never,
      expectedPayee: "0x2222222222222222222222222222222222222222",
    });

    expect(outcome).toEqual({ id: "a2a_claimed", status: "completed" });
    expect(collector).toHaveBeenCalledWith(
      expect.objectContaining({ fundingOwner: "treasury", budget: 0.05, question: "What changed?" }),
    );
    expect(db.completeA2aOrder).toHaveBeenCalledOnce();
    expect(db.markA2aOrderPaymentStarted).toHaveBeenCalledOnce();
    expect(db.markA2aOrderResultSaving).toHaveBeenCalledOnce();
    expect(db.failA2aOrder).not.toHaveBeenCalled();
  });

  it("fails before creator spend when private input no longer matches its request hash", async () => {
    const db = {
      completeA2aOrder: vi.fn(),
      getA2aOrder: vi.fn(),
      failA2aOrder: vi.fn().mockResolvedValue(true),
    };
    const collector = vi.fn();
    const order = claimedOrder();
    order.request = { ...order.request!, question: "tampered" };

    const outcome = await runClaimedA2aOrder(db as never, order, { collector });

    expect(outcome).toEqual({
      id: "a2a_claimed",
      status: "failed",
      errorCode: "invalid_order_data",
    });
    expect(collector).not.toHaveBeenCalled();
    expect(db.failA2aOrder).toHaveBeenCalledWith(
      order.id,
      "invalid_order_data",
      expect.any(String),
    );
  });

  it("fails before creator spend when the stored package no longer adds up exactly", async () => {
    const db = {
      completeA2aOrder: vi.fn(),
      getA2aOrder: vi.fn(),
      failA2aOrder: vi.fn().mockResolvedValue(true),
    };
    const collector = vi.fn();
    const order = { ...claimedOrder(), amountUsdc: 0.11 };

    const outcome = await runClaimedA2aOrder(db as never, order, { collector });

    expect(outcome).toMatchObject({ status: "failed", errorCode: "invalid_order_data" });
    expect(collector).not.toHaveBeenCalled();
  });

  it("leaves a saved paid run repairable when the final order completion write fails", async () => {
    const db = {
      completeA2aOrder: vi.fn().mockRejectedValue(new Error("database timeout")),
      getA2aOrder: vi.fn().mockRejectedValue(new Error("database timeout")),
      failA2aOrder: vi.fn().mockResolvedValue(true),
    };
    const collector = vi.fn(async (input) => ({
      id: input.queryId!,
      answer: "durable answer",
      citations: [],
      evidence: [],
      claimCoverage: [],
      totalToCreators: 0.02,
      engine: "heuristic",
      paymentMode: "real" as const,
    }));

    const outcome = await runClaimedA2aOrder(db as never, claimedOrder(), {
      collector: collector as never,
    });

    expect(outcome).toEqual({ id: "a2a_claimed", status: "recovery_pending" });
    expect(db.failA2aOrder).not.toHaveBeenCalled();
  });
});
