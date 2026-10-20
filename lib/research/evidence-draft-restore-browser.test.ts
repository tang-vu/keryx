import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft } from "./evidence-draft";
import { evidenceDraftCopy as copy } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";
import { MAX_EVIDENCE_DRAFT_BACKUP_BYTES } from "./evidence-draft-restore";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{EvidenceDraftWorkspace}from'./components/keryx/evidence-draft-workspace';
    createRoot(document.getElementById('root')).render(<EvidenceDraftWorkspace/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "offline-workspace", setup(plugin) {
      plugin.onResolve({ filter: /literature-browser-store$/ }, () => ({ path: "store", namespace: "fixture" }));
      plugin.onResolve({ filter: /completed-evidence-draft-selector$/ }, () => ({ path: "completed", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: path === "store"
        ? `const workspace={version:1,scope:'personal-bibliography',title:'Existing library',question:'',entries:[]};
           export function useLiteratureWorkspace(){return {ready:true,workspace};}`
        : `export function CompletedEvidenceDraftSelector({onImport}){window.originalCompletedImport??=onImport;window.latestCompletedImport=onImport;return null;}` }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const backup = () => {
  const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
  packet.themes[0].excerptIds = [excerpt.id]; packet.claims[0].excerptIds = [excerpt.id];
  packet.claims[0].assessment = { origin: "user-assessment", reviewer: "Fixture reviewer", reviewedAt: "2026-10-20T00:00:00Z",
    verdict: "supported", claimText: packet.passage, paperUrls: packet.claims[0].paperUrls, excerptIds: [excerpt.id], excerpts: [excerpt] };
  return packet;
};
const choose = (page: Page, content: string | Buffer, name = "private-evidence-draft.json") => page.getByLabel(restore.file).setInputFiles({ name, mimeType: "application/json", buffer: typeof content === "string" ? Buffer.from(content) : content });
async function fixturePage(page: Page, requests: string[]) {
  await page.route("**/*", route => {
    requests.push(route.request().url());
    return route.request().url() === "https://draft-restore.test/" ? route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' }) : route.abort();
  });
  await page.goto("https://draft-restore.test/");
  await page.evaluate(() => localStorage.setItem("saved-library-sentinel", "unchanged"));
  await page.addScriptTag({ content: bundle });
  await page.getByLabel(copy.claim.passage).waitFor();
}

it.each([320, 1366])("saves, reopens and continues a private draft without changing the library at %ipx", async width => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  try {
    const page = await context.newPage(), requests: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await fixturePage(page, requests);
    const packet = backup(), passage = page.getByLabel(copy.claim.passage);
    await passage.fill("Current unsaved text");
    await choose(page, JSON.stringify(packet, null, 2));
    await page.getByRole("heading", { name: "Methods review", exact: true }).waitFor();
    expect(await passage.inputValue()).toBe("Current unsaved text");
    const [previous] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: restore.save, exact: true }).click()]);
    expect(JSON.parse(await readFile((await previous.path())!, "utf8")).passage).toBe("Current unsaved text");
    await passage.fill("Latest edits after preview");
    expect(await page.getByRole("button", { name: restore.restore, exact: true }).isDisabled()).toBe(true);
    await choose(page, JSON.stringify(packet));
    await page.getByRole("button", { name: restore.restore, exact: true }).click();
    expect(await passage.inputValue()).toBe(packet.passage);
    expect(await page.getByText("Your assessment: supported", { exact: true }).count()).toBe(1);
    await page.getByLabel(copy.theme.notes).fill("Written after restoring this draft.");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy.download.backup, exact: true }).click()]);
    const path = (await download.path())!;
    const exported = JSON.parse(await readFile(path, "utf8"));
    expect(exported.themes[0].authorNote).toBe("Written after restoring this draft.");
    expect(exported.claims[0].assessment).toEqual(packet.claims[0].assessment);
    await page.reload(); await page.addScriptTag({ content: bundle });
    expect(await passage.inputValue()).toBe("");
    await page.getByLabel(restore.file).setInputFiles(path);
    await page.getByRole("button", { name: restore.restore, exact: true }).click();
    expect(await passage.inputValue()).toBe(packet.passage);
    expect(await page.getByLabel(copy.theme.notes).inputValue()).toBe("Written after restoring this draft.");
    const [markdown] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy.download.markdown, exact: true }).click()]);
    const text = await readFile((await markdown.path())!, "utf8");
    expect(text).toContain("Written after restoring this draft.");
    expect(text).toContain(packet.reports[0].evidence![0].quote);
    expect(text).toContain(packet.workspace.entries[0].paper.url);
    expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([["saved-library-sentinel", "unchanged"]]);
    expect(errors).toEqual([]);
    expect(requests.every(url => url === "https://draft-restore.test/")).toBe(true);
  } finally { await context.close(); }
});

it("rejects invalid files and stale/cancelled reads while preserving current edits", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), requests: string[] = [];
    await fixturePage(page, requests);
    const passage = page.getByLabel(copy.claim.passage);
    await passage.fill("Keep current edits");
    for (const bad of ["{invalid", Buffer.from([0xff]), Buffer.alloc(MAX_EVIDENCE_DRAFT_BACKUP_BYTES + 1)]) {
      await choose(page, bad);
      await page.getByText(restore.refused, { exact: true }).waitFor();
      expect(await passage.inputValue()).toBe("Keep current edits");
    }
    await page.evaluate(() => {
      const native = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name !== "slow.json") return native.call(this);
        return native.call(this).then(bytes => new Promise<ArrayBuffer>(resolve => {
          (window as unknown as { releaseSlow: () => void }).releaseSlow = () => resolve(bytes);
        }));
      };
    });
    await choose(page, JSON.stringify(backup()), "slow.json");
    await page.waitForFunction(() => typeof (window as unknown as { releaseSlow?: () => void }).releaseSlow === "function");
    await passage.fill("Changed while file was reading");
    await page.evaluate(() => (window as unknown as { releaseSlow: () => void }).releaseSlow());
    await page.getByText(restore.stale, { exact: true }).waitFor();
    expect(await passage.inputValue()).toBe("Changed while file was reading");
    await page.evaluate(() => { delete (window as unknown as { releaseSlow?: () => void }).releaseSlow; });
    await choose(page, JSON.stringify(backup()), "slow.json");
    await page.waitForFunction(() => typeof (window as unknown as { releaseSlow?: () => void }).releaseSlow === "function");
    await page.getByRole("button", { name: restore.cancel, exact: true }).click();
    await page.evaluate(() => (window as unknown as { releaseSlow: () => void }).releaseSlow());
    await page.getByText(restore.cancelled, { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: restore.restore, exact: true }).count()).toBe(0);
    await page.evaluate(() => { delete (window as unknown as { releaseSlow?: () => void }).releaseSlow; });
    const superseded = backup(); superseded.workspace.title = "Superseded backup";
    await choose(page, JSON.stringify(superseded), "slow.json");
    await page.waitForFunction(() => typeof (window as unknown as { releaseSlow?: () => void }).releaseSlow === "function");
    await choose(page, JSON.stringify(backup()));
    await page.getByRole("heading", { name: "Methods review", exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { releaseSlow: () => void }).releaseSlow());
    await page.getByRole("button", { name: restore.restore, exact: true }).click();
    const late = { report: { ...backup().reports[0], id: "late_report" }, readingStatuses: [] };
    expect(await page.evaluate(value => (window as unknown as { originalCompletedImport: (value: unknown) => boolean }).originalCompletedImport(value), late)).toBe(false);
    expect(await page.getByText("Reports: 1 · matching retained excerpts: 1", { exact: true }).count()).toBe(1);
    expect(await page.evaluate(value => (window as unknown as { latestCompletedImport: (value: unknown) => boolean }).latestCompletedImport(value), late)).toBe(true);
    await page.getByText("Reports: 2 · matching retained excerpts: 2", { exact: true }).waitFor();
    expect(requests.every(url => url === "https://draft-restore.test/")).toBe(true);
  } finally { await context.close(); }
});
