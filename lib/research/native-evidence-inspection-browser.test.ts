import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMessages, englishMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import type { QueryRun } from "../types";
import type { BibliographicOriginalRecord } from "./bibliographic-original-types";
import { bibliographicOriginalDeliverable } from "./bibliographic-original-text";
import type { BibliographicTaskResult } from "./bibliographic-task";

let browser: Browser, css: string, bundle: string;
const capture = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR
  ? join(process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR, "evidence-inspection") : undefined;
const claim = "Original target <literal> {count} 日本語 / हिन्दी";
const quote = "Original quote <literal> {source}.  \n\n";
const first = { marker: "P1", sourceId: "original-alpha", sourceName: "Restore source", itemId: "1706.03762v7",
  itemTitle: "Article original {count} 日本語", itemUrl: "https://arxiv.org/abs/1706.03762v7", contentVersion: "v7",
  weight: 0.5, reward: 0, rationale: "Original rationale" };
const second = { ...first, marker: "P2", sourceId: "original-beta", sourceName: "Original second source", itemTitle: "Second original article" };
const run: QueryRun = { id: "local-inspection-browser-fixture", question: "Original question {count}", answer: "Original answer [P1].",
  subClaims: [claim, "Original audit target", "Original missing target"], citations: [first, second], decisions: [], trace: [],
  budget: 0.025, totalSpent: 0.000001, totalToCreators: 0, pendingPayments: 1, engine: "fixture", paymentMode: "offline", createdAt: "2026-10-30T00:00:00Z",
  evidence: [
    { ...first, claimIndex: 0, claim, quote, support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...second, claimIndex: 0, claim, quote: "Original second quote.", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...first, claimIndex: 1, claim: "Original audit target", quote: "Original audit quote.", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false },
  ] };
const record: BibliographicOriginalRecord = { scope: "metadata-only", requested: { scope: "metadata-only", language: "en", target: { kind: "arxiv", id: "1706.03762v7" } },
  fields: { title: { state: "observed", value: "Metadata original {source} हिन्दी", provenance: [{ path: "fixture.title" }] },
    firstAuthor: { state: "observed", value: "Original Author", provenance: [{ path: "fixture.authors[0]" }] },
    identifier: { state: "observed", value: "1706.03762v7", provenance: [{ path: "fixture.identifier" }] },
    year: { state: "observed", value: "2020", provenance: [{ path: "fixture.year" }] },
    journal: { state: "missing", reason: "not-explicit" }, doi: { state: "missing", reason: "not-explicit" }, status: { state: "missing", reason: "not-explicit" } },
  authors: [{ position: 1, name: "Original Author", provenance: { path: "fixture.authors[0]" } }], authorCount: 1, authorsIncomplete: false, peerReview: "unknown",
  paper: { title: "Metadata original {source} हिन्दी", authors: ["Original Author"], authorCount: 1, authorsTruncated: false,
    arxivId: "1706.03762v7", repository: "arxiv", url: "https://arxiv.org/abs/1706.03762v7", metadataUrl: "https://arxiv.org/abs/1706.03762v7",
    metadataObservedAt: "2026-10-30T00:00:00Z", publishedYear: 2020, publicationKind: "preprint", peerReview: "unknown" } };
const bibliography: BibliographicTaskResult = { kind: "bibliography", ...bibliographicOriginalDeliverable(record),
  originalQuestionSha256: "a".repeat(64), requestedFields: ["title", "identifier"], requestedAuthorCount: 1, record };
const emptyRecord = { ...record, paper: undefined };
const emptyBibliography = { ...bibliography, ...bibliographicOriginalDeliverable(emptyRecord), record: emptyRecord };
type Fixture = { failDownloads: boolean; blobTypes: string[]; revoked: string[]; empty(value: boolean): void; unchanged(): boolean };
const originalsByFilename = new Map<string, string>();

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{SourceEvidenceLens}from'./components/keryx/source-evidence-lens';import{ResearchCitationExport}from'./components/keryx/research-citation-export';
    import{BibliographyExports}from'./components/keryx/bibliography-exports';import{LanguageSwitcher}from'./components/keryx/language-switcher';
    import{LocaleProvider}from'./lib/i18n/locale-context';import{UiCopyProvider}from'./lib/i18n/ui-copy-provider';
    import{preparedLocales}from'./lib/i18n/locales';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    const original=${JSON.stringify(run)},bibliography=${JSON.stringify(bibliography)},emptyBibliography=${JSON.stringify(emptyBibliography)};
    const before=JSON.stringify({original,bibliography});const fixture=window.evidenceFixture={failDownloads:false,blobTypes:[],revoked:[],unchanged:()=>JSON.stringify({original,bibliography})===before};
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(fixture.failDownloads)throw Error('Explicit download failure fixture');fixture.blobTypes.push(blob.type);return create(blob)};
    URL.revokeObjectURL=url=>{fixture.revoked.push(url);return revoke(url)};
    function App(){const[empty,setEmpty]=useState(false);fixture.empty=setEmpty;return <LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider>
      <LanguageSwitcher/><main className="mx-auto max-w-[960px] px-4"><section id="lens"><SourceEvidenceLens run={original}/></section>
      <section id="exports"><div id="citations"><ResearchCitationExport citations={empty?[{...original.citations[0],itemUrl:undefined}]:[original.citations[0],{...original.citations[1],itemUrl:undefined}]}/></div>
      <div id="bibliography"><BibliographyExports result={empty?emptyBibliography:bibliography}/></div></section></main>
    </UiCopyProvider></LocaleProvider>};createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  for (const path of ["components/keryx/source-evidence-lens.tsx", "components/keryx/research-citation-export.tsx", "components/keryx/bibliography-exports.tsx",
    "lib/research/source-evidence-lens.ts", "lib/research-citation-export.ts", "lib/papers/reference-export.ts", "lib/browser-text-download.ts", "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx"])
    expect(inputs.some(input => input.endsWith(path))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  css += `@font-face{font-family:EvidenceDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:EvidenceSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:EvidenceMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:EvidenceDisplay;--font-spectral:EvidenceSerif;--font-spline-mono:EvidenceMono}`;
  if (capture) await mkdir(capture, { recursive: true }); browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each((["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const).flatMap(locale => [320, 1366].map(width => ({ locale, width }))))(
  "keeps actual $locale excerpt inspection and original reference downloads local at $width", async ({ locale, width }) => {
    const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", acceptDownloads: true, serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://evidence.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === "/evidence.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/evidence.css"></head><body><div id="root"></div></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://evidence.test/"); await page.addScriptTag({ content: bundle });
      const language = page.locator("[data-language-switcher] select"); await expect.poll(() => language.isEnabled()).toBe(true);
      await language.selectOption(locale); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale);
      const lens = page.locator("#lens"); await lens.locator(":scope > details > summary").click();
      const select = lens.getByRole("combobox"), rows = lens.locator("ol > li");
      expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "2"]);
      await rows.first().locator("details > summary").click();
      expect(await rows.first().locator("blockquote p").first().textContent()).toBe(`“${quote}”`);
      await select.selectOption(first.sourceId);
      expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "1"]);
      expect(await rows.nth(1).locator("dd").allTextContents()).toEqual(["1", "0"]);
      expect(await rows.nth(2).locator("dd").allTextContents()).toEqual(["0", "0"]);
      for (const row of await rows.all()) {
        const positions = await row.locator("dd").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
        expect(Math.abs(positions[0] - positions[1])).toBeLessThan(1);
      }
      expect(await lens.getByRole("status").textContent()).toContain(message("reportSourceLens.omitted.one", { count: 1, source: first.sourceName }));
      expect(await rows.first().locator("h3").textContent()).toBe(claim); expect(await rows.first().locator("h3").getAttribute("lang")).toBe("und");
      expect(await lens.locator('[lang="en"]').filter({ hasText: englishMessages["reportSourceLens.qualification"] }).count()).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (capture) await lens.screenshot({ path: join(capture, `evidence-${locale}-${width}-omitted.png`) });
      await lens.getByRole("button", { name: message("reportSourceLens.restore"), exact: true }).click();
      expect(await select.inputValue()).toBe(""); expect(await select.evaluate(node => document.activeElement === node)).toBe(true);
      expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "2"]);
      expect(await rows.first().locator("blockquote p").first().textContent()).toBe(`“${quote}”`);
      const citationPanel = page.locator("#citations"), bibliographyPanel = page.locator("#bibliography");
      expect(await citationPanel.locator(`button [lang="${locale}"]`).count()).toBe(3);
      expect(await bibliographyPanel.locator(`button [lang="${locale}"]`).count()).toBe(3);
      expect(await citationPanel.textContent()).toContain(message("citationExport.omitted.one", { count: 1 }));
      expect(await bibliographyPanel.locator('[lang="en"]').textContent()).toBe(englishMessages["bibliographyExport.notice"]);
      for (const [panel, namespace, prefix, title, otherTitle] of [
        [citationPanel, "citationExport", "keryx-references", "Article original", "Metadata original"],
        [bibliographyPanel, "bibliographyExport", "keryx-bibliography", "Metadata original", "Article original"],
      ] as const) {
        for (const [format, extension] of [["bibtex", "bib"], ["ris", "ris"], ["cslJson", "json"]] as const) {
          const button = panel.getByRole("button", { name: message(`${namespace}.${format}`), exact: true });
          const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
          const filename = `${prefix}.${extension}`; expect(download.suggestedFilename()).toBe(filename); expect(await download.failure()).toBeNull();
          const output = await readFile((await download.path())!, "utf8"); expect(output).toContain(first.itemUrl); expect(output).toContain(title); expect(output).not.toContain(otherTitle);
          if (extension === "json") expect(JSON.parse(output)).toHaveLength(1);
          if (originalsByFilename.has(filename)) expect(output).toBe(originalsByFilename.get(filename)); else originalsByFilename.set(filename, output);
        }
      }
      await expect.poll(() => page.evaluate(() => (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.revoked.length)).toBe(6);
      const types = await page.evaluate(() => (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.blobTypes);
      expect(types.filter(type => type.startsWith("application/json"))).toHaveLength(2); expect(types.filter(type => type.startsWith("text/plain"))).toHaveLength(4);
      await page.evaluate(() => { (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.failDownloads = true; });
      await citationPanel.getByRole("button", { name: message("citationExport.bibtex"), exact: true }).click();
      await bibliographyPanel.getByRole("button", { name: message("bibliographyExport.bibtex"), exact: true }).click();
      expect(await citationPanel.getByRole("alert").locator('[lang="en"]').textContent()).toBe(englishMessages["citationExport.failed"]);
      expect(await bibliographyPanel.getByRole("alert").locator('[lang="en"]').textContent()).toBe(englishMessages["bibliographyExport.failed"]);
      await bibliographyPanel.locator("details > summary").click(); expect(await bibliographyPanel.locator("pre").textContent()).toBe(JSON.stringify(record, null, 2));
      expect(await bibliographyPanel.locator("pre").getAttribute("lang")).toBe("und");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (capture) await page.locator("#exports").screenshot({ path: join(capture, `evidence-${locale}-${width}-exports-failed.png`) });
      const alternate = locale === "fr" ? "ja" : "fr"; await language.selectOption(alternate);
      await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(alternate);
      expect(await citationPanel.getByRole("alert").locator('[lang="en"]').textContent()).toBe(englishMessages["citationExport.failed"]);
      expect(await bibliographyPanel.getByRole("alert").locator('[lang="en"]').textContent()).toBe(englishMessages["bibliographyExport.failed"]);
      await page.evaluate(() => (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.empty(true));
      await expect.poll(() => page.locator("#exports button:disabled").count()).toBe(6);
      expect(await page.evaluate(() => (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.blobTypes.length)).toBe(6);
      expect(await page.evaluate(() => (window as unknown as { evidenceFixture: Fixture }).evidenceFixture.unchanged())).toBe(true);
      expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }, 20_000,
);
