import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { evidenceDraftCopy as copy } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";
import { evidenceDraftEditingCopy as editing } from "../../locales/en/evidence-draft-editing";
import { LITERATURE_STORAGE_KEY, serializeLiteratureWorkspace } from "../papers/literature-workspace";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{EvidenceDraftWorkspace}from'./components/keryx/evidence-draft-workspace';
    const root=createRoot(document.getElementById('root'));root.render(<EvidenceDraftWorkspace/>);
    window.unmountDraft=()=>root.unmount();
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

// Exercise the installed page's cancellation behavior, without a real navigation
// for each edit. The responsive cases below also exercise native reload dialogs.
const warns = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
async function expectWarning(page: Page, expected: boolean) { await expect.poll(() => warns(page)).toBe(expected); }
async function download(page: Page, label = copy.download.backup) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label, exact: true }).click()]);
  return JSON.parse(await readFile((await file.path())!, "utf8"));
}
async function openBackup(page: Page) {
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "private-evidence-draft.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(evidenceDraftFixture())) });
  await page.getByRole("button", { name: restore.restore, exact: true }).click();
  await page.getByText(restore.restored, { exact: true }).waitFor();
}
async function fixture(run: (page: Page) => Promise<void>, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://draft-unload.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta charset="utf-8"><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-unload.test/");
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY,
      raw: serializeLiteratureWorkspace(evidenceDraftFixture().workspace) });
    const original = await page.evaluate(() => Object.entries(localStorage).sort());
    await page.addScriptTag({ content: bundle });
    await page.getByLabel(copy.claim.passage).waitFor();
    await run(page);
    expect(await page.evaluate(() => Object.entries(localStorage).sort())).toEqual(original);
    expect(errors).toEqual([]); expect(requests.every(url => url === "https://draft-unload.test/")).toBe(true);
  } finally { await context.close(); }
}

it("protects author edits, returns to clean when reverted, and detaches on unmount", async () => {
  await fixture(async page => {
    await expectWarning(page, false);
    const passage = page.getByLabel(copy.claim.passage);
    await passage.fill("Unsaved original passage"); await expectWarning(page, true);
    await passage.fill(""); await expectWarning(page, false);
    const notes = page.getByLabel(copy.theme.notes);
    await notes.fill("Unsaved author note"); await expectWarning(page, true);
    await page.evaluate(() => (window as unknown as { unmountDraft(): void }).unmountDraft());
    await expectWarning(page, false);
  });
});

it("uses restored/downloaded JSON as the retained baseline, never a text export", async () => {
  await fixture(async page => {
    await openBackup(page); await expectWarning(page, false);
    const notes = page.getByLabel(copy.theme.notes), original = await notes.inputValue();
    await notes.fill("Latest note"); await expectWarning(page, true);
    const [markdown] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy.download.markdown, exact: true }).click()]);
    expect(await readFile((await markdown.path())!, "utf8")).toContain("Latest note");
    await expectWarning(page, true);
    expect((await download(page)).themes[0].authorNote).toBe("Latest note"); await expectWarning(page, false);
    await notes.fill(original); await expectWarning(page, true);
    await notes.fill("Latest note"); await expectWarning(page, false);
    await notes.fill("Discarded on explicit restore"); await openBackup(page); await expectWarning(page, false);
  });
});

it.each(["report", "reviewer", "unfinished"] as const)("keeps unretained %s input protected after private JSON download", async kind => {
  await fixture(async page => {
    await openBackup(page);
    if (kind === "report") await page.getByLabel(copy.import.label).fill('{"notImported":true}');
    if (kind === "reviewer") await page.getByLabel(copy.claim.reviewer).fill("Unretained reviewer input");
    if (kind === "unfinished") {
      await page.getByRole("button", { name: copy.statement.add, exact: true }).click();
      await page.getByLabel(copy.statement.kind).selectOption("gap");
    }
    await expectWarning(page, true);
    const packet = await download(page); expect(packet).not.toHaveProperty("reportJson"); expect(packet).not.toHaveProperty("reviewer");
    expect(packet.themes[0].statements ?? []).toEqual([]); await expectWarning(page, true);
    if (kind === "report") await page.getByLabel(copy.import.label).fill("");
    if (kind === "reviewer") await page.getByLabel(copy.claim.reviewer).fill("");
    if (kind === "unfinished") await page.getByRole("button", { name: copy.statement.remove, exact: true }).click();
    await expectWarning(page, false);
  });
});

it("retains the warning when a private JSON download cannot start", async () => {
  await fixture(async page => {
    await page.getByLabel(copy.claim.passage).fill("Keep this after download failure");
    await page.evaluate(() => { URL.createObjectURL = () => { throw new Error("Synthetic download refusal"); }; });
    await page.getByRole("button", { name: copy.download.backup, exact: true }).click();
    await page.getByText(copy.download.backupRefused, { exact: true }).waitFor(); await expectWarning(page, true);
  });
});

it.each([320, 1440])("dismisses a real reload without losing work at %ipx", async width => {
  await fixture(async page => {
    const passage = page.getByLabel(copy.claim.passage);
    await passage.fill("Keep these exact unsaved bytes \u{1f600}");
    const opened = page.waitForEvent("dialog", { timeout: 1500 });
    const reload = page.reload().then(() => "loaded", () => "cancelled");
    const dialog = await opened;
    expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); expect(await reload).toBe("cancelled");
    expect(await passage.inputValue()).toBe("Keep these exact unsaved bytes \u{1f600}"); await expectWarning(page, true);
    expect((await download(page)).passage).toBe("Keep these exact unsaved bytes \u{1f600}"); await expectWarning(page, false);
  }, width);
});

it("restores the prior retained baseline and warning when undoing clear", async () => {
  await fixture(async page => {
    const clear = async () => {
      const opened = page.waitForEvent("dialog"), click = page.getByRole("button", { name: copy.workspace.clear, exact: true }).click();
      const dialog = await opened; expect(dialog.message()).toBe(editing.confirmClear); await dialog.accept(); await click;
    };
    await openBackup(page); await expectWarning(page, false);
    await clear(); await expectWarning(page, false);
    await page.getByRole("button", { name: editing.undoClear, exact: true }).click(); await expectWarning(page, false);
    await page.getByLabel(copy.theme.notes).fill("Unsaved note before clear"); await expectWarning(page, true);
    await clear(); await expectWarning(page, false);
    await page.getByRole("button", { name: editing.undoClear, exact: true }).click();
    expect(await page.getByLabel(copy.theme.notes).inputValue()).toBe("Unsaved note before clear"); await expectWarning(page, true);
    expect((await download(page)).themes[0].authorNote).toBe("Unsaved note before clear"); await expectWarning(page, false);
  });
});
