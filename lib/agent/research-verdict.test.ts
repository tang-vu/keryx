import { expect, it } from "vitest";
import { researchVerdict } from "./research-verdict";
const base = { coverage: [{ claimIndex: 0, claim: "Which retention period applies?", coverage: 1, coveredBy: ["S1", "S2"] }],
  citedMarkers: ["S1", "S2"], sourceMarkers: ["S1", "S2"] };
const conflict = { point: "retention", positions: [{ marker: "S1", stance: "seven days" }, { marker: "S2", stance: "thirty days" }],
  trusted: "none", reason: "No precedence rule" };
it("does not promote an unresolved conflict with perfect coverage and two citations", () => {
  for (const trusted of ["none", "", "S99"]) expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted }] })).toMatchObject({ level: "Low", reason: expect.stringContaining("unresolved") });
});
it("requires supported source identity and an explanation, and caps explained preferences at Moderate", () => {
  expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted: "S1" }] }).level).toBe("Moderate");
  for (const delta of [{ reason: "" }, { positions: [{ marker: "S1", stance: "seven" }, { marker: "S99", stance: "thirty" }] }]) {
    expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted: "S1", ...delta }] }).level).toBe("Low");
  }
  expect(researchVerdict({ ...base, citedMarkers: ["S2"], conflicts: [{ ...conflict, trusted: "S1" }] }).level).toBe("Low");
});
it("retains strong corroborated, weak and absent evidence verdicts without conflicts", () => {
  expect(researchVerdict({ ...base, conflicts: [] }).level).toBe("High");
  expect(researchVerdict({ ...base, conflicts: [], citedMarkers: ["S1"] }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], coverage: [{ ...base.coverage[0], coverage: 0.1 }] }).level).toBe("Low");
  expect(researchVerdict({ ...base, conflicts: [], citedMarkers: [] }).level).toBe("Low");
});
