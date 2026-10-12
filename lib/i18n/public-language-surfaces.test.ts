import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ArchiveEntry } from "../answers-archive";

const fixture = vi.hoisted(() => {
  vi.stubEnv("BASE_URL", "https://synthetic-language.example");
  return { entries: [] as ArchiveEntry[] };
});
vi.mock("@/lib/answers-archive-cache", () => ({ getArchiveCached: async () => fixture.entries }));
vi.mock("@/lib/wanted-board", () => ({ loadWantedBoard: async () => ({ open: [], filled: [] }), WANTED_DETAIL_LIMIT: 100 }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/product-guide", () => ({ ProductEntryNote: () => null }));
vi.mock("@/components/keryx/display-time", () => ({ DisplayTime: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, redirect: (url: string) => { throw Error(`redirect:${url}`); } }));

import AnswersPage, { generateMetadata as indexMetadata } from "@/app/answers/page";
import AnswersPageN from "@/app/answers/page/[n]/page";
import { GET as feed } from "@/app/answers/feed.xml/route";
import { archiveIndexJsonLd } from "@/app/answers/archive-index-json-ld";
import { paginateArchive } from "../answers-pagination";
import { ArchivePagination } from "@/components/keryx/archive-pagination";
import { ArchiveAnswerRow } from "@/components/keryx/archive-answer-row";
import { AnswerMarkdown } from "@/components/keryx/answer-markdown";
import sitemap from "@/app/sitemap";

function entry(id: string, answerLanguage?: string): ArchiveEntry {
  return { id, answerLanguage, question: `${id} question sentinel`, answerSnippet: `${id} answer sentinel`, citationCount: 1,
    totalSpent: 0, toCreators: 0, sourceNames: [], createdAt: "2026-10-12T00:00:00Z", confidence: null };
}
beforeEach(() => { fixture.entries = [entry("vi", "vi"), entry("zh", "zh-Hans"), entry("unknown")]; });
afterAll(() => vi.unstubAllEnvs());

describe("actual public language surfaces", () => {
  it("filters the server archive and its Atom subscription from the same recorded language", async () => {
    const page = await AnswersPage({ searchParams: Promise.resolve({ language: "vi" }) });
    const serialized = JSON.stringify(page);
    expect(serialized).toContain("vi answer sentinel");
    expect(serialized).not.toContain("zh answer sentinel");
    expect(serialized).not.toContain("unknown answer sentinel");
    const response = await feed(new Request("https://synthetic-language.example/answers/feed.xml?language=vi"));
    const xml = await response.text();
    expect(xml).toContain("vi answer sentinel");
    expect(xml).not.toContain("zh answer sentinel");
    expect(xml).not.toContain("unknown answer sentinel");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses ambiguous repeated query preferences consistently across page and feed", async () => {
    const page = await AnswersPage({ searchParams: Promise.resolve({ language: ["vi", "zh-Hans"] }) });
    expect(JSON.stringify(page)).toContain("unknown answer sentinel");
    const xml = await (await feed(new Request("https://synthetic-language.example/answers/feed.xml?language=vi&language=zh-Hans"))).text();
    expect(xml).toContain("unknown answer sentinel");
  });

  it("retains one existing canonical and shipped English alternates while filtered views stay nonindexed", async () => {
    const plain = await indexMetadata({ searchParams: Promise.resolve({}) });
    const filtered = await indexMetadata({ searchParams: Promise.resolve({ language: "vi" }) });
    expect(filtered.alternates).toEqual(plain.alternates);
    expect(filtered.alternates?.canonical).toBe("/answers");
    expect(filtered.robots).toEqual({ index: false, follow: true });
    const routes = await sitemap();
    expect(routes.filter(row => row.url.includes("/dispatch/")).map(row => row.url)).toHaveLength(3);
    expect(routes.every(row => !row.url.includes("?language=") && !/^\/(vi|zh-Hans)(\/|$)/.test(new URL(row.url).pathname))).toBe(true);
  });

  it("retains page-one route continuity and language selection without a redirect loop", async () => {
    await expect(AnswersPageN({ params: Promise.resolve({ n: "1" }), searchParams: Promise.resolve({ language: "vi" }) }))
      .rejects.toThrow("redirect:/answers?language=vi");
    const nav = renderToStaticMarkup(createElement(ArchivePagination, { page: 2, totalPages: 3, language: "vi" }));
    expect(nav).toContain('href="/answers?language=vi"');
    expect(nav).toContain('href="/answers/page/3?language=vi"');
  });

  it("places the recorded tag on answer snippets and answer works, keeping unknown questions separate", () => {
    const html = renderToStaticMarkup(createElement(ArchiveAnswerRow, { entry: fixture.entries[0] }));
    expect(html).toContain('<h2 lang="und"');
    expect(html).toContain('<p lang="vi"');
    const collection = archiveIndexJsonLd({ base: "https://synthetic-language.example", url: "/answers", name: "Archive",
      slice: paginateArchive(fixture.entries, 1), totalEntries: 3 });
    expect(collection.inLanguage).toBe("en");
    const rows = (collection.mainEntity as { itemListElement: Array<{ item?: { inLanguage?: string } }> }).itemListElement;
    expect(rows[0].item?.inLanguage).toBe("vi");
    expect(rows[1].item?.inLanguage).toBe("zh-Hans");
    expect(rows[2].item).toBeUndefined();
  });

  it("keeps verbatim quotation outside recorded generated-prose language without changing bytes", () => {
    const text = 'Generated sentence. Source text: “Original “nested” quotation” [S1]';
    const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [], language: "vi" }));
    expect(html).toContain('<div lang="vi"');
    expect(html).toContain('<span lang="und">“Original');
    expect(html).toContain('Original “nested” quotation');
    expect(html).toContain('<button lang="en"');
    expect(renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [] }))).toContain('<div lang="und"');
  });
});
