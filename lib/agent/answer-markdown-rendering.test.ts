// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeGroundedAnswer } from "@/lib/agent/answer-grounding";
import { buildEvidenceLedger } from "@/lib/agent/evidence-ledger";
import type { Citation } from "@/lib/types";
import { AnswerMarkdown } from "@/components/keryx/answer-markdown";

const citation: Citation = {
  marker: "S1", sourceId: "quote-fixture", sourceName: "Quote fixture",
  weight: 1, reward: 0, rationale: "Synthetic public excerpt; no reward authority.",
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

async function render(text: string, onCitationClick = vi.fn()) {
  await act(async () => {
    root.render(createElement(AnswerMarkdown, { text, citations: [citation], language: "en", onCitationClick }));
  });
  return onCitationClick;
}

const visible = (text: string | null) => text?.replaceAll("\u200b", "");

describe("grounded quote rendering", () => {
  it.each([
    "If-Match: * and If-None-Match: * select conditional request behavior.",
    "The source writes **bold**, *italic*, and underscores_like_this literally.",
    "The source writes `code` and `other code` literally.",
    "Mixed delimiters **`value_*`** and *`another_value`* remain exact.",
    "Source marker [S9] and **bold** and `code` are literal source text.",
  ])("preserves the finalized excerpt %j with only its real citation clickable", async quote => {
    const claim = "Conditional request notation";
    const ledger = buildEvidenceLedger({
      subClaims: [claim], answer: "Unverified draft [S1]", declaredMarkers: ["S1"],
      gathered: [{ marker: "S1", sourceId: citation.sourceId, sourceName: citation.sourceName,
        sourceKind: "public-reference", text: quote }],
      proposedEvidence: [{ claimIndex: 0, marker: "S1", quote,
        quoteSpan: { start: 0, end: quote.length }, support: 0.9 }],
      finalAssessment: [{ claim, coverage: 0.9, coveredBy: ["S1"] }],
    });
    expect(ledger.evidence).toHaveLength(1);
    expect(ledger.evidence[0]).toMatchObject({ quote, qualifiesForAnswer: true, qualifiesForReward: false });
    const retained = structuredClone(ledger);
    const text = finalizeGroundedAnswer({ question: claim, answer: "Unverified draft [S1]", ledger });
    const onCitationClick = await render(text);

    const excerpt = container.querySelector("li")!;
    expect(visible(excerpt.querySelector('[lang="und"]')!.textContent)).toBe(`“${quote}”`);
    expect(visible(excerpt.textContent)).toBe(`“${quote}” [1]`);
    expect(container.querySelectorAll("strong, em, code")).toHaveLength(0);
    expect(container.textContent).not.toContain("Unverified draft");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button.lang).toBe("en");
    expect(button.getAttribute("aria-label")).toContain(citation.sourceName);
    await act(async () => { button.click(); });
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith("S1", button);
    expect(ledger).toEqual(retained);
  });

  it.each([
    "*\u200bopened*", "*closed*\u200b",
    "*\u200b*\u200bopened**", "**closed*\u200b*\u200b",
    "`\u200bopened`", "`closed`\u200b",
    "*\u200balone *\u200band `\u200balone",
  ])("keeps an escaped delimiter from opening or closing markup: %j", async text => {
    await render(text);
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("strong, em, code")).toHaveLength(0);
  });

  it("keeps normal formatting, quoted-language spans and real citation interaction", async () => {
    const text = "**Important**: *check* `header` before “If-Match: *\u200b and If-None-Match: *\u200b” [S1].";
    const onCitationClick = await render(text);
    expect(container.querySelector("strong")!.textContent).toBe("Important");
    expect(container.querySelector("em")!.textContent).toBe("check");
    expect(container.querySelector("code")!.textContent).toBe("header");
    expect(visible(container.querySelector('[lang="und"]')!.textContent)).toBe("“If-Match: * and If-None-Match: *”");
    expect(container.firstElementChild!.getAttribute("lang")).toBe("en");
    const button = container.querySelector("button")!;
    await act(async () => { button.click(); });
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith("S1", button);
  });

  it("preserves escaped delimiters inside legitimate inline formatting", async () => {
    await render("**bold *\u200b literal** and *italic *\u200b literal* and `code `\u200b literal`");
    expect(visible(container.querySelector("strong")!.textContent)).toBe("bold * literal");
    expect(visible(container.querySelector("em")!.textContent)).toBe("italic * literal");
    expect(visible(container.querySelector("code")!.textContent)).toBe("code ` literal");
  });
});
