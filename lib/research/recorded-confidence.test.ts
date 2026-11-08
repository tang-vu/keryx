import { expect, it } from "vitest";
import { MAX_RECORDED_CONFIDENCE_REASON_CHARS, projectRecordedConfidence, projectRunConfidence } from "./recorded-confidence";
import { deriveConfidence } from "../agent/confidence";
import { presentationRun } from "./presentation.test-fixture";
import { validatePrivacyRun } from "../run-privacy/contracts";

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

const id = "eaf71ac0-cbf3-4c6d-b691-0c45ffcb6ba1";
const oldVerdict = { phase: "verdict", ts: 1, message: "Older grade", detail: { level: "High", reason: "Older grade" } };
function recorded(confidence: unknown, trace: unknown[]) {
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id, confidence, trace })), id);
}

it.each([undefined, null, 42, false, [], { privateNote: "PRIVATE" }, { toString: null }].map(reason => ({ reason })))(
  "keeps the strict public omission for a recognized malformed stored reason %#", ({ reason }) => {
    const run = recorded({ level: "Moderate", reason }, [oldVerdict]), before = JSON.stringify(run);
    expect(projectRunConfidence(run)).toBeUndefined();
    expect(JSON.stringify(run)).toBe(before);
  },
);

it.each([
  { reason: undefined, legacy: "", publicReason: "" }, { reason: null, legacy: "", publicReason: "" },
  { reason: 42, legacy: "42", publicReason: undefined }, { reason: false, legacy: "false", publicReason: undefined },
  { reason: [], legacy: "", publicReason: undefined }, { reason: ["old", "reason"], legacy: "old,reason", publicReason: undefined },
  { reason: { legacy: true }, legacy: "[object Object]", publicReason: undefined },
])("retains the separate legacy trace and strict public explanation contracts %#", ({ reason, legacy, publicReason }) => {
  const run = recorded(undefined, [oldVerdict, { phase: "verdict", ts: 2, message: "Later grade", detail: { level: "Low", reason } }]);
  const before = JSON.stringify(run);
  expect(deriveConfidence(run)).toEqual({ level: "Low", reason: legacy });
  expect(projectRunConfidence(run)).toEqual(publicReason === undefined ? undefined : { level: "Low", reason: publicReason });
  expect(JSON.stringify(run)).toBe(before);
});

it("retains fallback past an unrecognized field or later unrecognized trace level", () => {
  const run = recorded({ level: "Future", reason: "Unsupported" }, [oldVerdict, { phase: "verdict", ts: 2, detail: { level: "Future" } }]);
  expect(projectRunConfidence(run)).toEqual({ level: "High", reason: "Older grade" });
});
