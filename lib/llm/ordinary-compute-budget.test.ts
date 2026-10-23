import { describe, expect, it } from "vitest";
import { OrdinaryComputeBudget, OrdinaryComputeLimitError, bindOrdinaryComputeBudget,
  admitOrdinaryCompute, ordinaryComputeSnapshot } from "./ordinary-compute-budget";

describe("ordinary per-run compute admission", () => {
  it("counts UTF-8 content and the requested output allowance, including review stages", () => {
    const budget = new OrdinaryComputeBudget({ calls: 2, promptUtf8Bytes: 7, requestedOutputTokens: 5 });
    budget.admit("synthesize", "é", "🙂", 3);
    budget.admit("evidence-review", "", "x", 2);
    expect(budget.snapshot().admitted).toEqual({ calls: 2, promptUtf8Bytes: 7, requestedOutputTokens: 5 });
    expect(() => budget.admit("attribute", "", "", 1)).toThrow(OrdinaryComputeLimitError);
  });

  it.each([
    ["calls", { calls: 1, promptUtf8Bytes: 20, requestedOutputTokens: 20 }, "", "", 1],
    ["promptUtf8Bytes", { calls: 20, promptUtf8Bytes: 1, requestedOutputTokens: 20 }, "é", "", 1],
    ["requestedOutputTokens", { calls: 20, promptUtf8Bytes: 20, requestedOutputTokens: 1 }, "", "", 2],
  ] as const)("refuses %s without partially consuming another dimension", (limit, limits, system, user, tokens) => {
    const budget = new OrdinaryComputeBudget(limits);
    if (limit === "calls") budget.admit("decide", "", "", 1);
    const before = budget.snapshot();
    expect(() => budget.admit("sufficiency", system, user, tokens)).toThrow(OrdinaryComputeLimitError);
    try { budget.admit("sufficiency", system, user, tokens); }
    catch (error) { expect(error).toMatchObject({ limit }); }
    expect(budget.snapshot()).toEqual(before);
  });

  it("shares admission across providers and keeps independent runs and snapshots isolated", () => {
    const first = {}, second = {}, independent = {};
    const budget = new OrdinaryComputeBudget({ calls: 1, promptUtf8Bytes: 100, requestedOutputTokens: 10 });
    bindOrdinaryComputeBudget(first, budget);
    bindOrdinaryComputeBudget(second, budget);
    bindOrdinaryComputeBudget(independent, new OrdinaryComputeBudget());
    admitOrdinaryCompute(first, "decide", "system", "question", 3);
    const snapshot = ordinaryComputeSnapshot(first)!;
    Object.assign(snapshot.limits, { calls: 99 });
    Object.assign(snapshot.admitted, { calls: 0 });
    expect(() => admitOrdinaryCompute(second, "sufficiency", "", "", 1)).toThrow(OrdinaryComputeLimitError);
    expect(() => admitOrdinaryCompute(independent, "sufficiency", "", "", 1)).not.toThrow();
    expect(ordinaryComputeSnapshot(first)!.admitted.calls).toBe(1);
    expect(() => bindOrdinaryComputeBudget(first, new OrdinaryComputeBudget())).toThrow("already bound");
    expect(() => bindOrdinaryComputeBudget({}, JSON.parse(JSON.stringify(budget)))).toThrow(TypeError);
  });

  it("leaves direct fixed-model originals unbound", () => {
    const original = {};
    for (let i = 0; i < 40; i++) admitOrdinaryCompute(original, "sufficiency", "", "", 2048);
    expect(ordinaryComputeSnapshot(original)).toBeUndefined();
  });

  it("refuses malformed requests and unsafe limit arithmetic", () => {
    for (const calls of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new OrdinaryComputeBudget({ calls, promptUtf8Bytes: 10, requestedOutputTokens: 10 })).toThrow(RangeError);
    }
    const budget = new OrdinaryComputeBudget();
    for (const tokens of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => budget.admit("decide", "", "", tokens)).toThrow(RangeError);
    }
    expect(budget.snapshot().admitted.calls).toBe(0);
  });
});
