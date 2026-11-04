// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SourceDirectory } from "./source-directory";
import { EXPLORE_SOURCES } from "../public-references/explore-catalog";
import { PAPER_CATALOG } from "../papers/catalog";
import { groupPaperWorks } from "../papers/work-groups";
import SourcesPage from "../../app/sources/page";

const fixture = vi.hoisted(() => ({ directory: null as SourceDirectory | null, getDb: vi.fn(), loadDirectory: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: fixture.getDb }));
vi.mock("@/lib/sources/source-directory", async importOriginal => ({ ...await importOriginal<typeof import("./source-directory")>(), loadSourceDirectory: fixture.loadDirectory }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/paper-search-panel", () => ({ PaperSearchPanel: () => null }));

function directory(): SourceDirectory {
  return {
    registry: { status: "ready", entries: Array.from({ length: 49 }, (_, i) => ({
      source: { id: `creator-${i}`, name: `Original creator ${i}`, url: `https://creator.test/${i}`, description: "Original source", walletAddress: "0x0000000000000000000000000000000000000001", fetchPrice: 0.01, tags: [], authors: [], createdAt: "2026-10-01T00:00:00Z" },
      totalEarnedUsdc: i / 100, citationCount: i, claim: null, claimPolicyUnavailable: false, controlFresh: false,
    })) },
    publicReferences: { status: "ready", entries: Array.from({ length: 49 }, (_, i) => ({
      id: `public:${i}`, name: `Original feed ${i}`, url: `https://feed.test/${i}`, rssUrl: `https://feed.test/${i}/rss`, description: "Original feed metadata", tags: ["data"], active: true, archivedItemCount: 10,
      items: Array.from({ length: 10 }, (_, n) => ({ id: `${i}:${n}`, title: `Original feed ${i} item ${n}`, link: `https://feed.test/${i}/${n}`, summary: "NEVER_RENDER_SUMMARY", content: "NEVER_RENDER_BODY", deliveryKind: "excerpt" as const })),
    })) },
    citedSources: { status: "ready", runCount: 50, entries: Array.from({ length: 49 }, (_, i) => ({ url: `https://cited.test/${i}`, title: `Original citation ${i}`, publisher: "Original publisher", runId: `run-${i}`, citedAt: "2026-10-01T00:00:00Z", deliveryKind: "excerpt", truncated: true })) },
    earningsStatus: "ready",
  };
}

beforeEach(() => {
  vi.clearAllMocks(); fixture.directory = directory();
  fixture.getDb.mockResolvedValue({ queryPublicReferenceItems: fixture.archive });
  fixture.loadDirectory.mockImplementation(async () => fixture.directory);
  fixture.archive.mockResolvedValue({ items: [], total: 490 });
});

async function render(params: Record<string, string | string[]> = {}) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve(params) }));
  return root;
}

it("bounds actual Sources HTML in every collection and omits off-page cards even inside details", async () => {
  const before = JSON.stringify(fixture.directory), root = await render();
  for (const [id, cap] of [["research-papers", 8], ["publisher-directory", 12], ["cited-sources", 12], ["public-references", 12], ["creator-listings", 12]] as const) {
    expect(root.querySelectorAll(`#${id} article`)).toHaveLength(cap);
    expect(root.querySelectorAll(`#${id} > details`)).toHaveLength(0);
    expect(root.querySelector(`#${id} nav[aria-labelledby="${id}-title"] [aria-current="page"]`)?.textContent).toBe("1");
  }
  expect(root.querySelector('#public-references a[href="https://feed.test/12"]')).toBeNull();
  expect(root.querySelector('#cited-sources a[href="https://cited.test/12"]')).toBeNull();
  expect(root.querySelector('#creator-listings a[href="/creator/creator-12"]')).toBeNull();
  expect(root.textContent).not.toContain("NEVER_RENDER_BODY"); expect(root.textContent).not.toContain("NEVER_RENDER_SUMMARY");
  expect(JSON.stringify(fixture.directory)).toBe(before);
  expect(fixture.getDb).toHaveBeenCalledTimes(1); expect(fixture.loadDirectory).toHaveBeenCalledTimes(1);
  expect(fixture.archive).toHaveBeenCalledExactlyOnceWith({ query: "", sort: "recent", limit: 20 });
});

it("keeps totals, structured data, archive request and availability notices independent of directory page", async () => {
  const first = await render({ publisher: "public:2", articleCursor: "opaque", articleSort: "oldest" });
  const second = await render({ publisher: "public:2", articleCursor: "opaque", articleSort: "oldest", feedPage: "2", citedPage: "2", creatorPage: "2", paperPage: "2", explorePage: "2" });
  expect(second.querySelector('script[type="application/ld+json"]')?.textContent).toBe(first.querySelector('script[type="application/ld+json"]')?.textContent);
  expect(second.querySelector("#browse-sources [role=status]")?.textContent).toBe(first.querySelector("#browse-sources [role=status]")?.textContent);
  expect(fixture.archive).toHaveBeenLastCalledWith({ query: "", referenceId: "public:2", cursor: "opaque", sort: "oldest", limit: 20 });
  expect(second.querySelector('#public-references a[href="https://feed.test/12"]')).not.toBeNull();
  expect(second.querySelector('#creator-listings a[href="/creator/creator-12"]')).not.toBeNull();
  expect(second.querySelector("#public-references nav a")?.getAttribute("href")).toContain("articleCursor=opaque");
});

it("makes every original feed, citation and creator reachable exactly once through actual page links", async () => {
  for (const [kind, section, selector, expected] of [
    ["feed", "public-references", "article h3 a", Array.from({ length: 49 }, (_, i) => `https://feed.test/${i}`)],
    ["cited", "cited-sources", "article h3 a", Array.from({ length: 49 }, (_, i) => `https://cited.test/${i}`)],
    ["creator", "creator-listings", 'article a[href^="/creator/"]', Array.from({ length: 49 }, (_, i) => `/creator/creator-${i}`)],
  ] as const) {
    const seen: string[] = []; let params: Record<string, string> = { kind };
    for (let step = 0; step < 5; step++) {
      const root = await render(params), selected = root.querySelector(`#${section}`)!;
      seen.push(...Array.from(selected.querySelectorAll(selector), node => node.getAttribute("href")!));
      const next = Array.from(selected.querySelectorAll("nav a")).find(node => node.textContent?.startsWith("Next page"));
      if (step === 4) expect(next).toBeUndefined();
      else { expect(next).toBeDefined(); params = Object.fromEntries(new URL(next!.getAttribute("href")!, "https://local.test").searchParams); }
    }
    expect(seen).toEqual(expected);
  }
});

it("reaches every configured publisher and paper without rendering later pages in advance", async () => {
  for (const [kind, section, cap, expected] of [["explore", "publisher-directory", 12, EXPLORE_SOURCES.length], ["paper", "research-papers", 8, undefined]] as const) {
    const seen: string[] = []; let params: Record<string, string> = { kind };
    for (let step = 0; step < 100; step++) {
      const root = await render(params), selected = root.querySelector(`#${section}`)!;
      const cards = selected.querySelectorAll("article"); expect(cards.length).toBeLessThanOrEqual(cap);
      seen.push(...Array.from(selected.querySelectorAll("article h3 a"), node => node.getAttribute("href")!));
      const next = Array.from(selected.querySelectorAll("nav a")).find(node => node.textContent?.startsWith("Next page"));
      if (!next) break;
      params = Object.fromEntries(new URL(next.getAttribute("href")!, "https://local.test").searchParams);
      expect(step).toBeLessThan(98);
    }
    expect(seen.length).toBeGreaterThan(cap); expect(new Set(seen).size).toBe(seen.length);
    if (expected) expect(seen).toHaveLength(expected);
    else {
      const groups = groupPaperWorks(PAPER_CATALOG);
      expect(seen).toHaveLength(groups.length);
      for (const group of groups) expect(group.records.some(record => seen.includes(record.url))).toBe(true);
    }
  }
});

it("searches the full directory before slicing and resets stale page links after GET filtering", async () => {
  const root = await render({ q: "Original feed 48", kind: "feed", feedPage: "5", run: "private", all: "1" });
  expect(root.querySelectorAll("#public-references article")).toHaveLength(1);
  expect(root.querySelector('#public-references a[href="https://feed.test/48"]')).not.toBeNull();
  expect(root.querySelector("#public-references nav")).toBeNull();
  expect(root.querySelector("#browse-sources form input[name=feedPage]")).toBeNull();
  expect(fixture.archive).toHaveBeenCalledExactlyOnceWith({ query: "Original feed 48", sort: "recent", limit: 20 });
});

it("preserves unavailable and empty directory distinctions with stale page parameters", async () => {
  fixture.directory = { registry: { status: "unavailable", entries: [] }, publicReferences: { status: "unavailable", entries: [] }, citedSources: { status: "unavailable", entries: [], runCount: 0 }, earningsStatus: "unavailable" };
  const unavailable = await render({ feedPage: "9999999", creatorPage: "2" });
  expect(unavailable.querySelector("#public-references")?.textContent).toContain("unavailable");
  expect(unavailable.querySelector("#creator-listings")?.textContent).toContain("unavailable");
  expect(unavailable.querySelectorAll("#public-references nav, #creator-listings nav")).toHaveLength(0);
  fixture.directory = { ...fixture.directory, registry: { status: "ready", entries: [] }, publicReferences: { status: "ready", entries: [] }, citedSources: { status: "ready", entries: [], runCount: 0 }, earningsStatus: "ready" };
  const empty = await render({ feedPage: "2" });
  expect(empty.querySelector("#public-references")?.textContent).not.toContain("temporarily unavailable");
  expect(empty.querySelectorAll("#public-references article, #creator-listings article")).toHaveLength(0);
});
