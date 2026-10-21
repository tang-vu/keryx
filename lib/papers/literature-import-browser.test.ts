import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";
import { literatureImportCopy as copy } from "../../locales/en/literature-import";
import { literatureSearchCopy as search } from "../../locales/en/literature-search";

const messages = createMessages("en"), time = "2026-10-20T00:00:00Z";
const saved = (...indices: number[]) => indices.reduce((value, index) => saveLiteraturePaper(value, PAPER_CATALOG[index], time), emptyLiteratureWorkspace());
const current = () => {
  const value = saved(0, 1);
  value.title = "Current review"; value.question = "Current criteria";
  value.entries[0].screening = "include"; value.entries[0].notes = "Current saved note";
  return value;
};
const incoming = () => {
  const value = saved(0, 2);
  value.title = "Other review"; value.question = "Other criteria";
  value.entries[0].paper.title = "Conflicting metadata"; value.entries[0].notes = "Do not overwrite";
  value.entries[1].screening = "exclude"; value.entries[1].notes = "Imported private note 📚";
  return value;
};
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    import{changeLiteratureWorkspace}from'./lib/papers/literature-browser-store';
    window.probeChange=changeLiteratureWorkspace;
    window.root=createRoot(document.getElementById('root'));window.root.render(<LiteratureWorkspace/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "plain-next-link", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(), contents:
        `import React from 'react';export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}` }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const add = (page: Page) => page.getByRole("button", { name: copy.add, exact: true });
const preview = (page: Page) => page.getByRole("region", { name: copy.preview, exact: true });
const file = (page: Page) => page.getByLabel(messages("literatureWorkspace.restoreLabel"));
const stored = (page: Page) => page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY);
const choose = (page: Page, value = incoming()) => file(page).setInputFiles({ name: "private-backup.json", mimeType: "application/json", buffer: Buffer.from(serializeLiteratureWorkspace(value)) });
const paper = (page: Page, index: number) => page.locator("article").filter({ has: page.getByRole("checkbox", { name: messages("literatureWorkspace.compareLabel", { title: PAPER_CATALOG[index].title }), exact: true }) });
async function boot(page: Page, raw?: string) {
  page.setDefaultTimeout(5000);
  await page.goto("https://literature-import.test/");
  if (raw !== undefined) await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY, raw });
  await page.addScriptTag({ content: bundle });
  await page.getByRole("heading", { name: messages("literatureWorkspace.portable"), exact: true }).waitFor();
}
async function fixture(run: (page: Page, raw: string) => Promise<void>, width = 1024, value: LiteratureWorkspace | string = current()) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://literature-import.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><main id="root"></main>' }) : route.abort();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const raw = typeof value === "string" ? value : serializeLiteratureWorkspace(value); await boot(page, raw);
    await run(page, raw);
    expect(errors).toEqual([]); expect(requests.every(url => url === "https://literature-import.test/")).toBe(true);
  } finally { await context.close(); }
}
async function hold(other: Page) {
  await other.evaluate(key => { navigator.locks.request(key, () => new Promise<void>(resolve => { Object.assign(window, { releaseImportLock: resolve }); })); }, LITERATURE_STORAGE_KEY);
  await other.waitForFunction(() => "releaseImportLock" in window);
}
async function release(other: Page, page: Page) {
  await other.evaluate(() => (window as unknown as { releaseImportLock: () => void }).releaseImportLock());
  // A later exclusive lock is a deterministic barrier after the queued import.
  await page.evaluate(key => navigator.locks.request(key, () => undefined), LITERATURE_STORAGE_KEY);
}

it.each([320, 1440])("previews/cancels and adds only missing records, preserving dirty editors, filters and comparison at %ipx", width => fixture(async (page, raw) => {
  const first = paper(page, 0), query = page.getByLabel(search.label, { exact: true });
  await first.getByText(messages("literatureWorkspace.editNotes"), { exact: true }).click();
  const notes = first.getByLabel(messages("literatureWorkspace.notesLabel"));
  await notes.fill("UNSAVED local note");
  await page.getByLabel(messages("literatureWorkspace.titleLabel"), { exact: true }).fill("UNSAVED title");
  await first.getByRole("checkbox").check(); await paper(page, 1).getByRole("checkbox").check();
  const prepared = page.getByRole("link", { name: messages("literatureWorkspace.prepare"), exact: true });
  const href = await prepared.getAttribute("href");
  await query.fill("Current saved note");
  await page.getByLabel(messages("literatureWorkspace.filter")).selectOption("include");
  await choose(page); await preview(page).waitFor();
  expect(await stored(page)).toBe(raw);
  expect(await preview(page).locator("dd").allTextContents()).toEqual(["1", "1", "3/50"]);
  await preview(page).getByText(copy.review, { exact: true }).click();
  await preview(page).getByRole("link", { name: PAPER_CATALOG[2].title, exact: true }).waitFor();
  await preview(page).getByText("Imported private note 📚", { exact: true }).waitFor();
  await page.getByRole("button", { name: messages("literatureWorkspace.cancelRestore"), exact: true }).click();
  expect(await preview(page).count()).toBe(0); expect(await stored(page)).toBe(raw);
  await choose(page); await add(page).click(); await page.getByText(copy.added, { exact: true }).waitFor();
  const expected = { ...current(), entries: [...current().entries, incoming().entries[1]] };
  expect(JSON.parse((await stored(page))!)).toEqual(expected);
  expect(await notes.inputValue()).toBe("UNSAVED local note");
  expect(await page.getByLabel(messages("literatureWorkspace.titleLabel"), { exact: true }).inputValue()).toBe("UNSAVED title");
  expect(await query.inputValue()).toBe("Current saved note");
  expect(await page.getByLabel(messages("literatureWorkspace.filter")).inputValue()).toBe("include");
  expect(await prepared.getAttribute("href")).toBe(href);
  expect(await page.getByRole("region", { name: messages("literatureComparison.label") }).locator("li").count()).toBe(2);
  await page.getByRole("button", { name: search.clear, exact: true }).click();
  await page.getByLabel(messages("literatureWorkspace.filter")).selectOption("exclude");
  expect(await paper(page, 2).isVisible()).toBe(true);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages("literatureWorkspace.backup"), exact: true }).click()]);
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(expected);
  expect(page.url()).toBe("https://literature-import.test/");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([LITERATURE_STORAGE_KEY]);
  await boot(page); expect(JSON.parse((await stored(page))!)).toEqual(expected);
  expect(await page.getByLabel(messages("literatureWorkspace.titleLabel"), { exact: true }).inputValue()).toBe("Current review");
}, width));

it("refreshes the preview after another real tab saves an incoming paper, and keeps that tab's note", () => fixture(async (page, raw) => {
  await choose(page); await preview(page).waitFor();
  const other = await page.context().newPage(); await boot(other);
  await other.evaluate(async entry => {
    await (window as unknown as { probeChange: (update: (value: LiteratureWorkspace) => LiteratureWorkspace) => Promise<void> })
      .probeChange(value => ({ ...value, entries: [...value.entries, { ...entry, notes: "Other tab saved note" }] }));
  }, incoming().entries[1]);
  await page.getByText(copy.none, { exact: true }).waitFor();
  expect(await preview(page).locator("dd").allTextContents()).toEqual(["0", "2", "3/50"]);
  expect(await add(page).isDisabled()).toBe(true);
  expect(JSON.parse((await stored(page))!).entries[2].notes).toBe("Other tab saved note");
  expect(await stored(page)).not.toBe(raw);
}));

it("refuses a stale queued import under the real Web Lock, then allows a reviewed retry", () => fixture(async page => {
  await choose(page); await preview(page).waitFor();
  const other = await page.context().newPage(); await boot(other); await hold(other);
  await other.evaluate(() => {
    (window as unknown as { probeChange: (update: (value: LiteratureWorkspace) => LiteratureWorkspace) => Promise<void> })
      .probeChange(value => ({ ...value, title: "Changed while waiting" }));
  });
  await other.waitForFunction(async key => (await navigator.locks.query()).pending?.filter(lock => lock.name === key).length === 1, LITERATURE_STORAGE_KEY);
  await add(page).click();
  await other.waitForFunction(async key => (await navigator.locks.query()).pending?.filter(lock => lock.name === key).length === 2, LITERATURE_STORAGE_KEY);
  await release(other, page); await page.getByText(copy.stale, { exact: true }).waitFor();
  expect(JSON.parse((await stored(page))!).entries).toHaveLength(2);
  expect(JSON.parse((await stored(page))!).title).toBe("Changed while waiting");
  await add(page).click(); await page.getByText(copy.added, { exact: true }).waitFor();
  expect(JSON.parse((await stored(page))!).entries).toHaveLength(3);
  expect(JSON.parse((await stored(page))!).title).toBe("Changed while waiting");
}));

it.each(["cancel", "unmount"])("does not commit a queued addition after %s", action => fixture(async (page, raw) => {
  await choose(page); await preview(page).waitFor();
  const other = await page.context().newPage(); await boot(other); await hold(other);
  await add(page).click();
  await other.waitForFunction(async key => (await navigator.locks.query()).pending?.some(lock => lock.name === key), LITERATURE_STORAGE_KEY);
  if (action === "cancel") {
    await page.getByRole("button", { name: messages("literatureWorkspace.cancelRestore"), exact: true }).click();
  } else await page.evaluate(() => (window as unknown as { root: { unmount: () => void } }).root.unmount());
  await release(other, page);
  if (action === "cancel") await page.getByText(copy.cancelled, { exact: true }).waitFor();
  expect(await stored(page)).toBe(raw);
}));

it.each(["quota", "readback"])("does not report success on %s failure, retaining preview for a retry", failure => fixture(async (page, raw) => {
  await choose(page); await preview(page).waitFor();
  await page.evaluate(failure => {
    const original = Storage.prototype.setItem;
    Object.assign(window, { restoreStorage: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = function (key, value) {
      if (key === "keryx-literature-workspace-v1") { if (failure === "quota") throw new DOMException("Full", "QuotaExceededError"); return; }
      original.call(this, key, value);
    };
  }, failure);
  await add(page).click(); await page.getByText(messages("paperWorkspace.saveUnverified"), { exact: true }).waitFor();
  expect(await stored(page)).toBe(raw); expect(await page.getByText(copy.added, { exact: true }).count()).toBe(0);
  expect(await preview(page).count()).toBe(1);
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await add(page).click(); await page.getByText(copy.added, { exact: true }).waitFor();
  expect(JSON.parse((await stored(page))!).entries).toHaveLength(3);
}));

it("blocks an over-capacity import in preview without partially adding records", () => {
  const value = current();
  for (let index = 1; index <= 48; index++) {
    const arxivId = `2601.${String(index).padStart(5, "0")}v1`;
    value.entries.push({ ...value.entries[0], paper: { ...PAPER_CATALOG[0], arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` } });
  }
  return fixture(async (page, raw) => {
    await choose(page); await page.getByText(copy.capacity, { exact: true }).waitFor();
    expect(await preview(page).locator("dd").allTextContents()).toEqual(["1", "1", "51/50"]);
    expect(await add(page).isDisabled()).toBe(true); expect(await stored(page)).toBe(raw);
  }, 1024, value);
});

it("keeps corrupt stored data recoverable and offers replacement without a misleading additive preview", () => fixture(async (page, raw) => {
  await choose(page); await page.getByRole("button", { name: messages("literatureWorkspace.restore"), exact: true }).waitFor();
  expect(await preview(page).count()).toBe(0); expect(await add(page).count()).toBe(0); expect(await stored(page)).toBe(raw);
  await page.getByRole("button", { name: messages("literatureWorkspace.restore"), exact: true }).click();
  await page.getByText(messages("literatureWorkspace.restored"), { exact: true }).waitFor();
  expect(JSON.parse((await stored(page))!)).toEqual(incoming());
}, 1024, "{broken"));

for (const field of ["title", "notes"] as const) it.each([320, 1440])(`refuses malformed UTF-8 ${field} without a preview, data write or lost editor at %ipx`, width => fixture(async (page, raw) => {
  await page.getByLabel(messages("literatureWorkspace.titleLabel"), { exact: true }).fill("UNSAVED focus 📚");
  const first = paper(page, 0); await first.getByText(messages("literatureWorkspace.editNotes"), { exact: true }).click();
  const notes = first.getByLabel(messages("literatureWorkspace.notesLabel")); await notes.fill("UNSAVED original note");
  // A previous valid preview must not remain actionable after choosing an invalid file.
  await choose(page); await preview(page).waitFor();
  const value = incoming();
  if (field === "title") value.entries[1].paper.title = "INVALID_BYTES"; else value.entries[1].notes = "INVALID_BYTES";
  const [before, after] = serializeLiteratureWorkspace(value).split("INVALID_BYTES");
  const bytes = Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]);
  await file(page).setInputFiles({ name: "damaged-backup.json", mimeType: "application/json", buffer: bytes });
  await page.getByRole("alert").filter({ hasText: messages("paperWorkspace.unsupportedBackup") }).waitFor();
  expect(await preview(page).count()).toBe(0);
  expect(await page.getByRole("button", { name: messages("literatureWorkspace.restore"), exact: true }).count()).toBe(0);
  expect(await stored(page)).toBe(raw);
  expect(await notes.inputValue()).toBe("UNSAVED original note");
  expect(await page.getByLabel(messages("literatureWorkspace.titleLabel"), { exact: true }).inputValue()).toBe("UNSAVED focus 📚");
}, width));

it.each([320, 1440])("adds exact valid Unicode and BOM input after a refused file at %ipx", width => fixture(async (page, raw) => {
  await file(page).setInputFiles({ name: "damaged.json", mimeType: "application/json", buffer: Buffer.from([0xff]) });
  await page.getByRole("alert").filter({ hasText: messages("paperWorkspace.unsupportedBackup") }).waitFor();
  const value = incoming(); value.entries[1].notes = "Ghi chú 📚 e\u0301 � العربية 中文";
  await file(page).setInputFiles({ name: "unicode.json", mimeType: "application/json", buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(serializeLiteratureWorkspace(value))]) });
  await preview(page).waitFor(); expect(await stored(page)).toBe(raw);
  await add(page).click(); await page.getByText(copy.added, { exact: true }).waitFor();
  expect(JSON.parse((await stored(page))!).entries[2]).toEqual(value.entries[1]);
}, width));

it("ignores a delayed damaged file after a newer valid preview", () => fixture(async (page, raw) => {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "delayed.json") return original.call(this);
      const file = this;
      return new Promise<ArrayBuffer>((resolve, reject) => Object.assign(window, { releaseLiteratureRead: () => original.call(file).then(resolve, reject) }));
    };
  });
  await file(page).setInputFiles({ name: "delayed.json", mimeType: "application/json", buffer: Buffer.from([0xff]) });
  await page.waitForFunction(() => "releaseLiteratureRead" in window);
  await choose(page); await preview(page).waitFor();
  await page.evaluate(() => (window as unknown as { releaseLiteratureRead: () => Promise<void> }).releaseLiteratureRead());
  expect(await preview(page).count()).toBe(1); expect(await page.getByRole("alert").count()).toBe(0);
  expect(await stored(page)).toBe(raw);
}));

it("reports an empty file-read error and permits retrying the same valid file", () => fixture(async (page, raw) => {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { File.prototype.arrayBuffer = original; return Promise.reject(new Error("")); };
  });
  await choose(page);
  await page.getByRole("alert").filter({ hasText: messages("literatureWorkspace.unreadable") }).waitFor();
  expect(await stored(page)).toBe(raw); expect(await preview(page).count()).toBe(0);
  await choose(page); await preview(page).waitFor();
  expect(await page.getByRole("alert").count()).toBe(0); expect(await stored(page)).toBe(raw);
}));

it("ignores a damaged file finishing after the workspace unmounts", () => fixture(async (page, raw) => {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const file = this;
      return new Promise<ArrayBuffer>((resolve, reject) => Object.assign(window, { releaseLiteratureRead: () => original.call(file).then(resolve, reject) }));
    };
  });
  await file(page).setInputFiles({ name: "delayed.json", mimeType: "application/json", buffer: Buffer.from([0xff]) });
  await page.waitForFunction(() => "releaseLiteratureRead" in window);
  await page.evaluate(() => (window as unknown as { root: { unmount: () => void } }).root.unmount());
  await page.evaluate(() => (window as unknown as { releaseLiteratureRead: () => Promise<void> }).releaseLiteratureRead());
  expect(await page.getByRole("alert").count()).toBe(0); expect(await stored(page)).toBe(raw);
}));
