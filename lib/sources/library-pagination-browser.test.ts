import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { LibraryPagination } from "../../components/keryx/library-pagination";
import { parseLibraryFilters } from "./library-browse";
import { paginateLibrary, type LibraryPaginationContext } from "./library-pagination";

let browser: Browser, css: string;
const records = Array.from({ length: 49 }, (_, id) => ({ id, title: `Original source ${id}` }));
beforeAll(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

function documentFor(url: URL) {
  const params = Object.fromEntries(url.searchParams), page = paginateLibrary(records, "feed", params.feedPage);
  const context: LibraryPaginationContext = { filters: parseLibraryFilters(params), articles: { query: "Original article", referenceId: "public:fixture", cursor: "opaque/+?=token", sort: "oldest" }, pages: { paper: 2, explore: 3, cited: 4, feed: page.page, creator: 5 } };
  const markup = renderToStaticMarkup(React.createElement("main", { className: "mx-auto max-w-[1040px] px-4 py-6" },
    React.createElement("h2", { id: "public-references-title" }, "Public references"),
    React.createElement("section", { className: "grid gap-4 md:grid-cols-2" }, page.items.map(item => React.createElement("article", { key: item.id, className: "border border-line p-5" }, item.title))),
    React.createElement(LibraryPagination, { kind: "feed", ...page, context })));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`;
}

it.each([320, 1440])("navigates real bounded GET pages with no JavaScript, native back and keyboard at %spx", async width => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false, reducedMotion: "reduce", serviceWorkers: "block" });
  const navigations: URL[] = [], unexpected: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://library-pages.test" || url.pathname !== "/sources") {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort();
      }
      if (request.isNavigationRequest()) navigations.push(url);
      return route.fulfill({ contentType: "text/html", body: documentFor(url) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://library-pages.test/sources?q=Original&sort=recent&topic=data-infrastructure&run=private&all=1");
    expect(await page.locator("script, details").count()).toBe(0);
    expect(await page.locator("article").count()).toBe(12);
    expect(await page.locator("article").allTextContents()).not.toContain("Original source 12");
    const seen: string[] = [];
    for (let step = 1; step <= 5; step++) {
      seen.push(...await page.locator("article").allTextContents());
      expect(await page.getByRole("navigation", { name: "Public references" }).count()).toBe(1);
      expect(await page.locator('[aria-current="page"]').textContent()).toBe(String(step));
      expect(await page.locator("nav a").count()).toBeLessThanOrEqual(7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const links = await page.locator("nav a").evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { height: rect.height, width: rect.width, left: rect.left, right: rect.right }; }));
      expect(links.every(rect => rect.height >= 44 && rect.width >= 44 && rect.left >= 0 && rect.right <= width)).toBe(true);
      const next = page.getByRole("link", { name: "Next page" });
      if (step === 5) { expect(await next.count()).toBe(0); break; }
      await next.focus(); expect(await next.evaluate(node => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Enter");
      await page.waitForURL(url => url.searchParams.get("feedPage") === String(step + 1));
      const current = new URL(page.url());
      expect(current.hash).toBe("#public-references");
      expect(current.searchParams.get("q")).toBe("Original"); expect(current.searchParams.get("sort")).toBe("recent");
      expect(current.searchParams.get("topic")).toBe("data-infrastructure");
      expect(current.searchParams.get("articleCursor")).toBe("opaque/+?=token");
      for (const [key, value] of Object.entries({ paperPage: "2", explorePage: "3", citedPage: "4", creatorPage: "5" })) expect(current.searchParams.get(key)).toBe(value);
      expect(current.searchParams.has("run")).toBe(false); expect(current.searchParams.has("all")).toBe(false);
    }
    expect(seen).toEqual(records.map(record => record.title));
    await page.goBack(); expect(await page.locator('[aria-current="page"]').textContent()).toBe("4");
    await page.getByRole("link", { name: "1", exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has("feedPage"));
    expect(await page.locator("article").first().textContent()).toBe("Original source 0");
    expect(navigations).toHaveLength(7); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
