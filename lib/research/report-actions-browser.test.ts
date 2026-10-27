import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
type Fixture = { mode(value: "defer" | "throw" | "missing"): void; settle(success: boolean): void;
  report(index: number): void; writes: string[]; failDownload(value: boolean): void;
  failLink(stage: "none" | "create" | "append" | "click"): void;
  allocated: string[]; revoked: string[]; connections: boolean[] };
const fonts = `@font-face{font-family:ReportDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:ReportSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:ReportMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
  :root{--font-bodoni:ReportDisplay;--font-spectral:ReportSerif;--font-spline-mono:ReportMono}`;

beforeAll(async () => {
  bundle = (await build({
    stdin: { contents: `import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';
      import{ReportActions}from'./components/keryx/report-actions';
      const pending=[];let mode='defer',downloadFailure='none';
      const nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL),nativeElement=document.createElement.bind(document),
        nativeAppend=document.body.appendChild.bind(document.body),nativeClick=HTMLAnchorElement.prototype.click;
      const fixture=window.reportFixture={writes:[],allocated:[],revoked:[],connections:[],mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:value==='missing'?undefined:{writeText(text){
        fixture.writes.push(text);if(mode==='throw')throw Error('PRIVATE_CLIPBOARD_DETAIL');
        return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}})},
        settle(success){const request=pending.shift();if(!request)throw Error('No pending synthetic clipboard request');success?request.resolve():request.reject(Error('PRIVATE_PERMISSION_DETAIL'))},
        failDownload(value){downloadFailure=value?'url':'none'},failLink(stage){downloadFailure=stage}};
      URL.createObjectURL=blob=>{if(downloadFailure==='url')throw Error('PRIVATE_DOWNLOAD_DETAIL');const url=nativeCreate(blob);fixture.allocated.push(url);return url;};
      URL.revokeObjectURL=url=>{fixture.revoked.push(url);nativeRevoke(url);};
      document.createElement=(name,...options)=>{if(name==='a'&&downloadFailure==='create')throw Error('PRIVATE_LINK_DETAIL');return nativeElement(name,...options);};
      document.body.appendChild=node=>{if(node instanceof HTMLAnchorElement&&downloadFailure==='append')throw Error('PRIVATE_APPEND_DETAIL');return nativeAppend(node);};
      HTMLAnchorElement.prototype.click=function(){fixture.connections.push(this.isConnected);if(downloadFailure==='click')throw Error('PRIVATE_CLICK_DETAIL');return nativeClick.call(this);};
      fixture.mode('defer');
      const reports=['report/alpha?x=1','report-beta'].map((id,index)=>({id,question:index?'Second question':'First question',answer:index?'Second report body [S1].':'First report body [S1].',
        budget:0.01,engine:'fixture',subClaims:[],decisions:[],createdAt:'2026-10-01',trace:[],paymentMode:'offline',totalSpent:0,totalToCreators:0,
        citations:[{marker:'S1',sourceId:'source',sourceName:'Synthetic publisher',itemTitle:'Observed public source',itemUrl:'https://publisher.invalid/article',contentVersion:'recorded-v2',weight:1,reward:0,rationale:'fixture'}],
        evidence:[{marker:'S1',claim:'Measured result',quote:'Exact recorded excerpt.',qualifiesForAnswer:true,qualifiesForReward:false}]}));
      const payments=[{kind:'citation',sourceName:'Synthetic writer',amountUsdc:0.001,settled:false,settlementStatus:'pending'}];
      function App(){const[index,setIndex]=useState(0);fixture.report=setIndex;return <><h2 style={{fontFamily:'var(--font-bodoni)',fontSize:30,marginBottom:16}}>{reports[index].question}</h2><ReportActions run={reports[index]} meta={null} payments={payments}/></>}
      createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion, acceptDownloads: true });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      expect(request.method()).toBe("GET"); expect(url.origin).toBe("https://report-tools.test");
      requests.push(url.pathname);
      if (url.pathname === "/toolbar.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/toolbar.css"></head><body><div id="root" style="max-width:900px;margin:32px auto;padding:0 16px"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://report-tools.test/");
    await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "Copy report", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await run(page);
    expect(errors).toEqual([]); expect(requests.some(path => path.startsWith("/api/"))).toBe(false);
  } finally { await context.close(); }
}
const settle = (page: Page, success: boolean) => page.evaluate(value => (window as unknown as { reportFixture: Fixture }).reportFixture.settle(value), success);
const report = (page: Page, index: number) => page.evaluate(value => (window as unknown as { reportFixture: Fixture }).reportFixture.report(value), index);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { reportFixture: Fixture }).reportFixture.writes);
const lifecycle = (page: Page) => page.evaluate(() => {
  const value = (window as unknown as { reportFixture: Fixture }).reportFixture;
  return { allocated: value.allocated, revoked: value.revoked, connections: value.connections };
});

it.each(["create", "append", "click"] as const)("releases allocated URLs when report download fails at %s and permits an exact retry", async stage => {
  await fixture(async page => {
    await page.getByRole("button", { name: "Copy report", exact: true }).click(); await settle(page, true);
    const expected = (await writes(page))[0];
    await page.evaluate(stage => (window as unknown as { reportFixture: Fixture }).reportFixture.failLink(stage), stage);
    const download = page.getByRole("button", { name: "Download report", exact: true }); await download.click();
    await expect.poll(() => page.getByRole("status").textContent()).toBe("Download unavailable. Open the saved report instead.");
    const failed = await lifecycle(page); expect(failed.allocated).toHaveLength(1);
    await expect.poll(async () => (await lifecycle(page)).revoked, { timeout: 5000 }).toEqual(failed.allocated);
    expect(await page.locator("a[download]").count()).toBe(0);
    await page.evaluate(() => (window as unknown as { reportFixture: Fixture }).reportFixture.failLink("none"));
    const pendingDownload = page.waitForEvent("download"); await download.click(); const file = await pendingDownload;
    expect(file.suggestedFilename()).toBe("keryx-report-reportalphax1.md");
    const stream = await file.createReadStream(); if (!stream) throw Error("Actual retry download missing");
    const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
    expect(Buffer.concat(parts).toString("utf8")).toBe(expected);
    expect(await page.getByRole("status").textContent()).toBe("Report downloaded with citations and payment states.");
    const retried = await lifecycle(page); expect(retried.allocated).toHaveLength(2);
    expect(retried.connections.length).toBeGreaterThan(0); expect(retried.connections.every(Boolean)).toBe(true);
    await expect.poll(async () => (await lifecycle(page)).revoked, { timeout: 5000 }).toEqual(retried.allocated);
    expect(await page.locator("a[download]").count()).toBe(0);
  });
});

it("keeps clipboard feedback truthful through pending, denial, synchronous failure and unsupported clipboard", async () => {
  await fixture(async page => {
    const copy = page.getByRole("button", { name: "Copy report", exact: true }), status = page.getByRole("status");
    await copy.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => copy.getAttribute("aria-busy")).toBe("true");
    expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press("Enter");
    const box = await copy.boundingBox(); if (!box) throw Error("Copy action missing");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await writes(page)).toHaveLength(1);
    expect(await status.textContent()).toBe("");
    await settle(page, true);
    await expect.poll(() => status.textContent()).toBe("Report copied with citations and payment states.");
    expect(await copy.getAttribute("aria-busy")).toBe("false");
    expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
    const exported = (await writes(page))[0];
    expect(exported).toContain("First report body [S1]."); expect(exported).toContain("https://publisher.invalid/article");
    expect(exported).toContain("recorded-v2"); expect(exported).toContain("Exact recorded excerpt.");
    expect(exported).toContain("citation · pending"); expect(exported).toContain("A citation alone does not prove settlement");
    await copy.click(); await settle(page, false);
    await expect.poll(() => status.textContent()).toBe("Copy unavailable. Download the report instead.");
    expect(await copy.getAttribute("aria-disabled")).toBe("false");
    await page.evaluate(() => (window as unknown as { reportFixture: Fixture }).reportFixture.mode("throw"));
    await copy.click();
    await expect.poll(() => status.textContent()).toBe("Copy unavailable. Download the report instead.");
    expect(await copy.getAttribute("aria-busy")).toBe("false");
    await page.evaluate(() => (window as unknown as { reportFixture: Fixture }).reportFixture.mode("missing"));
    await copy.click();
    expect(await status.textContent()).not.toContain("PRIVATE");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report", exact: true }).click();
    const file = await download; expect(file.suggestedFilename()).toBe("keryx-report-reportalphax1.md");
    const stream = await file.createReadStream(); if (!stream) throw Error("Actual download missing");
    const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
    expect(Buffer.concat(parts).toString("utf8")).toBe(exported);
    expect(await status.textContent()).toBe("Report downloaded with citations and payment states.");
    await page.evaluate(() => (window as unknown as { reportFixture: Fixture }).reportFixture.failDownload(true));
    await page.getByRole("button", { name: "Download report", exact: true }).click();
    await expect.poll(() => status.textContent()).toBe("Download unavailable. Open the saved report instead.");
    expect(await page.getByRole("link", { name: "Open saved report" }).getAttribute("href")).toBe("/dispatch/report%2Falpha%3Fx%3D1");
    expect(await page.locator('a[href="/operator/evidence"]').count()).toBe(1);
  });
});

it("isolates notices and pending clipboard outcomes between reports", async () => {
  await fixture(async page => {
    const copy = page.getByRole("button", { name: "Copy report", exact: true }), status = page.getByRole("status");
    await copy.click(); await settle(page, true);
    await expect.poll(() => status.textContent()).toBe("Report copied with citations and payment states.");
    await report(page, 1);
    await page.getByRole("heading", { name: "Second question" }).waitFor();
    expect(await status.textContent()).toBe("");
    await copy.click();
    await expect.poll(() => copy.getAttribute("aria-busy")).toBe("true");
    await report(page, 0);
    await page.getByRole("heading", { name: "First question" }).waitFor();
    expect(await status.textContent()).toBe("");
    expect(await copy.getAttribute("aria-busy")).toBe("false");
    await settle(page, true);
    expect(await status.textContent()).toBe("");
    await copy.click(); await settle(page, true);
    await expect.poll(() => status.textContent()).toBe("Report copied with citations and payment states.");
    expect((await writes(page)).at(-1)).toContain("First report body [S1].");
    expect((await writes(page)).at(-1)).not.toContain("Second report body");
  });
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "fits report actions and preserves live motion/focus at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const geometry = await page.locator("button, a").evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
      }));
      expect(geometry.every(box => box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= width)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const copy = page.getByRole("button", { name: "Copy report", exact: true });
      await page.keyboard.press("Tab"); await copy.focus();
      expect(await copy.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect.poll(() => copy.getAttribute("aria-busy")).toBe("true");
      expect(await copy.locator("svg").evaluate(element => getComputedStyle(element).animationName === "none")).toBe(motion === "reduce");
      if (screenshots) await page.screenshot({ path: join(screenshots, `report-actions-${width}-${motion}-pending.png`), fullPage: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('button[aria-busy="true"] svg')!).animationName === "none");
      expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
      await settle(page, true);
      await expect.poll(() => page.getByRole("status").textContent()).toBe("Report copied with citations and payment states.");
      expect(await copy.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.effect?.getTiming().iterations === Infinity))).toBe(false);
      if (screenshots) await page.screenshot({ path: join(screenshots, `report-actions-${width}-${motion}.png`), fullPage: true });
    }, width, motion);
  });
