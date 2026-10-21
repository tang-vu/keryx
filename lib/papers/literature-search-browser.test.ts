import { readFile } from "node:fs/promises";
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
const downloadText = async (page: Page, label: string) => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label, exact: true }).click()]);
  return readFile((await download.path())!, "utf8");
};

it.each([320, 1440])("searches saved notes, exports the shown subset and keeps dirty editors/comparison at %ipx", width => fixture(width, async (page, raw) => {
  const current = workspace(), first = card(page, 0), input = page.getByLabel(search.label, { exact: true });
  await first.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
  const notes = first.getByLabel(copy("literatureWorkspace.notesLabel"));
  await notes.fill("UNSAVED note survives filtering");
  await first.getByRole("checkbox").check(); await card(page, 1).getByRole("checkbox").check();
  const comparison = page.getByRole("region", { name: copy("literatureComparison.label") });
  const prepared = page.getByRole("link", { name: copy("literatureWorkspace.prepare"), exact: true });
  const href = (await prepared.getAttribute("href"))!;
  await input.fill("alpha");
  await input.press("Enter");
  expect(await first.isVisible()).toBe(true); expect(await card(page, 1).isVisible()).toBe(false); expect(await card(page, 2).isVisible()).toBe(true);
  expect(await page.getByLabel(copy("literatureWorkspace.filter")).locator('option[value="include"]').textContent()).toContain("(1)");
  expect(await comparison.getByText(search.outsideSearch, { exact: true }).count()).toBe(1);
  await page.getByLabel(copy("literatureWorkspace.filter")).selectOption("include");
  expect(await card(page, 2).isVisible()).toBe(false);
  await page.getByText(copy("literatureWorkspace.selection.one", { count: 1, selected: 2 }), { exact: true }).waitFor();
  await input.fill("DANG alpha");
  expect(await first.isVisible()).toBe(true);
  const ris = await downloadText(page, copy("literatureWorkspace.ris"));
  expect((ris.match(/^TY  - /gm) ?? []).length).toBe(1);
  expect(ris).toContain(current.entries[0].paper.url);
  expect(ris).not.toContain(current.entries[1].paper.url); expect(ris).not.toContain(current.entries[2].paper.url);
  expect(ris).not.toContain("PRIVATE"); expect(ris).not.toContain("alpha"); expect(ris).not.toContain("UNSAVED");
  const csl = await downloadText(page, copy("literatureWorkspace.csl"));
  expect(JSON.parse(csl)).toHaveLength(1);
  expect(csl).toContain(current.entries[0].paper.url); expect(csl).not.toContain(current.entries[1].paper.url);
  expect(csl).not.toContain("PRIVATE"); expect(csl).not.toContain("alpha");
  const csv = await downloadText(page, copy("literatureWorkspace.csv"));
  for (const entry of current.entries) expect(csv).toContain(entry.paper.url);
  expect(csv).toContain("PRIVATE FIELDNOTE"); expect(csv).not.toContain("UNSAVED");
  expect(JSON.parse(await downloadText(page, copy("literatureWorkspace.backup")))).toEqual(current);
  await input.fill("zz-no-match");
  await page.getByText(search.empty, { exact: true }).waitFor();
  expect(await page.getByRole("button", { name: copy("literatureWorkspace.ris"), exact: true }).isDisabled()).toBe(true);
  expect(await page.getByRole("button", { name: copy("literatureWorkspace.csl"), exact: true }).isDisabled()).toBe(true);
  expect(await page.locator("article").count()).toBe(3);
  expect(await comparison.locator("li").count()).toBe(2);
  expect(await comparison.getByText(search.outsideSearch, { exact: true }).count()).toBe(2);
  expect(await prepared.getAttribute("href")).toBe(href);
  const question = new URL(href, page.url()).searchParams.get("q")!;
  expect(question).toContain("Grounding methods");
  for (const secret of ["PRIVATE", "UNSAVED", "alpha", "zz-no-match"]) expect(question).not.toContain(secret);
  await page.getByRole("button", { name: search.clear, exact: true }).click();
  expect(await input.inputValue()).toBe("");
  expect(await page.getByLabel(copy("literatureWorkspace.filter")).inputValue()).toBe("include");
  expect(await notes.inputValue()).toBe("UNSAVED note survives filtering");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([LITERATURE_STORAGE_KEY]);
  expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
  expect(page.url()).toBe("https://literature-search.test/");
  await input.fill("PRIVATE FIELDNOTE"); await page.reload(); await page.addScriptTag({ content: bundle });
  await input.waitFor(); expect(await input.inputValue()).toBe("");
  expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
}));

it("updates matches after a deliberate saved-note edit in another tab", () => fixture(1024, async page => {
  const input = page.getByLabel(search.label, { exact: true });
  await input.fill("newly-saved-marker"); await page.getByText(search.empty, { exact: true }).waitFor();
  const other = await page.context().newPage(); await boot(other);
  const first = card(other, 0);
  await first.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
  await first.getByLabel(copy("literatureWorkspace.notesLabel")).fill("newly-saved-marker");
  await first.getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true }).click();
  await card(page, 0).getByRole("heading", { name: titles[0], exact: true }).waitFor();
  expect(await input.inputValue()).toBe("newly-saved-marker");
  expect(await card(page, 1).isVisible()).toBe(false); expect(await card(page, 2).isVisible()).toBe(false);
  expect(await other.getByLabel(search.label, { exact: true }).inputValue()).toBe("");
}));
