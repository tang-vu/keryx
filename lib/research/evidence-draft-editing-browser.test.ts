import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftCopy as copy } from "./evidence-draft-copy";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";
import { LITERATURE_STORAGE_KEY, serializeLiteratureWorkspace } from "../papers/literature-workspace";

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

const backup = () => {
  const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
  packet.claims[0].excerptIds = [excerpt.id]; packet.themes[0].excerptIds = [excerpt.id];
  packet.claims[0].assessment = { origin: "user-assessment", reviewer: "Fixture reviewer", reviewedAt: "2026-10-20T00:00:00Z",
    verdict: "supported", claimText: packet.passage, paperUrls: packet.claims[0].paperUrls, excerptIds: [excerpt.id], excerpts: [excerpt] };
  return packet;
};
const themes = (page: Page) => page.getByRole("region", { name: copy.theme.label, exact: true }).locator("article");
const claims = (page: Page) => page.getByRole("region", { name: copy.claim.label, exact: true }).locator("article");
const saveButton = (page: Page) => page.getByRole("button", { name: copy.download.backup, exact: true });
async function reopen(page: Page, packet: EvidenceDraftRequest) {
  await page.getByLabel(restore.file, { exact: true }).setInputFiles({ name: "private-evidence-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(packet)) });
  await page.getByRole("button", { name: restore.restore, exact: true }).click();
  await page.getByText(restore.restored, { exact: true }).waitFor();
}
async function download(page: Page, label: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label, exact: true }).click()]);
  return readFile((await file.path())!, "utf8");
}
async function fixture(width: number, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://draft-editing.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}input,textarea,select,button{max-width:100%}article,section,a{overflow-wrap:anywhere}</style><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-editing.test/");
    const library = evidenceDraftFixture().workspace;
    library.entries[0].screening = "exclude"; library.entries[0].notes = "Keep saved library notes";
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY, raw: serializeLiteratureWorkspace(library) });
    const original = await page.evaluate(() => Object.entries(localStorage).sort());
    await page.addScriptTag({ content: bundle }); await page.getByLabel(copy.claim.passage).waitFor();
    await run(page);
    expect(await page.evaluate(() => Object.entries(localStorage).sort())).toEqual(original);
    expect(errors).toEqual([]); expect(requests.every(url => url === "https://draft-editing.test/")).toBe(true);
  } finally { await context.close(); }
}
async function addClaim(page: Page) {
  await page.getByLabel(copy.claim.passage).evaluate((element: HTMLTextAreaElement) => {
    element.focus(); element.setSelectionRange(0, element.value.length);
  });
  await page.getByRole("button", { name: copy.claim.add, exact: true }).click();
}

it.each([320, 1440])("continues restored sparse claim IDs without invalidating original assessments at %ipx", width => fixture(width, async page => {
  const packet = backup();
  packet.claims = ["claim3", "claim4"].map(id => ({ ...packet.claims[0], id }));
  buildEvidenceDraft(packet); await reopen(page, packet);
  await addClaim(page);
  expect(await saveButton(page).isDisabled()).toBe(false);
  expect(await claims(page).count()).toBe(3);
  expect(await page.getByText("Your assessment: supported", { exact: true }).count()).toBe(2);
  const saved: EvidenceDraftRequest = JSON.parse(await download(page, copy.download.backup));
  expect(saved.claims.slice(0, 2)).toEqual(packet.claims);
  expect(saved.claims[2]).toMatchObject({ start: 0, end: packet.passage.length, paperUrls: packet.claims[0].paperUrls, excerptIds: [] });
  expect(saved.claims[2]).not.toHaveProperty("assessment");
  expect(new Set(saved.claims.map(row => row.id)).size).toBe(3);
  expect(saved.themes).toEqual(packet.themes);
  expect(await download(page, copy.download.markdown)).toBe(exportEvidenceDraft(saved).markdown);
  await reopen(page, saved); await addClaim(page);
  const continued: EvidenceDraftRequest = JSON.parse(await download(page, copy.download.backup));
  expect(continued.claims.slice(0, 3)).toEqual(saved.claims);
  expect(new Set(continued.claims.map(row => row.id)).size).toBe(4);
  expect(continued.reports).toEqual(packet.reports);
}));

it.each([320, 1440])("adds an independent theme after restoring sparse IDs and exports matching references at %ipx", width => fixture(width, async page => {
  const packet = backup();
  packet.themes = ["theme3", "theme4"].map(id => ({ ...packet.themes[0], id, title: `Restored ${id}`, authorNote: `Keep ${id} notes` }));
  buildEvidenceDraft(packet); await reopen(page, packet);
  await page.getByRole("button", { name: copy.theme.add, exact: true }).click();
  expect(await saveButton(page).isDisabled()).toBe(false);
  expect(await themes(page).count()).toBe(3);
  await themes(page).nth(2).getByLabel(copy.theme.notes).fill("New theme only");
  expect(await themes(page).nth(0).getByLabel(copy.theme.notes).inputValue()).toBe("Keep theme3 notes");
  expect(await themes(page).nth(1).getByLabel(copy.theme.notes).inputValue()).toBe("Keep theme4 notes");
  const saved: EvidenceDraftRequest = JSON.parse(await download(page, copy.download.backup));
  expect(saved.themes.slice(0, 2)).toEqual(packet.themes);
  expect(saved.themes[2].authorNote).toBe("New theme only");
  expect(new Set(saved.themes.map(row => row.id)).size).toBe(3);
  expect(saved.claims).toEqual(packet.claims);
  const expected = exportEvidenceDraft(saved);
  for (const format of ["markdown", "latex", "bibtex", "ris"] as const)
    expect(await download(page, copy.download[format])).toBe(expected[format]);
  expect(buildEvidenceDraft(saved).references).toHaveLength(1);
  await reopen(page, saved); await page.getByRole("button", { name: copy.theme.add, exact: true }).click();
  const continued: EvidenceDraftRequest = JSON.parse(await download(page, copy.download.backup));
  expect(continued.themes.slice(0, 3)).toEqual(saved.themes);
  expect(new Set(continued.themes.map(row => row.id)).size).toBe(4);
}));

it("keeps statement IDs unique across themes, unfinished rows and deletion before another addition", () => fixture(1024, async page => {
  const packet = backup();
  packet.themes = ["theme_custom", "theme99"].map((id, index) => ({ ...packet.themes[0], id,
    statements: [{ id: `statement${index + 3}`, kind: "gap" as const, text: `Restored author gap ${index + 1}`, paperUrls: [], excerptIds: [] }] }));
  await reopen(page, packet);
  const first = themes(page).nth(0), second = themes(page).nth(1);
  await first.getByRole("button", { name: copy.statement.add, exact: true }).click();
  await second.getByRole("button", { name: copy.statement.add, exact: true }).click();
  await first.getByRole("button", { name: copy.statement.remove, exact: true }).first().click();
  await first.getByRole("button", { name: copy.statement.add, exact: true }).click();
  for (const [theme, index, text] of [[first, 0, "First unfinished row now complete"], [first, 1, "New row after deletion"], [second, 1, "Other theme's row now complete"]] as const) {
    await theme.getByLabel(copy.statement.kind).nth(index).selectOption("gap");
    await theme.getByLabel(copy.statement.text).nth(index).fill(text);
  }
  const saved: EvidenceDraftRequest = JSON.parse(await download(page, copy.download.backup));
  const ids = saved.themes.flatMap(theme => (theme.statements ?? []).map(row => row.id));
  expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4);
  expect(saved.themes[1].statements![0]).toEqual(packet.themes[1].statements![0]);
  expect(saved.themes.map(theme => theme.id)).toEqual(packet.themes.map(theme => theme.id));
  expect(saved.claims).toEqual(packet.claims);
  expect(buildEvidenceDraft(saved).themes.flatMap(theme => theme.statements)).toHaveLength(4);
}));
