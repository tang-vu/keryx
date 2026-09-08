import { describe, expect, it } from "vitest";
import { readBuyerDecisions } from "./buyer-decisions";

const id = `a2a_${"a".repeat(64)}`;
const decision = { sourceName: "Engineering", action: "BUY", rationale: "Contains recovery steps", priceUsdc: 0.002, targets: [0] };
const receipt = (decisions: unknown = [decision]) => ({ payload: {
  schema: "urn:keryx:research-receipt:1", dispatch: { id, answer: "Answer" }, agency: { decisions },
} });

describe("buyer decision display boundary", () => {
  it("keeps recorded actions without inferring a completed payment", () => {
    const rows = ["BUY", "SKIP", "CACHE"].map(action => ({ ...decision, action, secret: "must not project" }));
    expect(readBuyerDecisions(receipt(rows), id, "Answer")).toEqual(rows.map(({ secret: _secret, ...row }) => row));
    expect(readBuyerDecisions(receipt([]), id, "Answer")).toEqual([]);
  });
  it("refuses receipts for another job or answer", () => {
    expect(() => readBuyerDecisions(receipt(), `a2a_${"b".repeat(64)}`, "Answer")).toThrow();
    expect(() => readBuyerDecisions(receipt(), id, "Changed")).toThrow();
  });
  it.each([{ action: "SETTLED" }, { priceUsdc: -1 }, { targets: [-1] }, { targets: [0.5] }])("rejects malformed display data %j", patch => {
    expect(() => readBuyerDecisions(receipt([{ ...decision, ...patch }]), id, "Answer")).toThrow();
  });
});
