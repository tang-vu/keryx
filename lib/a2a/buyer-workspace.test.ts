import { describe, expect, it } from "vitest";
import { a2aQueryIdSchema, buyerJobSchema, parseBuyerBudget, shouldPollBuyerJob } from "./buyer-workspace";

const queryId = `a2a_${"a".repeat(64)}`;
describe("buyer workspace boundaries", () => {
  it("accepts exact micro-USDC caps without silently changing invalid requests", () => {
    expect(parseBuyerBudget("0.000001", 0.5)).toBe(0.000001);
    expect(parseBuyerBudget("0.5", 0.5)).toBe(0.5);
    for (const value of ["0", "-1", "0.500001", "0.0000001", "1e-2", "Infinity", "", "0x1", "1,0"]) {
      expect(parseBuyerBudget(value, 0.5)).toBeNull();
    }
  });
  it("only accepts opaque job IDs, never a user-supplied polling URL", () => {
    expect(a2aQueryIdSchema.safeParse(queryId).success).toBe(true);
    for (const value of ["a2a_short", `https://evil.example/${queryId}`, `${queryId}&bot=secret`, ` ${queryId}`]) {
      expect(a2aQueryIdSchema.safeParse(value).success).toBe(false);
    }
  });
  it("stops automatic refresh for review and terminal outcomes", () => {
    expect(shouldPollBuyerJob("queued")).toBe(true);
    expect(shouldPollBuyerJob("processing")).toBe(true);
    for (const status of ["review_required", "completed", "failed"] as const) expect(shouldPollBuyerJob(status)).toBe(false);
  });
  it("preserves unknown reserve and historical measurements instead of making them zero", () => {
    const parsed = buyerJobSchema.parse({ queryId, status: "failed", pricing: {
      totalPriceUsdc: 0.1, serviceFeeUsdc: 0.05, creatorBudgetUsdc: 0.05,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.02,
      unusedCreatorReserveUsdc: null, accountingComplete: false,
    } });
    expect(parsed.pricing?.unusedCreatorReserveUsdc).toBeNull();
    expect(parsed.serviceReceipt).toBeUndefined();
    expect(parsed.pricing?.pendingCreatorSpendUsdc).toBe(0.02);
    expect(buyerJobSchema.parse({ queryId, status: "queued" }).pricing).toBeUndefined();
  });
  it("rejects impossible monetary and quality values", () => {
    expect(buyerJobSchema.safeParse({ queryId, status: "completed", serviceReceipt: {
      totalDurationMs: 100, targetCompletionMs: 100, targetMet: true,
      quality: { status: "measured", groundedClaimRate: 1.5 },
    } }).success).toBe(false);
    expect(buyerJobSchema.safeParse({ queryId, status: "completed", pricing: {
      totalPriceUsdc: 0.1, serviceFeeUsdc: 0.05, creatorBudgetUsdc: 0.05,
      settledCreatorSpendUsdc: -1, pendingCreatorSpendUsdc: 0, unusedCreatorReserveUsdc: 0,
    } }).success).toBe(false);
  });
});
