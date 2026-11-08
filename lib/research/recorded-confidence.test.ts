import { expect, it } from "vitest";
import { MAX_RECORDED_CONFIDENCE_REASON_CHARS, projectRecordedConfidence } from "./recorded-confidence";

it.each(["High", "Moderate", "Low"] as const)("copies only the recorded %s level and exact reason", level => {
  const original = Object.freeze({ level, reason: `Original café 🌍 reason <raw> [S1]\r\nSecond line.`, privateTicket: "PRIVATE", nested: { token: "PRIVATE" } });
  const projected = projectRecordedConfidence(original);
  expect(projected).toEqual({ level, reason: original.reason });
  expect(projected).not.toBe(original);
  expect(Object.keys(projected!).sort()).toEqual(["level", "reason"]);
  expect(original.privateTicket).toBe("PRIVATE");
});

it.each([undefined, null, [], "Low", 1, true, { level: "HIGH", reason: "unknown" }, { level: "Certain", reason: "unknown" },
  { level: "Moderate" }, { reason: "missing grade" }, { level: "Low", reason: null }, { level: "High", reason: {} },
])("does not invent a grade or explanation from malformed input %#", value => {
  expect(projectRecordedConfidence(value)).toBeUndefined();
});

it("retains an explicitly recorded empty explanation and the existing public text boundary without truncating", () => {
  expect(projectRecordedConfidence({ level: "Low", reason: "" })).toEqual({ level: "Low", reason: "" });
  const reason = "x".repeat(MAX_RECORDED_CONFIDENCE_REASON_CHARS);
  expect(projectRecordedConfidence({ level: "High", reason })).toEqual({ level: "High", reason });
  expect(projectRecordedConfidence({ level: "High", reason: reason + "x" })).toBeUndefined();
});
