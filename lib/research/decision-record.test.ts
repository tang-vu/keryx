import { describe, expect, it } from "vitest";
import { isDecisionRecord } from "./decision-record";
import type { Decision } from "../types";

const choice: Decision = { sourceId: "source-1", sourceName: "Source", action: "BUY",
  expectedValue: 0.8, confidence: 0.7, price: 0.01, rationale: "Useful passage", targets: [0] };

describe("decision trace display shape", () => {
  it.each(["BUY", "CACHE", "SKIP"] as const)("retains real %s choices", action => {
    expect(isDecisionRecord({ ...choice, action, ...(action === "SKIP" ? { targets: [], selectionRefusal: "missing_targets" } : {}) })).toBe(true);
  });
  it("preserves the canonical empty-rationale compatibility", () => {
    expect(isDecisionRecord({ ...choice, rationale: "" })).toBe(true);
  });
  it.each([
    undefined, null, [], { action: "BUY" }, { ...choice, protocol: "keryx-source-selection-v1" },
    { ...choice, expectedValue: NaN }, { ...choice, expectedValue: "0.8" }, { ...choice, confidence: Infinity },
    { ...choice, price: -1 }, { ...choice, targets: [-1] }, { ...choice, targets: [0.5] }, { ...choice, external: "true" },
  ])("withholds malformed or diagnostic records without a fabricated decision", value => {
    expect(isDecisionRecord(value)).toBe(false);
  });
  it("does not execute accessors on unknown details", () => {
    let called = false;
    const value = { ...choice, get sourceName() { called = true; throw new Error("Accessor"); } };
    expect(isDecisionRecord(value)).toBe(false); expect(called).toBe(false);
  });
});
