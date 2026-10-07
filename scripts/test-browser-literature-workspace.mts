/** Real components, synthetic bibliography and blocked HTTP. No wallet/model/provider/payment. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { PAPER_CATALOG } from "../lib/papers/catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "../lib/papers/literature-workspace";

const papers = PAPER_CATALOG.slice(0, 3), timestamp = "2026-10-07T00:00:00.000Z";
const backup = serializeLiteratureWorkspace(saveLiteraturePaper(emptyLiteratureWorkspace(), papers[2], timestamp));
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LiteratureWorkspace}from'./components/keryx/literature-workspace';import{PaperSaveButton}from'./components/keryx/paper-save-button';import{changeLiteratureWorkspace}from'./lib/papers/literature-browser-store';
    window.probeChange=changeLiteratureWorkspace;
    const papers=${JSON.stringify(papers)};createRoot(document.getElementById('root')).render(<><section aria-label="Synthetic paper library">{papers.map(paper=><article key={paper.url}><h2>{paper.title}</h2><PaperSaveButton paper={paper}/></article>)}</section><LiteratureWorkspace/></>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "plain-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children)}", loader: "jsx", resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ headless: true });
const boot = async (page: Page) => { await page.goto("https://literature.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole("heading", { name: "Start with your review question" }).waitFor(); };
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const requests: string[] = [], errors: string[] = [];
    await context.route("**/*", route => {
      requests.push(route.request().url());
      assert.equal(route.request().url(), "https://literature.test/"); assert.equal(route.request().method(), "GET");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><main id="root"></main>' });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); await boot(page);
    const library = page.getByRole("region", { name: "Synthetic paper library" });
    const save = (index: number) => library.locator("article").nth(index).getByRole("button", { name: "Save to literature workspace" });
    await save(0).click(); await save(1).click();
    await page.getByRole("heading", { name: "Your papers 2/50" }).waitFor();
    await page.getByLabel("Review title", { exact: true }).fill("Grounding review");
    await page.getByLabel("Research question or inclusion criteria").fill("Grounding methods");
    await page.getByRole("button", { name: "Save review focus" }).click();
    const entry = page.locator('article').filter({ has: page.getByRole("checkbox", { name: `Compare ${papers[0].title}`, exact: true }) });
    await entry.getByText("Edit screening and notes", { exact: true }).click();
    await entry.getByLabel("Your screening decision").selectOption("include");
    await entry.getByLabel("Why keep or exclude this paper? What needs checking?").fill('=1+1\nPRIVATE NOTE "literal" <script>');
    await entry.getByRole("button", { name: "Save screening and notes" }).click();
    await page.getByText("Screening and notes saved on this browser.", { exact: true }).waitFor();
    await boot(page);
    assert.equal(await page.getByLabel("Review title", { exact: true }).inputValue(), "Grounding review");
    await page.locator("p").filter({ hasText: 'PRIVATE NOTE "literal" <script>' }).waitFor();
    await page.getByRole("checkbox", { name: `Compare ${papers[0].title}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Compare ${papers[1].title}`, exact: true }).check();
    const href = await page.getByRole("link", { name: "Prepare comparison" }).getAttribute("href"); assert(href);
    const draft = new URL(href, "https://literature.test").searchParams.get("q")!;
    assert(draft.includes(papers[0].url) && draft.includes(papers[1].url) && draft.includes("Grounding methods"));
    assert(!draft.includes("PRIVATE NOTE")); assert(!new URL(href, "https://literature.test").searchParams.has("run"));
    const selection = page.getByRole("region", { name: "Comparison selection" });
    assert.equal(await selection.locator("li").count(), 2);
    await selection.getByRole("link", { name: papers[0].title, exact: true }).waitFor();
    await selection.getByRole("link", { name: papers[1].title, exact: true }).waitFor();
    await selection.getByText("Review prepared question", { exact: true }).click();
    assert.equal(await selection.getByLabel("Prepared comparison question").textContent(), draft);
    await page.getByLabel("Research question or inclusion criteria").fill("Unsaved narrower question");
    assert.equal(await selection.getByText("Grounding methods", { exact: true }).count(), 1);
    assert.equal(await selection.getByLabel("Prepared comparison question").textContent(), draft, "Preview uses saved focus, not an unsaved form draft");
    await page.getByLabel("Research question or inclusion criteria").fill("Grounding methods");
    await page.getByLabel("Show screening decisions").selectOption("exclude");
    await page.getByText("No papers have this screening decision.", { exact: false }).waitFor();
    assert(await page.getByRole("button", { name: "Download shown references (RIS)" }).isDisabled());
    assert.equal(await selection.getByText("Outside the current screening filter; still selected.", { exact: true }).count(), 2);
    await selection.getByRole("button", { name: "Remove paper 2 from comparison", exact: true }).click();
    assert.equal(await selection.locator("li").count(), 1);
    assert.equal(await page.getByRole("link", { name: "Prepare comparison" }).count(), 0);
    assert.equal(await selection.getByLabel("Prepared comparison question").count(), 0);
    await page.getByLabel("Show screening decisions").selectOption("all");
    await page.getByRole("checkbox", { name: `Compare ${papers[1].title}`, exact: true }).check();
    await page.getByLabel("Show screening decisions").selectOption("include");
    assert.equal(await selection.locator("li").count(), 2);
    assert.equal(await selection.getByText("Outside the current screening filter; still selected.", { exact: true }).count(), 1);
    const risDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download shown references (RIS)" }).click();
    const download = await risDownload;
    assert.equal(download.suggestedFilename(), "keryx-literature-references.ris");
    const ris = await readFile((await download.path())!, "utf8");
    assert.equal((ris.match(/^TY  - /gm) ?? []).length, 1);
    assert(ris.includes(papers[0].url) && !ris.includes(papers[1].url));
    assert(ris.includes("no Keryx read, citation or settlement evidence"));
    assert(!ris.includes("PRIVATE NOTE") && !ris.includes("Grounding methods") && !ris.includes("Grounding review"));
    await page.getByLabel("Show screening decisions").selectOption("all");

    const csvDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download screening CSV" }).click();
    const csv = await readFile((await (await csvDownload).path())!, "utf8");
    assert(csv.includes('"\'=1+1') && csv.includes("PRIVATE NOTE") && csv.includes(papers[0].metadataUrl));
    const jsonDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download JSON backup" }).click();
    const original = await readFile((await (await jsonDownload).path())!, "utf8"); assert.equal(JSON.parse(original).entries.length, 2);

    const other = await context.newPage(); other.on("pageerror", error => errors.push(error.message)); await boot(other);
    await page.getByLabel("Review title", { exact: true }).fill("Unsaved local title");
    await entry.getByText("Edit screening and notes", { exact: true }).click();
    await entry.getByLabel("Why keep or exclude this paper? What needs checking?").fill("Unsaved local notes");
    await other.getByLabel("Review title", { exact: true }).fill("Edited in another tab"); await other.getByRole("button", { name: "Save review focus" }).click();
    await page.getByText("The saved review focus changed in another tab or restore.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Review title", { exact: true }).inputValue(), "Unsaved local title");
    await page.getByRole("button", { name: "Save review focus" }).click();
    await page.getByText("Your review focus changed in another tab.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Load saved focus" }).click();
    assert.equal(await page.getByLabel("Review title", { exact: true }).inputValue(), "Edited in another tab");
    const otherEntry = other.locator("article").filter({ has: other.getByRole("checkbox", { name: `Compare ${papers[0].title}`, exact: true }) });
    await otherEntry.getByText("Edit screening and notes", { exact: true }).click();
    await otherEntry.getByLabel("Your screening decision").selectOption("exclude");
    await otherEntry.getByRole("button", { name: "Save screening and notes" }).click();
    await entry.getByText("Saved screening changed in another tab or restore.", { exact: false }).waitFor();
    assert.equal(await entry.getByLabel("Why keep or exclude this paper? What needs checking?").inputValue(), "Unsaved local notes");
    await page.getByLabel("Show screening decisions").selectOption("include");
    await page.getByLabel("Show screening decisions").selectOption("all");
    assert.equal(await entry.getByLabel("Why keep or exclude this paper? What needs checking?").inputValue(), "Unsaved local notes");
    await entry.getByRole("button", { name: "Save screening and notes" }).click();
    await page.getByText("This paper changed in another tab.", { exact: false }).waitFor();
    await entry.getByRole("button", { name: "Load saved screening" }).click();
    // Hold one real Web Lock while two tabs queue unrelated mutations. Both must survive.
    await page.evaluate(key => {
      navigator.locks.request(key, () => new Promise<void>(resolve => { (window as unknown as { releaseLock: () => void }).releaseLock = resolve; }));
    }, LITERATURE_STORAGE_KEY);
    await page.waitForFunction(() => typeof (window as unknown as { releaseLock?: unknown }).releaseLock === "function");
    const changeTitle = page.evaluate(async () => {
      await (window as unknown as { probeChange: (change: (value: { title: string }) => unknown) => Promise<void> }).probeChange(value => ({ ...value, title: "Concurrent title" }));
    });
    const changeQuestion = other.evaluate(async () => {
      await (window as unknown as { probeChange: (change: (value: { question: string }) => unknown) => Promise<void> }).probeChange(value => ({ ...value, question: "Concurrent question" }));
    });
    await other.waitForFunction(async key => (await navigator.locks.query()).pending?.filter(lock => lock.name === key).length === 2, LITERATURE_STORAGE_KEY);
    await page.evaluate(() => (window as unknown as { releaseLock: () => void }).releaseLock());
    await Promise.all([changeTitle, changeQuestion]);
    assert.deepEqual(await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)!); return [value.title, value.question]; }, LITERATURE_STORAGE_KEY), ["Concurrent title", "Concurrent question"]);
    // One tab adds while the other has an already rendered list: current unrelated notes survive.
    await save(2).click(); await other.getByRole("heading", { name: "Your papers 3/50" }).waitFor();
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LITERATURE_STORAGE_KEY);
    assert.equal(stored.title, "Concurrent title"); assert(stored.entries[0].notes.includes("PRIVATE NOTE"));
    const input = page.getByLabel("Restore a workspace backup (JSON, up to 1 MiB)");
    await input.setInputFiles({ name: "corrupt.json", mimeType: "application/json", buffer: Buffer.from("{bad") });
    await page.getByText("Unsupported workspace backup. Existing data has been kept.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY), JSON.stringify(stored));
    await input.setInputFiles({ name: "restored.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await page.getByRole("button", { name: "Replace workspace with this backup" }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY), JSON.stringify(stored));
    await page.getByRole("button", { name: "Cancel restore" }).click();
    await input.setInputFiles({ name: "restored.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await page.evaluate(key => {
      navigator.locks.request(key, () => new Promise<void>(resolve => { (window as unknown as { releaseRestore: () => void }).releaseRestore = resolve; }));
    }, LITERATURE_STORAGE_KEY);
    await page.waitForFunction(() => typeof (window as unknown as { releaseRestore?: unknown }).releaseRestore === "function");
    await page.getByRole("button", { name: "Replace workspace with this backup" }).click();
    assert.equal(await page.getByRole("button", { name: "Cancel restore" }).isDisabled(), true);
    assert.equal(await input.isDisabled(), true);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY), JSON.stringify(stored));
    await page.evaluate(() => (window as unknown as { releaseRestore: () => void }).releaseRestore());
    await page.getByRole("heading", { name: "Your papers 1/50" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Prepare comparison" }).count(), 0);
    await other.close();

    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); }; });
    await save(0).click(); await page.getByText("Could not verify the browser save.", { exact: false }).waitFor();
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries.length, LITERATURE_STORAGE_KEY), 1);
    await page.evaluate(key => { localStorage.removeItem(key); }, LITERATURE_STORAGE_KEY); await boot(page);
    await page.evaluate(key => localStorage.setItem(key, "{unreadable-original"), LITERATURE_STORAGE_KEY); await page.goto("https://literature.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Saved workspace could not be read.", { exact: false }).last().waitFor();
    assert.equal(await save(0).isDisabled(), true);
    const rawDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download stored data" }).click();
    assert.equal(await readFile((await (await rawDownload).path())!, "utf8"), "{unreadable-original");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY), "{unreadable-original");
    assert.equal(await page.locator("script").count(), 1, "Imported/notes text never becomes markup");
    assert.deepEqual(errors, []); assert(requests.every(url => url === "https://literature.test/"));
    const unsupported = await context.newPage();
    await unsupported.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined, configurable: true }));
    await unsupported.goto("https://literature.test/"); await unsupported.addScriptTag({ content: bundle.outputFiles[0].text });
    // Corrupt storage still takes priority and is never erased; a fresh unsupported browser refuses writes too.
    await unsupported.evaluate(key => localStorage.removeItem(key), LITERATURE_STORAGE_KEY);
    await unsupported.goto("https://literature.test/"); await unsupported.addScriptTag({ content: bundle.outputFiles[0].text });
    await unsupported.getByText("This browser cannot coordinate safe saves across tabs.", { exact: false }).last().waitFor();
    assert.equal(await unsupported.getByRole("button", { name: "Save to literature workspace" }).first().isDisabled(), true);
    await context.close();
  }
  console.log("PASS: local save/reload, exact notes, screening, bounded comparison draft, safe downloads, two-tab edits, replace/cancel restore, malformed backup preservation, quota failure and corrupt-storage recovery; no external or payment HTTP.");
} finally { await browser.close(); }
