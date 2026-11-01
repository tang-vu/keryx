import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft, evidenceDraftWorkspace, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftCopy as english, evidenceDraftCopyText as format } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restoreEnglish } from "../../locales/en/evidence-draft-restore";
import { evidenceDraftEditingCopy as editingEnglish } from "../../locales/en/evidence-draft-editing";
import { PAPER_CATALOG } from "../papers/catalog";
import { LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { previewCopy } from "../i18n/ui-preview";
import type { UiLocale } from "../i18n/locales";

const popular = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const matrix = [...popular.flatMap(locale => [320, 1366].map(width => ({ locale, width, font: 16 }))),
  { locale: "ar" as const, width: 390, font: 16 },
  ...(["pt-BR", "ru", "ar"] as const).map(locale => ({ locale, width: 320, font: 32 })),
  ...(["en", "vi", "zh-Hans"] as const).map(locale => ({ locale, width: 320, font: 16 }))];
const originalPassage = "Your original passage العربية 日本語 <script>literal</script> {title}";
const originalNote = "Original notes العربية <literal> {assessment}";
const originalReviewer = "Original reviewer العربية <literal>";
const originalSentence = english.statement.text;
const originalReason = english.reading.reason;
const captures = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const fonts = `@font-face{font-family:DraftDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:DraftSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:DraftMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:DraftDisplay;--font-spectral:DraftSerif;--font-spline-mono:DraftMono}`;

/** Supplied synthetic metadata/ledgers; no observed reading or semantic support. */
function packet() {
  const value = structuredClone(evidenceDraftFixture()), firstUrl = value.workspace.entries[0].paper.url;
  const other = PAPER_CATALOG.filter(paper => paper.url !== firstUrl).slice(0, 2);
  expect(other).toHaveLength(2);
  for (const paper of other) value.workspace = saveLiteraturePaper(value.workspace, paper, "2026-11-01T00:00:00Z");
  value.workspace.title = "Original saved review العربية <literal>";
  value.workspace.question = "Original saved question 日本語 {reports}";
  const titles = [english.claim.passage, "Original العربية 日本語 <script>literal</script> {title}", english.claim.label];
  for (const [index, row] of value.workspace.entries.entries()) {
    row.paper.title = titles[index]; row.screening = "include"; row.notes = `Original saved note ${index} <literal>`;
  }
  const first = value.reports[0];
  first.citations[0].itemTitle = titles[0]; first.evidence![0].itemTitle = titles[0];
  first.evidence![0].quote = english.claim.selectFirst;
  const second = structuredClone(first), secondUrl = value.workspace.entries[1].paper.url;
  second.id = "retained2";
  for (const row of [...second.citations, ...second.evidence!]) Object.assign(row, {
    sourceId: "second-synthetic-paper", marker: "S2", itemId: "second-paper-v1", itemUrl: secondUrl,
    itemTitle: titles[1], contentVersion: "sha256:version-two",
  });
  second.evidence![0].quote = "Exact second excerpt العربية <script>literal</script> {title}";
  value.reports.push(second); value.passage = originalPassage;
  value.claims[0].start = 0; value.claims[0].end = originalPassage.length;
  const excerpts = buildEvidenceDraft(value).excerpts;
  const a = excerpts.find(row => row.reportId === first.id)!, b = excerpts.find(row => row.reportId === second.id)!;
  expect(a).toBeDefined(); expect(b).toBeDefined();
  value.claims[0].excerptIds = [a.id];
  value.claims[0].assessment = { origin: "user-assessment", reviewer: originalReviewer,
    reviewedAt: "2026-11-01T00:00:00Z", verdict: "supported", claimText: originalPassage,
    paperUrls: [firstUrl], excerptIds: [a.id], excerpts: [a] };
  value.themes[0].title = english.theme.add; value.themes[0].authorNote = originalNote;
  value.themes[0].excerptIds = [a.id, b.id];
  value.themes[0].statements = [{ id: "statement1", kind: "contribution", text: originalSentence,
    paperUrls: [firstUrl], excerptIds: [a.id] }];
  value.readingStatuses = [{ paperUrl: value.workspace.entries[2].paper.url, status: "unread", reason: originalReason }];
  buildEvidenceDraft(value); return value;
}

type Fixture = { writes: number; navigations: string[]; locale(value: UiLocale): Promise<void> };
let browser: Browser, bundle: string, css: string;
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import LiteraturePage from'./app/literature/page';import DraftPage from'./app/literature/drafts/page';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    import{createMessages}from'./lib/i18n/messages';import{createRichMessages}from'./lib/i18n/rich-messages';
    const f=window.evidenceWorldFixture={writes:0,navigations:[]};
    for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){f.writes++;return original.apply(this,args)}}
    function App(){const[copy,setCopy]=useState(englishUiCopy),[view,setView]=useState('list');
      f.navigate=href=>{f.navigations.push(href);setView(href==='/literature/drafts'?'draft':'list')};
      f.locale=async locale=>{const preview=await loadUiPreview(locale);document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
        setCopy({locale,preview,message:createMessages(locale,preview.$messages),richMessage:createRichMessages(locale,preview.$messages)})};
      return <UiCopyContext.Provider value={copy}>{view==='list'?<LiteraturePage/>:<DraftPage/>}</UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production", KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [{ name: "offline-page-chrome-and-routing-only", setup(api) {
      api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "draft-chrome" }));
      api.onResolve({ filter: /^@\/components\/keryx\/(?:site-header|site-footer|sponsored-trial-notice)$/ }, args => ({ path: args.path, namespace: "draft-chrome" }));
      api.onLoad({ filter: /.*/, namespace: "draft-chrome" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "link"
        ? `import React from'react';export default function Link({prefetch,href,...props}){return <a {...props} href={href} onClick={event=>{if(href==='/literature/drafts'||href==='/literature'){event.preventDefault();window.evidenceWorldFixture.navigate(href)}}}/>;}`
        : `import React from'react';export function SiteHeader(){return <header/>}export function SiteFooter(){return <footer/>}export function SponsoredTrialNotice(){return null}` }));
    } }] });
  for (const path of ["app/literature/page.tsx", "app/literature/drafts/page.tsx", "components/keryx/evidence-draft-workspace.tsx", "components/keryx/evidence-draft-text.tsx", "lib/papers/literature-browser-store.ts", "lib/research/evidence-draft-export.ts"])
    expect(Object.keys(result.metafile!.inputs).some(input => input.replaceAll("\\", "/").endsWith(path))).toBe(true);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (captures) await mkdir(captures, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function locale(page: Page, value: UiLocale) {
  await page.evaluate(value => (window as unknown as { evidenceWorldFixture: Fixture }).evidenceWorldFixture.locale(value), value);
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(value);
}
async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact: true }).click()]);
  return readFile((await file.path())!, "utf8");
}
async function capture(locator: Locator, name: string) {
  if (!captures) return;
  await locator.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
  await locator.screenshot({ path: join(captures, name + ".png"), animations: "disabled" });
}
async function readable(page: Page, selected: Locator) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll("main *")].flatMap(element => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1 ? [{ tag: element.tagName, class: element.className,
        text: element.textContent?.slice(0, 90), left: Math.round(rect.left), right: Math.round(rect.right) }] : [];
    }).slice(0, 12),
  }));
  expect(layout.document <= layout.viewport + 1, `The actual production layout must stay inside its viewport: ${JSON.stringify(layout)}`).toBe(true);
  await expect.poll(() => selected.evaluate((element: HTMLSelectElement) => element.nextElementSibling?.textContent))
    .toBe(await selected.locator("option:checked").textContent());
  expect(await page.locator("main select").evaluateAll(elements => elements.every(element => {
    const select = element as HTMLSelectElement, caption = select.nextElementSibling;
    if (!(caption instanceof HTMLElement) || caption.getAttribute("aria-hidden") !== "true" ||
      caption.textContent !== select.selectedOptions[0]?.textContent) return false;
    const style = getComputedStyle(caption), box = caption.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(caption);
    return style.display !== "none" && style.visibility === "visible" && box.height > 0 &&
      style.textOverflow !== "ellipsis" && [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1);
  })), "Every native select must show its full current value in a visible wrapping caption without changing its accessible label").toBe(true);
}

it.each(matrix)("keeps $locale evidence drafts and exports exact at $width with $font px text", async ({ locale: language, width, font }) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
  const errors: string[] = [], unexpected: string[] = [], confirmations: string[] = [];
  const original = packet(), prefix = `evidence-draft-${language}-${width}-font${font}`;
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://evidence-world.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"></head><body><div id="root"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => { confirmations.push(dialog.message()); void dialog.accept(); });
    await page.goto("https://evidence-world.test/");
    const raw = serializeLiteratureWorkspace(original.workspace);
    await page.evaluate(({ key, raw, font }) => { localStorage.setItem(key, raw); document.documentElement.style.fontSize = `${font}px`; }, { key: LITERATURE_STORAGE_KEY, raw, font });
    await page.addScriptTag({ content: bundle }); await page.getByRole("link", { name: english.page.navigation, exact: true }).waitFor();
    await locale(page, language);
    const preview = await loadUiPreview(language), ui = previewCopy(preview, "evidence-drafts", english);
    const restore = previewCopy(preview, "evidence-draft-restore", restoreEnglish), editing = previewCopy(preview, "evidence-draft-editing", editingEnglish);
    const link = page.getByRole("link", { name: ui.page.navigation, exact: true });
    expect(await link.getAttribute("href")).toBe("/literature/drafts"); await capture(link, prefix + "-entry"); await link.click();
    await page.getByRole("heading", { name: ui.page.heading, exact: true }).waitFor();
    expect(await page.getByRole("textbox", { name: ui.theme.title, exact: true }).first().inputValue()).toBe(english.theme.initialTitle);
    const restoreRegion = page.getByRole("region", { name: restore.heading, exact: true });
    async function reopen(value: EvidenceDraftRequest) {
      await restoreRegion.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "original-private-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
      await restoreRegion.getByRole("button", { name: restore.restore, exact: true }).click();
      await restoreRegion.getByText(restore.restored, { exact: true }).waitFor();
    }
    await reopen(original);
    const claims = () => page.getByRole("region", { name: ui.claim.label, exact: true }).locator("article");
    const themes = () => page.getByRole("region", { name: ui.theme.label, exact: true }).locator("article");
    expect(await page.getByRole("textbox", { name: ui.claim.passage, exact: true }).inputValue()).toBe(originalPassage);
    expect(await themes().first().getByRole("textbox", { name: ui.theme.title, exact: true }).inputValue()).toBe(english.theme.add);
    expect(await themes().first().getByRole("textbox", { name: ui.theme.notes, exact: true }).inputValue()).toBe(originalNote);
    const kind = themes().first().getByRole("combobox", { name: ui.statement.kind, exact: true });
    expect(await kind.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["contribution", "agreement", "disagreement", "gap"]);
    expect(await kind.locator("option span").count()).toBe(0);
    expect(await page.locator("#root script, #root img").count()).toBe(0);
    await capture(page.locator("main"), prefix + "-restored"); await readable(page, kind);
    const readingLabelTop = await page.getByRole("combobox", { name: ui.reading.status, exact: true })
      .evaluate(element => element.closest("label")!.getBoundingClientRect().top);
    const readingLink = await page.getByRole("link", { name: ui.reading.prepare, exact: true }).boundingBox();
    expect(readingLink).not.toBeNull();
    expect(readingLabelTop, "Reading observation must start below its separate prepare-reading action").toBeGreaterThanOrEqual(readingLink!.y + readingLink!.height);
    const saved: EvidenceDraftRequest = JSON.parse(await download(page, ui.download.backup));
    expect(saved.workspace).toEqual(evidenceDraftWorkspace(original.workspace)); expect(saved.reports).toEqual(original.reports);
    expect(saved.claims).toEqual(original.claims); expect(saved.themes).toEqual(original.themes);
    expect(saved.passage).toBe(originalPassage); expect(saved.readingStatuses).toEqual(original.readingStatuses);
    const exports = exportEvidenceDraft(saved), before: Record<string, string> = {};
    for (const format of ["markdown", "latex", "bibtex", "ris"] as const) { before[format] = await download(page, ui.download[format]); expect(before[format]).toBe(exports[format]); }
    const passage = page.getByRole("textbox", { name: ui.claim.passage, exact: true }); await passage.evaluate(element => element.setAttribute("data-original-node", "preserved"));
    await page.getByRole("textbox", { name: ui.claim.reviewer, exact: true }).fill(originalReviewer);
    await locale(page, language === "en" ? "ar" : "en"); await locale(page, language);
    expect(await passage.getAttribute("data-original-node")).toBe("preserved"); expect(await passage.inputValue()).toBe(originalPassage);
    expect(await page.getByRole("textbox", { name: ui.claim.reviewer, exact: true }).inputValue()).toBe(originalReviewer);
    expect(JSON.parse(await download(page, ui.download.backup))).toEqual(saved);
    for (const format of ["markdown", "latex", "bibtex", "ris"] as const) expect(await download(page, ui.download[format])).toBe(before[format]);
    await claims().first().getByRole("button", { name: format(ui.claim.recordAssessment, { assessment: ui.claim.verdicts["partly-supported"] }), exact: true }).click();
    const assessed: EvidenceDraftRequest = JSON.parse(await download(page, ui.download.backup));
    expect(assessed.claims[0].assessment?.verdict).toBe("partly-supported"); expect(assessed.claims[0].assessment?.reviewer).toBe(originalReviewer);
    expect(assessed.claims[0].assessment?.claimText).toBe(originalPassage);
    await page.getByRole("button", { name: ui.theme.add, exact: true }).click();
    expect(await themes().last().getByRole("textbox", { name: ui.theme.title, exact: true }).inputValue()).toBe(english.theme.newTitle);
    expect((JSON.parse(await download(page, ui.download.backup)) as EvidenceDraftRequest).themes.at(-1)?.title).toBe(english.theme.newTitle);
    await kind.selectOption("agreement"); await page.getByText(ui.statement.needsTwoPapers, { exact: true }).waitFor(); await readable(page, kind);
    await capture(themes().first(), prefix + "-withheld");
    await kind.selectOption("disagreement"); await page.getByText(ui.statement.needsTwoPapers, { exact: true }).waitFor();
    await kind.selectOption("gap"); await readable(page, kind);
    const named = themes().first().getByRole("group", { name: ui.statement.papers, exact: true });
    await named.locator('input[type="checkbox"]:checked').uncheck(); await page.getByText(ui.statement.authorGap, { exact: true }).waitFor();
    const gap: EvidenceDraftRequest = JSON.parse(await download(page, ui.download.backup));
    expect(gap.themes[0].statements?.[0]).toMatchObject({ kind: "gap", text: originalSentence, paperUrls: [], excerptIds: [] });
    await kind.selectOption("contribution"); await page.getByText(ui.statement.needsOnePaper, { exact: true }).waitFor();
    await claims().first().getByRole("combobox", { name: ui.claim.paper, exact: true }).selectOption(original.workspace.entries[2].paper.url);
    await page.getByText(ui.claim.unavailable, { exact: true }).waitFor();
    expect(await claims().first().getByRole("button", { name: format(ui.claim.recordAssessment, { assessment: ui.claim.verdicts["not-found"] }), exact: true }).isDisabled()).toBe(true);
    const modelNotice = buildEvidenceDraft(JSON.parse(await download(page, ui.download.backup))).claims[0].evidenceNotice;
    const notice = claims().first().getByText(modelNotice, { exact: true });
    expect(await notice.getAttribute("lang")).toBe("en"); expect(await notice.getAttribute("dir")).toBe("ltr");
    await capture(page.getByRole("region", { name: ui.claim.label, exact: true }), prefix + "-unavailable");
    const unavailable: EvidenceDraftRequest = JSON.parse(await download(page, ui.download.backup));
    expect(unavailable.claims[0].assessment).toBeUndefined(); expect(buildEvidenceDraft(unavailable).claims[0].status).toBe("source-unavailable");
    await reopen(original);
    await restoreRegion.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{not valid JSON") });
    await restoreRegion.getByText(restore.refused, { exact: true }).waitFor();
    expect(JSON.parse(await download(page, ui.download.backup))).toEqual(saved);
    await claims().first().getByRole("button", { name: editing.removeClaim, exact: true }).click(); expect(await claims().count()).toBe(0);
    await page.getByRole("button", { name: editing.undoRemoval, exact: true }).click(); expect((JSON.parse(await download(page, ui.download.backup)) as EvidenceDraftRequest).claims).toEqual(saved.claims);
    await page.getByRole("button", { name: ui.workspace.clear, exact: true }).click();
    await page.getByRole("button", { name: editing.undoClear, exact: true }).click(); expect(JSON.parse(await download(page, ui.download.backup))).toEqual(saved);
    expect(confirmations).toHaveLength(2);
    expect(await page.evaluate(({ key }) => localStorage.getItem(key), { key: LITERATURE_STORAGE_KEY })).toBe(raw);
    expect(await page.evaluate(() => (window as unknown as { evidenceWorldFixture: Fixture }).evidenceWorldFixture.writes)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { evidenceWorldFixture: Fixture }).evidenceWorldFixture.navigations)).toEqual(["/literature/drafts"]);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  } finally { await context.close(); }
}, 90_000);
