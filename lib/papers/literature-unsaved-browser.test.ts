import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";
import { literatureSearchCopy as search } from "../../locales/en/literature-search";

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
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    const root=createRoot(document.getElementById('root'));root.render(<LiteratureWorkspace/>);window.unmountLibrary=()=>root.unmount();
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
        '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><main id="root"></main>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    const raw = serializeLiteratureWorkspace(workspace()); await boot(page, raw);
    try { await run(page, raw); }
    catch (error) { throw new Error(`${String(error)}; browser errors: ${JSON.stringify(errors)}`, { cause: error }); }
    expect(errors).toEqual([]);
    expect(requests.every(url => url === "https://literature-search.test/")).toBe(true);
  } finally { await context.close(); }
}
const warns = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
const expectWarning = async (page: Page, value: boolean) => { await expect.poll(() => warns(page)).toBe(value); };
const focus = (page: Page) => page.getByLabel(copy("literatureWorkspace.questionLabel"));
const saveFocus = (page: Page) => page.getByRole("button", { name: copy("literatureWorkspace.saveFocus"), exact: true });
const notes = (page: Page, index = 0) => card(page, index).getByLabel(copy("literatureWorkspace.notesLabel"));
const editNotes = async (page: Page, index = 0) => { await card(page, index).getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click(); };
const saveNotes = (page: Page, index = 0) => card(page, index).getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true });

it("warns for private focus, notes and decisions, becomes clean on exact revert, and removes listeners on unmount", () => fixture(1440, async (page, raw) => {
  await expectWarning(page, false);
  const title = page.getByLabel(copy("literatureWorkspace.titleLabel")), original = await title.inputValue();
  await title.fill("Unretained review title"); await expectWarning(page, true);
  await title.fill(original); await expectWarning(page, false);
  await focus(page).fill("New private question"); await expectWarning(page, true);
  await focus(page).fill(workspace().question); await expectWarning(page, false);
  await editNotes(page); const decision = card(page, 0).getByLabel(copy("literatureWorkspace.screeningDecision"));
  await decision.selectOption("exclude"); await expectWarning(page, true);
  await decision.selectOption("include"); await expectWarning(page, false);
  await notes(page).fill("PRIVATE unsaved note \u{1f9ea}"); await expectWarning(page, true);
  expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
  await page.evaluate(() => (window as unknown as { unmountLibrary(): void }).unmountLibrary());
  await expectWarning(page, false);
}));

it("keeps independent hidden edits protected until every deliberate save or revert completes", () => fixture(320, async page => {
  await editNotes(page); await editNotes(page, 1);
  await notes(page).fill("Retain first note"); await notes(page, 1).fill("Retain second note");
  await focus(page).fill("Retain review question"); await expectWarning(page, true);
  await saveNotes(page).click(); await page.getByText("Retain first note", { exact: true }).waitFor(); await expectWarning(page, true);
  await saveFocus(page).click(); await expectWarning(page, true);
  await page.getByLabel(search.label, { exact: true }).fill("no matching cards");
  await expectWarning(page, true); expect(await card(page, 1).isVisible()).toBe(false);
  await page.getByRole("button", { name: search.clear, exact: true }).click();
  expect(await notes(page, 1).inputValue()).toBe("Retain second note");
  await saveNotes(page, 1).click(); await expectWarning(page, false);
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY))!);
  expect(stored.question).toBe("Retain review question"); expect(stored.entries[1].notes).toBe("Retain second note");
}));

it("retains protection when persistence fails and clears it only after verified retry", () => fixture(1440, async (page, raw) => {
  await editNotes(page); await notes(page).fill("Exact private failed-save note"); await expectWarning(page, true);
  await page.evaluate(() => { const original = Storage.prototype.setItem;
    (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = () => { throw new Error("Synthetic storage refusal"); };
  });
  await saveNotes(page).click(); await page.getByText(copy("paperWorkspace.saveUnverified"), { exact: true }).waitFor();
  await expectWarning(page, true); expect(await notes(page).inputValue()).toBe("Exact private failed-save note");
  expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
  await page.evaluate(() => (window as unknown as { restoreStorage(): void }).restoreStorage());
  await saveNotes(page).click(); await expectWarning(page, false);
}));

it("does not warn for remote-only changes, protects conflicting local edits and accepts explicit stale reload", () => fixture(1440, async page => {
  const other = await page.context().newPage(); await boot(other);
  await focus(other).fill("Other tab saved focus"); await saveFocus(other).click();
  await page.getByText(copy("literatureWorkspace.staleFocus"), { exact: true }).waitFor(); await expectWarning(page, false);
  await focus(page).fill("This tab private focus"); await expectWarning(page, true);
  await saveFocus(page).click(); await page.getByText(copy("literatureWorkspace.staleFocusError"), { exact: true }).waitFor(); await expectWarning(page, true);
  await page.getByRole("button", { name: copy("literatureWorkspace.loadFocus"), exact: true }).click();
  expect(await focus(page).inputValue()).toBe("Other tab saved focus"); await expectWarning(page, false);
  await focus(page).fill("Shared exact edits"); await expectWarning(page, true);
  await focus(other).fill("Shared exact edits"); await saveFocus(other).click(); await expectWarning(page, false);
}));

it.each([320, 1440])("cancels a real native reload with exact private input intact at %ipx, then allows reload after save", width => fixture(width, async page => {
  await focus(page).fill("Unsaved private question \u{1f600}"); await expectWarning(page, true);
  const opened = page.waitForEvent("dialog", { timeout: 1500 });
  const reload = page.reload().then(() => "loaded", () => "cancelled");
  const dialog = await opened; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); expect(await reload).toBe("cancelled");
  expect(await focus(page).inputValue()).toBe("Unsaved private question \u{1f600}"); await expectWarning(page, true);
  await saveFocus(page).click(); await expectWarning(page, false);
  await page.reload(); await page.addScriptTag({ content: bundle }); await focus(page).waitFor();
  expect(await focus(page).inputValue()).toBe("Unsaved private question \u{1f600}"); await expectWarning(page, false);
}));
