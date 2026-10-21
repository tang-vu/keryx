import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft, type EvidenceDraftRequest } from "./evidence-draft";
import { evidenceDraftCopy as copy } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{EvidenceDraftWorkspace}from'./components/keryx/evidence-draft-workspace';
    createRoot(document.getElementById('root')).render(<EvidenceDraftWorkspace/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

function backup() {
  const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
  packet.passage = "Recorded result. Recorded result.";
  packet.claims = [0, 17].map((start, index) => ({ ...packet.claims[0], id: `claim${index + 1}`, start, end: start + 16,
    excerptIds: [excerpt.id], assessment: { origin: "user-assessment", reviewer: `Reviewer ${index + 1}`, reviewedAt: "2026-10-20T00:00:00Z",
      verdict: "supported", claimText: "Recorded result.", paperUrls: packet.claims[0].paperUrls, excerptIds: [excerpt.id], excerpts: [excerpt] } }));
  buildEvidenceDraft(packet);
  return packet;
}
async function reopen(page: Page, packet: EvidenceDraftRequest) {
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "private-evidence-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(packet)) });
  await page.getByRole("button", { name: restore.restore, exact: true }).click();
  await page.getByText(restore.restored, { exact: true }).waitFor();
}
async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy.download.backup, exact: true }).click()]);
  return JSON.parse(await readFile((await file.path())!, "utf8")) as EvidenceDraftRequest;
}
async function fixture(width: number, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://draft-passage.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-passage.test/"); await page.addScriptTag({ content: bundle });
    await page.getByLabel(copy.claim.passage).waitFor();
    await run(page);
    expect(errors).toEqual([]); expect(requests.every(url => url === "https://draft-passage.test/")).toBe(true);
    expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([]);
  } finally { await context.close(); }
}
async function select(page: Page, start: number, end = start) {
  await page.getByLabel(copy.claim.passage).evaluate((element: HTMLTextAreaElement, range) => {
    element.focus(); element.setSelectionRange(range.start, range.end);
  }, { start, end });
}

it.each([320, 1440])("preserves assessed claims through surrounding Unicode edits and export/restore at %ipx", width => fixture(width, async page => {
  const packet = backup(); await reopen(page, packet);
  await select(page, 0); await page.keyboard.insertText("🧪 Introduction. ");
  await select(page, (await page.getByLabel(copy.claim.passage).inputValue()).length); await page.keyboard.insertText(" New conclusion.");
  const saved = await download(page), shift = "🧪 Introduction. ".length;
  expect(saved.claims).toEqual(packet.claims.map(row => ({ ...row, start: row.start + shift, end: row.end + shift })));
  expect(buildEvidenceDraft(saved).claims.map(row => row.status)).toEqual(["user-assessed", "user-assessed"]);
  expect(saved.reports).toEqual(packet.reports); expect(saved.themes).toEqual(packet.themes);
  await reopen(page, saved);
  expect(await page.getByText("Your assessment: supported", { exact: true }).count()).toBe(2);
}));

it.each([320, 1440])("deletes the first repeated occurrence without transferring its assessment at %ipx", width => fixture(width, async page => {
  const packet = backup(); await reopen(page, packet);
  await select(page, 0, 17); await page.keyboard.press("Backspace");
  const saved = await download(page);
  expect(saved.passage).toBe("Recorded result.");
  expect(saved.claims).toEqual([{ ...packet.claims[1], start: 0, end: 16 }]);
  expect(buildEvidenceDraft(saved).claims[0].assessment?.reviewer).toBe("Reviewer 2");
  expect(await page.getByRole("status").filter({ hasText: copy.claim.selectFirst }).count()).toBe(1);
}));

it.each([320, 1440])("withholds edited claim evidence, keeps its neighbor and resets the notice on restore at %ipx", width => fixture(width, async page => {
  const packet = backup(); await reopen(page, packet);
  await select(page, 3); await page.keyboard.insertText("new ");
  await page.keyboard.insertText("word ");
  const saved = await download(page), shift = "new word ".length;
  expect(saved.claims).toEqual([{ ...packet.claims[1], start: 17 + shift, end: 33 + shift }]);
  expect(saved.reports).toEqual(packet.reports); expect(saved.themes).toEqual(packet.themes);
  expect(await page.getByRole("status").filter({ hasText: copy.claim.selectFirst }).count()).toBe(1);
  await reopen(page, packet);
  expect(await page.getByRole("status").filter({ hasText: copy.claim.selectFirst }).count()).toBe(0);
  expect(await page.getByText("Your assessment: supported", { exact: true }).count()).toBe(2);
}));
