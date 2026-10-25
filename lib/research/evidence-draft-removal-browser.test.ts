import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftCopy as copy } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";
import { evidenceDraftEditingCopy as editing } from "../../locales/en/evidence-draft-editing";
import { LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { PAPER_CATALOG } from "../papers/catalog";

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
  const packet = evidenceDraftFixture(), firstUrl = packet.workspace.entries[0].paper.url, second = PAPER_CATALOG[1];
  packet.workspace = saveLiteraturePaper(packet.workspace, second, "2026-10-20T00:00:00Z");
  packet.workspace.entries[1].screening = "include";
  const identity = { ...packet.reports[0].citations[0], sourceId: "second-original", marker: "S2", itemId: "second-paper",
    itemUrl: second.url, itemTitle: second.title, contentVersion: "sha256:second-version" };
  packet.reports.push({ id: "retained2", subClaims: ["Second research target"], citations: [identity], evidence: [{ ...identity,
    claimIndex: 0, claim: "Second research target", quote: "The second retained method was evaluated separately.", qualifiesForAnswer: true, qualifiesForReward: false }] });
  const excerpts = buildEvidenceDraft(packet).excerpts;
  packet.claims = [firstUrl, second.url].map((url, index) => {
    const excerpt = excerpts.find(row => row.paperUrl === url)!;
    return { ...packet.claims[0], id: `claim${index + 3}`, paperUrls: [url], excerptIds: [excerpt.id], assessment: {
      origin: "user-assessment" as const, reviewer: `Fixture reviewer ${index}`, reviewedAt: "2026-10-20T00:00:00Z", verdict: "supported" as const,
      claimText: packet.passage, paperUrls: [url], excerptIds: [excerpt.id], excerpts: [excerpt],
    } };
  });
  packet.themes = [firstUrl, second.url].map((url, index) => {
    const excerpt = excerpts.find(row => row.paperUrl === url)!;
    return { id: `theme${index + 3}`, title: `Original theme ${index}`, authorNote: `Original note ${index}`, excerptIds: [excerpt.id],
      statements: [{ id: `statement${index + 3}`, kind: "contribution" as const, text: `Author statement ${index}`, paperUrls: [url], excerptIds: [excerpt.id] }] };
  });
  buildEvidenceDraft(packet);
  return packet;
}
const claims = (page: Page) => page.getByRole("region", { name: copy.claim.label, exact: true }).locator("article");
const themes = (page: Page) => page.getByRole("region", { name: copy.theme.label, exact: true }).locator("article");
async function download(page: Page, label: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label, exact: true }).click()]);
  return readFile((await file.path())!, "utf8");
}
const saved = async (page: Page): Promise<EvidenceDraftRequest> => JSON.parse(await download(page, copy.download.backup));
async function remove(page: Page, button: Locator, message: string, accept: boolean) {
  const dialog = page.waitForEvent("dialog");
  const click = button.click();
  const opened = await dialog;
  expect(opened.type()).toBe("confirm"); expect(opened.message()).toBe(message);
  if (accept) await opened.accept(); else await opened.dismiss();
  await click;
}
async function fixture(width: number, run: (page: Page, packet: EvidenceDraftRequest) => Promise<void>, packet = backup()) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://draft-removal.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-removal.test/");
    const library = evidenceDraftFixture().workspace; library.entries[0].notes = "Keep saved library notes";
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY, raw: serializeLiteratureWorkspace(library) });
    const original = await page.evaluate(() => Object.entries(localStorage).sort());
    await page.addScriptTag({ content: bundle });
    await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "private-evidence-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(packet)) });
    await page.getByRole("button", { name: restore.restore, exact: true }).click();
    await page.getByText(restore.restored, { exact: true }).waitFor();
    await run(page, packet);
    expect(await page.evaluate(() => Object.entries(localStorage).sort())).toEqual(original);
    expect(errors).toEqual([]); expect(requests.every(url => url === "https://draft-removal.test/")).toBe(true);
  } finally { await context.close(); }
}
async function unfinished(page: Page) {
  const theme = themes(page).nth(1);
  await theme.getByRole("button", { name: copy.statement.add, exact: true }).click();
  await theme.getByLabel(copy.statement.kind).nth(1).selectOption("gap");
  await theme.getByLabel(copy.statement.text).nth(1).fill(" \n\t ");
  await page.getByLabel(copy.import.label).fill("UNIMPORTED private report draft");
  await page.getByLabel(copy.claim.reviewer).fill("Current reviewer draft");
}
async function assertUnfinished(page: Page, themeIndex: number) {
  expect(await themes(page).nth(themeIndex).getByLabel(copy.statement.text).nth(1).inputValue()).toBe(" \n\t ");
  expect(await themes(page).nth(themeIndex).getByLabel(copy.statement.kind).nth(1).inputValue()).toBe("gap");
  expect(await page.getByLabel(copy.import.label).inputValue()).toBe("UNIMPORTED private report draft");
  expect(await page.getByLabel(copy.claim.reviewer).inputValue()).toBe("Current reviewer draft");
}

it.each([320, 1440])("confirms one claim removal while keeping passage, other assessment and unfinished editors at %ipx", width => fixture(width, async (page, packet) => {
  await unfinished(page);
  const before = await saved(page);
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, false);
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await page.getByText(editing.claimRemoved, { exact: true }).waitFor();
  expect(await claims(page).count()).toBe(1);
  const result = await saved(page);
  expect(result).toEqual({ ...before, claims: before.claims.slice(1) });
  expect(result.claims[0].assessment).toEqual(packet.claims[1].assessment);
  expect(await page.getByLabel(copy.claim.passage).inputValue()).toBe(packet.passage);
  expect(buildEvidenceDraft(result).references).toHaveLength(2);
  await assertUnfinished(page, 1);
  expect(await download(page, copy.download.markdown)).toBe(exportEvidenceDraft(result).markdown);
}));

it.each([320, 1440])("removes one theme's reference scope, preserving other statements, assessments and source reports at %ipx", width => fixture(width, async (page, packet) => {
  await unfinished(page);
  await themes(page).nth(1).getByLabel(copy.theme.notes).fill("Keep my latest theme note");
  const before = await saved(page);
  await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, false);
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
  await page.getByText(editing.themeRemoved, { exact: true }).waitFor();
  const result = await saved(page);
  expect(result).toEqual({ ...before, themes: before.themes.slice(1) });
  expect(result.claims).toEqual(packet.claims); expect(result.reports).toEqual(packet.reports);
  expect(await themes(page).first().getByLabel(copy.theme.notes).inputValue()).toBe("Keep my latest theme note");
  await assertUnfinished(page, 0);
  const draft = buildEvidenceDraft(result), expected = exportEvidenceDraft(result);
  expect(draft.references.map(row => row.paper.url)).toEqual([packet.workspace.entries[1].paper.url]);
  for (const format of ["markdown", "latex", "bibtex", "ris"] as const)
    expect(await download(page, copy.download[format])).toBe(expected[format]);
  expect(expected.bibtex).not.toContain(packet.workspace.entries[0].paper.url);
  expect(expected.ris).not.toContain(packet.workspace.entries[0].paper.url);
}));

it("allows empty collections without inventing references and can add fresh rows afterwards", () => fixture(1024, async (page, packet) => {
  for (let index = 0; index < 2; index++) {
    await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
    await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
  }
  const empty = await saved(page);
  expect(empty).toEqual({ ...packet, claims: [], themes: [] });
  expect(buildEvidenceDraft(empty).references).toEqual([]);
  expect(await download(page, copy.download.ris)).not.toContain("TY  - ");
  await page.getByLabel(copy.claim.passage).evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, element.value.length); });
  await page.getByRole("button", { name: copy.claim.add, exact: true }).click();
  await page.getByRole("button", { name: copy.theme.add, exact: true }).click();
  const fresh = await saved(page);
  expect(fresh.claims).toHaveLength(1); expect(fresh.themes).toHaveLength(1);
  expect(fresh.passage).toBe(packet.passage); expect(fresh.reports).toEqual(packet.reports);
}));

it.each([320, 1440])("undoes claim and theme removals with original assessments and unfinished edits at %ipx", width => fixture(width, async (page, packet) => {
  await unfinished(page);
  await themes(page).nth(1).getByLabel(copy.theme.notes).fill("Keep latest private note");
  const before = await saved(page);
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  const undo = page.getByRole("button", { name: editing.undoRemoval, exact: true });
  expect(await undo.evaluate(button => button === document.activeElement)).toBe(true);
  expect(await claims(page).first().evaluate(article => article.previousElementSibling?.tagName)).toBe("ASIDE");
  await page.keyboard.press("Enter");
  await page.getByText(editing.removalRestored, { exact: true }).waitFor();
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  expect((await saved(page)).claims[0].assessment).toEqual(packet.claims[0].assessment);
  expect(await undo.count()).toBe(0);
  await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
  await undo.click();
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  expect(await themes(page).nth(1).getByLabel(copy.theme.notes).inputValue()).toBe("Keep latest private note");
}));

it("recovers only the newest removal and invalidates it when other work is edited", () => fixture(1024, async (page, packet) => {
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
  await page.getByRole("button", { name: editing.undoRemoval, exact: true }).click();
  expect(await saved(page)).toEqual({ ...packet, claims: packet.claims.slice(1) });
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await themes(page).first().getByLabel(copy.theme.notes).fill("New work after removal");
  expect(await page.getByRole("button", { name: editing.undoRemoval, exact: true }).count()).toBe(0);
  expect((await saved(page)).claims).toEqual([]);
  expect(await themes(page).first().getByLabel(copy.theme.notes).inputValue()).toBe("New work after removal");
}));

it("keeps the draft when a removal recovery snapshot cannot be prepared", () => fixture(1024, async (page, packet) => {
  await page.evaluate(() => { window.structuredClone = () => { throw new Error("Synthetic snapshot refusal"); }; });
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await page.getByText(editing.removalRefused, { exact: true }).waitFor();
  expect(await saved(page)).toEqual(packet);
  expect(await page.getByRole("button", { name: editing.undoRemoval, exact: true }).count()).toBe(0);
}));

it("invalidates a pending original file preview across removal undo and retires recovery after explicit restore", () => fixture(1024, async (page, packet) => {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await original.call(this);
      if (this.name === "pending-original.json") await new Promise<void>(resolve => {
        (window as unknown as { releaseOriginalPreview: () => void }).releaseOriginalPreview = resolve;
      });
      return bytes;
    };
  });
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "pending-original.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(packet)) });
  await page.waitForFunction(() => typeof (window as unknown as { releaseOriginalPreview?: unknown }).releaseOriginalPreview === "function");
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await page.getByRole("button", { name: editing.undoRemoval, exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseOriginalPreview: () => void }).releaseOriginalPreview());
  expect(await page.getByRole("button", { name: restore.restore, exact: true }).count()).toBe(0);
  expect(await saved(page)).toEqual(packet);
  await remove(page, themes(page).first().getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
  const next = structuredClone(packet); next.workspace.title = "Deliberately restored next work";
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "next.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) });
  await page.getByRole("button", { name: restore.restore, exact: true }).click();
  expect(await page.getByRole("button", { name: editing.undoRemoval, exact: true }).count()).toBe(0);
  expect(await saved(page)).toEqual(next);
}));

it("undoes clear to the state after a previous removal, without reviving older recovery", () => fixture(1024, async (page, packet) => {
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.getByRole("button", { name: editing.undoClear, exact: true }).click();
  expect(await saved(page)).toEqual({ ...packet, claims: packet.claims.slice(1) });
  expect(await page.getByRole("button", { name: editing.undoRemoval, exact: true }).count()).toBe(0);
}));

it("restores the exact retained baseline and unload warning when undoing a removal", () => fixture(1024, async page => {
  const warns = () => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  await expect.poll(warns).toBe(false);
  await remove(page, claims(page).first().getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
  await expect.poll(warns).toBe(true);
  await page.getByRole("button", { name: editing.undoRemoval, exact: true }).click();
  await expect.poll(warns).toBe(false);
}));

it("frees a slot at both editor limits and preserves unique IDs when adding again", () => {
  const packet = backup();
  packet.claims = Array.from({ length: 32 }, (_, index) => ({ ...packet.claims[index % 2], id: `claim${index + 1}` }));
  packet.themes = Array.from({ length: 16 }, (_, index) => ({ ...packet.themes[index % 2], id: `theme${index + 1}`,
    statements: [{ ...packet.themes[index % 2].statements![0], id: `statement${index + 1}` }] }));
  buildEvidenceDraft(packet);
  return fixture(1024, async page => {
    expect(await page.getByRole("button", { name: copy.claim.add, exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: copy.theme.add, exact: true }).isDisabled()).toBe(true);
    await remove(page, claims(page).nth(4).getByRole("button", { name: editing.removeClaim, exact: true }), editing.confirmClaim, true);
    await remove(page, themes(page).nth(5).getByRole("button", { name: editing.removeTheme, exact: true }), editing.confirmTheme, true);
    await page.getByLabel(copy.claim.passage).evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, element.value.length); });
    await page.getByRole("button", { name: copy.claim.add, exact: true }).click();
    await page.getByRole("button", { name: copy.theme.add, exact: true }).click();
    const result = await saved(page);
    expect(result.claims.slice(0, 31)).toEqual(packet.claims.filter(row => row.id !== "claim5"));
    expect(result.themes.slice(0, 15)).toEqual(packet.themes.filter(row => row.id !== "theme6"));
    expect(new Set(result.claims.map(row => row.id)).size).toBe(32);
    expect(new Set(result.themes.map(row => row.id)).size).toBe(16);
  }, packet);
});

it.each([320, 1440])("cancels whole-draft clear or undoes it with exact exports and unfinished inputs at %ipx", width => fixture(width, async page => {
  await unfinished(page);
  await themes(page).nth(1).getByLabel(copy.theme.notes).fill("Latest unsaved author note 🧪");
  const before = await saved(page), expected = exportEvidenceDraft(before);
  const clear = page.getByRole("button", { name: copy.workspace.clear, exact: true });
  await remove(page, clear, editing.confirmClear, false);
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(0);
  await remove(page, clear, editing.confirmClear, true);
  await page.getByText(copy.workspace.cleared, { exact: true }).waitFor();
  expect(await page.getByLabel(copy.claim.passage).inputValue()).toBe("");
  expect(await claims(page).count()).toBe(0);
  expect((await saved(page)).reports).toEqual([]);
  // A second clear can cancel a new pending selector without replacing the
  // only useful recovery with an empty editor.
  await remove(page, clear, editing.confirmClear, true);
  await page.getByRole("button", { name: editing.undoClear, exact: true }).click();
  await page.getByText(editing.clearRestored, { exact: true }).waitFor();
  expect(await page.getByLabel(copy.claim.passage).evaluate(element => element === document.activeElement)).toBe(true);
  await assertUnfinished(page, 1); expect(await saved(page)).toEqual(before);
  for (const format of ["markdown", "latex", "bibtex", "ris"] as const)
    expect(await download(page, copy.download[format])).toBe(expected[format]);
}));

it.each(["passage", "report", "reviewer", "note"] as const)("ends clear recovery when new %s work starts", kind => fixture(1024, async page => {
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(1);
  const label = { passage: copy.claim.passage, report: copy.import.label, reviewer: copy.claim.reviewer, note: copy.theme.notes }[kind];
  await page.getByLabel(label).fill("New work must not be replaced");
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(0);
  expect(await page.getByLabel(label).inputValue()).toBe("New work must not be replaced");
}));

it("keeps the original draft when a recovery copy cannot be prepared", () => fixture(1024, async page => {
  await unfinished(page); const before = await saved(page);
  await page.evaluate(() => { window.structuredClone = () => { throw new Error("Synthetic clone refusal"); }; });
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.getByText(editing.clearRefused, { exact: true }).waitFor();
  expect(await saved(page)).toEqual(before); await assertUnfinished(page, 1);
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(0);
}));

it("invalidates an old file preview across clear/undo and retires recovery after a new explicit restore", () => fixture(1024, async (page, packet) => {
  const next = structuredClone(packet); next.workspace.title = "New explicit restored workspace";
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "different-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) });
  expect(await page.getByRole("button", { name: restore.restore, exact: true }).isDisabled()).toBe(false);
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.getByRole("button", { name: editing.undoClear, exact: true }).click();
  expect(await page.getByRole("button", { name: restore.restore, exact: true }).isDisabled()).toBe(true);
  expect(await saved(page)).toEqual(packet);
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "different-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) });
  await page.getByRole("button", { name: restore.restore, exact: true }).click();
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(0);
  expect(await saved(page)).toEqual(next);
}));

it("recovers unfinished edits even when the draft cannot currently be downloaded", () => fixture(1024, async page => {
  await themes(page).first().getByLabel(copy.theme.title).fill("");
  await themes(page).first().getByLabel(copy.theme.notes).fill("Keep this temporarily invalid draft 🧪");
  expect(await page.getByRole("button", { name: copy.download.backup, exact: true }).isDisabled()).toBe(true);
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.getByRole("button", { name: editing.undoClear, exact: true }).click();
  expect(await themes(page).first().getByLabel(copy.theme.title).inputValue()).toBe("");
  expect(await themes(page).first().getByLabel(copy.theme.notes).inputValue()).toBe("Keep this temporarily invalid draft 🧪");
  expect(await page.getByRole("button", { name: copy.download.backup, exact: true }).isDisabled()).toBe(true);
}));

it("does not persist clear recovery when reopening the editor", () => fixture(1024, async page => {
  await remove(page, page.getByRole("button", { name: copy.workspace.clear, exact: true }), editing.confirmClear, true);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.getByLabel(copy.claim.passage).waitFor();
  expect(await page.getByRole("button", { name: editing.undoClear, exact: true }).count()).toBe(0);
  expect(await page.getByLabel(copy.claim.passage).inputValue()).toBe("");
  expect(await claims(page).count()).toBe(0);
}));
