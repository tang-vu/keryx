import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";
import { shellMessages } from "@/locales/en/shell";

describe("English shell and retained observation copy", () => {
  it("retains payment evidence wording and named transaction tooltip data", () => {
    const message = createMessages("en");
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    expect(message("cashouts.onchain")).toBe("on-chain");
    expect(message("cashouts.viewMint", { amount: "0.125", recipient: "<recipient>{amount}" }))
      .toBe("View the on-chain mint tx for $0.125 → <recipient>{amount}");
    expect(message("shellFooter.copyright", { year: 2026 }))
      .toBe("© 2026 Keryx — legal tender for attention");
  });

  it("keeps rich source words, links and recorded network labels escaped as data", () => {
    const rich = createRichMessages("en");
    const etymology = rich("shellFooter.etymology", {
      gap: " ", word: createElement("span", { className: "italic text-ink" }, "κῆρυξ"),
    });
    expect(renderToStaticMarkup(createElement("p", null, etymology)))
      .toBe('<p>From the Greek <span class="italic text-ink">κῆρυξ</span> — a herald: the one sent to carry a message, and paid for the carrying.</p>');
    expect(renderToStaticMarkup(createElement("p", null,
      rich("shellFooter.originalEvidence", { network: "<original>{network}" }))))
      .toBe("<p>&lt;original&gt;{network} · inspect original settlement evidence</p>");
  });

  it("preserves ordinary English fallback and the finite manual history action", () => {
    const message = createMessages("vi", {});
    expect(message("shellHeader.openMenu")).toBe("Open menu");
    expect(message("historyObservation.openHistory")).toBe("Open history to retry.");
    expect(shellMessages["historyObservation.unavailable"])
      .toBe("Historical evidence is temporarily unavailable. {link}");
  });
});
