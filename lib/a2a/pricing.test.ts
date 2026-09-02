import { describe, expect, it } from "vitest";
import { a2aReceiptEconomics, quoteA2aResearch } from "./pricing";

describe("A2A v2 pricing", () => {
  it("adds the fixed service fee to the exact creator-spend cap", () => {
    expect(quoteA2aResearch(0.05, "quick")).toMatchObject({
      researchPackage: { id: "keryx-quick", version: "1.0.0" },
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.02,
      totalPriceUsdc: 0.07,
    });
    expect(quoteA2aResearch(0.05, "deep")).toMatchObject({
      researchPackage: { id: "keryx-deep", version: "1.0.0" },
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      totalPriceUsdc: 0.1,
    });
  });

  it("clamps hostile/invalid budgets and rounds in integer micro-USDC", () => {
    expect(quoteA2aResearch(99, "deep").creatorBudgetUsdc).toBe(0.5);
    expect(quoteA2aResearch(Number.NaN, "quick").creatorBudgetUsdc).toBe(0.05);
    expect(quoteA2aResearch(0.0000004, "quick").creatorBudgetUsdc).toBe(0.000001);
  });

  it("itemizes actual creator spend without presenting unused reserve as payout", () => {
    const quote = quoteA2aResearch(0.05, "deep");
    expect(a2aReceiptEconomics(quote, 0.031234, 0.005)).toMatchObject({
      settledCreatorSpendUsdc: 0.031234,
      pendingCreatorSpendUsdc: 0.005,
      unusedCreatorReserveUsdc: 0.013766,
      refundable: false,
    });
  });

  it("fails closed if downstream accounting ever exceeds the prepaid cap", () => {
    const quote = quoteA2aResearch(0.05, "deep");
    expect(() => a2aReceiptEconomics(quote, 0.050001)).toThrow(/exceeded/);
    expect(() => a2aReceiptEconomics(quote, 0.04, 0.010001)).toThrow(/exceeded/);
    expect(() => a2aReceiptEconomics(quote, Number.NaN)).toThrow(/exceeded/);
  });
});
