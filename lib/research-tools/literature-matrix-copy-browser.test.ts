import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { researchGuidesCopy } from "@/locales/en/research-guides";
import { emptyMatrixRow, literatureMatrixCsv } from "./literature-matrix";

const copy = researchGuidesCopy.tool;
type Fixture = { writes: string[]; mode: string; settle(ok: boolean): void };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{LiteratureReviewMatrix}from'./components/keryx/literature-review-matrix';
    const pending=[];const f=window.fixture={writes:[],mode:'defer',settle(ok){const p=pending.shift();ok?p.resolve():p.reject(Error('PRIVATE_DENIED'));}};
    Object.defineProperty(navigator,'clipboard',{value:{writeText(text){f.writes.push(text);if(f.mode==='reject')return Promise.reject(Error('PRIVATE_DENIED'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});
    createRoot(document.getElementById('root')).render(<StrictMode><LiteratureReviewMatrix/></StrictMode>);` }, plugins: [{ name: "local-link", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "link" }));
    b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: "import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://matrix-copy.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    await page.goto("https://matrix-copy.test/"); await page.addScriptTag({ content: bundle }); await page.getByLabel(copy.question, { exact: true }).fill("Research scope"); await page.getByRole("button", { name: copy.add, exact: true }).click(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://matrix-copy.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button", { name: copy.copy, exact: true });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.writes);
const settle = (page: Page, ok: boolean) => page.evaluate(async ok => { (window as unknown as { fixture: Fixture }).fixture.settle(ok); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }, ok);
it("copies the exact CSV once while pending without marking the worksheet saved", async () => fixture(async page => {
  await button(page).click(); await button(page).evaluate(e => (e as HTMLButtonElement).click());
  expect(await writes(page)).toEqual([literatureMatrixCsv("Research scope", [emptyMatrixRow()])]); expect(await button(page).getAttribute("aria-busy")).toBe("true");
  expect(await page.getByRole("status").textContent()).toBe(""); await settle(page, true); await page.getByText(copy.copied, { exact: true }).waitFor();
  await page.getByText(copy.unsaved, { exact: true }).waitFor();
}));
it.each(["question", "cell", "add", "remove"].flatMap(change => [true, false].map(ok => ({ change, ok }))))("discards late $ok feedback after a $change revision", async ({ change, ok }) => fixture(async page => {
  await button(page).click();
  if (change === "question") await page.getByLabel(copy.question, { exact: true }).fill("New scope");
  if (change === "cell") await page.getByLabel(copy.columns.title, { exact: true }).fill("New title");
  if (change === "add") await page.getByRole("button", { name: copy.add, exact: true }).click();
  if (change === "remove") await page.getByRole("button", { name: `${copy.remove} 1`, exact: true }).click();
  await settle(page, ok); expect(await page.getByRole("status").textContent()).toBe("");
  await button(page).click(); await settle(page, true); await page.getByText(copy.copied, { exact: true }).waitFor();
  const row = { ...emptyMatrixRow(), ...(change === "cell" ? { title: "New title" } : {}) };
  expect((await writes(page)).at(-1)).toBe(literatureMatrixCsv(change === "question" ? "New scope" : "Research scope", change === "remove" ? [] : change === "add" ? [row, emptyMatrixRow()] : [row]));
  await page.getByText(copy.unsaved, { exact: true }).waitFor();
}));
it("reports clipboard denial with existing guidance and permits a fresh retry", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "reject"; }); await button(page).click(); await page.getByText(copy.copyFailed, { exact: true }).waitFor();
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "defer"; }); await button(page).click(); await settle(page, true); await page.getByText(copy.copied, { exact: true }).waitFor();
}));
