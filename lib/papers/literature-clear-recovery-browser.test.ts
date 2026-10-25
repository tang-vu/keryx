import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";
import { literatureSearchCopy as search } from "../../locales/en/literature-search";

import { literatureClearRecoveryCopy as recovery } from "../../locales/en/literature-clear-recovery";
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
    import {clearLiteratureWithRecovery} from './lib/papers/literature-browser-store';
    window.refuseRetention=()=>clearLiteratureWithRecovery(()=>{throw new Error('Synthetic retention refusal')});
    window.asyncRetention=()=>clearLiteratureWithRecovery(()=>Promise.resolve());
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
const warns = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
const expectWarning = async (page: Page, value: boolean) => { await expect.poll(() => warns(page)).toBe(value); };
const restore = (page: Page) => page.getByRole("button", { name: recovery.restore, exact: true });
const checkpoint = (page: Page) => page.getByRole("region", { name: recovery.title, exact: true });
async function clear(page: Page) {
  const disclosure = page.getByText(copy("literatureWorkspace.clearDetails"), { exact: true });
  if (!(await disclosure.evaluate(el => (el.parentElement as HTMLDetailsElement).open))) await disclosure.click();
  const opened = page.waitForEvent("dialog"), click = page.getByRole("button", { name: copy("literatureWorkspace.clear"), exact: true }).click();
  const dialog = await opened; expect(dialog.message()).toBe(copy("literatureWorkspace.clearConfirm")); await dialog.accept(); await click;
}
async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: recovery.download, exact: true }).click()]);
  return JSON.parse(await readFile((await file.path())!, "utf8"));
}
async function restoreStorage(page: Page) {
  await page.evaluate(key => { (window as unknown as { restoreStorage(): void }).restoreStorage(); window.dispatchEvent(new StorageEvent("storage", { key })); }, LITERATURE_STORAGE_KEY);
}

it.each([320, 1440])("restores the saved library with exact private fields and meaningful native focus at %ipx", width => fixture(width, async page => {
  const original = workspace();
  await card(page, 0).getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
  await card(page, 0).getByLabel(copy("literatureWorkspace.notesLabel")).fill("UNSAVED form input excluded from checkpoint");
  await clear(page); await checkpoint(page).waitFor(); expect(await rawState(page)).toBeNull(); await expectWarning(page, true);
  expect(await page.getByRole("heading", { name: recovery.title, exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
  expect(await download(page)).toEqual(original); await expectWarning(page, true);
  expect(await page.getByRole("button", { name: copy("literatureWorkspace.clear"), exact: true }).isDisabled()).toBe(true);
  if (css) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bounds = await restore(page).boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (process.env.KERYX_LITERATURE_SCREENSHOT_DIR) { await mkdir(process.env.KERYX_LITERATURE_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.KERYX_LITERATURE_SCREENSHOT_DIR, `clear-${width}.png`), fullPage: true }); }
  }
  await restore(page).click(); await page.getByText(recovery.restored, { exact: true }).waitFor();
  expect(JSON.parse((await rawState(page))!)).toEqual(original); expect(await checkpoint(page).count()).toBe(0); await expectWarning(page, false);
  expect(await page.getByRole("heading", { name: copy("literatureWorkspace.focusTitle"), exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
}));

it("refuses clear before deletion if synchronous retention fails or an async callback is supplied", () => fixture(1440, async (page, raw) => {
  const failure = await page.evaluate(async () => { try { await (window as unknown as { refuseRetention(): Promise<void> }).refuseRetention(); } catch { return true; } return false; });
  expect(failure).toBe(true); expect(await rawState(page)).toBe(raw);
  const asyncRefusal = await page.evaluate(async () => { try { await (window as unknown as { asyncRetention(): Promise<void> }).asyncRetention(); } catch { return true; } return false; });
  expect(asyncRefusal).toBe(true); expect(await rawState(page)).toBe(raw); expect(await checkpoint(page).count()).toBe(0); await expectWarning(page, false);
}));

it("retains a downloadable checkpoint after removal failure and accepts the identical already-retained library", () => fixture(1440, async (page, raw) => {
  await page.evaluate(() => { const original = Storage.prototype.removeItem;
    (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.removeItem = original; };
    Storage.prototype.removeItem = () => { throw new Error("Synthetic removal refusal"); };
  });
  await clear(page); await page.getByText(copy("paperWorkspace.clearFailed"), { exact: true }).waitFor();
  expect(await rawState(page)).toBe(raw); expect(await download(page)).toEqual(workspace()); await expectWarning(page, true);
  await restoreStorage(page); await restore(page).click(); await page.getByText(recovery.restored, { exact: true }).waitFor();
  expect(JSON.parse((await rawState(page))!)).toEqual(workspace()); await expectWarning(page, false);
}));

it("keeps recovery downloadable when deletion readback makes storage inaccessible", () => fixture(1440, async page => {
  await page.evaluate(() => { const get = Storage.prototype.getItem, remove = Storage.prototype.removeItem; let removed = false;
    (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.getItem = get; Storage.prototype.removeItem = remove; };
    Storage.prototype.removeItem = function(key) { remove.call(this, key); removed = true; };
    Storage.prototype.getItem = function(key) { if (removed) throw new Error("Synthetic readback refusal"); return get.call(this, key); };
  });
  await clear(page); await page.getByText(copy("paperWorkspace.clearFailed"), { exact: true }).waitFor(); await checkpoint(page).waitFor();
  expect(await download(page)).toEqual(workspace()); await expectWarning(page, true);
  await restoreStorage(page); expect(await rawState(page)).toBeNull();
  await restore(page).click(); await page.getByText(recovery.restored, { exact: true }).waitFor(); expect(JSON.parse((await rawState(page))!)).toEqual(workspace());
}));

it("refuses to replace newer work from another tab and keeps the old saved snapshot portable", () => fixture(1440, async page => {
  await clear(page); const other = await page.context().newPage(); await boot(other);
  await other.getByLabel(copy("literatureWorkspace.questionLabel")).fill("New question in another tab");
  await other.getByRole("button", { name: copy("literatureWorkspace.saveFocus"), exact: true }).click();
  await other.getByText(copy("literatureWorkspace.focusSaved"), { exact: true }).waitFor(); const newer = await rawState(other);
  await restore(page).click(); await page.getByText(recovery.changed, { exact: true }).waitFor();
  expect(await rawState(page)).toBe(newer); expect(await download(page)).toEqual(workspace()); await expectWarning(page, true);
}));

it("captures the latest saved fields inside the queued clear lock, not the earlier rendered snapshot", () => fixture(1440, async page => {
  const other = await page.context().newPage(); await boot(other);
  await other.evaluate(key => new Promise<void>(ready => { navigator.locks.request(key, () => new Promise<void>(release => { (window as unknown as { releaseLibraryLock(): void }).releaseLibraryLock = release; ready(); })); }), LITERATURE_STORAGE_KEY);
  await clear(page);
  const latest = workspace(); latest.question = "Latest locked snapshot"; latest.entries[0].notes = "Latest saved note \u{1f9ea}";
  await other.evaluate(({ key, raw }) => { localStorage.setItem(key, raw); (window as unknown as { releaseLibraryLock(): void }).releaseLibraryLock(); }, { key: LITERATURE_STORAGE_KEY, raw: serializeLiteratureWorkspace(latest) });
  await checkpoint(page).waitFor(); expect(await download(page)).toEqual(latest);
}));

it("dismisses an actual reload and retains protection after download until explicit discard", () => fixture(320, async page => {
  await clear(page); await checkpoint(page).waitFor(); await expectWarning(page, true);
  const opened = page.waitForEvent("dialog", { timeout: 1500 }), reload = page.reload().then(() => "loaded", () => "cancelled");
  const dialog = await opened; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); expect(await reload).toBe("cancelled");
  expect(await download(page)).toEqual(workspace()); await expectWarning(page, true);
  const discard = page.waitForEvent("dialog"), click = page.getByRole("button", { name: recovery.discard, exact: true }).click();
  const prompt = await discard; expect(prompt.message()).toBe(recovery.discardConfirm); await prompt.accept(); await click;
  await page.getByText(recovery.discarded, { exact: true }).waitFor(); await expectWarning(page, false);
  expect(await rawState(page)).toBeNull();
  expect(await page.getByText(copy("literatureWorkspace.clearDetails"), { exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
}));

it("invalidates a bulk preview and a late backup read across clear and recovery", () => fixture(1440, async page => {
  await page.getByText(bulk.summary, { exact: true }).click(); await page.getByRole("button", { name: bulk.preview, exact: true }).click();
  await page.getByRole("region", { name: bulk.previewTitle, exact: true }).waitFor();
  await page.evaluate(() => { const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() { if (this.name !== "late-library.json") return original.call(this);
      return new Promise<ArrayBuffer>(resolve => { (window as unknown as { releaseBackup(): Promise<void> }).releaseBackup = async () => resolve(await original.call(this)); }); };
  });
  const incoming = workspace(); incoming.title = "Late incoming focus";
  await page.getByLabel(copy("literatureWorkspace.restoreLabel")).setInputFiles({ name: "late-library.json", mimeType: "application/json", buffer: Buffer.from(serializeLiteratureWorkspace(incoming)) });
  await clear(page); await checkpoint(page).waitFor();
  await page.evaluate(() => (window as unknown as { releaseBackup(): Promise<void> }).releaseBackup());
  expect(await rawState(page)).toBeNull(); expect(await page.getByText("Late incoming focus", { exact: false }).count()).toBe(0);
  await restore(page).click(); await page.getByText(recovery.restored, { exact: true }).waitFor();
  expect(await page.getByRole("region", { name: bulk.previewTitle, exact: true }).count()).toBe(0);
  expect(JSON.parse((await rawState(page))!)).toEqual(workspace());
}));

it("keeps explicit corrupt-storage clearing available without inventing a valid recovery", () => fixture(1440, async page => {
  await page.evaluate(key => { localStorage.setItem(key, "PRIVATE_CORRUPT_JSON"); window.dispatchEvent(new StorageEvent("storage", { key })); }, LITERATURE_STORAGE_KEY);
  await page.getByText(copy("paperWorkspace.readFailed"), { exact: true }).waitFor();
  await clear(page); await page.getByText(copy("literatureWorkspace.cleared"), { exact: true }).waitFor();
  expect(await rawState(page)).toBeNull(); expect(await checkpoint(page).count()).toBe(0); await expectWarning(page, false);
}));

it("refuses unreadable saved storage before deletion instead of using corrupt-JSON clear", () => fixture(1440, async (page, raw) => {
  await page.evaluate(key => { const original = Storage.prototype.getItem;
    (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.getItem = original; };
    Storage.prototype.getItem = () => { throw new Error("Synthetic unreadable saved storage"); };
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, LITERATURE_STORAGE_KEY);
  await page.getByText(copy("paperWorkspace.storageUnavailable"), { exact: true }).waitFor();
  await page.getByText(copy("literatureWorkspace.clearDetails"), { exact: true }).click();
  const allowed = await page.getByRole("button", { name: copy("literatureWorkspace.clear"), exact: true }).isEnabled();
  if (allowed) { await clear(page); await page.getByText(copy("paperWorkspace.clearFailed"), { exact: true }).waitFor(); }
  await restoreStorage(page);
  expect(await rawState(page)).toBe(raw); expect(allowed).toBe(false); expect(await checkpoint(page).count()).toBe(0);
}));
