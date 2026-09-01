import { describe, expect, it } from "vitest";
import { a2aOrderId, a2aRequestHash, sameA2aOrder, type A2aOrder } from "./order";

const base = {
  network: "eip155:5042002",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  authorizationId: "0xnonce",
};

describe("A2A authorization identity", () => {
  it("is deterministic but scopes the nonce to payer, payee, and network", () => {
    expect(a2aOrderId(base)).toBe(a2aOrderId(base));
    expect(a2aOrderId(base)).not.toBe(
      a2aOrderId({ ...base, payer: "0x3333333333333333333333333333333333333333" }),
    );
  });

  it("rejects a replay whose transaction or economic tuple changes", () => {
    const order: A2aOrder = {
      id: "a2a_id",
      queryId: "a2a_id",
      authorizationId: base.authorizationId,
      requestHash: "request-hash",
      payer: base.payer,
      payee: base.payee,
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      status: "running",
      transaction: "circle-1",
      request: { question: "private question", origin: "a2a" },
      startedAt: null,
      workerId: null,
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: null,
      resolution: null,
      createdAt: "now",
      updatedAt: "now",
    };
    expect(sameA2aOrder(order, { ...order, status: "completed" })).toBe(true);
    expect(sameA2aOrder(order, { ...order, transaction: "circle-2" })).toBe(false);
    expect(sameA2aOrder(order, { ...order, creatorBudgetUsdc: 0.04 })).toBe(false);
    expect(sameA2aOrder(order, { ...order, requestHash: "different" })).toBe(false);
  });

  it("binds canonical request semantics without leaking the question into its identifier", () => {
    const input = {
      question: "private question",
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep" as const,
      model: "deepseek-flash",
    };
    const hash = a2aRequestHash(input);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(input.question);
    expect(hash).not.toBe(a2aRequestHash({ ...input, question: "different" }));
  });
});
