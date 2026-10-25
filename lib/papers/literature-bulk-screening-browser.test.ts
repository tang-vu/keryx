import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";
import { literatureSearchCopy as search } from "../../locales/en/literature-search";

import { literatureBulkScreeningCopy as bulk } from "../../locales/en/literature-bulk-screening";
const copy = createMessages("en");
const titles = ["Đường truyền", "Retrieval systems", "Other topic"];
const workspace = () => {
  let value = emptyLiteratureWorkspace();
  for (const [index, paper] of PAPER_CATALOG.slice(0, 3).entries())
    value = saveLiteraturePaper(value, { ...paper, title: titles[index], authors: [index === 0 ? "José Đặng" : "Example Author"],
      authorCount: 1, authorsTruncated: false }, "2026-10-20T00:00:00Z");
  value.question = "Grounding methods";
  value.entries[0].notes = "PRIVATE FIELDNOTE alpha systems"; value.entries[0].screening = "include";
  value.entries[1].notes = "PRIVATE FIELDNOTE beta"; value.entries[1].screening = "include";
  value.entries[2].notes = "PRIVATE FIELDNOTE alpha"; value.entries[2].screening = "exclude";
  return value;
};
let browser: Browser, bundle: string, css = "";
beforeAll(async () => {
  if (process.env.KERYX_LITERATURE_CSS) css = await readFile(process.env.KERYX_LITERATURE_CSS, "utf8");
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    createRoot(document.getElementById('root')).render(<LiteratureWorkspace/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "plain-next-link", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(), contents:
        `import React from 'react';export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}` }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const card = (page: Page, index: number) => page.locator("article").filter({ has: page.getByRole("checkbox", {
  name: copy("literatureWorkspace.compareLabel", { title: titles[index] }), exact: true,
}) });
async function boot(page: Page, raw?: string) {
  await page.goto("https://literature-search.test/");
  if (raw) await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY, raw });
  await page.addScriptTag({ content: bundle });
  await page.getByLabel(search.label, { exact: true }).waitFor();
}
async function fixture(width: number, run: (page: Page, raw: string) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://literature-search.test/" ? route.fulfill({ contentType: "text/html", body:
        `<meta charset="utf-8"><style>${css || "*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}"}</style><main id="root"></main>` }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    const raw = serializeLiteratureWorkspace(workspace()); await boot(page, raw);
    try { await run(page, raw); }
    catch (error) { throw new Error(`${String(error)}; browser errors: ${JSON.stringify(errors)}`, { cause: error }); }
    expect(errors).toEqual([]);
    expect(requests.every(url => url === "https://literature-search.test/")).toBe(true);
  } finally { await context.close(); }
}
const rawState = (page: Page) => page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY);
const openBulk = async (page: Page) => { await page.getByText(bulk.summary, { exact: true }).click(); };
const preview = (page: Page) => page.getByRole("button", { name: bulk.preview, exact: true });
const confirm = (page: Page) => page.getByRole("button", { name: bulk.confirm, exact: true });
const region = (page: Page) => page.getByRole("region", { name: bulk.previewTitle, exact: true });

it.each([320, 1440])("previews exact shown papers, confirms frozen targets and preserves private editors/selection at %ipx", width => fixture(width, async page => {
  const current = workspace();
  await card(page, 0).getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
  const notes = card(page, 0).getByLabel(copy("literatureWorkspace.notesLabel")); await notes.fill("UNSAVED private editor");
  await card(page, 0).getByRole("checkbox").check(); await card(page, 1).getByRole("checkbox").check();
  const prepared = page.getByRole("link", { name: copy("literatureWorkspace.prepare"), exact: true }), href = await prepared.getAttribute("href");
  await page.getByLabel(search.label, { exact: true }).fill("alpha"); await openBulk(page);
  await page.getByLabel(bulk.decision, { exact: true }).selectOption("undecided"); await preview(page).click();
  expect(await region(page).locator("li").count()).toBe(2);
  expect(await region(page).locator("li").allTextContents()).toEqual([expect.stringContaining(titles[0]), expect.stringContaining(titles[2])]);
  expect(await region(page).textContent()).not.toContain("PRIVATE"); expect(await region(page).textContent()).not.toContain("UNSAVED");
  expect(await page.getByRole("heading", { name: bulk.previewTitle, exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
  await page.getByLabel(search.label, { exact: true }).fill("beta");
  expect(await region(page).locator("li").count()).toBe(2); await confirm(page).click();
  await page.getByText(bulk.saved, { exact: true }).waitFor();
  expect(await preview(page).evaluate(el => el === document.activeElement)).toBe(true);
  const stored = JSON.parse((await rawState(page))!);
  expect(stored.entries.map((entry: { screening: string }) => entry.screening)).toEqual(["undecided", "include", "undecided"]);
  expect({ ...stored, entries: stored.entries.map((entry: object, index: number) => ({ ...entry, screening: current.entries[index].screening })) }).toEqual(current);
  expect(await prepared.getAttribute("href")).toBe(href);
  await page.getByRole("button", { name: search.clear, exact: true }).click(); expect(await notes.inputValue()).toBe("UNSAVED private editor");
  expect(await card(page, 0).getByText(copy("literatureWorkspace.staleScreening"), { exact: true }).count()).toBe(1);
  if (css) {
    await preview(page).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const control of [preview(page), confirm(page)]) { const bounds = await control.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); }
    if (process.env.KERYX_LITERATURE_SCREENSHOT_DIR) { await mkdir(process.env.KERYX_LITERATURE_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.KERYX_LITERATURE_SCREENSHOT_DIR, `bulk-${width}.png`), fullPage: true }); }
  }
}));

it("cancels without writes and refuses preview when the shown set is empty", () => fixture(1440, async (page, raw) => {
  await openBulk(page); await preview(page).click(); await page.getByRole("button", { name: bulk.cancel, exact: true }).click();
  expect(await region(page).count()).toBe(0); expect(await preview(page).evaluate(el => el === document.activeElement)).toBe(true);
  expect(await rawState(page)).toBe(raw);
  await page.getByLabel(search.label, { exact: true }).fill("no matching saved title"); expect(await preview(page).isDisabled()).toBe(true);
}));

it("refuses the complete change after another tab edits a previewed note", () => fixture(1440, async page => {
  await page.getByLabel(copy("literatureWorkspace.filter")).selectOption("include"); await openBulk(page);
  await page.getByLabel(bulk.decision, { exact: true }).selectOption("exclude"); await preview(page).click();
  const other = await page.context().newPage(); await boot(other);
  await card(other, 1).getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
  await card(other, 1).getByLabel(copy("literatureWorkspace.notesLabel")).fill("Newer private note from other tab");
  await card(other, 1).getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true }).click();
  await other.getByText("Newer private note from other tab", { exact: true }).waitFor();
  await confirm(page).click(); await page.getByText(bulk.stale, { exact: true }).waitFor();
  const stored = JSON.parse((await rawState(page))!);
  expect(stored.entries.map((entry: { screening: string }) => entry.screening)).toEqual(["include", "include", "exclude"]);
  expect(stored.entries[1].notes).toBe("Newer private note from other tab"); expect(await region(page).locator("li").count()).toBe(2);
}));

it("keeps keyboard focus on the screening disclosure when a confirmed decision empties the filter", () => fixture(320, async page => {
  await page.getByLabel(copy("literatureWorkspace.filter")).selectOption("include"); await openBulk(page);
  await page.getByLabel(bulk.decision, { exact: true }).selectOption("exclude"); await preview(page).click(); await confirm(page).click();
  await page.getByText(bulk.saved, { exact: true }).waitFor(); expect(await preview(page).isDisabled()).toBe(true);
  expect(await page.getByText(bulk.summary, { exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
  expect(JSON.parse((await rawState(page))!).entries.map((entry: { screening: string }) => entry.screening)).toEqual(["exclude", "exclude", "exclude"]);
}));

it("keeps the preview after a refused storage write and disables actions while waiting for the workspace lock", () => fixture(1440, async (page, raw) => {
  await openBulk(page); await preview(page).click();
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = () => { throw new Error("Synthetic storage refusal"); }; });
  await confirm(page).click(); await page.getByText(bulk.failed, { exact: true }).waitFor(); expect(await rawState(page)).toBe(raw);
  await page.evaluate(() => (window as unknown as { restoreStorage(): void }).restoreStorage());
  const other = await page.context().newPage(); await boot(other);
  await other.evaluate(key => new Promise<void>(ready => { navigator.locks.request(key, () => new Promise<void>(release => { (window as unknown as { releaseLibraryLock(): void }).releaseLibraryLock = release; ready(); })); }), LITERATURE_STORAGE_KEY);
  await confirm(page).click(); const saving = page.getByRole("button", { name: bulk.applying, exact: true });
  await saving.waitFor(); expect(await saving.isDisabled()).toBe(true); expect(await preview(page).isDisabled()).toBe(true);
  expect(await page.getByRole("button", { name: bulk.cancel, exact: true }).isDisabled()).toBe(true);
  await other.evaluate(() => (window as unknown as { releaseLibraryLock(): void }).releaseLibraryLock());
  await page.getByText(bulk.saved, { exact: true }).waitFor(); expect(await region(page).count()).toBe(0);
}));
