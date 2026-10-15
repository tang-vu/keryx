/** Parent-run compiled Next UI control. Synthetic same-origin session/API responses
 * qualify actual emitted detail UI + canonical hooks only, never native store/HTTP ownership.
 * Offline route omits checkout. This driver reports INCOMPLETE, never compiled consent acceptance.
 * No build, install, envfile, provider, paid request, scheduler or shipped auth seam.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { copyNextConfigFixture, nextConfigFixtureFiles } from "../test-support/next-config-fixture";
import { researchFlowMessages as words } from "../locales/en/research-flow";
import { pendingOwner257Copy as ownerCopy } from "../locales/en/pending-owner257";
import { jobTargetCopy as targetCopy } from "../locales/en/job-targets";

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
// Freeze the entire runtime/product graph. Independent fixture tests/docs are
// intentionally excluded: their author does not provide compiled acceptance.
async function filesUnder(base: string, directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(base, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `No redirected source/dist input: ${path}`);
    if (entry.isDirectory()) result.push(...await filesUnder(base, path));
    else { assert(entry.isFile()); result.push(path); }
  }
  return result.sort();
}
const runtimeFiles = (await Promise.all(["app", "components", "lib", "locales", "public"].map(path => filesUnder(root, path)))).flat()
  .filter(path => !/\.(test|spec)\.[^.]+$/.test(path));
const pinnedPaths = [...new Set([...runtimeFiles, ...nextConfigFixtureFiles, "instrumentation.ts", "package-lock.json",
  "scripts/a2a-research-worker.mts", "test-support/next-config-fixture.ts", "scripts/test-browser-job-target257.mts",
  "scripts/test-browser-job-target257-built.mts"])].sort();
async function pins(base: string, paths: string[]) {
  return Promise.all(paths.map(async path => ({ path, sha256: sha(await readFile(join(base, path))) })));
}
async function pinSources() { return pins(root, pinnedPaths); }
const sourcePins = await pinSources();
type Admission = { owner: "ROOT"; buildEvidence: string; readOnlyDistProof: string; dist: string; output: string; port: number; buildId: string;
  sourcePins: { path: string; sha256: string }[]; compiledPins: { path: string; sha256: string }[] };
const admission = JSON.parse(await readFile(admissionPath, "utf8")) as Admission;
assert.equal(admission.owner, "ROOT"); assert(admission.buildEvidence?.trim(), "Actual current source/input build evidence required");
assert(admission.readOnlyDistProof?.trim(), "Parent's actual read-only dist provenance is mandatory, not an old source review");
assert.equal(resolve(admission.dist), resolve(dist)); assert.equal(resolve(admission.output), resolve(output)); assert.equal(admission.port, port);
assert.deepEqual(admission.sourcePins, sourcePins, "Current full runtime/product graph, driver and old driver bound by parent");
const compiledPaths = await filesUnder(dist, "");
const compiledPins = await pins(dist, compiledPaths);
assert.deepEqual(admission.compiledPins, compiledPins, "Parent binds every emitted file, not just a page manifest");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim(); assert(buildId && buildId.length <= 128);
assert.equal(admission.buildId, buildId);
const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8"));
assert.equal(appPaths["/research/page"], "app/research/page.js");
const references = await readFile(join(dist, "server/app/research/page_client-reference-manifest.js"), "utf8");
assert(references.includes("research-job"), "Actual emitted page references authored client manager");
assert(references.includes("research-request"), "Current emitted route retains real checkout entry, even though offline render omits it");
const emittedClient = (await Promise.all(compiledPaths.filter(path => path.startsWith("static/") && path.endsWith(".js"))
  .map(path => readFile(join(dist, path), "utf8")))).join("\n");
for (const marker of [ownerCopy.consent, ownerCopy.held, ownerCopy.failed, "data-owned-job", "pending=owned&id=", "/api/auth/sessions"])
  assert(emittedClient.includes(marker), `Actual current emitted checkout/detail/transport marker: ${marker}`);

const run = join(output, "run"), fixture = join(output, "runtime"), origin = `http://127.0.0.1:${port}`;
const wallet = `0x${"a".repeat(40)}`, list = "/api/me/jobs";
const session = "/api/auth/session", failures: string[] = [], externalAttempts: string[] = [], pageErrors: string[] = [];
const results: string[] = [], httpRequests: string[] = [];
const observations: unknown[] = [];
let contextSerial = 0;
const tracePaths = new WeakMap<BrowserContext, string>();
let app: ReturnType<NextFactory> | undefined, browser: Browser | undefined, mainFailure: unknown;
let mainFailed = false, acceptanceIncomplete = false, browserClosed = false, httpDrained = false, appClosed = false, instrumentationClosed = false, tracesFlushed = false;
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
    if (req.headers["next-router-prefetch"] === "1" && url.pathname !== "/research" && !url.pathname.startsWith("/_next/")) {
      res.writeHead(503, { "Cache-Control": "no-store" }); res.end(); return;
    }
    assert(url.pathname === "/research" || url.pathname === "/favicon.ico" || url.pathname.startsWith("/_next/"), "Finite compiled page/assets only");
    assert(app); await app.getRequestHandler()(req, res);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    if (!res.headersSent) res.writeHead(500); res.end();
  }
});
server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;

const coverage = {
  checkout: "UNREACHABLE: current /research excludes ResearchRequest when KERYX_FORCE_OFFLINE=1",
  signedPost: "UNRUN: no supported browser wallet signing control; existing transport unit proof is separate",
  fixedOrigin: "UNRUN: account consent requires https://keryx.cc; loopback does not confer that authority",
  externalGenericAnonymousResubmit: "UNRUN: no reachable real paid UI control in this boot; no fabricated POST",
  root496: "OPEN final-main structured auth-notice coupling gate; no unmerged protocol copied",
};
type JobCase = "failed" | "held" | "unknown" | "missing" | "historical" | "unowned" | "overdue" | "stale";
function fixtureCase(mode: "quick" | "deep", kind: JobCase) {
  const id = `a2a_${"1".repeat(64)}`, target = mode === "quick" ? 180000 : 300000;
  const observed = Date.now(), elapsed = kind === "overdue" ? target + 1000 : kind === "stale" ? target : 1000;
  // Acceptance is the original createdAt, never updatedAt or a fresh poll clock.
  const createdAt = new Date(observed - elapsed).toISOString();
  const unavailable = kind === "historical";
  const escalation = {
    state: unavailable ? "unavailable" : kind === "overdue" ? "overdue" : "within_target",
    escalationNeeded: unavailable ? null : kind === "overdue", observedAt: new Date(observed).toISOString(),
    acceptedAt: unavailable ? null : createdAt, targetCompletionAt: unavailable ? null : new Date(observed - elapsed + target).toISOString(),
    targetCompletionMs: unavailable ? null : target, elapsedMs: unavailable ? null : elapsed,
    lastRecordedStage: "unknown", failureCode: kind === "failed" ? "research_failed" : null,
    creatorPaymentState: "unknown", evaluation: "on_observation", objectiveKind: "provisional_slo", remedy: "none",
  };
  const status = kind === "failed" ? "failed" : kind === "held" ? "review_required" : "processing";
  const job = { queryId: id, status, ...(kind === "missing" ? {} : { escalation }) };
  const row = { id, question: null, status, createdAt, updatedAt: new Date(observed).toISOString(), mode, packagePriceUsdc: null,
    escalation, attention: kind === "failed" || kind === "held" ? "needs_review" : "unknown",
    recoveryState: kind === "held" ? "held" : "unknown" };
  return { id, job, packet: { wallet, jobs: kind === "unowned" || kind === "historical" || kind === "missing" ? [] : [row],
    nextCursor: null, ownership: "authenticated_original", recoveryState: "unknown" }, createdAt, target };
}

/** Observe actual hook calls and a held synthetic fetch/body. No React, module,
 * timer, auth-hook or rendered component substitution. Cancellation is real. */
function observePage() {
  const native = window.fetch.bind(window);
  const state = { hold: "" as string, held: 0, cancelled: 0, released: 0, reads: 0, sessionRows: 0,
    afterClear: false, paints: [] as string[], calls: [] as { path: string; method: string; credentials: string; started: number }[] };
  let release: (() => void) | undefined;
  const observer = new MutationObserver(() => {
    if (state.afterClear && document.querySelector("[data-owned-job]")) {
      if (state.paints.length >= 64) throw Error("Paint observation cap");
      state.paints.push(document.querySelector("[data-owned-job]")!.textContent ?? "");
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true });
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const owned = url.pathname === "/api/me/jobs" && url.searchParams.get("pending") === "owned";
    if (state.calls.length >= 256) throw Error("Fetch observation cap");
    state.calls.push({ path: url.pathname + url.search, method: init?.method ?? request?.method ?? "GET",
      credentials: init?.credentials ?? request?.credentials ?? "same-origin", started: performance.now() });
    if (url.pathname === "/api/auth/sessions") state.sessionRows++;
    if (owned) state.reads++;
    const hold = owned ? state.hold : "";
    if (hold) state.hold = "";
    if (hold === "fetch") {
      state.held++;
      await new Promise<void>(done => { release = () => { state.released++; release = undefined; done(); }; });
      // Returning after actual abort must remain ineffective in the mounted hook.
    }
    const response = await native(input, init);
    if (hold !== "body") return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 131072) throw Error("Synthetic body cap");
    let cancelled = false;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        state.held++;
        release = () => { state.released++; release = undefined; if (!cancelled) { controller.enqueue(bytes); controller.close(); } };
      },
      cancel() { cancelled = true; state.cancelled++; },
    }), { status: response.status, headers: response.headers });
  };
  (window as unknown as { job257: unknown }).job257 = { state,
    hold(value: "fetch" | "body") { if (state.hold || release) throw Error("One held response only"); state.hold = value; },
    cleared() { state.afterClear = true; },
    release() { if (!release) throw Error("No held response"); release(); },
    close() { release?.(); observer.disconnect(); window.fetch = native; },
  };
}
type FixtureWindow = Window & typeof globalThis & { job257: {
  state: { reads: number; held: number; cancelled: number; released: number; sessionRows: number; paints: string[];
    calls: { path: string; method: string; credentials: string; started: number }[] };
  hold(value: "fetch" | "body"): void; cleared(): void; release(): void; close(): void;
} };
const flush = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const region = (page: Page) => page.getByRole("region", { name: words["researchJob.title"], exact: true });
const owned = (page: Page) => region(page).locator("[data-owned-job]");
const warning = (page: Page, value: string) => region(page).locator(`[data-job-target-state="${value}"]`);
type Call = { method: string; path: string; body: string | null };
async function scenario(width: number, mode: "quick" | "deep", kind: JobCase) {
  assert(browser);
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  tracePaths.set(context, join(run, `context-${++contextSerial}.zip`));
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.routeWebSocket("**/*", socket => {
    externalAttempts.push(`WEBSOCKET ${socket.url()}`); socket.close({ code: 1008, reason: "Synthetic fixture admits no WebSocket" });
  });
  const fixture = fixtureCase(mode, kind), calls: Call[] = [];
  let signedIn = true, sessionId = "a".repeat(64), address = wallet;
  const issuedAt = Date.now() - 1000, expiresAt = issuedAt + 3600000;
  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  await context.addInitScript(observePage);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { externalAttempts.push(`${request.method()} ${url.origin}`); await route.abort("blockedbyclient"); return; }
    try {
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
      assert(calls.length < 256); calls.push({ method: request.method(), path: url.pathname + url.search, body: request.postData() });
      if (url.pathname === session) {
        assert.equal(request.method(), "GET"); assert.equal(url.search, "");
        await json({ session: signedIn ? { address, role: "asker" } : null }); return;
      }
      if (url.pathname === "/api/auth/sessions") {
        assert.equal(request.method(), "GET"); assert.equal(url.search, "");
        await json({ sessions: signedIn ? [{ id: sessionId, issuedAt, expiresAt, current: true }] : [], truncated: false }); return;
      }
      if (url.pathname === "/api/agent/ask") {
        assert.equal(request.method(), "GET", "No synthetic signed POST is fabricated");
        assert.equal(url.search, `?queryId=${fixture.id}`);
        assert.equal(request.headers()["x-keryx-account-job"], undefined);
        assert.equal(request.headers().cookie, undefined, "Public bearer lookup omits account cookie");
        await json(fixture.job); return;
      }
      if (url.pathname === list) {
        assert.equal(request.method(), "GET");
        if (url.search === "") { await json({ wallet: address, jobs: [], nextCursor: null }); return; }
        assert.equal(url.search, `?pending=owned&id=${fixture.id}`);
        assert.equal(request.headers()["x-keryx-account-job"], undefined);
        if (!signedIn) { await json({ error: "Synthetic session ended" }, 401); return; }
        await json(address === wallet ? fixture.packet : { ...fixture.packet, wallet: address, jobs: [] }); return;
      }
      if (url.pathname === "/api/me/private-jobs/history") {
        assert.equal(request.method(), "POST"); assert.deepEqual(request.postDataJSON(), { cursor: null });
        await json({ error: "Synthetic incidental history unavailable" }, 503); return;
      }
      if (["/api/me/locale-preference", "/api/payments", "/api/sources", "/maintenance/status"].includes(url.pathname)) {
        assert.equal(request.method(), "GET");
        if (url.pathname === "/api/sources") assert(["", "?limit=20"].includes(url.search));
        else assert.equal(url.search, "");
        await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
      }
      assert(!url.pathname.startsWith("/api/"), `Unknown API blocked: ${url.pathname}`);
      assert.equal(request.method(), "GET"); await route.continue();
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); await route.abort("failed"); }
  });
  return { context, fixture, calls,
    logout() { signedIn = false; }, replace() { sessionId = "b".repeat(64); }, foreign() { address = `0x${"b".repeat(40)}`; },
  };
}
async function closeContext(context: BrowserContext) {
  const errors: unknown[] = [];
  for (const page of context.pages()) if (!page.isClosed()) {
    try { observations.push(await page.evaluate(() => (window as FixtureWindow).job257.state)); } catch (error) { errors.push(error); }
    try { await page.evaluate(() => (window as FixtureWindow).job257.close()); } catch (error) { errors.push(error); }
    try { await page.close(); } catch (error) { errors.push(error); }
  }
  try { await context.tracing.stop({ path: tracePaths.get(context)! }); } catch (error) { errors.push(error); }
  try { await context.close(); } catch (error) { errors.push(error); }
  if (errors.length) { process.exitCode = 1; throw new AggregateError(errors, "Owned pages/context close failed"); }
}
async function open(context: BrowserContext, id: string) {
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(10000);
  const response = await page.goto(`${origin}/research`); assert.equal(response?.status(), 200);
  await region(page).getByLabel(words["researchJob.idLabel"], { exact: true }).fill(id);
  await region(page).getByRole("button", { name: words["researchJob.open"], exact: true }).click();
  await page.waitForFunction(() => (window as FixtureWindow).job257.state.reads >= 1);
  return page;
}
async function guidance(page: Page, state: string, calls: Call[]) {
  const panel = warning(page, state);
  for (const choice of ["wait", "partial", "human"] as const) {
    const before = calls.filter(call => call.method !== "GET").length;
    await panel.getByRole("button", { name: targetCopy[choice], exact: true }).click();
    await panel.getByRole("status").getByText(targetCopy[`${choice}Body`], { exact: true }).waitFor();
    assert.equal(calls.filter(call => call.method !== "GET").length, before, "Guidance sends no financial/recovery/refund request");
  }
  await panel.getByText(targetCopy.choiceNotice, { exact: true }).waitFor();
  await panel.getByText(targetCopy.originalOnly, { exact: true }).waitFor();
}
async function using(s: Awaited<ReturnType<typeof scenario>>, control: () => Promise<void>) {
  let failed = false, original: unknown;
  try { await control(); } catch (error) { process.exitCode = 1; failed = true; original = error; }
  try { await closeContext(s.context); }
  catch (error) { process.exitCode = 1; throw failed ? new AggregateError([original, error], "Control and context cleanup failed") : error; }
  if (failed) throw original;
}
try {
  await mkdir(run); await mkdir(fixture); // Exclusive runtime, never overwrite old captures.
  await cp(dist, join(fixture, ".next"), { recursive: true, dereference: true, force: false, errorOnExist: true });
  await cp(join(root, "public"), join(fixture, "public"), { recursive: true, dereference: true, force: false, errorOnExist: true });
  assert.deepEqual(await pins(join(fixture, ".next"), await filesUnder(join(fixture, ".next"), "")), compiledPins,
    "Owned runtime copy begins as exact admitted current compiled bytes");
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
  for (const width of [360, 1366]) for (const mode of ["quick", "deep"] as const) {
    for (const kind of ["failed", "held", "unknown", "missing", "historical", "unowned", "overdue", "stale"] as const) {
      const s = await scenario(width, mode, kind);
      await using(s, async () => {
        const page = await open(s.context, s.fixture.id);
        if (kind === "failed" || kind === "held") {
          await owned(page).getByText(ownerCopy.title, { exact: true }).waitFor();
          await owned(page).getByText(kind === "held" ? ownerCopy.held : ownerCopy.failed, { exact: true }).waitFor();
          if (kind === "failed") await owned(page).getByText(ownerCopy.recoveryUnknown, { exact: true }).waitFor();
          await warning(page, "needs_review_on_observation").getByText(targetCopy.reviewTitle, { exact: true }).waitFor();
          assert.equal(await warning(page, "overdue_on_observation").count(), 0);
          await guidance(page, "needs_review_on_observation", s.calls);
        } else if (kind === "overdue") {
          await warning(page, "overdue_on_observation").waitFor();
          assert.equal(await warning(page, "needs_review_on_observation").count(), 0);
          await guidance(page, "overdue_on_observation", s.calls);
        } else if (kind === "stale") {
          // Actual canonical display timer crosses the retained original deadline.
          // No clock replacement, timer reset, fake server read or 180s wait.
          await warning(page, "target_elapsed_since_observation").getByText(targetCopy.localBody, { exact: true }).waitFor();
          assert.equal(await warning(page, "overdue_on_observation").count(), 0);
          await guidance(page, "target_elapsed_since_observation", s.calls);
        } else {
          await page.waitForFunction(() => (window as FixtureWindow).job257.state.sessionRows >= 2);
          await flush(page);
          assert.equal(await owned(page).count(), 0, "Unknown, missing, historical and unowned do not infer a recovery hold");
          assert.equal(await warning(page, "needs_review_on_observation").count(), 0);
          if (kind === "historical") await region(page).getByRole("status").getByText("Completion timing is unavailable for this recorded job. No target or refund promise is inferred.", { exact: true }).waitFor();
        }
        assert.equal(await page.getByRole("checkbox", { name: ownerCopy.consent, exact: true }).count(), 0,
          "Offline current route cannot mount purchase consent; never treat this absence as opt-in acceptance");
        const calls = await page.evaluate(() => (window as FixtureWindow).job257.state.calls);
        for (const call of calls.filter(call => call.path.startsWith("/api/me/jobs?pending=owned"))) {
          assert.equal(call.credentials, "same-origin"); assert.equal(call.method, "GET");
        }
        for (const call of calls.filter(call => call.path.startsWith("/api/agent/ask?"))) assert.equal(call.credentials, "omit");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: join(run, `${mode}-${kind}-${width}.png`), fullPage: true });
        results.push(`${mode}-${kind}-${width}:detail-control`);
      });
    }
  }
  // Real mounted per-request timeout covers BOTH fetch and body consumption.
  // Do not inflate the canonical five-second bound or substitute hook timers.
  for (const hold of ["fetch", "body"] as const) {
    const s = await scenario(1366, "quick", "failed");
    await using(s, async () => {
      const page = await open(s.context, s.fixture.id);
      await owned(page).waitFor();
      await page.evaluate(hold => (window as FixtureWindow).job257.hold(hold), hold);
      await page.waitForFunction(() => (window as FixtureWindow).job257.state.held === 1);
      await owned(page).waitFor({ state: "detached" });
      if (hold === "body") await page.waitForFunction(() => (window as FixtureWindow).job257.state.cancelled === 1);
      await page.evaluate(() => (window as FixtureWindow).job257.release());
      await owned(page).waitFor(); // A subsequent actual read recovers while mounted.
      assert((await page.evaluate(() => (window as FixtureWindow).job257.state.reads)) >= 3);
      results.push(`five-second-${hold}-bound-and-next-read`);
    });
  }
  // Native same-origin two-page broadcast/focus, fresh synthetic durable tuples.
  // Auth notices are current contracts; Root496 coupling remains a final-main gate.
  for (const loss of ["logout", "replacement", "foreign", "focus", "unmount"] as const) {
    const s = await scenario(1366, "deep", "held");
    await using(s, async () => {
      const page = await open(s.context, s.fixture.id), peer = await s.context.newPage();
      await peer.goto(`${origin}/research`); assert.equal(new URL(peer.url()).origin, new URL(page.url()).origin);
      await owned(page).waitFor();
      await page.evaluate(() => (window as FixtureWindow).job257.hold("body"));
      await page.waitForFunction(() => (window as FixtureWindow).job257.state.held === 1);
      if (loss === "logout") s.logout();
      if (loss === "replacement") s.replace();
      if (loss === "foreign") s.foreign();
      if (loss === "unmount") await region(page).getByRole("button", { name: words["researchJob.clear"], exact: true }).click();
      else if (loss === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      else await peer.evaluate(loss => {
        const channel = new BroadcastChannel("keryx-auth-v1");
        channel.postMessage(loss === "logout" ? "signed-out" : "changed"); channel.close();
      }, loss);
      await owned(page).waitFor({ state: "detached" });
      await page.waitForFunction(() => (window as FixtureWindow).job257.state.cancelled === 1);
      await page.evaluate(() => { (window as FixtureWindow).job257.cleared(); (window as FixtureWindow).job257.release(); });
      await flush(page);
      assert.equal(await owned(page).count(), 0);
      assert.deepEqual(await page.evaluate(() => (window as FixtureWindow).job257.state.paints), [], "Cancelled late body cannot repaint private attention");
      // Replacement/focus may start a new legitimate read after two seconds;
      // this control asserts refusal of the old body, not permanent sign-out.
      results.push(`${loss}-native-auth-loss-late-body`);
    });
  }
  {
    const s = await scenario(1366, "quick", "failed");
    await using(s, async () => {
      const page = await open(s.context, s.fixture.id);
      await owned(page).waitFor();
      await page.evaluate(() => (window as FixtureWindow).job257.hold("body"));
      await page.waitForFunction(() => (window as FixtureWindow).job257.state.held === 1);
      const reads = await page.evaluate(() => (window as FixtureWindow).job257.state.sessionRows);
      s.replace(); // Same wallet, changed durable session during body, no hint.
      await page.evaluate(() => (window as FixtureWindow).job257.release());
      await page.waitForFunction(reads => (window as FixtureWindow).job257.state.sessionRows > reads, reads);
      await owned(page).waitFor({ state: "detached" });
      results.push("exact-durable-tuple-rechecked-after-body-without-auth-hint");
    });
  }
  assert.deepEqual(await pinSources(), sourcePins); assert.deepEqual(await pins(dist, await filesUnder(dist, "")), compiledPins); assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []);
  // Global public analytics can attempt outbound delivery; refusal is retained.
  // No external request is continued, including provider/search/payment traffic.
  // A successful partial suite must NEVER signal original257 compiled consent PASS.
  acceptanceIncomplete = true;
  throw new Error("INCOMPLETE compiled owner-consent acceptance: permitted offline current route omits checkout; signed purchase and fixed-origin controls remain OPEN. See outcome coverage.");
} catch (error) { process.exitCode = 1; mainFailed = true; mainFailure = error; }
finally {
  try { await browser?.close(); browserClosed = true; } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  try { if (server.listening) await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); httpDrained = !server.listening; }
  catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  if (app) {
    try {
      const instrumentation = require(join(fixture, ".next/server/instrumentation.js")) as { close(): Promise<boolean> };
      assert.equal(await instrumentation.close(), true); instrumentationClosed = true;
    } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
    try { await app.close(); appClosed = true; } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
    try { await require("next/dist/trace").flushAllTraces(); tracesFlushed = true; } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  } else { instrumentationClosed = appClosed = tracesFlushed = true; }
  try {
    assert.deepEqual(await pinSources(), sourcePins, "Consumed current sources unchanged even on failed controls");
    assert.deepEqual(await pins(dist, await filesUnder(dist, "")), compiledPins, "Parent dist remains unchanged even on failed controls");
  } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  Socket.prototype.connect = nativeConnect; globalThis.fetch = nativeFetch;
  try { process.chdir(previousCwd); for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment); }
  catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  try {
    await writeFile(join(run, "outcome.json"), JSON.stringify({ status: cleanupFailures.length || (mainFailed && !acceptanceIncomplete) ? "FAILED" : "INCOMPLETE",
      scope: "Actual compiled Next detail UI/hooks; synthetic metadata only. No checkout, native, payment or settlement acceptance.",
      buildId, sourcePins, compiledPins, admissionPath, buildEvidence: admission.buildEvidence, readOnlyDistProof: admission.readOnlyDistProof, coverage, results, observations, httpRequests, failures, pageErrors, externalAttempts,
      naturalClose: { browserClosed, httpDrained, instrumentationClosed, appClosed, tracesFlushed,
        processExitObserved: null, stdoutEofObserved: null, stderrEofObserved: null },
      error: mainFailure instanceof Error ? { name: mainFailure.name, message: mainFailure.message, stack: mainFailure.stack } : mainFailed ? String(mainFailure) : null,
      cleanupFailures: cleanupFailures.map(error => error instanceof Error ? { message: error.message, stack: error.stack } : String(error)),
      note: "Parent captures actual process exit/close/EOF. No forced exit, kill, retry, build or native acceptance." }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures, "Compiled job257 natural close failed");
  if (mainFailed) throw mainFailure;
}
console.log("Compiled job257 detail controls completed; checkout and signed purchase remain OPEN.");
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
    } catch (recordError) { throw new AggregateError([error, recordError], "Compiled job257 failure and failure-record write failure"); }
  }
  throw error;
});
