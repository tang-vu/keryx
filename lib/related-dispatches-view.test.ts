import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { RelatedDispatches } from "../components/keryx/related-dispatches";
import type { ArchiveEntry } from "./answers-archive";

const entry = (values: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: "retained-dispatch", question: "Read the retained original.", answerSnippet: "Recorded answer.",
  citationCount: 1, toCreators: 0.025, totalSpent: 0.025, sourceNames: ["Recorded source"],
  createdAt: "2026-10-08T12:39:56.153Z", confidence: null, ...values,
});
const render = (entries: ArchiveEntry[]) => new JSDOM(renderToStaticMarkup(createElement(RelatedDispatches, { entries })));

describe("related dispatch content", () => {
  it("keeps complete long questions and exact links available to readers", () => {
    const url = `https://sqlite.org/${"original-reference-".repeat(12)}backup.html`;
    const question = `SQLite is receiving writes during a backup. Read ${url} and preserve the full original question.`;
    const values = [entry({ question }), entry({ id: "second-retained", question: "A second recorded question." })];
    const before = JSON.stringify(values), dom = render(values);
    try {
      const section = dom.window.document.querySelector('section[aria-label="Related dispatches"]')!;
      const links = [...section.querySelectorAll<HTMLAnchorElement>('a[href^="/dispatch/"]')];
      expect(links.map(link => link.getAttribute("href"))).toEqual(["/dispatch/retained-dispatch", "/dispatch/second-retained"]);
      expect(links[0].textContent).toContain(question);
      expect(links[0].textContent).toContain("1 source cited");
      expect(links[0].textContent).toContain("$0.0250 recorded creator rewards");
      expect(links[0].querySelector("time")?.dateTime).toBe(values[0].createdAt);
      expect(section.querySelector('a[href="/answers"]')?.textContent).toContain("Browse the full archive");
      expect(JSON.stringify(values)).toBe(before);
    } finally { dom.window.close(); }
  });

  it("preserves historical network and currency labels without promotion", () => {
    const dom = render([entry({ archivedNetwork: "eip155:5042002", citationCount: 2 })]);
    try {
      const text = dom.window.document.body.textContent;
      expect(text).toContain("Arc testnet history");
      expect(text).toContain("2 sources cited");
      expect(text).toContain("0.0250 test USDC recorded creator rewards");
      expect(text).not.toContain("$0.0250");
    } finally { dom.window.close(); }
  });

  it("escapes recorded markup and omits an empty archive", () => {
    expect(renderToStaticMarkup(createElement(RelatedDispatches, { entries: [] }))).toBe("");
    const question = '<img data-archive-injection onerror="attack()"> https://example.invalid/retained';
    const dom = render([entry({ question })]);
    try {
      expect(dom.window.document.body.textContent).toContain(question);
      expect(dom.window.document.querySelector("[data-archive-injection]")).toBeNull();
      expect(dom.window.document.querySelectorAll('a[href^="/dispatch/"]')).toHaveLength(1);
    } finally { dom.window.close(); }
  });
});
