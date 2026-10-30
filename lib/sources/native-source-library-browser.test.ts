import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMessages, englishMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import type { CitedSourceHistoryEntry } from "./cited-source-history";
import type { PublicReference } from "../public-references/catalog";
import type { ExploreSource } from "../public-references/explore-catalog";

let browser: Browser, css: string, bundle: string;
const capture = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR ? join(process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR, "source-library") : undefined;
const cited: CitedSourceHistoryEntry = { url: "https://original.test/paper?literal={count}", title: "Metadata only", publisher: "Original publisher 日本語 हिन्दी", runId: "original/run?x=1", citedAt: "", deliveryKind: "excerpt", truncated: true };
const feed: PublicReference = { id: "public:original", name: "Clear filters", url: "https://original.test/feed", rssUrl: "https://original.test/rss", active: true,
  description: "وصف أصلي <literal> {count} 日本語 हिन्दी", tags: ["Topics", "Original tag"],
  items: (["full_text", "excerpt", "abstract", "metadata_only"] as const).map((deliveryKind, i) => ({ id: `original-${i}`, title: `Original item ${i} {count}`, link: `https://original.test/item/${i}`, summary: "Original summary", content: "Original content", deliveryKind })) };
const explore: ExploreSource = { id: "explore:original", name: "Find sources", url: "https://original.test/guide?x=1&y=2", description: "Original directory description {count}", topic: "data-infrastructure", tags: ["Original metadata tag"] };

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';
    import{SourceLibraryFilters}from'./components/keryx/source-library-filters';import{ExploreSourceCard}from'./components/keryx/explore-source-card';
    import{CitedSourceCard}from'./components/keryx/cited-source-card';import{PublicReferenceCard}from'./components/keryx/public-reference-card';
    import{SourceDirectoryPreview}from'./components/keryx/source-directory-preview';import{LanguageSwitcher}from'./components/keryx/language-switcher';
    import{LocaleProvider}from'./lib/i18n/locale-context';import{UiCopyProvider}from'./lib/i18n/ui-copy-provider';
    import{preparedLocales}from'./lib/i18n/locales';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';import{parseLibraryFilters}from'./lib/sources/library-browse';
    const cited=${JSON.stringify(cited)},feed=${JSON.stringify(feed)},explore=${JSON.stringify(explore)};
    const before=JSON.stringify({cited,feed,explore});window.libraryFixture={unchanged:()=>JSON.stringify({cited,feed,explore})===before};
    const filters=parseLibraryFilters(Object.fromEntries(new URL(location.href).searchParams));
    const directory={registry:{status:'ready',entries:[]},publicReferences:{status:'ready',entries:[feed]},citedSources:{status:'ready',entries:[cited],runCount:1},earningsStatus:'unavailable'};
    function App(){return <LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider>
      <LanguageSwitcher/><main className="mx-auto max-w-[1080px] px-4 pb-8"><SourceLibraryFilters filters={filters} total={4} matched={4} publishers={1}/>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><section id="explore"><ExploreSourceCard source={explore}/></section><section id="cited"><CitedSourceCard entry={cited}/></section>
      <section id="unknown"><CitedSourceCard entry={{...cited,deliveryKind:undefined,title:'Original unknown scope'}}/></section><section id="feed"><PublicReferenceCard reference={feed}/></section></div>
      <SourceDirectoryPreview directory={directory}/></main>
    </UiCopyProvider></LocaleProvider>};createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  for (const path of ["components/keryx/source-library-filters.tsx", "components/keryx/source-library-input.tsx", "components/keryx/explore-source-card.tsx", "components/keryx/cited-source-card.tsx", "components/keryx/public-reference-card.tsx", "components/keryx/source-directory-preview.tsx", "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx"])
    expect(inputs.some(input => input.endsWith(path))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  css += `@font-face{font-family:LibraryDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:LibrarySerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:LibraryMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:LibraryDisplay;--font-spectral:LibrarySerif;--font-spline-mono:LibraryMono}`;
  if (capture) await mkdir(capture, { recursive: true }); browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each((["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const).flatMap(locale => [320, 1366].map(width => ({ locale, width }))))(
  "keeps actual $locale source discovery, scope and native GET handoffs local at $width", async ({ locale, width }) => {
    const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", timezoneId: "UTC", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [], navigations: URL[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://library.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === "/library.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/sources") { unexpected.push(url.pathname); return route.abort(); }
        if (request.isNavigationRequest()) navigations.push(url);
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/library.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://library.test/sources");
      const language = page.locator("[data-language-switcher] select"); await expect.poll(() => language.isEnabled()).toBe(true);
      await language.selectOption(locale); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale); await page.evaluate(() => document.fonts.ready);
      const filters = page.locator("#browse-sources"), search = filters.locator('input[name="q"]');
      expect(await search.getAttribute("placeholder")).toBe(message("sourceFilter.placeholder", { database: "PostgreSQL", domain: "circle.com" }));
      expect(await filters.locator('input[name="author"]').getAttribute("placeholder")).toBe(message("sourceFilter.authorPlaceholder"));
      expect(await filters.locator('input[name="doi"]').getAttribute("placeholder")).toBe(message("sourceFilter.doiPlaceholder", { identifier: "10.…", url: "https://doi.org/…" }));
      expect(await page.locator("#cited article > p.border-l-2").textContent()).toBe(message("sourceCited.scopeBounded.excerpt"));
      expect(await page.locator("#unknown article > p.border-l-2").textContent()).toBe(message("sourceCited.scopeBounded.unrecorded"));
      expect(await page.locator("#cited h3").getAttribute("lang")).toBe("und"); expect(await page.locator("#cited h3").textContent()).toBe(cited.title);
      expect(await page.locator("#feed h3").textContent()).toContain(feed.name); expect(await page.locator("#explore h3").textContent()).toBe(explore.name);
      if (locale === "ar") {
        expect(await search.getAttribute("lang")).toBe("und"); expect(await search.getAttribute("dir")).toBe("auto");
        for (const selector of ["#cited h3", "#feed h3", "#explore h3"]) {
          expect(await page.locator(selector).getAttribute("dir")).toBe("auto");
          expect(await page.locator(selector).evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
        }
        const original = page.locator('#feed p[lang="und"]').filter({ hasText: feed.description });
        expect(await original.textContent()).toBe(feed.description);
        expect(await original.getAttribute("dir")).toBe("auto");
        expect(await original.evaluate(element => getComputedStyle(element).direction)).toBe("rtl");
        expect(await original.locator('bdi[dir="ltr"]').textContent()).toBe("<literal> {count}");
      }
      expect(await page.locator("#feed ul[aria-label]").getAttribute("aria-label")).toBe(message("sourceFeed.topics"));
      expect(await page.locator("#feed ul[aria-label] li").allTextContents()).toEqual(feed.tags);
      await page.locator("#feed details summary").click();
      for (const key of ["sourceFeed.fullText", "sourceFeed.excerpt", "sourceFeed.abstract", "sourceFeed.metadata"] as const) expect(await page.locator("#feed").textContent()).toContain(message(key));
      expect(await page.locator("#feed").textContent()).toContain(englishMessages["sourceFeed.paymentNotice"]);
      expect(await page.locator("#explore").textContent()).toContain(englishMessages["sourceExplore.draftNotice"]);
      const ask = new URL((await page.locator('#explore a[href^="/?q="]').getAttribute("href"))!, page.url());
      expect([...ask.searchParams.keys()]).toEqual(["q"]); expect(ask.searchParams.get("q")).toBe(`Summarize the guidance in ${explore.url}, with citations and evidence gaps clearly stated.`);
      expect(await page.locator('#cited a[href^="/dispatch/"]').getAttribute("href")).toBe("/dispatch/original%2Frun%3Fx%3D1");
      const summary = filters.locator("details summary"); await summary.focus(); await page.keyboard.press("Space");
      expect(await summary.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      const query = "Clear filters {count} 日本語 हिन्दी & original"; await search.fill(query);
      await filters.locator('input[name="author"]').fill("Original author"); await filters.locator('input[name="doi"]').fill("10.1234/original");
      await language.selectOption(locale === "fr" ? "ja" : "fr"); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale === "fr" ? "ja" : "fr");
      expect(await search.inputValue()).toBe(query); expect(await filters.locator('input[name="author"]').inputValue()).toBe("Original author");
      await language.selectOption(locale); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale);
      expect(await page.evaluate(() => (window as unknown as { libraryFixture: { unchanged(): boolean } }).libraryFixture.unchanged())).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const controls = await filters.locator("input,select,button,summary").evaluateAll(nodes => nodes.map(node => ({ rect: node.getBoundingClientRect().toJSON(), font: parseFloat(getComputedStyle(node).fontSize) })));
      expect(controls.every(({ rect }) => rect.height >= 44 && rect.left >= 0 && rect.right <= width)).toBe(true);
      expect(controls.filter((_, index) => index < 4).every(({ font }) => font >= 16)).toBe(true);
      if (capture) await page.screenshot({ path: join(capture, `library-${locale}-${width}-draft.png`), fullPage: true });
      const year = filters.locator('input[name="year"]'); await year.fill("20x");
      await filters.getByRole("button", { name: message("sourceFilter.find"), exact: true }).click(); expect(navigations).toHaveLength(1);
      expect(await year.evaluate(element => document.activeElement === element && !(element as HTMLInputElement).validity.valid)).toBe(true);
      await year.fill("2024"); await filters.locator('select[name="topic"]').selectOption("data-infrastructure"); await filters.locator('select[name="kind"]').selectOption("paper"); await filters.locator('select[name="sort"]').selectOption("recent");
      await Promise.all([page.waitForURL(url => url.searchParams.get("q") === query), filters.getByRole("button", { name: message("sourceFilter.find"), exact: true }).click()]);
      const applied = new URL(page.url()); expect(Object.fromEntries(applied.searchParams)).toEqual({ q: query, topic: "data-infrastructure", kind: "paper", sort: "recent", year: "2024", author: "Original author", doi: "10.1234/original" }); expect(applied.hash).toBe("#browse-sources");
      await expect.poll(() => language.inputValue()).toBe(locale); expect(await search.inputValue()).toBe(query); expect(await filters.locator("details").getAttribute("open")).not.toBeNull();
      expect(await filters.locator('select[name="kind"] option:checked').textContent()).toBe(message("sourceLibrary.papers"));
      const selectedLabels = await filters.locator("select").evaluateAll(nodes => nodes.map(node => {
        const select = node as HTMLSelectElement, style = getComputedStyle(select), canvas = document.createElement("canvas"), painter = canvas.getContext("2d")!;
        painter.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return { text: select.selectedOptions[0].textContent, textWidth: painter.measureText(select.selectedOptions[0].textContent ?? "").width,
          available: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24 };
      }));
      expect(selectedLabels.filter(label => label.textWidth > label.available + 2)).toEqual([]);
      if (capture) await page.screenshot({ path: join(capture, `library-${locale}-${width}-applied.png`), fullPage: true });
      await filters.getByRole("link", { name: message("sourceFilter.clear"), exact: true }).click(); await page.waitForURL(url => !url.search); await expect.poll(() => language.inputValue()).toBe(locale);
      expect(await search.inputValue()).toBe(""); expect(await year.inputValue()).toBe(""); expect(await filters.locator('input[name="author"]').inputValue()).toBe(""); expect(await filters.locator("details").getAttribute("open")).toBeNull();
      expect(navigations).toHaveLength(3); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 30_000);
