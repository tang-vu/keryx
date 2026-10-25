/** Real WebCrypto, local file reads, downloads and asynchronous races. No research. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, mkdtemp, symlink, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type BrowserContext } from "playwright";
import { createHash } from "node:crypto";
import { canonicalJson } from "../lib/canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types";
import { reportComparisonCopy as copy } from "../locales/en/report-comparison";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { parsePublicMaintenanceStatus, STATUS_PATH } from "../lib/maintenance/public-status";

const dist = path.resolve(process.env.NEXT_DIST_DIR ?? ".next");
const cssDir = [path.join(dist, "static/chunks"), path.join(dist, "dev/static/chunks")]
  .find(dir => existsSync(dir) && readdirSync(dir).some(name => name.endsWith(".css")));
assert(cssDir, "Build the current Tailwind stylesheet before the styled comparison test");
const css = readdirSync(cssDir).filter(name => name.endsWith(".css")).map(name => readFileSync(path.join(cssDir, name), "utf8")).join("\n");
assert(css.includes(".bg-paper") && css.includes(".text-ink"), "Missing actual current product stylesheet");
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ReportComparisonWorkspace} from './components/keryx/report-comparison-workspace';
createRoot(document.getElementById('root')).render(<ReportComparisonWorkspace/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, minify: true,
  define: { "process.env.NODE_ENV": '"production"' }, metafile: true,
  plugins: [{ name: "comparison-alias", setup(api) { api.onResolve({ filter: /^@\// }, args => {
    const target = path.resolve(args.path.replace(/^@\//, ""));
    return { path: existsSync(target + ".ts") ? target + ".ts" : target + ".tsx" };
  }); } }],
});
assert(!Object.keys(bundle.metafile!.inputs).some(file => /(?:lib\/db|lib\/payments|mcp\/|node:)/u.test(file.replaceAll("\\", "/"))), "Local file UI must not include server, payment or database code");
const server = createServer((request, response) => {
  if (request.url === "/comparison.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  response.setHeader("content-type", "text/html");
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-paper-2 text-ink"><main id="root"></main><script src="/comparison.js"></script></body></html>`);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const output = process.env.KERYX_COMPARISON_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
function receipt(version: string, target = "How long is the buffer valid?", legacy = false) {
  const quote = version === "v1" ? "The buffer is valid until the next call." : 'The buffer is valid for two calls. <img src=x onerror="alert(1)">';
  const identity = { marker: "S1", sourceId: "original:documentation", sourceName: "Original documentation",
    itemId: "api", itemTitle: "Buffer lifetime", itemUrl: "javascript:alert(1)", contentVersion: version };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { id: version, question: "Read the original", answer: quote + " [S1]" },
    ...(legacy ? {} : { citations: [identity], claims: [{ claimIndex: 0, claim: target,
      evidence: [{ ...identity, quote, qualifiesForAnswer: true, qualifiesForReward: false,
        webProvenance: { extraction: "pdf", truncated: true, pdfTextScope: { format: "keryx-pdf-text-scope-v1", pagesRead: 3, totalPages: 10, pagesWithoutText: [2], textLimitReached: false } } }] }] }) };
  return JSON.stringify({ payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
}
const file = (name: string, text: string) => ({ name, mimeType: "application/json", buffer: Buffer.from(text) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors: string[] = [], outbound: string[] = [], dialogs: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/*", route => {
    if (!route.request().url().startsWith(origin + "/")) { outbound.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    (window as unknown as { storageWrites: number }).storageWrites = 0;
    Storage.prototype.setItem = () => { (window as unknown as { storageWrites: number }).storageWrites++; throw new Error("No persistence permitted"); };
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: copy.title }).waitFor();
  assert(await page.getByRole("button", { name: copy.compare, exact: true }).isDisabled());
  await page.getByLabel(copy.beforeFile, { exact: true }).setInputFiles(file("before.json", receipt("v1")));
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("after.json", receipt("v2")));
  await page.getByLabel(copy.afterFile, { exact: true }).focus(); await page.keyboard.press("Tab");
  assert(await page.getByRole("button", { name: copy.compare, exact: true }).evaluate(button => button === document.activeElement));
  await page.keyboard.press("Enter");
  const result = page.getByTestId("report-comparison-result"); await result.waitFor();
  assert.equal(await result.getByText(copy.state["recorded-excerpts-changed"], { exact: true }).count(), 1);
  assert.equal(await result.locator("blockquote").last().textContent(), JSON.parse(receipt("v2")).payload.claims[0].evidence[0].quote);
  assert.equal(await result.locator("img,script,a[href^='javascript:']").count(), 0);
  await result.getByText(copy.identity, { exact: true }).last().click();
  assert((await result.textContent())?.includes('"pagesRead": 3'));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    if (output) await page.screenshot({ path: path.join(output, `comparison-${width}.png`), fullPage: true });
  }
  for (const format of ["json", "markdown", "csv"] as const) {
    const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: copy[format], exact: true }).click();
    const download = await downloaded, downloadedPath = await download.path(); assert(downloadedPath);
    const text = await readFile(downloadedPath, "utf8");
    assert.equal(download.suggestedFilename(), `keryx-report-comparison.${format === "markdown" ? "md" : format}`);
    assert(text.includes(JSON.parse(receipt("v1")).integrity.digest));
    if (format === "json") { const comparison = JSON.parse(text); assert.equal(comparison.summary.addedRows, 1); assert.equal(comparison.summary.removedRows, 1); }
  }
  // File changes invalidate results synchronously; renamed targets require an explicit choice.
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("renamed.json", receipt("v2", "A renamed target")));
  assert.equal(await result.count(), 0);
  await page.getByRole("button", { name: copy.compare, exact: true }).click(); await result.waitFor();
  assert.equal(await result.getByText(copy.match.unmatched, { exact: true }).count(), 2);
  await page.getByRole("combobox", { name: copy.matchAfter }).selectOption("0");
  assert.equal(await result.count(), 0); assert.equal(await page.getByRole("button", { name: copy.json, exact: true }).count(), 0);
  await page.getByRole("button", { name: copy.compare, exact: true }).click(); await result.waitFor();
  assert.equal(await result.getByText(copy.match["user-selected"], { exact: true }).count(), 1);
  // Pause real digests after hashing, then change input. Old completion must stay invisible.
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle), pending: Array<() => void> = [];
    const state = window as unknown as { pendingDigests: Array<() => void>; releaseDigests: () => void };
    let hold = true; state.pendingDigests = pending;
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto["digest"]>) => { const value = await original(...args); if (hold) await new Promise<void>(resolve => pending.push(resolve)); return value; };
    state.releaseDigests = () => { hold = false; for (const resolve of pending.splice(0)) resolve(); };
  });
  await page.getByRole("button", { name: copy.compare, exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { pendingDigests: unknown[] }).pendingDigests.length === 2);
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("legacy.json", receipt("v2", "Unused", true)));
  await page.evaluate(() => (window as unknown as { releaseDigests: () => void }).releaseDigests());
  await page.waitForFunction(() => !document.querySelector('[data-testid="report-comparison-result"]'));
  await page.getByRole("button", { name: copy.compare, exact: true }).click(); await result.waitFor();
  assert.equal(await result.getByText(copy.availability.unavailable, { exact: true }).count(), 1);
  // A slow old file read must not replace a newer selection of the same input.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const value = await original.call(this);
      if (this.name === "slow.json") await new Promise<void>(resolve => { (window as unknown as { releaseFile: () => void }).releaseFile = resolve; });
      return value;
    };
  });
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("slow.json", receipt("v1")));
  await page.waitForFunction(() => typeof (window as unknown as { releaseFile?: unknown }).releaseFile === "function");
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("fresh.json", receipt("v2")));
  await page.evaluate(() => (window as unknown as { releaseFile: () => void }).releaseFile());
  await page.getByRole("button", { name: copy.compare, exact: true }).click(); await result.waitFor();
  assert.equal(await result.getByText(copy.state["recorded-excerpts-changed"], { exact: true }).count(), 1);
  const corrupted = JSON.parse(receipt("v2")); corrupted.payload.dispatch.question = "Changed without rehashing";
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("corrupt.json", JSON.stringify(corrupted)));
  await page.getByRole("button", { name: copy.compare, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: copy.errors["invalid-receipt"] }).waitFor();
  assert.equal(await result.count(), 0);
  await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("large.json", "x".repeat(524_289)));
  await page.getByRole("alert").filter({ hasText: copy.errors["input-too-large"] }).waitFor();
  await page.getByRole("button", { name: copy.clear, exact: true }).click();
  assert.equal(await page.getByLabel(copy.beforeFile, { exact: true }).inputValue(), "");
  assert.equal(await result.count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { storageWrites: number }).storageWrites), 0);
  assert.deepEqual(outbound, []); assert.deepEqual(dialogs, []); assert.deepEqual(errors, []);
  console.log("PASS: local WebCrypto comparison, exact excerpts, safe downloads, explicit mapping, stale-result rejection, unknown ledgers, checksum/size failures, clear and responsive layout; outbound/storage writes 0.");
} finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

// CI also exercises the actual compiled route and its server/client boundary.
// Local focused checks may use only the styled fixture while the host build slot is held.
if (process.argv.includes("--built")) {
  const source = process.cwd(), temporary = await mkdtemp(path.join(tmpdir(), "keryx-comparison-built-"));
  assert(path.resolve(temporary).startsWith(path.resolve(tmpdir()) + path.sep));
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address(); assert(address && typeof address === "object");
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const physical = `http://127.0.0.1:${address.port}`, origin = "https://comparison-built.test";
  let child: ReturnType<typeof spawn> | undefined, exited = false, stopped: Promise<void> | undefined;
  let context: BrowserContext | undefined;
  const links: string[] = [], browser = await chromium.launch({ headless: true });
  try {
    await copyNextConfigFixture(source, temporary);
    for (const name of ["node_modules", ".next"]) {
      const link = path.join(temporary, name);
      await symlink(path.join(source, name), link, process.platform === "win32" ? "junction" : "dir"); links.push(link);
    }
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
      KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0" };
    for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
      if (process.env[name]) env[name] = process.env[name];
    child = spawn(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(address.port)],
      { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; child.stdout?.on("data", data => { log = (log + String(data)).slice(-4000); });
    child.stderr?.on("data", data => { log = (log + String(data)).slice(-4000); });
    stopped = new Promise<void>(resolve => { child!.once("exit", () => { exited = true; resolve(); }); child!.once("error", () => { exited = true; resolve(); }); });
    let ready = false;
    for (let attempt = 0; attempt < 80 && !exited; attempt++) {
      try { ready = (await fetch(`${physical}/research/compare`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
      if (ready) break; await delay(250);
    }
    assert(ready, `Compiled comparison route unavailable: ${log}`);
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const mutations: string[] = [], errors: string[] = [];
    // The standalone front door owns this endpoint, outside the bare Next app.
    // This is a synthetic control observation, never an application-health probe.
    const maintenance = { state: "normal", planned: false, admissionClosed: false, window: null,
      checkedAt: "2026-10-25T00:00:00.000Z", statusPath: STATUS_PATH, applicationStatus: "not-probed" };
    assert(parsePublicMaintenanceStatus(maintenance));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.method() !== "GET") { mutations.push(url.pathname); return route.abort(); }
      if (url.pathname === STATUS_PATH) return route.fulfill({ json: maintenance });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.fulfill({ response: await route.fetch({ url: physical + url.pathname + url.search }) });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    assert.equal((await page.goto(`${origin}/research/compare`))?.status(), 200);
    await page.getByRole("heading", { name: copy.title }).waitFor();
    await page.getByLabel(copy.beforeFile, { exact: true }).setInputFiles(file("before.json", receipt("v1")));
    await page.getByLabel(copy.afterFile, { exact: true }).setInputFiles(file("after.json", receipt("v2")));
    await page.getByRole("button", { name: copy.compare, exact: true }).click();
    await page.getByTestId("report-comparison-result").waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.title(), copy.metadataTitle);
    assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
  } finally {
    try {
      if (context) {
        // Stop page producers without changing routing policy mid-flight. Keep
        // the request context alive until every existing local proxy finishes.
        for (const page of context.pages()) await page.close();
        await context.unrouteAll({ behavior: "wait" });
      }
    }
    finally {
      try { await browser.close(); }
      finally {
        if (child && !exited) { child.kill(); await stopped; }
        assert(!child || exited, "Observe owned Next server exit before fixture cleanup");
        for (const link of links) await unlink(link);
        const target = path.resolve(temporary); assert(target.startsWith(path.resolve(tmpdir()) + path.sep));
        await rm(target, { recursive: true, force: true });
      }
    }
  }
  console.log("PASS: actual compiled /research/compare route, shell, WebCrypto, imported files and drained proxy teardown; isolated offline store, GET only.");
}
