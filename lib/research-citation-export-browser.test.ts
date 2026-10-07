import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchCitationExport}from'./components/keryx/research-citation-export';
    const citation={marker:'P1',sourceId:'public:arxiv',sourceName:'Group <img src="https://tracker.invalid/pixel"> & research',
      itemId:'1706.03762v7',itemTitle:'Recorded preprint',itemUrl:'https://arxiv.org/abs/1706.03762v7',contentVersion:'v7',weight:0,reward:0,rationale:'recorded',
      scholarly:{provider:'arxiv',recordUrl:'https://export.arxiv.org/api/query',retrievedAt:'2026-10-07T00:00:00Z',title:'Recorded preprint',authors:[],
        workType:'preprint',arxivId:'1706.03762v7',peerReview:'unknown',evidenceScope:'abstract-page'}};
    createRoot(document.getElementById('root')).render(<ResearchCitationExport citations={[citation,{...citation,marker:'S2',itemUrl:undefined}]}/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

it.each([320, 1366])("downloads actual RIS and BibTeX files with retained preprint identity at %ipx", async width => {
  const context = await browser.newContext({ viewport: { width, height: 768 }, acceptDownloads: true });
  try {
    const requests: string[] = [];
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://references.test/"
        ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage();
    await page.goto("https://references.test/");
    await page.addScriptTag({ content: bundle });
    await page.getByText(/1 article references/).waitFor();
    expect(await page.locator("body").textContent()).toContain("1 citations omitted");
    for (const [button, filename] of [["Download RIS (Zotero)", "keryx-references.ris"],
      ["Download BibTeX", "keryx-references.bib"]] as const) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button, exact: true }).click()]);
      expect(download.suggestedFilename()).toBe(filename);
      expect(await download.failure()).toBeNull();
      const output = await readFile((await download.path())!, "utf8");
      expect(output).toContain("https://arxiv.org/abs/1706.03762v7");
      expect(output).toContain("Read scope: abstract-page. Preprint. Peer review unknown");
      expect(output).toContain("Content version: v7.");
      if (filename.endsWith(".ris")) {
        expect(output).toContain("TY  - MANSCPT\r\n"); expect(output).not.toContain("TY  - JOUR");
        expect(output).toContain("AN  - arXiv:1706.03762v7");
        expect(output).toContain("Group &lt;img"); expect(output).not.toContain("<img");
      } else { expect(output).toContain("@misc{"); expect(output).toContain("archivePrefix = {arXiv}"); }
    }
    expect(requests).toEqual(["https://references.test/"]);
  } finally { await context.close(); }
});
