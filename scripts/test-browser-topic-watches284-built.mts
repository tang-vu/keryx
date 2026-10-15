/** Parent-run compiled Next UI control. Synthetic same-origin session/API responses
 * qualify actual emitted UI + canonical hooks only, never native store/HTTP ownership.
 * No build, install, envfile, provider, paid request, scheduler or shipped auth seam.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { topicWatchMessages as words } from "../locales/en/topic-watches";

let failureOutput: string | undefined;
async function main() {
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const flags = ["dist", "output", "port", "admission"] as const;
const args = process.argv.slice(2);
assert.equal(args.length, flags.length, "Parent supplies --dist=ABS --output=ABS --port=OWNED --admission=ABS");
const values = Object.fromEntries(flags.map(flag => {
  const matches = args.filter(value => value.startsWith(`--${flag}=`));
  assert.equal(matches.length, 1, `Exactly one ${flag}`);
  return [flag, matches[0].slice(flag.length + 3)];
})) as Record<typeof flags[number], string>;
const { dist, output, admission: admissionPath } = values, port = Number(values.port);
assert(isAbsolute(dist) && isAbsolute(output) && isAbsolute(admissionPath));
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
function inside(path: string, parent: string) {
  const part = relative(resolve(parent), resolve(path));
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
assert(inside(output, join(root, "output")), "Mutable runtime belongs to this worktree/output");
assert(inside(await realpath(output), join(await realpath(root), "output")), "No foreign output junction");
assert(resolve(dist) !== resolve(output) && !inside(dist, output) && !inside(output, dist));
const actualDist = await realpath(dist), actualOutput = await realpath(output);
assert(actualDist !== actualOutput && !inside(actualDist, actualOutput) && !inside(actualOutput, actualDist));
failureOutput = output; // Only a verified owned directory may retain preflight failure JSON.
for (const [name, leaf] of [["TEMP", "temp"], ["TMP", "temp"], ["TSX_CACHE_DIR", "tsx-cache"]] as const)
  assert.equal(resolve(process.env[name] ?? ""), resolve(output, leaf), `Parent binds ${name}`);
const require = createRequire(import.meta.url), sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
assert.equal(require("next/package.json").version, "16.3.8");
const pinnedPaths = ["app/me/watches/page.tsx", "components/keryx/topic-watch-manager.tsx", "components/keryx/wallet-menu.tsx",
  "locales/en/topic-watches.ts", "lib/i18n/messages.ts", "lib/hooks/use-siwe-auth.ts", "next.config.ts", "instrumentation.ts",
  "package.json", "package-lock.json", "test-support/next-config-fixture.ts", "scripts/test-browser-topic-watches284-built.mts"];
async function pinSources() { return Promise.all(pinnedPaths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) }))); }
const sourcePins = await pinSources();
type Admission = { owner: "ROOT"; buildEvidence: string; dist: string; output: string; port: number; buildId: string;
  sourcePins: { path: string; sha256: string }[]; compiledPins: { path: string; sha256: string }[] };
const admission = JSON.parse(await readFile(admissionPath, "utf8")) as Admission;
assert.equal(admission.owner, "ROOT"); assert(admission.buildEvidence?.trim(), "Actual exact-source/input build evidence required");
assert.equal(resolve(admission.dist), resolve(dist)); assert.equal(resolve(admission.output), resolve(output)); assert.equal(admission.port, port);
assert.deepEqual(admission.sourcePins, sourcePins, "Parent admits current UI/hooks/config source, including this driver");
const compiledPaths = ["BUILD_ID", "server/app-paths-manifest.json", "server/app/me/watches/page.js",
  "server/app/me/watches/page_client-reference-manifest.js", "required-server-files.json"];
const compiledPins = await Promise.all(compiledPaths.map(async path => ({ path, sha256: sha(await readFile(join(dist, path))) })));
assert.deepEqual(admission.compiledPins, compiledPins, "Parent binds actual compiled page/client references");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim(); assert(buildId && buildId.length <= 128);
assert.equal(admission.buildId, buildId);
const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8"));
assert.equal(appPaths["/me/watches/page"], "app/me/watches/page.js");
const references = await readFile(join(dist, "server/app/me/watches/page_client-reference-manifest.js"), "utf8");
assert(references.includes("topic-watch-manager"), "Actual emitted page references authored client manager");

const run = join(output, "run"), fixture = join(output, "runtime"), origin = `http://127.0.0.1:${port}`;
const wallet = `0x${"a".repeat(40)}`, list = "/api/me/topic-watches";
const session = "/api/auth/session", failures: string[] = [], externalAttempts: string[] = [], pageErrors: string[] = [];
const results: string[] = [], httpRequests: string[] = [];
let app: ReturnType<NextFactory> | undefined, browser: Browser | undefined, mainFailure: unknown;
let mainFailed = false, browserClosed = false, httpDrained = false, appClosed = false, instrumentationClosed = false, tracesFlushed = false;
const cleanupFailures: unknown[] = [], previousEnvironment = { ...process.env }, previousCwd = process.cwd();
const nativeFetch = globalThis.fetch, nativeConnect = Socket.prototype.connect;
type NextFactory = (options: { dev: false; dir: string; hostname: string; port: number; httpServer: ReturnType<typeof createServer> }) => {
  prepare(): Promise<void>; close(): Promise<void>; getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server: { getServer(): Promise<{ prepare(): Promise<void> }> };
};
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.host, new URL(origin).host); assert(httpRequests.length < 2048);
    const url = new URL(req.url!, origin); httpRequests.push(`${req.method} ${url.pathname}`);
    assert.equal(req.method, "GET");
    // No API reaches compiled server handlers: all are intercepted in the browser.
    assert(!url.pathname.startsWith("/api/"), "API interception missing");
    if (req.headers["next-router-prefetch"] === "1" && url.pathname !== "/me/watches" && !url.pathname.startsWith("/_next/")) {
      res.writeHead(503, { "Cache-Control": "no-store" }); res.end(); return;
    }
    assert(url.pathname === "/me/watches" || url.pathname === "/favicon.ico" || url.pathname.startsWith("/_next/"), "Finite compiled page/assets only");
    assert(app); await app.getRequestHandler()(req, res);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    if (!res.headersSent) res.writeHead(500); res.end();
  }
});
server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;

/** Only a held synthetic mutation body/paint observer; canonical hook and fetch
 * requests still execute. Native BroadcastChannel/focus are never substituted. */
function observePage() {
  const native = window.fetch.bind(window);
  let hold = false, release: (() => void) | undefined, observer: MutationObserver | undefined;
  const state = { held: 0, released: 0, afterClear: false, paints: [] as string[], marker: "" };
  window.fetch = async (input, init) => {
    const response = await native(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!hold || url.pathname !== "/api/me/topic-watches" || init?.method !== "POST") return response;
    hold = false; const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 262144) throw Error("Synthetic body cap");
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      release = [() => { controller.enqueue(bytes); controller.close(); state.released++; release = undefined; }][0];
      state.held++;
    } }), { status: response.status, headers: response.headers });
  };
  observer = new MutationObserver(() => {
    const text = document.querySelector("main")?.textContent ?? "";
    if (state.afterClear && (text.includes(state.marker) || text.includes("created. Paid requests: 0."))) {
      if (state.paints.length >= 32) throw Error("Stale paint observation cap");
      state.paints.push(text.slice(0, 8192));
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true });
  (window as unknown as { watch284: unknown }).watch284 = { state,
    holdBody(marker: string) { if (hold || release) throw Error("Only one held body"); hold = true; state.marker = marker; },
    cleared() { state.afterClear = true; },
    release() { if (!release) throw Error("No held body"); release(); },
    close() { release?.(); observer?.disconnect(); window.fetch = native; },
  };
}
type Observation = { state: { held: number; released: number; paints: string[] }; holdBody(marker: string): void; cleared(): void; release(): void; close(): void };
type FixtureWindow = Window & typeof globalThis & { watch284: Observation };
const flush = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const region = (page: Page) => page.getByRole("region", { name: words["topicWatch.title"], exact: true });
const button = (page: Page, name: string) => region(page).getByRole("button", { name, exact: true });
const consent = (page: Page) => region(page).getByRole("checkbox", { name: words["topicWatch.consent"], exact: true });
const question = (page: Page) => region(page).getByLabel(words["topicWatch.question"], { exact: true });

// Deliberately shallow synthetic transport rows, matching the original authored UI
// journey. They are NOT parsed/qualified native domain states, store or CAS proof.
type Row = { key: { ownerWallet: string; watchId: string }; spec: Record<string, any>; revision: number;
  status: string; nextSlot: number; history: { kind: string; slot: number; status: string; newMatches: number }[] };
type Call = { method: string; path: string; body: any };
async function scenario(width: number, signedIn = true, heldSession = false) {
  assert(browser);
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const rows: Row[] = [], calls: Call[] = [];
  let releaseSession!: () => void, sessionReads = 0, markSessionRequested!: () => void;
  const sessionRequested = new Promise<void>(done => { markSessionRequested = done; });
  const sessionGate = new Promise<void>(done => { releaseSession = done; });
  if (!heldSession) releaseSession();
  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  await context.addInitScript(observePage);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { externalAttempts.push(`${request.method()} ${url.origin}`); await route.abort("blockedbyclient"); return; }
    try {
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
      if (url.pathname === session) { sessionReads++; markSessionRequested(); await sessionGate; await json({ session: signedIn ? { address: wallet, role: "asker" } : null }); return; }
      if (["/api/me/locale-preference", "/api/payments", "/maintenance/status"].includes(url.pathname)) {
        assert.equal(request.method(), "GET"); await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
      }
      if (url.pathname === list || url.pathname.startsWith(`${list}/`)) {
        assert(signedIn); assert(calls.length < 64); assert.equal(url.search, "");
        const headers = request.headers(); assert.equal(headers["x-keryx-expected-wallet"], wallet);
        const method = request.method(), body = request.postDataJSON(); calls.push({ method, path: url.pathname, body });
        if (method === "GET") { assert.equal(url.pathname, list); await json({ watches: rows }); return; }
        if (method === "POST" && url.pathname === list) {
          assert.equal(rows.length, 0); assert.equal(body.consent.manualMetadata, true);
          assert.deepEqual(body.requestedCaps, { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 });
          assert.equal(body.maximumRowsPerCheck, 32); assert.equal(body.maximumDigestItems, 16);
          rows.push({ key: { ownerWallet: wallet, watchId: body.watchId }, spec: body, revision: 1, status: "active", nextSlot: 0, history: [] });
          await json({ result: { status: "created", paidRequests: 0 } }); return;
        }
        assert.equal(rows.length, 1); const row = rows[0]; assert.equal(url.pathname, `${list}/${row.key.watchId}`);
        assert.equal(headers["if-match"], `"${row.revision}"`); row.revision++;
        if (method === "PUT") row.spec = body;
        else if (method === "DELETE") row.status = "cancelled";
        else {
          assert.equal(method, "POST"); assert(["check", "pause", "resume"].includes(body.action));
          if (body.action === "pause") row.status = "paused";
          if (body.action === "resume") row.status = "active";
          if (body.action === "check") { row.nextSlot++; row.history.push({ kind: "check", slot: 0, status: "unchanged", newMatches: 0 }); }
        }
        await json({ result: { status: body?.action === "check" ? "unchanged" : "controlled", paidRequests: 0 } }); return;
      }
      assert(!url.pathname.startsWith("/api/"), "No paid/search/model/provider API");
      assert.equal(request.method(), "GET"); await route.continue();
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); await route.abort("failed"); }
  });
  return { context, rows, calls, releaseSession, sessionRequested, sessionReads: () => sessionReads };
}
async function closeContext(context: BrowserContext) {
  const errors: unknown[] = [];
  for (const page of context.pages()) if (!page.isClosed()) {
    try { await page.evaluate(() => (window as FixtureWindow).watch284?.close()); } catch (error) { errors.push(error); }
    try { await page.close(); } catch (error) { errors.push(error); }
  }
  try { await context.close(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "Owned pages/context close failed");
}
async function open(context: BrowserContext) {
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(10000);
  const response = await page.goto(`${origin}/me/watches`); assert.equal(response?.status(), 200);
  return page;
}
async function draft(page: Page, title: string) {
  await question(page).fill(title);
  await region(page).getByLabel(words["topicWatch.keywords"], { exact: true }).fill("transformer");
}
async function broadcastCleared(page: Page, privateTitle: string) {
  // Actual foreign hints clear canonical session, unmounting the whole private editor.
  const main = page.locator("main");
  const signIn = main.getByRole("link", { name: words["topicWatch.signIn"], exact: true });
  await signIn.waitFor(); assert.equal(await signIn.getAttribute("href"), "/connect");
  assert.equal(await region(page).count(), 0); assert.equal(await main.locator("input").count(), 0);
  assert.equal(await main.getByRole("heading", { name: words["topicWatch.editTitle"], exact: true }).count(), 0);
  assert.equal(await main.getByText("created. Paid requests: 0.", { exact: true }).count(), 0);
  assert(!(await main.textContent())?.includes(privateTitle));
  assert(!(await main.textContent())?.includes("BROADCAST PRIVATE DRAFT"));
}
async function cleared(page: Page) {
  await region(page).getByRole("alert").getByText(words["topicWatch.accountChanged"], { exact: true }).waitFor();
  assert.equal(await question(page).inputValue(), ""); assert.equal(await consent(page).isChecked(), false);
  assert.equal(await region(page).getByRole("heading", { name: words["topicWatch.editTitle"], exact: true }).count(), 0);
  assert.equal(await region(page).getByText("created. Paid requests: 0.", { exact: true }).count(), 0);
  assert.equal(await button(page, words["topicWatch.create"]).isDisabled(), true);
}

try {
  await mkdir(run); await mkdir(fixture); // Exclusive runtime, never overwrite old captures.
  await cp(dist, join(fixture, ".next"), { recursive: true, dereference: true, force: false, errorOnExist: true });
  await copyNextConfigFixture(root, fixture);
  await symlink(join(root, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(join(fixture, "data"));
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", NODE_OPTIONS: "", BASE_URL: origin,
    NEXT_TELEMETRY_DISABLED: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
    KERYX_RPC_WS_URL: "", TEMP: join(output, "temp"), TMP: join(output, "temp"), TSX_CACHE_DIR: join(output, "tsx-cache") };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"])
    if (previousEnvironment[name]) environment[name] = previousEnvironment[name];
  for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, environment); process.chdir(fixture);
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, origin, "No server outbound fetch"); return nativeFetch(input, init);
  };
  // Cover non-fetch HTTP/TLS too. Only the explicit loopback listener is admitted;
  // inherited RPC/provider/DB origins and Unix/Windows pipe paths are refused.
  Socket.prototype.connect = function (this: Socket, ...args: any[]) {
    const input = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof input[0] === "object" ? input[0] : { port: input[0], host: input[1] };
    assert.equal(options.host ?? options.hostname, "127.0.0.1", "No non-loopback server socket");
    assert.equal(Number(options.port), port, "Only parent-owned loopback port");
    return Reflect.apply(nativeConnect, this, args);
  } as typeof nativeConnect;
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); });
  // Next's production prepare starts real entry preloads asynchronously. Observe
  // and await exactly that existing promise; do not disable or replace preloads.
  const prototype = require("next/dist/server/next-server").default.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "unstable_preloadEntries");
  assert(descriptor && typeof descriptor.value === "function" && descriptor.configurable);
  const preloads = new WeakMap<object, Promise<void>>();
  Object.defineProperty(prototype, "unstable_preloadEntries", { ...descriptor, value: function (this: object, ...args: unknown[]) {
    assert(!preloads.has(this)); const promise = Reflect.apply(descriptor.value, this, args) as Promise<void>; preloads.set(this, promise); return promise;
  } });
  try {
    app = (require("next") as NextFactory)({ dev: false, dir: fixture, hostname: "127.0.0.1", port, httpServer: server });
    await app.prepare(); const actual = await app.server.getServer(); await actual.prepare();
    const pending = preloads.get(actual); assert(pending, "Actual compiled entry preload observed"); await pending;
  } finally { Object.defineProperty(prototype, "unstable_preloadEntries", descriptor); }
  browser = await chromium.launch({ headless: true });
  for (const width of [360, 1366]) {
    const s = await scenario(width);
    try {
      const page = await open(s.context); await region(page).getByText(words["topicWatch.empty"], { exact: true }).waitFor();
      assert(s.calls.every(call => call.method === "GET"));
      if (width < 1024) await page.locator('header button[aria-controls="mobile-site-menu"]').click();
      await page.locator("header").getByRole("button", { name: /asker/ }).click();
      const anchor = page.getByRole("menuitem", { name: words["topicWatch.menu"], exact: true });
      assert.equal(await anchor.getAttribute("href"), "/me/watches"); await page.keyboard.press("Escape");
      await draft(page, "PRIVATE review question"); await button(page, words["topicWatch.create"]).click(); assert.equal(s.rows.length, 0);
      await consent(page).check(); await button(page, words["topicWatch.create"]).click();
      await region(page).getByRole("heading", { name: "PRIVATE review question", exact: true }).waitFor();
      await button(page, words["topicWatch.edit"]).click(); await question(page).fill("Edited private question");
      await consent(page).check(); await button(page, words["topicWatch.save"]).click();
      await region(page).getByRole("heading", { name: "Edited private question", exact: true }).waitFor();
      await button(page, words["topicWatch.pause"]).click(); await button(page, words["topicWatch.resume"]).waitFor();
      assert.equal(await button(page, words["topicWatch.check"]).isDisabled(), true);
      await button(page, words["topicWatch.resume"]).click(); await button(page, words["topicWatch.pause"]).waitFor();
      await button(page, words["topicWatch.check"]).click();
      await region(page).getByText("unchanged. Paid requests: 0.", { exact: true }).waitFor();
      assert.equal(await button(page, words["topicWatch.edit"]).isDisabled(), true);
      await button(page, words["topicWatch.cancel"]).click(); await region(page).getByText(words["topicWatch.cancelled"], { exact: true }).waitFor();
      assert.equal(await button(page, words["topicWatch.cancel"]).isDisabled(), true);
      assert.equal(s.calls.filter(call => call.method === "POST" && call.body?.action === "check").length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(run, `manual-${width}.png`), fullPage: true }); results.push(`manual-${width}`);
    } finally { s.releaseSession(); await closeContext(s.context); }
  }
  // Foreign peer hints clear the entire canonical session/private editor without IO.
  // Focus retains the editor invalidation path. Recovery requires explicit user action.
  for (const mode of ["draft-broadcast", "late-broadcast", "late-focus"] as const) {
    const s = await scenario(1366);
    try {
      const page = await open(s.context), peer = await open(s.context);
      await region(page).getByText(words["topicWatch.empty"], { exact: true }).waitFor();
      await region(peer).getByText(words["topicWatch.empty"], { exact: true }).waitFor();
      assert.equal(new URL(page.url()).origin, new URL(peer.url()).origin);
      const title = mode === "draft-broadcast" ? "BROADCAST PRIVATE WATCH" : "LATE BODY PRIVATE QUESTION";
      if (mode !== "draft-broadcast") await page.evaluate(title => (window as FixtureWindow).watch284.holdBody(title), title);
      await draft(page, title); await consent(page).check(); await button(page, words["topicWatch.create"]).click();
      if (mode === "draft-broadcast") {
        await region(page).getByRole("heading", { name: title, exact: true }).waitFor();
        await region(page).getByText("created. Paid requests: 0.", { exact: true }).waitFor();
        await button(page, words["topicWatch.edit"]).click(); await question(page).fill("BROADCAST PRIVATE DRAFT");
        await consent(page).check(); await region(page).getByRole("checkbox", { name: words["topicWatch.heartbeat"], exact: true }).check();
      } else await page.waitForFunction(() => (window as FixtureWindow).watch284.state.held === 1);
      const privateReads = s.calls.filter(call => call.method === "GET").length;
      if (mode === "late-focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      else await peer.evaluate(() => { const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close(); });
      if (mode === "late-focus") {
        await cleared(page); assert.equal(await region(page).getByRole("heading", { name: title, exact: true }).count(), 0);
        assert.equal(await region(page).getByRole("checkbox", { name: words["topicWatch.heartbeat"], exact: true }).isChecked(), false);
        assert.equal(await region(page).getByLabel(words["topicWatch.keywords"], { exact: true }).inputValue(), "");
      } else await broadcastCleared(page, title);
      if (mode !== "draft-broadcast") {
        await page.evaluate(() => { (window as FixtureWindow).watch284.cleared(); (window as FixtureWindow).watch284.release(); });
        if (mode === "late-focus") await button(page, words["topicWatch.refresh"]).and(page.locator(":enabled")).waitFor();
        await flush(page);
        if (mode === "late-focus") await cleared(page); else await broadcastCleared(page, title);
        assert.deepEqual(await page.evaluate(() => (window as FixtureWindow).watch284.state.paints), []);
        assert.equal(await page.evaluate(() => (window as FixtureWindow).watch284.state.released), 1);
      }
      assert.equal(s.calls.filter(call => call.method === "GET").length, privateReads, "No private list refresh from hint/focus/late body");
      if (mode === "late-focus") await button(page, words["topicWatch.refresh"]).click();
      else {
        const beforeReloadSessionReads = s.sessionReads();
        const reloaded = await page.reload(); assert.equal(reloaded?.status(), 200);
        await region(page).getByRole("heading", { name: title, exact: true }).waitFor();
        assert(s.sessionReads() > beforeReloadSessionReads, "Explicit reload obtains fresh server session");
      }
      await region(page).getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(await consent(page).isChecked(), false); assert.equal(await region(page).getByText("created. Paid requests: 0.", { exact: true }).count(), 0);
      results.push(mode);
    } finally { s.releaseSession(); await closeContext(s.context); }
  }
  const anonymous = await scenario(360, false, true);
  try {
    const page = await open(anonymous.context);
    await page.locator("main").getByText(words["topicWatch.checking"], { exact: true }).waitFor();
    let sessionRequestDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([anonymous.sessionRequested, new Promise<never>((_done, fail) => {
        sessionRequestDeadline = setTimeout(() => fail(new Error("Initial synthetic session request did not arrive within existing 10000ms bound")), 10000);
      })]);
    } finally { if (sessionRequestDeadline !== undefined) clearTimeout(sessionRequestDeadline); }
    assert(anonymous.sessionReads() > 0); assert.equal(await region(page).count(), 0);
    assert.equal(await page.locator("main input").count(), 0); assert.equal(anonymous.calls.length, 0);
    anonymous.releaseSession();
    const signIn = page.locator("main").getByRole("link", { name: words["topicWatch.signIn"], exact: true });
    await signIn.waitFor(); assert.equal(await signIn.getAttribute("href"), "/connect"); assert.equal(await region(page).count(), 0);
    assert.equal(anonymous.calls.length, 0); results.push("anonymous-no-private-markup");
  } finally { anonymous.releaseSession(); await closeContext(anonymous.context); }
  assert.deepEqual(await pinSources(), sourcePins); assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []);
  // Global public analytics can attempt outbound delivery; refusal is retained.
  // No external request is continued, including provider/search/payment traffic.
} catch (error) { mainFailed = true; mainFailure = error; }
finally {
  try { await browser?.close(); browserClosed = true; } catch (error) { cleanupFailures.push(error); }
  try { if (server.listening) await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); httpDrained = !server.listening; }
  catch (error) { cleanupFailures.push(error); }
  if (app) {
    try {
      const instrumentation = require(join(fixture, ".next/server/instrumentation.js")) as { close(): Promise<boolean> };
      assert.equal(await instrumentation.close(), true); instrumentationClosed = true;
    } catch (error) { cleanupFailures.push(error); }
    try { await app.close(); appClosed = true; } catch (error) { cleanupFailures.push(error); }
    try { await require("next/dist/trace").flushAllTraces(); tracesFlushed = true; } catch (error) { cleanupFailures.push(error); }
  } else { instrumentationClosed = appClosed = tracesFlushed = true; }
  Socket.prototype.connect = nativeConnect; globalThis.fetch = nativeFetch;
  try { process.chdir(previousCwd); for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment); }
  catch (error) { cleanupFailures.push(error); }
  try {
    await writeFile(join(run, "outcome.json"), JSON.stringify({ status: mainFailed || cleanupFailures.length ? "FAILED" : "PASS",
      scope: "Actual compiled Next UI/canonical hooks; synthetic session/watch API only. Native store/HTTP ownership separately qualified.",
      buildId, sourcePins, compiledPins, admissionPath, buildEvidence: admission.buildEvidence, results, httpRequests, failures, pageErrors, externalAttempts,
      naturalClose: { browserClosed, httpDrained, instrumentationClosed, appClosed, tracesFlushed,
        processExitObserved: null, stdoutEofObserved: null, stderrEofObserved: null },
      error: mainFailure instanceof Error ? { name: mainFailure.name, message: mainFailure.message, stack: mainFailure.stack } : mainFailed ? String(mainFailure) : null,
      cleanupFailures: cleanupFailures.map(error => error instanceof Error ? { message: error.message, stack: error.stack } : String(error)),
      note: "Parent captures actual process exit/close/EOF. No forced exit, kill, retry, build or native acceptance." }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures, "Compiled watch284 natural close failed");
  if (mainFailed) throw mainFailure;
}
console.log("PASS: compiled watch284 synthetic UI scenarios and natural owned cleanup; native/store/CI/release acceptance remains separate.");
}
await main().catch(async error => {
  process.exitCode = 1;
  // Admission/setup failures are nonzero too. Before a safe owned output is
  // established there is deliberately no arbitrary-path failure-file fallback.
  if (failureOutput) {
    try {
      await writeFile(join(failureOutput, "failed.json"), JSON.stringify({ status: "FAILED",
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        note: "Preflight or main/cleanup failure; preserve run/outcome.json and actual parent exit/EOF capture when present." }, null, 2) + "\n", { flag: "wx" });
    } catch (recordError) { throw new AggregateError([error, recordError], "Compiled watch284 failure and failure-record write failure"); }
  }
  throw error;
});
