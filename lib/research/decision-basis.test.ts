import { describe, expect, it } from "vitest";
import type { Decision } from "../types";
import { parseDecisionBasis, withDecisionBasis, type DecisionRule } from "./decision-basis";

function decision(id: string, action: Decision["action"], expectedValue: number, price: number, extra: Partial<Decision> = {}): Decision {
  return { sourceId: id, assetId: `item:${id}`, sourceName: id, action, expectedValue, price, confidence: 0.5,
    rationale: `Reason for ${id}`, targets: [0], ...extra };
}
const rules: Record<string, DecisionRule> = { passed: "portfolio", weak: "model-skip", market: "external-only" };
const ruleFor = (row: Decision): DecisionRule => rules[row.sourceId] ?? (row.action === "CACHE" ? "cache-selected" : "selected");

describe("structured decision basis", () => {
  const ledger = [decision("first", "BUY", 0.9, 0.002), decision("cached", "CACHE", 0.7, 0.004),
    decision("second", "BUY", 0.6, 0.0015), decision("passed", "SKIP", 0.5, 0.003),
    decision("weak", "SKIP", 0.1, 0.001), decision("market", "SKIP", 0.95, 0.01, { external: true })];
  // 0.05 * 0.7 is 0.034999999999999996 in binary floating point; the cap is still 35,000 micro-USDC.
  const recorded = withDecisionBasis(ledger, { fetchBudgetUsdc: 0.05 * 0.7, ruleFor });

  it("records price, fetch budget left, rule and the considered alternative for every row", () => {
    expect(recorded.map(row => row.basis?.budgetLeftMicroUsdc)).toEqual(["35000", "33000", "33000", "31500", "31500", "31500"]);
    expect(recorded.every(row => row.basis?.fetchBudgetMicroUsdc === "35000")).toBe(true);
    expect(recorded.map(row => row.basis?.quotedPriceMicroUsdc)).toEqual(["2000", "4000", "1500", "3000", "1000", "10000"]);
    expect(recorded.map(row => row.basis?.rule)).toEqual(["selected", "cache-selected", "selected", "portfolio", "model-skip", "external-only"]);
    expect(recorded.map(row => row.basis?.plannedAction)).toEqual(ledger.map(row => row.action));
    // Selected reads name the best proposal the portfolio passed over; an external listing is never one.
    const passed = { assetId: "item:passed", sourceId: "passed", action: "SKIP", expectedValue: 0.5, quotedPriceMicroUsdc: "3000" };
    expect(recorded.slice(0, 3).map(row => row.basis?.alternative)).toEqual([passed, passed, passed]);
    // Unselected rows name the strongest read that was selected instead.
    const first = { assetId: "item:first", sourceId: "first", action: "BUY", expectedValue: 0.9, quotedPriceMicroUsdc: "2000" };
    expect(recorded.slice(3).map(row => row.basis?.alternative)).toEqual([first, first, first]);
    expect(recorded.every(row => parseDecisionBasis(row.basis) !== undefined)).toBe(true);
  });

  it("changes no action, price, order or rationale and leaves the input untouched", () => {
    expect(recorded.map(row => { const copy = { ...row }; delete copy.basis; return copy; })).toEqual(ledger);
    expect(ledger.every(row => !Object.hasOwn(row, "basis"))).toBe(true);
  });

  it("records unknown amounts instead of rounding or inventing budget", () => {
    const rows = withDecisionBasis([decision("odd", "BUY", 0.8, 0.0000015), decision("next", "BUY", 0.7, 0.001),
      decision("alone", "SKIP", 0.2, 0.001)], { fetchBudgetUsdc: 0.01, ruleFor });
    expect(rows[0].basis).toMatchObject({ quotedPriceMicroUsdc: null, budgetLeftMicroUsdc: "10000", alternative: null });
    expect(rows[1].basis?.budgetLeftMicroUsdc).toBeNull();
    expect(parseDecisionBasis(rows[1].basis)).toBeDefined();
    // A planned purchase above the remaining fetch budget cannot produce a negative or clamped balance.
    const over = withDecisionBasis([decision("big", "BUY", 0.8, 0.02), decision("after", "SKIP", 0.1, 0)], { fetchBudgetUsdc: 0.01, ruleFor });
    expect(over.map(row => row.basis?.budgetLeftMicroUsdc)).toEqual(["10000", null]);
    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(withDecisionBasis([decision("free", "CACHE", 0.5, 0)], { fetchBudgetUsdc: budget, ruleFor })[0].basis)
        .toMatchObject({ fetchBudgetMicroUsdc: "0", budgetLeftMicroUsdc: "0" });
    expect(withDecisionBasis([], { fetchBudgetUsdc: 0.05, ruleFor })).toEqual([]);
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, -0.001, 0.0000015]) {
      const unknown = withDecisionBasis([decision("odd", "BUY", 0.8, price), decision("later", "SKIP", 0.3, 0.001)],
        { fetchBudgetUsdc: 0.01, ruleFor });
      expect(unknown[0].basis).toMatchObject({ quotedPriceMicroUsdc: null, budgetLeftMicroUsdc: "10000" });
      expect(unknown[1].basis?.budgetLeftMicroUsdc).toBeNull();
      expect(parseDecisionBasis(unknown[1].basis)).toBeDefined();
    }
  });

  it("refuses open, malformed or inconsistent stored records", () => {
    const basis = recorded[0].basis!;
    expect(parseDecisionBasis(JSON.parse(JSON.stringify(basis)))).toEqual(basis);
    for (const bad of [undefined, null, [], "basis", { ...basis, extra: 1 }, { ...basis, version: 2 },
      { ...basis, rule: "model-says-so" }, { ...basis, plannedAction: "STOP" }, { ...basis, quotedPriceMicroUsdc: "1.5" },
      { ...basis, fetchBudgetMicroUsdc: "-1" }, { ...basis, budgetLeftMicroUsdc: "35001" },
      { ...basis, alternative: { ...basis.alternative, expectedValue: 2 } },
      { ...basis, alternative: { ...basis.alternative, wallet: "0x" } },
      Object.defineProperty({ ...basis }, "rule", { get: () => "selected", enumerable: true })])
      expect(parseDecisionBasis(bad)).toBeUndefined();
  });
});
