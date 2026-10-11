import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "../../lib/i18n/messages";
import { nativeDesktopMessages } from "../../locales/en/native-desktop";

describe("native Desktop English source catalogue", () => {
  const message = createMessages("en");

  it("registers every native key with the shared validated catalogue", () => {
    expect(validateMessageCatalogue(englishMessages).invalid).toEqual([]);
    for (const [key, text] of Object.entries(nativeDesktopMessages)) {
      expect(englishMessages[key as keyof typeof nativeDesktopMessages]).toBe(text);
    }
  });

  it("preserves original count grammar through whole-message plural arms", () => {
    for (const count of [0, 1, 2]) {
      expect(message(count === 1 ? "nativeDesktop.workspace.taskCount.one" : "nativeDesktop.workspace.taskCount.other", { count }))
        .toBe(`${count} research tasks`);
      expect(message(count === 1 ? "nativeDesktop.workspace.unrecognized.one" : "nativeDesktop.workspace.unrecognized.other", { count }))
        .toBe(`${count} folder${count === 1 ? "" : "s"} could not be recognized as valid Operator tasks and were left untouched.`);
    }
  });

  it("keeps recovery paths and diagnostics as one-pass parameters", () => {
    const path = "C:\\private\\{reason} <task>\\request";
    expect(message("nativeDesktop.task.createdRefreshFailed", { path }))
      .toBe(`Task was created, but the workspace view could not be refreshed. Keep that folder and inspect it before retrying: ${path}`);
    expect(message("nativeDesktop.savedResult.openFailed", { reason: "<unavailable>{path}" }))
      .toBe("Saved result cannot be opened: <unavailable>{path}");
  });

  it("retains the preparation, seller-report and offline settlement boundaries", () => {
    expect(message("nativeDesktop.task.prepareBoundary")).toBe("Save a question and spending boundary. Creating a task does not make a purchase.");
    expect(message("nativeDesktop.task.sellerReportedBoundary")).toBe("Payment details are reported by the seller. Check again for the latest delivery state.");
    expect(message("nativeDesktop.savedResult.verification", { date: "observed time" }))
      .toBe("Saved observed time. Local receipt and original task binding checked. The original server response and settlement cannot be independently rechecked offline.");
  });
});
