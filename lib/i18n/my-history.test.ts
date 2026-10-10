import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";

describe("English personal dispatch ledger messages", () => {
  it("retains observed count wording in both grammar arms without changing data", () => {
    const message = createMessages("en");
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    for (const count of [0, 1, 2]) {
      expect(message(count === 1 ? "myHistory.dispatchLabel.one" : "myHistory.dispatchLabel.other"))
        .toBe("dispatches");
      expect(message(count === 1 ? "myHistory.citationsLabel.one" : "myHistory.citationsLabel.other"))
        .toBe("citations paid");
      expect(message(count === 1 ? "myHistory.cited.one" : "myHistory.cited.other", { count }))
        .toBe(`${count} cited`);
      expect(message(count === 1 ? "myHistory.recentLimit.one" : "myHistory.recentLimit.other", { count }))
        .toBe(`Showing your most recent ${count} dispatches.`);
    }
    expect(message("myHistory.minutesAgo", { minutes: 59 })).toBe("59m ago");
    expect(message("myHistory.hoursAgo", { hours: 23 })).toBe("23h ago");
    expect(message("myHistory.daysAgo", { days: Number.NaN })).toBe("NaNd ago");
  });

  it("keeps recorded funding cautions whole and never reinterprets inserted data", () => {
    const rich = createRichMessages("en");
    expect(renderToStaticMarkup(createElement("p", null, rich("myHistory.otherFunding.one", {
      count: 1, fundingGap: " ", amount: "0.5", separateGap: " ",
    })))).toBe("<p>1 of these have no recorded browser-wallet creator funding: $0.5 recorded to creators. Original purchases, service fees and gas are separate.</p>");
    expect(renderToStaticMarkup(createElement("span", null,
      rich("myHistory.confidence", { level: "<recorded>{count}" }))))
      .toBe("<span>&lt;recorded&gt;{count} confidence</span>");
    expect(renderToStaticMarkup(createElement("span", null,
      rich("myHistory.cited.other", { count: null })))).toBe("<span> cited</span>");
  });

  it("supports distinct future plural grammar while preserving English fallback", () => {
    const message = createMessages("vi", {
      "myHistory.recentLimit.one": "One retained dispatch ({count}).",
      "myHistory.recentLimit.other": "Several retained dispatches ({count}).",
    });
    expect(message("myHistory.recentLimit.one", { count: 1 })).toBe("One retained dispatch (1).");
    expect(message("myHistory.recentLimit.other", { count: 2 })).toBe("Several retained dispatches (2).");
    expect(message("myHistory.loadFailed")).toBe("Couldn't load your dispatches — try again.");
  });
});
