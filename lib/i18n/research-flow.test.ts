import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("research presentation catalogue boundaries", () => {
  it("admits the complete English catalogue and keeps data out of template parsing", () => {
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    const message = createMessages("en");
    expect(message("researchTurn.label", { question: "Literal {question} <tag>&" }))
      .toBe("Research: Literal {question} <tag>&");
    expect(message("creatorPayments.operatingPaymentWithReference", {
      amount: "0.000001", state: "pending", reference: "recorded {amount}",
    })).toBe("$0.000001 USDC · pending · Circle reference recorded {amount}");
  });

  it("resolves independent count arms without turning pending records into settled spend", () => {
    const message = createMessages("vi", {
      "creatorPayments.pendingTotal.one": "One pending ({count}); confirmed total",
      "creatorPayments.pendingTotal.other": "Several pending ({count}); confirmed total",
    });
    expect(message("creatorPayments.pendingTotal.one", { count: 1 })).toBe("One pending (1); confirmed total");
    expect(message("creatorPayments.pendingTotal.other", { count: 2 })).toBe("Several pending (2); confirmed total");
    expect(message("creatorPayments.failedTotal.other", { count: 2 })).toBe("2 failed · not charged");
  });

  it("keeps the embed retry link and source emphasis as escaped React nodes in whole sentences", () => {
    const rich = createRichMessages("en");
    expect(renderToStaticMarkup(createElement("p", null, rich("embedResearch.retryAfter", {
      seconds: 5, continueLink: createElement("a", { href: "/" }, "Keep going"),
    })))).toBe('<p>Try again in 5s — or <a href="/">Keep going</a>.</p>');
    expect(renderToStaticMarkup(createElement("p", null, rich("embedResearch.sourceDesk", {
      source: createElement("strong", null, "Literal {source} <tag>&"),
    })))).toBe('<p>You’re asking from <strong>Literal {source} &lt;tag&gt;&amp;</strong>’s desk — if the herald cites them, they’re paid for it, instantly.</p>');
  });
});
