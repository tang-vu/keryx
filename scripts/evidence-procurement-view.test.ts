import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceProcurementWorkspace } from "../components/keryx/evidence-procurement-workspace";

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
  });
});
