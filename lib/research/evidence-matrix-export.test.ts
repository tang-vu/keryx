import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { EvidenceMatrixExport } from "../../components/keryx/evidence-matrix-export";
import type { QueryRun } from "../types";

function fixture(secondUrl: string): QueryRun {
  const first = { marker: "S1", sourceId: "publisher", sourceName: "Publisher", itemId: "article",
    itemUrl: "https://publisher.example/article?v=1", itemTitle: "First exact article",
    contentVersion: "sha256:recorded", weight: 1, reward: 0, rationale: "Recorded evidence" };
  const second = { ...first, itemUrl: secondUrl, itemTitle: "Second exact article" };
  return { id: "matrix-fixture", question: "Which result?", budget: 0.03, engine: "offline", answer: "[S1]",
    subClaims: ["Measured result?"], decisions: [], citations: [first, second],
    evidence: [first, second].map((row, index) => ({ ...row, claimIndex: 0, claim: "Measured result?",
      quote: `Exact article ${index + 1} quotation.`, support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false })),
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-22T00:00:00Z", paymentMode: "real" };
}

describe("rendered evidence matrix article identity", () => {
  it.each(["https://publisher.example/article?v=2", "https://copied.example/article?v=1"])(
    "keeps separately cited %s in its own source card with only its retained quote", secondUrl => {
      const run = fixture(secondUrl), before = JSON.stringify(run);
      const dom = new JSDOM(renderToStaticMarkup(createElement(EvidenceMatrixExport, { run })));
      try {
        const document = dom.window.document;
        const sources = [...document.querySelectorAll('ol[aria-label="By target"] > li:first-child article')];
        expect(sources).toHaveLength(2);
        expect(sources[0].textContent).toContain("First exact article");
        expect(sources[1].textContent).toContain("Second exact article");
        expect(sources.map(cell => [...cell.querySelectorAll("blockquote")].map(quote => quote.textContent)))
          .toEqual([[run.evidence![0].quote], [run.evidence![1].quote]]);
        expect(JSON.stringify(run)).toBe(before);
      } finally { dom.window.close(); }
    });

  it("shows an inspection gap when an excerpt points to a different uncited article", () => {
    const run = fixture("https://publisher.example/article?v=2");
    run.citations = run.citations.slice(0, 1); run.evidence = run.evidence!.slice(0, 1);
    run.evidence[0].itemUrl = "https://copied.example/article?v=1";
    const dom = new JSDOM(renderToStaticMarkup(createElement(EvidenceMatrixExport, { run })));
    try {
      expect(dom.window.document.querySelectorAll("blockquote")).toHaveLength(0);
      expect(dom.window.document.querySelector("ol > li > header p:last-child span")!.textContent).toBe("No inspectable excerpt recorded");
    } finally { dom.window.close(); }
  });

  it("retains the historical single source identity when both sides lack an article URL", () => {
    const run = fixture("https://publisher.example/article?v=2");
    for (const row of [...run.citations, ...run.evidence!]) delete row.itemUrl;
    const dom = new JSDOM(renderToStaticMarkup(createElement(EvidenceMatrixExport, { run })));
    try {
      expect(dom.window.document.querySelectorAll('ol[aria-label="By target"] > li:first-child article')).toHaveLength(1);
      expect([...dom.window.document.querySelectorAll("blockquote")].map(quote => quote.textContent))
        .toEqual(run.evidence!.map(row => row.quote));
    } finally { dom.window.close(); }
  });
});
