import { describe, expect, it } from "vitest";
import { OPERATOR_REASON_TEXT } from "@/lib/business-operator/contracts";
import { createMessages, englishMessages, validateMessageCatalogue } from "@/lib/i18n/messages";
import { operationsMessages } from "@/locales/en/operations";

describe("English operating observations and assumptions", () => {
  it("registers the area catalogue without altering the source decision explanations", () => {
    expect(Object.isFrozen(operationsMessages)).toBe(true);
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    for (const [reason, explanation] of Object.entries(OPERATOR_REASON_TEXT)) {
      const name = reason.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join("");
      const key = `operatorBusiness.reason${name}` as keyof typeof operationsMessages;
      expect(operationsMessages[key]).toBe(explanation);
    }
  });

  it("retains singular and plural observed findings without turning unknown states into zero", () => {
    const message = createMessages("en");
    for (const count of [0, 1, 2]) {
      expect(message(count === 1 ? "statusRegistry.mismatch.one" : "statusRegistry.mismatch.other", { count, checkedAgo: "just now" }))
        .toBe(`${count} mismatch${count === 1 ? "" : "es"} · just now`);
      expect(message(count === 1 ? "statusSettlement.shortWallets.one" : "statusSettlement.shortWallets.other", { count }))
        .toBe(`${count} wallet${count === 1 ? "" : "s"}`);
      expect(message(count === 1 ? "statusDispatch.partial.one" : "statusDispatch.partial.other", { count }))
        .toBe(` · ${count} partial`);
      expect(message(count === 1 ? "statusDispatch.circuitSkips.one" : "statusDispatch.circuitSkips.other", { count }))
        .toBe(` · ${count} circuit skips`);
      expect(message(count === 1 ? "statusSettlement.unverified.one" : "statusSettlement.unverified.other", { count }))
        .toBe(` · ${count} unverified`);
      expect(message(count === 1 ? "statusReconciliation.terminalFailures.one" : "statusReconciliation.terminalFailures.other", { failed: "3", released: String(count) }))
        .toBe(`3 (${count} reservations released)`);
      expect(message(count === 1 ? "businessCalculator.unknownInputs.one" : "businessCalculator.unknownInputs.other", { basis: "Illustrative scenario", count }))
        .toBe(`Illustrative scenario · ${count} unknown inputs. These are two alternative views; do not add them together.`);
    }
    expect(message("operatorBusiness.unknown")).toBe("Unknown");
    expect(message("statusReconciliation.none")).toBe("none");
  });

  it("permits distinct future grammar and plain named data without activating a translation", () => {
    const message = createMessages("vi", {
      "statusRegistry.mismatch.one": "One finding ({count}); {checkedAgo}",
      "statusRegistry.mismatch.other": "Several findings ({count}); {checkedAgo}",
    });
    expect(message("statusRegistry.mismatch.one", { count: 1, checkedAgo: "<time>{count}" })).toBe("One finding (1); <time>{count}");
    expect(message("statusRegistry.mismatch.other", { count: 2, checkedAgo: "now" })).toBe("Several findings (2); now");
    expect(message("statusSettlement.shortWallets.one", { count: 1 })).toBe("1 wallet");
  });
});
