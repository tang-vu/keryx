import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveEntry } from "./answers-archive";

const fixtures = vi.hoisted(() => {
  vi.stubEnv("BASE_URL", "https://keryx.cc");
  return { entries: [] as ArchiveEntry[] };
});
afterAll(() => vi.unstubAllEnvs());
vi.mock("@/lib/answers-archive-cache", () => ({ getArchiveCached: async () => fixtures.entries }));
vi.mock("@/lib/wanted-board", () => ({ WANTED_DETAIL_LIMIT: 100, loadWantedBoard: async () => ({ open: [], filled: [] }) }));

import sitemap from "@/app/sitemap";
import { GET as feed } from "@/app/answers/feed.xml/route";
import { archiveIndexJsonLd } from "@/app/answers/archive-index-json-ld";
import { paginateArchive } from "./answers-pagination";

const BASE = process.env.BASE_URL || "https://keryx.cc";
beforeEach(() => {
  fixtures.entries = [{ id: "public-vi", question: "Tiếng Việt", answerSnippet: "Một câu trả lời",
    citationCount: 1, totalSpent: 0, toCreators: 0, sourceNames: ["Synthetic public fixture"],
    createdAt: "2026-10-11T00:00:00Z", confidence: null }];
});

describe("shipped public metadata route contracts", () => {
  it("keeps interface sitemap alternates reciprocal without relabelling unknown answer language", async () => {
    const routes = await sitemap();
    const index = routes.find(route => route.url === `${BASE}/answers`)!;
    expect(index.alternates).toEqual({ languages: { "x-default": `${BASE}/answers`, en: `${BASE}/answers` } });
    const report = routes.find(route => route.url === `${BASE}/dispatch/public-vi`)!;
    expect(report.alternates).toBeUndefined();
    expect(routes.map(route => route.url).filter(url => url.includes("/dispatch/")))
      .toEqual([`${BASE}/dispatch/public-vi`]);
    expect(routes.every(route => !/\/(?:vi|zh-Hans)(?:\/|$)/u.test(new URL(route.url).pathname))).toBe(true);

    const response = await feed();
    const xml = await response.text();
    expect(response.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(xml).toContain('<entry xml:lang="">');
    expect(xml).toContain(`href="${BASE}/dispatch/public-vi"`);
    expect(xml).not.toContain('hreflang="vi"');
  });

  it("labels the collection interface without assigning its language to recorded answers", () => {
    const collection = archiveIndexJsonLd({ base: BASE, url: `${BASE}/answers`, name: "Keryx Answer Archive",
      slice: paginateArchive(fixtures.entries, 1), totalEntries: fixtures.entries.length });
    expect(collection["@type"]).toBe("CollectionPage");
    expect(collection.inLanguage).toBe("en");
    const items = (collection.mainEntity as { itemListElement: Record<string, unknown>[] }).itemListElement;
    expect(items[0]).toEqual({ "@type": "ListItem", position: 1,
      url: `${BASE}/dispatch/public-vi`, name: "Tiếng Việt" });
  });
});
