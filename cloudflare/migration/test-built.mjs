/** Actual workerd + browser compatibility. No production request, credential or database. */
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("playwright");
const temporary = process.env.KERYX_CLOUDFLARE_TEST_DIR;
assert(temporary, "Set an isolated test directory under canonical .local before running");
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const canonical = resolve(common, "../.local");
const normalized = resolve(temporary).toLowerCase();
assert(["\\", "/"].some(separator => normalized.startsWith(canonical.toLowerCase() + separator)), "Test output must stay under canonical local data");
await mkdir(temporary, { recursive: true });
const build = fileURLToPath(new URL(".cloudflare/output/v0/workers/default/", import.meta.url));
const config = JSON.parse(await readFile(resolve(build, "worker.config.json"), "utf8"));
assert.equal(config.name, "keryx-migration-preview");
assert.deepEqual(config.assets.runWorkerFirst, ["/*"]);
assert(!config.routes && !config.triggers && !config.containers, "Compatibility preview cannot provision production routing or paid execution");
const token = "x".repeat(43), outbound = [];
const bundleRoot = resolve(build, "bundle");
const modules = [{ type: "ESModule", path: resolve(bundleRoot, "index.js") }];
for (const name of await readdir(bundleRoot, { recursive: true })) {
  if (name !== "index.js" && /\.(?:js|wasm)$/.test(name)) modules.push({
    type: name.endsWith(".wasm") ? "CompiledWasm" : "ESModule", path: resolve(bundleRoot, name),
  });
}
const runtime = new Miniflare(convertV4MiniflareOptions({
  name: config.name, compatibilityDate: config.compatibilityDate,
  compatibilityFlags: config.compatibilityFlags,
  modules, modulesRoot: bundleRoot,
  bindings: { MIGRATION_PREVIEW_TOKEN: token, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1" },
  assets: { directory: resolve(build, "assets"), binding: "ASSETS", routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
  resourcePersistencePath: resolve(temporary, "state"), host: "127.0.0.1", port: 0,
  outboundService: async request => {
    outbound.push({ method: request.method, origin: new URL(request.url).origin });
    return new Response("Isolated compatibility fixture", { status: 503 });
  },
}));
let browser, page;
const errors = [], responses = [], recent = [], consoleErrors = [];
try {
  const url = await runtime.ready;
  const call = (path, options = {}) => runtime.dispatchFetch(new URL(path, url), options);
  assert.equal((await call("/")).status, 401);
  assert.equal((await call("/_next/static/unknown.js")).status, 401, "Assets cannot bypass preview admission");
  const health = await (await call("/__migration/health")).json();
  assert.equal(health.productionReady, false); assert.equal(health.payments, "disabled");
  for (const path of ["/api/ask", "/api/ask/sign", "/mcp"]) {
    assert.equal((await call(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status, 503);
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  await context.route("**/*", route => new URL(route.request().url()).origin === url.origin
    ? route.continue() : route.abort());
  page = await context.newPage();
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500)); });
  page.on("request", request => { recent.push({ path: new URL(request.url()).pathname, kind: "request" }); if (recent.length > 60) recent.shift(); });
  page.on("requestfinished", request => { recent.push({ path: new URL(request.url()).pathname, kind: "finished" }); if (recent.length > 60) recent.shift(); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    // The independent production front door is absent in this isolated preview.
    // MaintenanceBanner explicitly treats its 404 as an inert control, not health.
    const inertControl = path === "/maintenance/status" && response.status() === 404;
    if (response.url().startsWith(url.origin) && response.status() >= 400 && !path.startsWith("/api/") && !inertControl) {
      responses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  try { await page.goto(new URL("/", url).href, { waitUntil: "domcontentloaded", timeout: 40_000 }); }
  catch (error) { console.error(JSON.stringify({ recent, errors, responses })); throw error; }
  await page.getByRole("heading", { name: /AI research/i, level: 1 }).waitFor();
  assert.match(await page.locator("body").innerText(), /Keryx/);
  assert.equal(await page.locator("header.sticky").evaluate(element => getComputedStyle(element).position), "sticky", "Production CSS must load");
  assert.equal((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper"))).trim(), "#f1e9d7", "Shared design tokens must survive the build");
  assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family.includes("Keryx Vietnamese Text"))), "Vietnamese font declarations must survive the build");
  await page.screenshot({ path: resolve(temporary, "home-desktop.png"), fullPage: true });
  await page.locator('footer a[href="/pricing"]').first().click();
  await page.waitForURL("**/pricing");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const mounted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/models");
  await page.goto(new URL("/", url).href, { waitUntil: "domcontentloaded" });
  await mounted;
  await page.getByRole("button", { name: /open menu/i }).click();
  await page.locator('#mobile-site-menu a[href="/answers"]').click();
  await page.waitForURL("**/answers");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.screenshot({ path: resolve(temporary, "answers-mobile.png"), fullPage: true });
  assert.deepEqual(errors, [], "Built client and hydration must have no browser exceptions");
  assert.deepEqual(consoleErrors.filter(message => /hydration|did not match|didn't match|Minified React error|content security policy/i.test(message)), [],
    "Hydration and the preserved CSP must remain functional");
  assert.deepEqual(responses, [], "Rendered pages and assets must be available");
  assert.deepEqual(outbound, [], "The Cloudflare preview must not depend on the VPS or external production services");
  console.log(JSON.stringify({ status: "passed", runtime: "workerd", pages: ["/", "/pricing", "/answers"], outbound: 0, payments: "disabled" }));
} catch (error) {
  console.error(JSON.stringify({ errors, responses, consoleErrors, recent }));
  await page?.screenshot({ path: resolve(temporary, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); await runtime.dispose(); }
