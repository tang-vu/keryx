import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  bundle = (await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ArchiveSearch} from './components/keryx/archive-search';
      const others=Array.from({length:53},(_,i)=>({id:'report-'+i,
        question:'Báo cáo đám mây '+i,sources:'Circle Arc USDC'}));
      const root=createRoot(document.getElementById('root'));
      window.renderArchive=(count=53)=>root.render(<ArchiveSearch
        terms={['Đánh giá đám mây Circle','Unrelated question Other publisher']}
        others={others.slice(0,count)}>
        <article>Đánh giá đám mây</article><article>Unrelated question</article>
      </ArchiveSearch>);
      window.renderArchive();
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "archive-link-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        loader: "jsx", resolveDir: process.cwd(), contents: "export default function Link(props){return <a {...props}/>}",
      }));
    } }],
  })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

it.each([320, 1366])("finds and opens every off-page match at %ipx", async (width) => {
  const context = await browser.newContext({ viewport: { width, height: 768 } });
  try {
    const requests: string[] = [];
    await context.route("**/*", (route) => {
      requests.push(route.request().url());
      return route.request().url() === "https://archive.test/"
        ? route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' })
        : route.abort();
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("https://archive.test/");
    await page.addScriptTag({ content: bundle });
    const search = page.getByRole("searchbox", { name: "Filter answers" });
    await search.waitFor({ timeout: 5_000 }).catch((error) => {
      throw new Error(`${pageErrors.join("; ")}: ${error.message}`);
    });
    expect(await page.locator("article:visible").count()).toBe(2);
    expect(await page.getByRole("link").count()).toBe(0);

    await search.fill("  circle   may dam  ");
    await page.getByRole("status").filter({ hasText: "54 found" }).waitFor();
    expect(await page.locator("article:visible").allTextContents()).toEqual(["Đánh giá đám mây"]);
    const newer = page.getByRole("button", { name: "← Newer" });
    const older = page.getByRole("button", { name: "Older →" });
    expect(await newer.isDisabled()).toBe(true);
    const seen: string[] = [];
    for (let index = 0; index < 3; index++) {
      const links = page.getByRole("link");
      expect(await links.count()).toBe(index === 2 ? 3 : 25);
      seen.push(...await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!)));
      if (index < 2) await older.click();
    }
    expect(seen).toEqual(Array.from({ length: 53 }, (_, i) => `/dispatch/report-${i}`));
    expect(await older.isDisabled()).toBe(true);
    await newer.click();
    expect(await page.getByRole("link").first().textContent()).toBe("Báo cáo đám mây 25");

    // A new query always starts at the first result page, including source-only matches.
    await search.fill("usdc");
    await page.getByRole("status").filter({ hasText: "53 found" }).waitFor();
    expect(await page.locator("article:visible").count()).toBe(0);
    expect(await page.getByRole("link").first().getAttribute("href")).toBe("/dispatch/report-0");
    await older.click();
    // Data can shrink during navigation without leaving the search on a nonexistent page.
    await page.evaluate(() => (window as unknown as { renderArchive(count: number): void }).renderArchive(1));
    await page.getByRole("status").filter({ hasText: "1 found" }).waitFor();
    expect(await page.getByRole("link").count()).toBe(1);

    await search.fill("no such answer");
    await page.getByRole("status").filter({ hasText: "0 found" }).waitFor();
    expect(await page.getByText(/No answer in the archive matches/).count()).toBe(1);
    await search.fill(" \t ");
    expect(await page.locator("article:visible").count()).toBe(2);
    expect(await page.getByRole("link").count()).toBe(0);
    expect(await page.getByRole("button").count()).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(requests).toEqual(["https://archive.test/"]);
  } finally {
    await context.close();
  }
});
