import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceProcurementWorkspace } from "../components/keryx/evidence-procurement-workspace";
import { evidenceProcurementCopy as copy, evidenceProcurementCopyText as copyText } from "../lib/evidence-procurement/copy";

describe("private evidence procurement presentation", () => {
  it("starts with usable request fields, plaintext export notice and honest proposal boundaries", () => {
    const html = renderToStaticMarkup(createElement(EvidenceProcurementWorkspace));
    expect(html).toContain("What decision are you trying to make?");
    expect(html).toContain("Evidence question 1");
    expect(html).toContain("Prepare evidence request");
    expect(html).toContain("Work stays in this tab&#x27;s memory and is lost on reload");
    expect(html).toContain("private plaintext files");
    expect(html).toContain("No provider is contacted, benchmark executed, purchase made or creator rewarded");
    expect(html).toContain("Signatures authenticate supplied offers and deliveries, not source ownership");
    expect(html).not.toContain("Sign offer message");
    expect(html).not.toContain("Quotation comparison");
    expect(copyText(copy.templates.question, { number: 1 })).toBe("Evidence question 1");
    expect(copyText(copy.workspace.quotationOfferId, { offerId: "offer1" })).toBe("Quotation offer1");
    expect(copyText(copy.templates.reviewNote, { id: "offer1" })).toBe("Review note for offer1");
    expect(copyText(copy.templates.reviewDeclaration, { requirement: "requirement1", stance: copy.reviewStances.refutes }))
      .toBe("I reviewed requirement1 as useful refuting evidence");
    expect(copyText(copy.templates.budgetSummary, { planned: "0.030000 USDC", remaining: "0.020000 USDC" }))
      .toBe("Planned quote total: 0.030000 USDC · remaining: 0.020000 USDC");
    expect(copy.workspace.deliveryForQuotation).toBe("Delivery for quotation");
    expect(copy.workspace.suppliedDeliveryText).toBe("Supplied delivery text");
    expect(copy.messages.selectionRefused).toBe("Quotation cannot be selected now. It expired or no longer adds eligible coverage. Compare again.");
  });
});
