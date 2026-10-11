import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";

describe("funding presentation catalogue", () => {
  it("validates complete templates without reparsing wallet or request data", () => {
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    const copy = createMessages("en");
    expect(copy("gatewayFunding.gateway", { network: "Arc", gateway: "Literal {network} <tag>&" }))
      .toBe("Arc Gateway: Literal {network} <tag>&");
    expect(copy("researchEvidence.sourceOption.syntheticUnverified", { name: "Literal {name}" }))
      .toBe("Literal {name} ? synthetic demo — ownership unverified");
  });

  it("supports independent duration and remaining-request count arms", () => {
    const copy = createMessages("vi", {
      "monthlyResearch.expired.one": "One expired slot ({count})",
      "monthlyResearch.expired.other": "Several expired slots ({count})",
      "budgetFields.hours.one": "Single hour ({count})",
      "budgetFields.hours.other": "Several hours ({count})",
    });
    expect(copy("monthlyResearch.expired.one", { count: 1 })).toBe("One expired slot (1)");
    expect(copy("monthlyResearch.expired.other", { count: 0 })).toBe("Several expired slots (0)");
    expect(copy("budgetFields.hours.one", { count: 1 })).toBe("Single hour (1)");
    expect(copy("budgetFields.hours.other", { count: 24 })).toBe("Several hours (24)");
  });

  it("retains actionable retry nodes and escapes AI policy data in whole messages", () => {
    const rich = createRichMessages("en");
    expect(renderToStaticMarkup(createElement("p", null, rich("researchEvidence.previewFailed", {
      retryButton: createElement("button", { type: "button" }, "Retry preview"),
    })))).toBe('<p>Public preview unavailable. No content availability has been established. <button type="button">Retry preview</button></p>');
    expect(renderToStaticMarkup(createElement("p", null, rich("privateCheckout.aiPolicy", {
      provider: "Source <provider>", model: "Literal {provider}", endpoint: "https://fixture.invalid/?a=1&b=2", lineBreak: createElement("br"),
    })))).toContain('Source &lt;provider&gt; · Model: Literal {provider}<br/>Endpoint: https://fixture.invalid/?a=1&amp;b=2<br/>Fallback: local heuristic. Redirects are prohibited.');
  });
});
