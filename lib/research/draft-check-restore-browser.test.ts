import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { draftCheckCopy as copy } from "./draft-check-copy";
import { draftCheckFixture } from "./fixtures/draft-check";
import { MAX_DRAFT_CHECK_BYTES, type DraftCheckRequest } from "./draft-check";
import { DRAFT_CHECK_STORAGE_KEY } from "./draft-check-retention";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DraftCheckWorkspace}from'./components/keryx/draft-check-workspace';
    let root;window.mountCheck=()=>{root=createRoot(document.getElementById('root'));root.render(<DraftCheckWorkspace/>)};
    window.unmountCheck=()=>root.unmount();window.mountCheck();
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type PendingRead = { resolve: () => void; reject: () => void };
type Controls = { reads: Record<string, PendingRead>; releaseLock: () => void; lockHeld: boolean;
  unmountCheck: () => void; mountCheck: () => void };
const packet = (passage: string): DraftCheckRequest => ({ ...draftCheckFixture(), passage });
const choose = (page: Page, content: string | Buffer, name = "input.json") => page.getByLabel(copy.retention.importInput).setInputFiles({
  name, mimeType: "application/json", buffer: typeof content === "string" ? Buffer.from(content) : content,
});
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
}
async function heldRead(page: Page, name: string, passage: string) {
  await choose(page, JSON.stringify(packet(passage)), name);
  await page.waitForFunction(key => !!(window as unknown as Controls).reads[key], name);
}
async function finishRead(page: Page, name: string, fail = false) {
  await page.evaluate(({ name, fail }) => {
    const read = (window as unknown as Controls).reads[name];
    if (fail) read.reject(); else read.resolve();
  }, { name, fail });
  await settle(page);
}
async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ acceptDownloads: true });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://draft-check-races.test/"
        ? route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-check-races.test/");
    await page.evaluate(() => {
      const controls = window as unknown as Controls;
      controls.reads = {};
      const native = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (!this.name.startsWith("slow-")) return native.call(this);
        const name = this.name;
        return native.call(this).then(bytes => new Promise<ArrayBuffer>((resolve, reject) => {
          controls.reads[name] = { resolve: () => resolve(bytes), reject: () => reject(new Error("Fixture read failed")) };
        }));
      };
    });
    await page.addScriptTag({ content: bundle });
    await page.getByLabel(copy.passage.label).waitFor();
    await run(page);
    expect(errors).toEqual([]);
    expect(requests.every(url => url === "https://draft-check-races.test/")).toBe(true);
  } finally { await context.close(); }
}

it("keeps the latest file selection even when earlier bytes finish first", () => fixture(async page => {
  const passage = page.getByLabel(copy.passage.label);
  await passage.fill("Keep current draft.");
  await heldRead(page, "slow-old.json", "Old selected file [1].");
  await heldRead(page, "slow-new.json", "Newest selected file [1].");
  await finishRead(page, "slow-old.json");
  expect(await passage.inputValue()).toBe("Keep current draft.");
  await finishRead(page, "slow-new.json");
  expect(await passage.inputValue()).toBe("Newest selected file [1].");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy.retention.downloadInput, exact: true }).click()]);
  expect(JSON.parse(await readFile((await download.path())!, "utf8")).passage).toBe("Newest selected file [1].");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
}));

it("does not let a stale read failure replace a newer successful status", () => fixture(async page => {
  await heldRead(page, "slow-failing.json", "Old file [1].");
  await choose(page, JSON.stringify(packet("Latest valid file [1].")));
  await page.getByText(copy.retention.restored, { exact: true }).waitFor();
  await finishRead(page, "slow-failing.json", true);
  expect(await page.getByLabel(copy.passage.label).inputValue()).toBe("Latest valid file [1].");
  expect(await page.getByRole("status").textContent()).toBe(copy.retention.restored);
}));

it.each(["edit", "clear", "check", "empty selection", "picker cancel", "invalid new selection"])("invalidates a pending file after %s", action => fixture(async page => {
  const passage = page.getByLabel(copy.passage.label);
  await passage.fill("Current draft.");
  await page.getByLabel(copy.references.label, { exact: true }).fill(draftCheckFixture().references.text);
  await heldRead(page, "slow-pending.json", "Delayed file [1].");
  if (action === "edit") await passage.fill("Latest manual edits.");
  if (action === "clear") await page.getByRole("button", { name: copy.workspace.clear, exact: true }).click();
  if (action === "check") await page.getByRole("button", { name: copy.workspace.check, exact: true }).click();
  if (action === "empty selection") await page.getByLabel(copy.retention.importInput).setInputFiles([]);
  if (action === "picker cancel") await page.getByLabel(copy.retention.importInput).dispatchEvent("cancel");
  if (action === "invalid new selection") {
    await choose(page, "{broken"); await page.getByText(copy.workspace.refused, { exact: true }).waitFor();
  }
  const expected = await passage.inputValue(), status = await page.getByRole("status").textContent();
  await finishRead(page, "slow-pending.json");
  expect(await passage.inputValue()).toBe(expected);
  expect(await page.getByRole("status").textContent()).toBe(status);
}));

async function queueDeviceRestore(page: Page) {
  const savedAt = Date.now();
  const raw = JSON.stringify({ version: 1, savedAt, expiresAt: savedAt + 3600_000,
    request: packet("Saved device draft [1].") });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: DRAFT_CHECK_STORAGE_KEY, raw });
  const blocker = await page.context().newPage();
  await blocker.goto("https://draft-check-races.test/");
  await blocker.evaluate(key => {
    const controls = window as unknown as Controls;
    void navigator.locks.request(key, { mode: "exclusive" }, () => {
      controls.lockHeld = true;
      return new Promise<void>(resolve => { controls.releaseLock = resolve; });
    });
  }, DRAFT_CHECK_STORAGE_KEY);
  await blocker.waitForFunction(() => (window as unknown as Controls).lockHeld);
  await page.getByRole("button", { name: copy.retention.restore, exact: true }).click();
  await page.waitForFunction(async key => (await navigator.locks.query()).pending?.some(lock => lock.name === key), DRAFT_CHECK_STORAGE_KEY);
  return { raw, async release() {
    await blocker.evaluate(() => (window as unknown as Controls).releaseLock());
    await page.waitForFunction(async key => !(await navigator.locks.query()).pending?.some(lock => lock.name === key), DRAFT_CHECK_STORAGE_KEY);
    await settle(page); await blocker.close();
  } };
}

it.each(["edits", "new file"])("does not replace %s with a device restore delayed by a real Web Lock", action => fixture(async page => {
  const pending = await queueDeviceRestore(page), passage = page.getByLabel(copy.passage.label);
  if (action === "edits") await passage.fill("Latest edits while storage is locked.");
  else { await choose(page, JSON.stringify(packet("Latest imported file [1]."))); await page.getByText(copy.retention.restored, { exact: true }).waitFor(); }
  const expected = await passage.inputValue(), status = await page.getByRole("status").textContent();
  await pending.release();
  expect(await passage.inputValue()).toBe(expected);
  expect(await page.getByRole("status").textContent()).toBe(status);
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_CHECK_STORAGE_KEY)).toBe(pending.raw);
}));

it("restores a current device save after a lock wait and discards an older file read", () => fixture(async page => {
  await heldRead(page, "slow-before-device.json", "Older file [1].");
  const pending = await queueDeviceRestore(page);
  await pending.release();
  await page.getByText(copy.retention.restored, { exact: true }).waitFor();
  await finishRead(page, "slow-before-device.json");
  expect(await page.getByLabel(copy.passage.label).inputValue()).toBe("Saved device draft [1].");
  expect(await page.getByRole("region", { name: copy.results.label }).count()).toBe(1);
}));

it("keeps a newer file status when an old queued device restore rejects", () => fixture(async page => {
  await page.evaluate(() => {
    const controls = window as unknown as Controls;
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => new Promise<void>((_, reject) => {
      controls.releaseLock = () => reject(new Error("Fixture lock refused"));
    }) } });
  });
  await page.getByRole("button", { name: copy.retention.restore, exact: true }).click();
  await choose(page, JSON.stringify(packet("New file after lock refusal [1].")));
  await page.getByText(copy.retention.restored, { exact: true }).waitFor();
  await page.evaluate(() => (window as unknown as Controls).releaseLock()); await settle(page);
  expect(await page.getByRole("status").textContent()).toBe(copy.retention.restored);
}));

it("preserves edits on malformed UTF-8, oversized or invalid input files", () => fixture(async page => {
  const passage = page.getByLabel(copy.passage.label);
  await passage.fill("Keep these edits.");
  for (const bad of [Buffer.from([0xff]), Buffer.alloc(MAX_DRAFT_CHECK_BYTES + 1), "{broken", JSON.stringify({ version: 99 })]) {
    await choose(page, bad);
    await page.getByText(copy.workspace.refused, { exact: true }).waitFor();
    expect(await passage.inputValue()).toBe("Keep these edits.");
  }
}));

it("discards reads from an unmounted editor", () => fixture(async page => {
  await heldRead(page, "slow-unmounted.json", "Old unmounted editor [1].");
  await page.evaluate(() => { const controls = window as unknown as Controls; controls.unmountCheck(); controls.mountCheck(); });
  await page.getByLabel(copy.passage.label).waitFor();
  await finishRead(page, "slow-unmounted.json");
  expect(await page.getByLabel(copy.passage.label).inputValue()).toBe("");
  expect(await page.getByRole("status").textContent()).toBe("");
}));
