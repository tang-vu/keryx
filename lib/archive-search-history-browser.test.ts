import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, webkit, type Browser, type Page } from "playwright";

let browser: Browser;
let bundle: string;
const origin = "https://archive-history.test";

beforeAll(async () => {
  bundle = (await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ArchiveSearch} from './components/keryx/archive-search';
      const others=Array.from({length:53},(_,i)=>({id:'report-'+i,question:'Báo cáo đám mây '+i,sources:'Circle Arc USDC'}));
      const root=createRoot(document.getElementById('root'));
      window.rerenderArchive=()=>root.render(<ArchiveSearch
        terms={['Đánh giá đám mây Circle','Unrelated question']}
        others={others}><article>Đánh giá đám mây</article><article>Unrelated question</article></ArchiveSearch>);
      window.rerenderArchive();
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "archive-link", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(),
        contents: "export default function Link(props){return <a {...props}/>}" }));
    } }],
  })).outputFiles[0].text;
  browser = await (process.env.KERYX_UX_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
});

afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page, requests: string[]) => Promise<void>, url = "/answers?language=vi#results") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      const request = route.request(), target = new URL(request.url());
      requests.push(request.method() + " " + target.pathname);
      expect(target.origin).toBe(origin);
      expect(request.method()).toBe("GET");
      const report = target.pathname.startsWith("/dispatch/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' +
        (report ? '<h1>Saved report</h1>' : '<div id="root"></div><script>' + bundle + '</script>') });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + url);
    await page.getByRole("searchbox").waitFor();
    await run(page, requests);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

it("keeps a search and result page after reload and return from a report", async () => {
  await fixture(async (page, requests) => {
    const search = page.getByRole("searchbox");
    await search.fill("ĐÁM mây circle");
    await page.getByRole("button", { name: "Older →", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("ĐÁM mây circle");
    expect(new URL(page.url()).searchParams.get("searchPage")).toBe("2");
    expect(new URL(page.url()).searchParams.get("language")).toBe("vi");
    expect(new URL(page.url()).hash).toBe("#results");
    expect(requests).toEqual(["GET /answers"]);
    await page.reload();
    await expect.poll(() => search.inputValue()).toBe("ĐÁM mây circle");
    await page.getByText("Matches 26–50 of 53", { exact: true }).waitFor();
    await page.getByRole("link").first().click();
    await page.getByRole("heading", { name: "Saved report" }).waitFor();
    await page.goBack();
    await expect.poll(() => search.inputValue()).toBe("ĐÁM mây circle");
    await page.getByText("Matches 26–50 of 53", { exact: true }).waitFor();
    expect(await page.getByRole("link").first().getAttribute("href")).toBe("/dispatch/report-25");
  });
});

it("restores history entries and resets result position when editing or clearing", async () => {
  await fixture(async page => {
    const search = page.getByRole("searchbox");
    await search.fill("usdc");
    const older = page.getByRole("button", { name: "Older →", exact: true });
    await older.click(); await older.click();
    await page.getByText("Matches 51–53 of 53", { exact: true }).waitFor();
    await page.goBack();
    await page.getByText("Matches 26–50 of 53", { exact: true }).waitFor();
    await page.goForward();
    await page.getByText("Matches 51–53 of 53", { exact: true }).waitFor();
    await search.fill("circle");
    await page.getByText("Matches 1–25 of 53", { exact: true }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.has("searchPage")).toBe(false);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    expect(await search.inputValue()).toBe("");
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    expect(new URL(page.url()).searchParams.get("language")).toBe("vi");
    expect(new URL(page.url()).hash).toBe("#results");
    expect(await page.locator("article:visible").count()).toBe(2);
    expect(await search.evaluate(node => node === document.activeElement)).toBe(true);
  });
});

it.each(["0", "-2", "bad", "2.5", "999999999999999999999999"])("handles invalid searchPage=%s safely", async searchPage => {
  await fixture(async page => {
    await expect.poll(() => page.getByRole("searchbox").inputValue()).toBe("usdc");
    await page.getByText("Matches 1–25 of 53", { exact: true }).waitFor();
  }, "/answers/topic/cloud?q=usdc&searchPage=" + searchPage);
});

it("clamps an old result position to the remaining results", async () => {
  await fixture(async page => {
    await expect.poll(() => page.getByRole("searchbox").inputValue()).toBe("usdc");
    await page.getByText("Matches 51–53 of 53", { exact: true }).waitFor();
  }, "/answers/page/2?q=usdc&searchPage=999");
});

it("preserves rapid edits before an immediate reload and does not resurrect a cleared query", async () => {
  await fixture(async page => {
    const search = page.getByRole("searchbox");
    await search.fill("usdc");
    await page.reload();
    await expect.poll(() => search.inputValue()).toBe("usdc");
    await page.getByText("Matches 1–25 of 53", { exact: true }).waitFor();
    await search.fill("circle");
    await search.press("Escape");
    await page.reload();
    expect(await search.inputValue()).toBe("");
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  });
});

it("replaces typing history and preserves unrelated entry state", async () => {
  await fixture(async page => {
    const initialLength = await page.evaluate(() => {
      window.history.replaceState({ customArchiveState: "retained" }, "", window.location.href);
      return window.history.length;
    });
    await page.getByRole("searchbox").pressSequentially("circle");
    expect(await page.evaluate(() => window.history.length)).toBe(initialLength);
    expect(await page.evaluate(() => window.history.state.customArchiveState)).toBe("retained");
    await page.getByRole("button", { name: "Older →", exact: true }).click();
    expect(await page.evaluate(() => window.history.length)).toBe(initialLength + 1);
    expect(await page.evaluate(() => window.history.state.customArchiveState)).toBe("retained");
  });
});

it("uses the new URL when a route update reuses the mounted archive", async () => {
  await fixture(async page => {
    await page.getByRole("searchbox").fill("circle");
    await page.evaluate(() => {
      window.history.replaceState(null, "", "/answers?language=zh&q=unrelated");
      (window as unknown as { rerenderArchive(): void }).rerenderArchive();
    });
    await expect.poll(() => page.getByRole("searchbox").inputValue()).toBe("unrelated");
    expect(await page.locator("article:visible").allTextContents()).toEqual(["Unrelated question"]);
  });
});

it("keeps filtering usable when the browser refuses history updates", async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      window.history.replaceState = window.history.pushState = () => { throw new DOMException("History unavailable", "SecurityError"); };
    });
    const search = page.getByRole("searchbox");
    await search.fill("usdc");
    await page.getByRole("button", { name: "Older →", exact: true }).click();
    await page.getByText("Matches 26–50 of 53", { exact: true }).waitFor();
    await search.fill("missing query");
    await page.getByText(/No answer in the archive matches/).waitFor();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    expect(await page.locator("article:visible").count()).toBe(2);
  });
});
