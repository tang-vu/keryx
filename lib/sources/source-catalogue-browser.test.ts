import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { SourceLibraryFilters } from "../../components/keryx/source-library-filters";
import { ExploreSourceCard } from "../../components/keryx/explore-source-card";
import { CitedSourceCard } from "../../components/keryx/cited-source-card";
import { parseLibraryFilters } from "./library-browse";
import type { ExploreSource } from "../public-references/explore-catalog";
import type { CitedSourceHistoryEntry } from "./cited-source-history";

let browser: Browser, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const source: ExploreSource = { id: "explore:fixture", name: "Systems Research Handbook",
  url: "https://docs.publisher.example/guide", description: "Curated publisher metadata. Read the methods and limitations before deciding whether to ask a research question.",
  topic: "data-infrastructure", tags: ["Systems", "Public metadata"] };
const cited: CitedSourceHistoryEntry = { url: "https://journal.example/observed-v2", title: "Evidence from an observed public document",
  publisher: "journal.example", runId: "run/2026?x=1", citedAt: "2026-10-05T00:00:00Z", retrievedAt: "2026-10-04T00:00:00Z",
  deliveryKind: "excerpt", truncated: true, extraction: "html" };
const fonts = `@font-face{font-family:CatalogueDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:CatalogueSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:CatalogueMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
  :root{--font-bodoni:CatalogueDisplay;--font-spectral:CatalogueSerif;--font-spline-mono:CatalogueMono}`;

beforeAll(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

function documentFor(url: URL) {
  const stress = url.searchParams.has("stress");
  const long = "Nghiên cứu 中文 " + "UnbrokenPublisherMetadata".repeat(10);
  const explore = stress ? { ...source, name: long, description: source.description + " " + "unbroken".repeat(40), tags: [long] } : source;
  const unknown = { ...cited, url: "https://archive.example/legacy", title: "A compact historical source with an unusually long title and " + "OriginalUnbrokenTitle".repeat(12),
    publisher: "archive.example", citedAt: "", retrievedAt: undefined, deliveryKind: undefined, truncated: true };
  const markup = renderToStaticMarkup(createElement("main", { style: { maxWidth: 1080, margin: "24px auto", padding: "0 16px" } },
    createElement(SourceLibraryFilters, { filters: parseLibraryFilters(Object.fromEntries(url.searchParams)), total: 3, matched: 3, publishers: 3 }),
    createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 16, marginTop: 20 } },
      createElement(ExploreSourceCard, { source: explore }),
      createElement(CitedSourceCard, { entry: cited }),
      createElement(CitedSourceCard, { entry: unknown, compact: true }))));
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/catalogue.css"></head><body>' + markup + "</body></html>";
}

async function fixture(run: (page: Page, navigations: URL[], errors: string[]) => Promise<void>, {
  width = 390, motion = "reduce", javaScriptEnabled = false, initial = "/sources",
}: { width?: number; motion?: "reduce" | "no-preference"; javaScriptEnabled?: boolean; initial?: string } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion, javaScriptEnabled });
  const navigations: URL[] = [], errors: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      expect(request.method()).toBe("GET"); expect(url.origin).toBe("https://source-catalogue.test");
      if (url.pathname === "/catalogue.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/sources");
      if (request.isNavigationRequest()) navigations.push(url);
      return route.fulfill({ contentType: "text/html", body: documentFor(url) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("https://source-catalogue.test" + initial);
    await page.evaluate(() => document.fonts.ready);
    await run(page, navigations, errors);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

it.each([false, true])("preserves native GET, visible invalid-year recovery and closed optional values with JavaScript=$0", async javaScriptEnabled => {
  await fixture(async (page, navigations) => {
    const optional = page.locator("details"), summary = optional.locator("summary");
    // Chromium exposes native summary as DisclosureTriangle, which Playwright's button role does not match.
    const accessibility = await page.context().newCDPSession(page);
    const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
    const disclosures = nodes.filter(node => node.role?.value === "DisclosureTriangle");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0].name?.value.replace(/\s+/g, " ")).toBe("AUTHOR EXACT DOI");
    expect(disclosures[0].properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "focusable", value: expect.objectContaining({ value: true }) }),
      expect.objectContaining({ name: "expanded", value: expect.objectContaining({ value: false }) }),
    ]));
    await accessibility.detach();
    expect(await optional.getAttribute("open")).toBeNull();
    expect(await page.getByLabel("Publication year", { exact: true }).isVisible()).toBe(true);
    const status = await page.getByRole("status").boundingBox(), search = page.getByRole("searchbox");
    const box = await search.boundingBox(); expect(status && box && status.y + status.height < box.y).toBe(true);
    const query = "SQLite & Tiếng Việt";
    await search.fill(query);
    await page.getByLabel("Topic", { exact: true }).selectOption("data-infrastructure");
    await page.getByLabel("Collection", { exact: true }).selectOption("paper");
    await page.getByLabel("Sort", { exact: true }).selectOption("recent");
    await summary.focus(); await page.keyboard.press("Space");
    expect(await optional.getAttribute("open")).not.toBeNull();
    await page.getByLabel("Author", { exact: true }).fill("Jane Doe");
    await page.getByLabel("Exact DOI", { exact: true }).fill("https://doi.org/10.1234/a_b.C");
    await summary.click();
    expect(await optional.getAttribute("open")).toBeNull();
    const year = page.getByLabel("Publication year", { exact: true });
    await year.fill("20x");
    await page.getByRole("button", { name: "Find sources", exact: true }).click();
    expect(navigations).toHaveLength(1);
    expect(await year.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await year.evaluate(element => (element as HTMLInputElement).validity.valid)).toBe(false);
    await year.fill("2024");
    await Promise.all([
      page.waitForURL(url => url.searchParams.get("q") === query),
      page.getByRole("button", { name: "Find sources", exact: true }).click(),
    ]);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: query, topic: "data-infrastructure", kind: "paper", sort: "recent", year: "2024", author: "Jane Doe", doi: "https://doi.org/10.1234/a_b.C" });
    expect(url.hash).toBe("#browse-sources");
    expect(await optional.getAttribute("open")).not.toBeNull();
    expect(await page.getByLabel("Author", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByLabel("Author", { exact: true }).inputValue()).toBe("Jane Doe");
    if (screenshots) await page.screenshot({ path: join(screenshots, `source-catalogue-applied-js-${javaScriptEnabled}.png`), fullPage: true });
    const topic = page.getByRole("navigation", { name: "Browse source topics" }).locator('a[href*="topic=payments"]');
    const href = await topic.getAttribute("href"); expect(href).toBeTruthy();
    const changed = new URL(href!, page.url());
    expect(Object.fromEntries(changed.searchParams)).toEqual({ ...Object.fromEntries(url.searchParams), topic: "payments" });
    expect(changed.hash).toBe("#browse-sources"); expect(changed.searchParams.has("run")).toBe(false);
    await page.getByRole("link", { name: "Clear filters", exact: true }).click();
    await page.waitForURL(url => !url.search);
    expect(await search.inputValue()).toBe("");
    expect(await year.inputValue()).toBe("");
    expect(await page.getByLabel("Author", { exact: true }).inputValue()).toBe("");
    expect(await page.getByLabel("Exact DOI", { exact: true }).inputValue()).toBe("");
    expect(await optional.getAttribute("open")).toBeNull();
    expect(await page.getByLabel("Collection", { exact: true }).inputValue()).toBe("all");
    expect(await page.getByLabel("Sort", { exact: true }).inputValue()).toBe("default");
  }, { javaScriptEnabled });
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "keeps catalogue controls/cards readable and keyboard accessible at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const summary = page.locator("details summary");
      if (screenshots && motion === "reduce") await page.screenshot({ path: join(screenshots, `source-catalogue-${width}-default.png`), fullPage: true });
      await summary.focus(); await page.keyboard.press("Space");
      await expect.poll(() => summary.locator("svg").evaluate(element => getComputedStyle(element).rotate)).toBe("180deg");
      const controls = await page.locator("input,select").evaluateAll(elements => elements.map(element => ({
        size: parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height,
        transform: getComputedStyle(element).textTransform,
      })));
      expect(controls.every(control => control.size >= 16 && control.height >= 44 && control.transform === "none")).toBe(true);
      expect(await summary.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      const links = await page.locator("a,button,summary").evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
      }));
      expect(links.every(rect => rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= width)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const compact = page.locator("article").nth(2).locator("h3 a");
      const compactSize = await compact.evaluate(element => ({ height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight) }));
      expect(compactSize.height).toBeLessThanOrEqual(compactSize.line * 3 + 1);
      const external = page.locator("article").first().locator("h3 a"), arrow = external.locator("svg");
      await external.scrollIntoViewIfNeeded();
      const before = await arrow.boundingBox(); expect(before).toBeTruthy();
      await external.hover();
      await expect.poll(async () => {
        const after = await arrow.boundingBox(); return after ? Math.round((after.x - before!.x) * 10) / 10 : null;
      }).toBe(motion === "reduce" ? 0 : 2);
      expect(await external.getAttribute("target")).toBe("_blank");
      expect(await external.getAttribute("rel")).toContain("noopener");
      await page.keyboard.press("Tab"); await external.focus();
      expect(await external.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      await page.getByText("Publisher directory · unread link", { exact: true }).waitFor();
      await page.getByText("Excerpt recorded · Bounded extraction", { exact: true }).waitFor();
      await page.getByText("Reading scope not recorded · Bounded extraction", { exact: true }).waitFor();
      await page.getByText("Citation date not recorded", { exact: true }).waitFor();
      const ask = await page.getByRole("link", { name: "Ask with this source →", exact: true }).getAttribute("href");
      const draft = new URL(ask!, page.url());
      expect(draft.pathname).toBe("/"); expect([...draft.searchParams.keys()]).toEqual(["q"]);
      expect(draft.searchParams.get("q")).toContain(source.url);
      expect(await page.locator('a[href="/dispatch/run%2F2026%3Fx%3D1"]').count()).toBe(2);
      expect(await page.locator("img,script").count()).toBe(0);
      if (screenshots) await page.screenshot({ path: join(screenshots, `source-catalogue-${width}-${motion}.png`), fullPage: true });
      await page.goto("https://source-catalogue.test/sources?stress=1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await page.locator("article").first().getByText(/UnbrokenPublisherMetadata/).count()).toBeGreaterThan(0);
    }, { width, motion, javaScriptEnabled: false });
  });
