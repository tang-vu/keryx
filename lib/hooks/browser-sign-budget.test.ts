import { describe, expect, it } from "vitest";
import { BrowserSignBudget } from "./browser-sign-budget";

describe("browser sign cap reservation", () => {
  it("blocks a concurrent SSE request while the first awaits authority checks", async () => {
    const budget = new BrowserSignBudget(0.1);
    let continueFirst!: () => void;
    const firstCheck = new Promise<void>((resolve) => { continueFirst = resolve; });
    const first = budget.reserve("60000");
    expect(first).not.toBeNull();
    const firstRequest = (async () => {
      await firstCheck;
      first!.markSigningStarted();
      first!.releaseBeforeSigning(); // POST failure cannot refund possible signature.
    })();

    expect(budget.reserve("60000")).toBeNull();
    continueFirst();
    await firstRequest;
    expect(budget.reserve("40000")).not.toBeNull();
    expect(budget.reserve("1")).toBeNull();
  });

  it("releases a failed pre-sign reservation once, then admits only available capacity", () => {
    const budget = new BrowserSignBudget(0.1);
    const first = budget.reserve("60000")!;
    expect(budget.reserve("60000")).toBeNull();
    first.releaseBeforeSigning();
    first.releaseBeforeSigning();
    const second = budget.reserve("60000")!;
    second.markSigningStarted();
    second.releaseBeforeSigning();
    expect(budget.reserve("40001")).toBeNull();
  });

  it("uses integer micros and floors cap precision instead of allowing rounding slack", () => {
    const budget = new BrowserSignBudget(0.0000019);
    expect(budget.reserve("2")).toBeNull();
    expect(budget.reserve("1")).not.toBeNull();
    expect(budget.reserve("1")).toBeNull();
  });

  it.each([undefined, 0, NaN, Infinity])("refuses an unavailable cap %s", (cap) => {
    expect(new BrowserSignBudget(cap).reserve("1")).toBeNull();
  });

  it.each(["0", "-1", "1.5", "1e3", "01", " 1", "9007199254740993.0"])(
    "refuses malformed atomic amount %s", (amount) => {
      expect(new BrowserSignBudget(0.1).reserve(amount)).toBeNull();
    },
  );

  it("rejects oversized challenge amounts before BigInt parsing", () => {
    expect(new BrowserSignBudget(0.1).reserve("9".repeat(1000))).toBeNull();
  });
});
