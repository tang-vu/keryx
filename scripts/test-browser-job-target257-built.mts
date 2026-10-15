/** Parent-run compiled Next UI control. Synthetic same-origin session/API responses
 * qualify actual emitted detail UI + canonical hooks only, never native store/HTTP ownership.
 * Disposable unfunded testnet setup reaches the unchanged checkout and signer.
 * Synthetic dispatch is intercepted, never payment/native/owner-admission acceptance.
 * No build, install, envfile, real provider/paid request, scheduler or shipped auth seam.
 */
import assert from "node:assert/strict";
import { assertStockUnchanged, qualificationHash, stockPins, copyStock, type CompiledCopyProof, type StockQualification } from "../test-support/stock-built-links.mjs";
import { createHash, randomBytes } from "node:crypto";
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
import { researchFundingMessages as checkoutCopy } from "../locales/en/research-funding";
import { productGuideMessages as entryCopy } from "../locales/en/product-guide";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";

let failureOutput: string | undefined;
async function main() {
// Enumerate names before touching inherited values. Parent must launch this
// process sterile; never snapshot/read a production credential for restoration.
const parentEnvNames = new Set(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "TEMP", "TMP", "TSX_CACHE_DIR",
  ...(process.platform === "win32" ? ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME"] : [])]);
assert(Object.keys(process.env).every(name => parentEnvNames.has(name)), "Parent must launch with only documented system/temp/cache variables; no inherited credentials or runtime flags");
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
// Actual sole main519/6cab native25 build; Q and parent finalization still required.
const finalizedBuildId = "RSmINzvub8NDPRm5Kz4WB" as string | null;
assert(typeof finalizedBuildId === "string" && finalizedBuildId.length > 0 && finalizedBuildId.length <= 128, "UNRUN until parent finalizes actual new BID");
assert.notEqual(finalizedBuildId, "Hppnnv0aKVNS5HY8yB1k8", "Historical BID refused");
const flags = ["dist", "output", "port", "admission", "selection"] as const;
const args = process.argv.slice(2);
assert.equal(args.length, flags.length, "Parent supplies --dist=ABS --output=ABS --port=OWNED --admission=ABS --selection=FIXED");
const values = Object.fromEntries(flags.map(flag => {
  const matches = args.filter(value => value.startsWith(`--${flag}=`));
  assert.equal(matches.length, 1, `Exactly one ${flag}`);
  return [flag, matches[0].slice(flag.length + 3)];
})) as Record<typeof flags[number], string>;
const { dist, output, admission: admissionPath, selection: selectionId } = values, port = Number(values.port);
// Finite batching changes allocation only. Unselected controls have no result/PASS.
const allExpectedResults: string[] = [
    "quick-failed-360:detail-control",
    "quick-held-360:detail-control",
    "quick-unknown-360:detail-control",
    "quick-missing-360:detail-control",
    "quick-historical-360:detail-control",
    "quick-unowned-360:detail-control",
    "quick-overdue-360:detail-control",
    "quick-stale-360:detail-control",
    "deep-failed-360:detail-control",
    "deep-held-360:detail-control",
    "deep-unknown-360:detail-control",
    "deep-missing-360:detail-control",
    "deep-historical-360:detail-control",
    "deep-unowned-360:detail-control",
    "deep-overdue-360:detail-control",
    "deep-stale-360:detail-control",
    "quick-failed-1366:detail-control",
    "quick-held-1366:detail-control",
    "quick-unknown-1366:detail-control",
    "quick-missing-1366:detail-control",
    "quick-historical-1366:detail-control",
    "quick-unowned-1366:detail-control",
    "quick-overdue-1366:detail-control",
    "quick-stale-1366:detail-control",
    "deep-failed-1366:detail-control",
    "deep-held-1366:detail-control",
    "deep-unknown-1366:detail-control",
    "deep-missing-1366:detail-control",
    "deep-historical-1366:detail-control",
    "deep-unowned-1366:detail-control",
    "deep-overdue-1366:detail-control",
    "deep-stale-1366:detail-control",
    "five-second-fetch-bound-and-next-read",
    "five-second-body-bound-and-next-read",
    "logout-native-auth-loss-late-body",
    "replacement-native-auth-loss-late-body",
    "foreign-native-auth-loss-late-body",
    "focus-native-auth-loss-late-body",
    "unmount-native-auth-loss-late-body",
    "exact-durable-tuple-rechecked-after-body-without-auth-hint",
    "quick-anonymous-360:compiled-synthetic-consent-and-get-only-recovery",
    "quick-opted-in-360:compiled-synthetic-consent-and-get-only-recovery",
    "deep-anonymous-360:compiled-synthetic-consent-and-get-only-recovery",
    "deep-opted-in-360:compiled-synthetic-consent-and-get-only-recovery",
    "quick-anonymous-1366:compiled-synthetic-consent-and-get-only-recovery",
    "quick-opted-in-1366:compiled-synthetic-consent-and-get-only-recovery",
    "deep-anonymous-1366:compiled-synthetic-consent-and-get-only-recovery",
    "deep-opted-in-1366:compiled-synthetic-consent-and-get-only-recovery",
    "logout:compiled-post-sign-durable-refusal-without-anonymous-fallback",
    "replacement:compiled-post-sign-durable-refusal-without-anonymous-fallback",
    "foreign:compiled-post-sign-durable-refusal-without-anonymous-fallback",
    "unknown:compiled-credit-refusal-before-sign-or-paid-dispatch",
    "insufficient:compiled-credit-refusal-before-sign-or-paid-dispatch",
    "external-loopback:compiled-fixed-origin-consent-unavailable-no-purchase"
];
const selectionRanges = {
  "remaining17": [37, 54],
} as const;
assert(Object.prototype.hasOwnProperty.call(selectionRanges, selectionId), "One fixed finite selection only");
const [selectionStart, selectionEnd] = selectionRanges[selectionId as keyof typeof selectionRanges];
const expectedResults = allExpectedResults.slice(selectionStart, selectionEnd);
const selection = { id: selectionId, universeCount: 54, selectedCount: expectedResults.length, expectedResults,
  notRun: allExpectedResults.filter(id => !expectedResults.includes(id)), whole54Acceptance: false };
assert.equal(allExpectedResults.length, 54); assert.equal(new Set(allExpectedResults).size, 54);
const selected = (id: string) => { assert(allExpectedResults.includes(id), "Unknown original scenario"); return expectedResults.includes(id); };
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
  "scripts/test-browser-job-target257-built.mts", "test-support/stock-built-links.mjs", "test-support/stock-built-links.d.mts"])].sort();
async function pins(base: string, paths: string[]) {
  return Promise.all(paths.map(async path => ({ path, sha256: sha(await readFile(join(base, path))) })));
}
async function pinSources() { return pins(root, pinnedPaths); }
const sourcePins = await pinSources();
type Checkpoint = { sourceHead: string; mergeHead: null; mainAncestor: string; currentCompiledNativeUserDomainTables: number;
  buildId: string; buildReceiptSha256: string; sourceReceiptSha256: string };
type Admission = { checkpoint: Checkpoint; selection: typeof selection; stockQualificationSha256: string; readOnlyDistProofSha256: string; owner: "ROOT"; buildEvidence: string; readOnlyDistProof: string; publicNetwork: "arcTestnet"; dist: string; output: string; port: number; buildId: string;
  sourcePins: { path: string; sha256: string }[]; compiledPins: { path: string; sha256: string }[] };
const admission = JSON.parse(await readFile(admissionPath, "utf8")) as Admission;
assert.deepEqual(admission.selection, selection, "Parent binds selected scope and ordered expected results");
assert.equal(admission.checkpoint.sourceHead, "1a7484b9c282ea3244fdc271a5ac7292442369ab");
assert.equal(admission.checkpoint.mergeHead, null);
assert.equal(admission.checkpoint.mainAncestor, "6cabdc9299773bdc28d6e68e142c4dc558470ab4");
assert.equal(admission.checkpoint.currentCompiledNativeUserDomainTables, 25);
assert.equal(admission.checkpoint.buildId, finalizedBuildId);
assert.equal(resolve(admission.buildEvidence), resolve("D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/job257-one-current-main519-build-20261016/actual-build-result.json"));
assert.equal(sha(await readFile(admission.buildEvidence)), admission.checkpoint.buildReceiptSha256);
const sourceReceiptPath = "D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/job257-one-current-main519-build-20261016/all-source-before.json";
assert.equal(sha(await readFile(sourceReceiptPath)), admission.checkpoint.sourceReceiptSha256);
const sourceReceipt = JSON.parse(await readFile(sourceReceiptPath, "utf8"));
assert.equal(sourceReceipt.sourceHead, "1a7484b9c282ea3244fdc271a5ac7292442369ab");
assert.equal(sourceReceipt.sourceNativeFamily, 25);
assert.equal(sourceReceipt.stock25Migration, "FOCUSED_66_CONTROLS_QUALIFIED_NO_TARGET_DDL");
assert.equal(sourceReceipt.pins.length, 4021);
assert.equal(new Set(sourceReceipt.pins.map((p: { path: string }) => p.path)).size, 4021);
const actualBuild = JSON.parse(await readFile(admission.buildEvidence, "utf8"));
assert.equal(actualBuild.passed, true);
assert.equal(actualBuild.sourceHead, "1a7484b9c282ea3244fdc271a5ac7292442369ab");
assert.equal(actualBuild.sourceNativeFamily, 25);
assert.equal(actualBuild.stock25Migration, "FOCUSED_66_CONTROLS_QUALIFIED_NO_TARGET_DDL");
assert.equal(actualBuild.sourceCount, 4021);
assert.equal(actualBuild.targetOperations, 0);
assert.equal(actualBuild.buildId, finalizedBuildId);
assert.equal(actualBuild.allSourceBeforeSha256, admission.checkpoint.sourceReceiptSha256);
assert.equal(admission.owner, "ROOT"); assert(admission.buildEvidence?.trim(), "Actual current source/input build evidence required");
assert.equal(admission.publicNetwork, "arcTestnet", "Parent build evidence must bind public/server testnet twins; runtime ENV cannot change a compiled public rail");
assert(admission.readOnlyDistProof?.trim(), "Parent's actual read-only dist provenance is mandatory, not an old source review");
assert.equal(resolve(admission.dist), resolve(dist)); assert.equal(resolve(admission.output), resolve(output)); assert.equal(admission.port, port);
assert.deepEqual(admission.sourcePins, sourcePins, "Current full runtime/product graph, driver and old driver bound by parent");
// Reuse the parent's real initial content qualification DATA, pinned as bytes.
// This child freshly checks the full source metadata and verifies content once
// while copying; it does not pretend a metadata-only check is a fresh hash.
const distProofBytes = await readFile(admission.readOnlyDistProof);
assert.equal(sha(distProofBytes), admission.readOnlyDistProofSha256);
const distProof = JSON.parse(distProofBytes.toString("utf8")) as { checkpoint: Checkpoint; stockQualification: StockQualification; stockQualificationSha256: string; dist: string; compiledPins: { path: string; sha256: string }[] };
assert.deepEqual(distProof.checkpoint, admission.checkpoint);
assert.equal(distProof.stockQualificationSha256, admission.stockQualificationSha256);
assert.equal(resolve(distProof.dist), resolve(dist));
assert.deepEqual(distProof.compiledPins, admission.compiledPins);
const stockQualification = distProof.stockQualification;
assertStockUnchanged(dist, stockQualification);
assert.equal(admission.stockQualificationSha256, qualificationHash(stockQualification));
const compiledPaths = stockPins(stockQualification).map(pin => pin.path);
assert(compiledPaths.every(path => !/(^|\/)\.env($|\.)/.test(path)), "No runtime ENV file may be copied from admitted dist");
const compiledPins = stockPins(stockQualification);
assert.deepEqual(admission.compiledPins, compiledPins, "Parent binds every emitted file, not just a page manifest");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim(); assert(buildId && buildId.length <= 128);
assert.equal(admission.buildId, buildId);
assert.equal(buildId, finalizedBuildId);
assert.equal(admission.checkpoint.buildId, buildId);
const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8"));
assert.equal(appPaths["/research/page"], "app/research/page.js");
const references = await readFile(join(dist, "server/app/research/page_client-reference-manifest.js"), "utf8");
assert(references.includes("research-job"), "Actual emitted page references authored client manager");
assert(references.includes("research-request"), "Current emitted route retains real checkout entry");
const emittedClient = (await Promise.all(compiledPaths.filter(path => path.startsWith("static/") && path.endsWith(".js"))
  .map(path => readFile(join(dist, path), "utf8")))).join("\n");
for (const marker of [ownerCopy.consent, ownerCopy.held, ownerCopy.failed, "data-owned-job", "pending=owned&id=", "/api/auth/sessions"])
  assert(emittedClient.includes(marker), `Actual current emitted checkout/detail/transport marker: ${marker}`);

const run = join(output, "run"), fixture = join(output, "runtime"), loopback = `http://127.0.0.1:${port}`;
const origin = "https://keryx.cc";
// Keys exist only in this disposable process. They are never read from custody,
// written to ENV/files, funded, sent to a provider or used to submit a transaction.
const testWallet = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
const sellerKey = `0x${randomBytes(32).toString("hex")}` as Hex;
const seller = privateKeyToAccount(sellerKey).address;
const wallet = testWallet.address.toLowerCase(), list = "/api/me/jobs";
const gateway = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const asset = "0x3600000000000000000000000000000000000000";
const pageQueries = new Set(["", "?mode=quick&budget=0.03", "?mode=deep&budget=0.03"]);
const assetPaths = new Set([
  ...compiledPaths.filter(path => path.startsWith("static/")).map(path => `/_next/${path}`),
  ...runtimeFiles.filter(path => path.startsWith("public/")).map(path => `/${path.slice(7)}`),
  "/favicon.ico",
]);
let fixtureSignatures = 0;
const session = "/api/auth/session", failures: string[] = [], externalAttempts: string[] = [], pageErrors: string[] = [];
const results: string[] = [], httpRequests: string[] = [];
const observations: unknown[] = [];
let contextSerial = 0;
const tracePaths = new WeakMap<BrowserContext, string>();
let app: ReturnType<NextFactory> | undefined, browser: Browser | undefined, mainFailure: unknown;
let compiledCopyProof: CompiledCopyProof | undefined;
let mainFailed = false, browserClosed = false, httpDrained = false, appClosed = false, instrumentationClosed = false, tracesFlushed = false;
const cleanupFailures: unknown[] = [], previousEnvironment = { ...process.env }, previousCwd = process.cwd();
const nativeFetch = globalThis.fetch, nativeConnect = Socket.prototype.connect;
type NextFactory = (options: { dev: false; dir: string; hostname: string; port: number; httpServer: ReturnType<typeof createServer> }) => {
  prepare(): Promise<void>; close(): Promise<void>; getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server: { getServer(): Promise<{ prepare(): Promise<void> }> };
};
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.host, new URL(loopback).host); assert(httpRequests.length < 2048);
    const url = new URL(req.url!, loopback); httpRequests.push(`${req.method} ${url.pathname}`);
    assert.equal(req.method, "GET");
    // No API reaches compiled server handlers: all are intercepted in the browser.
    assert(!url.pathname.startsWith("/api/"), "API interception missing");
    assert(url.pathname === "/research" ? pageQueries.has(url.search) : assetPaths.has(url.pathname) && url.search === "",
      "Finite compiled page query and exact pinned assets only");
    assert(app); await app.getRequestHandler()(req, res);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    if (!res.headersSent) res.writeHead(500); res.end();
  }
});
server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;

const coverage = {
  checkout: "AUTHORED UNRUN: existing testnet seller/funder availability branch; ordinary EIP-6963 injected fixture",
  signedPost: "AUTHORED UNRUN: unchanged compiled signer/journal/price/budget/nonce policy; synthetic intercepted POST returns 503, no receipt",
  fixedOrigin: "AUTHORED UNRUN: literal https://keryx.cc, every page/asset fulfilled exclusively from owned loopback; no external continue",
  externalGenericAnonymousResubmit: "AUTHORED UNRUN: anonymous generic transport, native GET recovery/reload and external-origin disabled consent; external signed dispatch unreachable under original CSP and separately requires existing transport-unit evidence",
  new28: "SEPARATE UNRUN: native signed-cookie/route original-owner admission fixtures belong to R166/ROOT; browser intercepts do not execute or qualify them",
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
    afterClear: false, paints: [] as string[], calls: [] as { path: string; method: string; credentials: string; redirect: string;
      destination: string; body: string | null; headers: [string, string][]; started: number }[] };
  let release: (() => void) | undefined;
  const observer = new MutationObserver(() => {
    if (state.afterClear && document.querySelector("[data-owned-job]")) {
      if (state.paints.length >= 64) throw Error("Paint observation cap");
      state.paints.push(document.querySelector("[data-owned-job]")!.textContent ?? "");
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true });
  window.fetch = [async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const owned = url.pathname === "/api/me/jobs" && url.searchParams.get("pending") === "owned";
    if (state.calls.length >= 256) throw Error("Fetch observation cap");
    state.calls.push({ path: url.pathname + url.search, method: init?.method ?? request?.method ?? "GET",
      credentials: init?.credentials ?? request?.credentials ?? "same-origin", redirect: init?.redirect ?? request?.redirect ?? "follow",
      destination: url.href, body: typeof init?.body === "string" ? init.body : null,
      headers: [...new Headers(init?.headers ?? request?.headers).entries()], started: performance.now() });
    if (url.pathname === "/api/auth/sessions") state.sessionRows++;
    if (owned) state.reads++;
    const hold = owned ? state.hold : "";
    if (hold) state.hold = "";
    if (hold === "fetch") {
      state.held++;
      await new Promise<void>(done => { release = [() => { state.released++; release = undefined; done(); }][0]; });
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
        release = [() => { state.released++; release = undefined; if (!cancelled) { controller.enqueue(bytes); controller.close(); } }][0];
      },
      cancel() { cancelled = true; state.cancelled++; },
    }), { status: response.status, headers: response.headers });
  }][0];
  (window as unknown as { job257: unknown }).job257 = { state,
    hold(value: "fetch" | "body") { if (state.hold || release) throw Error("One held response only"); state.hold = value; },
    cleared() { state.afterClear = true; },
    release() { if (!release) throw Error("No held response"); release(); },
    close() { release?.(); observer.disconnect(); window.fetch = native; },
  };
}
type FixtureWindow = Window & typeof globalThis & { job257: {
  state: { reads: number; held: number; cancelled: number; released: number; sessionRows: number; paints: string[];
    calls: { path: string; method: string; credentials: string; redirect: string; destination: string; body: string | null;
      headers: [string, string][]; started: number }[] };
  hold(value: "fetch" | "body"): void; cleared(): void; release(): void; close(): void;
} };
const flush = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const region = (page: Page) => page.getByRole("region", { name: words["researchJob.title"], exact: true });
const owned = (page: Page) => region(page).locator("[data-owned-job]");
const warning = (page: Page, value: string) => region(page).locator(`[data-job-target-state="${value}"]`);
type Call = { method: string; path: string; body: string | null };
async function scenario(width: number, mode: "quick" | "deep", kind: JobCase, checkout?: { external?: boolean; credit?: "unknown" | "insufficient"; holdSign?: boolean }) {
  assert(browser);
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  tracePaths.set(context, join(run, `context-${++contextSerial}.zip`));
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.routeWebSocket("**/*", socket => {
    externalAttempts.push(`WEBSOCKET ${socket.url()}`); socket.close({ code: 1008, reason: "Synthetic fixture admits no WebSocket" });
  });
  const fixture = fixtureCase(mode, kind), calls: Call[] = [];
  const displayOrigin = checkout?.external ? loopback : origin;
  const requestBody = JSON.stringify({ question: "Explain isolated durable recovery", budget: 0.03, researchMode: mode, packageVersion: "1.0.0", responseMode: "async" });
  const changedQuestionRequestBody = JSON.stringify({ question: "A separately reviewed new question", budget: 0.03, researchMode: mode, packageVersion: "1.0.0", responseMode: "async" });
  const price = mode === "quick" ? "50000" : "80000"; // Existing .03 cap plus unchanged .02/.05 service fee.
  let unsignedQuotes = 0;
  const signedFixtures: { typed: any; signature: Hex; queryId: string; dispatchedAuthorization?: unknown }[] = [];
  const providerMethods: string[] = [];
  let fixtureBalanceReads = 0;
  const recoveryIds = new Set<string>();
  let releaseSign: (() => void) | undefined, signWaiting = false;
  let fixtureWalletConnected = false; // Synthetic EIP-1193 stays disconnected until the real connector requests accounts.
  let signedIn = true, sessionId = "a".repeat(64), address = wallet;
  const issuedAt = Date.now() - 1000, expiresAt = issuedAt + 3600000;
  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  await context.addInitScript(observePage);
  if (checkout) {
    await context.exposeBinding("job257FixtureRequest", async (_source, packet: { method: string; params?: unknown[] }) => {
      try {
        assert(providerMethods.length < 64); providerMethods.push(packet.method);
        if (packet.method === "wallet_requestPermissions") {
          assert.deepEqual(packet.params, [{ eth_accounts: {} }]);
          // Installed injected connector probes this optional API before the
          // ordinary eth_requestAccounts path. Explicit unsupported response;
          // no granted permission, provider forwarding or connector override.
          return Promise.reject(Object.assign(new Error("Optional wallet permissions unsupported in isolated fixture"), { code: 4200 }));
        }
        if (["eth_accounts", "eth_requestAccounts"].includes(packet.method)) {
          assert(!packet.params || packet.params.length === 0);
          if (packet.method === "eth_requestAccounts") fixtureWalletConnected = true;
          return fixtureWalletConnected ? [wallet] : [];
        }
        if (packet.method === "eth_chainId") { assert(!packet.params || packet.params.length === 0); return "0x4cef52"; }
        assert.equal(packet.method, "eth_signTypedData_v4", "No raw transaction, personal sign, send, provider RPC or chain-switch API");
        assert.equal(packet.params?.length, 2); assert.equal(String(packet.params![0]).toLowerCase(), wallet);
        const raw = packet.params![1]; assert.equal(typeof raw, "string"); assert((raw as string).length <= 4096);
        const typed = JSON.parse(raw as string);
        assert.deepEqual(Object.keys(typed).sort(), ["domain", "message", "primaryType", "types"]);
        assert.deepEqual(typed.domain, { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: gateway.toLowerCase() });
        assert.equal(typed.primaryType, "TransferWithAuthorization");
        assert.deepEqual(typed.types, {
          EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
          TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }],
        });
        const message = typed.message;
        assert.deepEqual(Object.keys(message).sort(), ["from", "nonce", "to", "validAfter", "validBefore", "value"]);
        assert.equal(message.from.toLowerCase(), wallet); assert.equal(message.to.toLowerCase(), seller.toLowerCase());
        assert.equal(String(message.value), price); assert(BigInt(message.value) <= BigInt(1_000_000));
        assert(/^0x[a-f0-9]{64}$/.test(message.nonce));
        assert(/^\d+$/.test(String(message.validAfter)) && /^\d+$/.test(String(message.validBefore)));
        const now = Math.floor(Date.now() / 1000);
        assert(Number(message.validAfter) >= now - 610 && Number(message.validAfter) <= now - 590);
        assert(Number(message.validBefore) >= now + 691190 && Number(message.validBefore) <= now + 691200);
        const queryId = `a2a_${sha(["keryx-a2a-v2", "eip155:5042002", wallet, seller.toLowerCase(), message.nonce].join("|"))}`;
        assert(!recoveryIds.has(queryId)); recoveryIds.add(queryId);
        assert(signedFixtures.length < 1 && fixtureSignatures < 16, "One isolated signature per context, sixteen overall");
        // Real request remains pending while a synthetic durable account tuple changes.
        // Cleanup always releases it. No hook, original nonce or transaction substitution.
        if (checkout.holdSign) {
          signWaiting = true;
          await _source.page.evaluate(() => { (window as unknown as { job257Wallet: { signWaiting: boolean } }).job257Wallet.signWaiting = true; });
          await new Promise<void>(done => { releaseSign = done; });
          signWaiting = false; releaseSign = undefined;
        }
        const signInput = { ...typed, message: { ...message, value: BigInt(message.value), validAfter: BigInt(message.validAfter), validBefore: BigInt(message.validBefore) } };
        const signature = await testWallet.signTypedData(signInput);
        assert.equal((await recoverTypedDataAddress({ ...signInput, signature })).toLowerCase(), wallet);
        fixtureSignatures++; signedFixtures.push({ typed, signature, queryId }); return signature;
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); throw error; }
    });
    // Ordinary provider discovery, not connected state, cookies, React hooks or
    // a replaced wallet module. All requests use the capped fixture binding.
    await context.addInitScript(() => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      (window as unknown as { job257Wallet: unknown }).job257Wallet = { signWaiting: false };
      const provider = {
        async request(packet: { method: string; params?: unknown[] }) {
          return (window as unknown as { job257FixtureRequest(packet: unknown): Promise<unknown> }).job257FixtureRequest(packet);
        },
        on(name: string, handler: (...args: unknown[]) => void) {
          if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(handler);
        },
        removeListener(name: string, handler: (...args: unknown[]) => void) { listeners.get(name)?.delete(handler); },
      };
      const detail = { info: { uuid: "0f07a231-28a1-4e37-91f8-89d11e501257", name: "Isolated 257 test wallet",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.keryx.isolated257" }, provider };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
      window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    });
  }
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    // Only the observed synthetic actor's unfunded USDC balance read is fulfilled locally.
    // No provider contact, signature, transaction, allowance, settlement or other RPC is admitted.
    if (url.href === "https://rpc.testnet.arc.network/") {
      try {
        assert.equal(request.method(), "POST");
        const body = request.postData(); assert(body !== null && Buffer.byteLength(body) <= 2048);
        const rpc = JSON.parse(body);
        assert.deepEqual(Object.keys(rpc).sort(), ["id", "jsonrpc", "method", "params"]);
        assert.equal(rpc.jsonrpc, "2.0"); assert(Number.isSafeInteger(rpc.id) && rpc.id >= 0 && rpc.id <= 2048);
        assert.equal(rpc.method, "eth_call");
        assert.deepEqual(rpc.params, [{ data: "0x70a08231" + "0".repeat(24) + address.slice(2).toLowerCase(), to: "0x3600000000000000000000000000000000000000" }, "latest"]);
        assert(++fixtureBalanceReads <= 16, "Bounded synthetic balance reads only");
        observations.push({ fixture: "unfunded-usdc-balance-read", context: contextSerial, count: fixtureBalanceReads });
        await route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x" + "0".repeat(64) }) });
      } catch (error) { failures.push(String(error)); await route.abort("blockedbyclient"); }
      return;
    }
    if (url.origin !== origin && !(checkout?.external && url.origin === loopback)) {
      assert(externalAttempts.length < 256); externalAttempts.push(`${request.method()} ${url.origin}`); await route.abort("blockedbyclient"); return;
    }
    try {
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
      assert(calls.length < 256); calls.push({ method: request.method(), path: url.pathname + url.search, body: request.postData() });
      if (url.pathname === "/api/models" || url.pathname === "/api/research/availability") {
        assert.equal(request.method(), "GET"); assert.equal(url.search, ""); assert.equal(request.postData(), null);
        await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
      }
      if (url.pathname === "/api/ask/visibility") {
        assert.equal(url.origin, displayOrigin); assert.equal(request.method(), "GET");
        assert.equal(url.search, ""); assert.equal(request.postData(), null);
        await json({ wallet: signedIn ? address : null, defaultVisibility: "public", privacyActive: true }); return;
      }
      if (url.pathname === session) {
        assert.equal(request.method(), "GET"); assert.equal(url.search, "");
        await json({ session: signedIn ? { address, role: "asker" } : null }); return;
      }
      if (url.pathname === "/api/auth/sessions") {
        assert.equal(request.method(), "GET"); assert.equal(url.search, "");
        await json({ sessions: signedIn ? [{ id: sessionId, issuedAt, expiresAt, current: true }] : [], truncated: false }); return;
      }
      if (url.pathname === "/api/agent/ask") {
        if (checkout && request.method() === "POST") {
          assert.equal(url.href, `${origin}/api/agent/ask`);
          const payment = request.headers()["payment-signature"];
          if (!payment) {
            assert(request.postData() === requestBody || request.postData() === changedQuestionRequestBody,
              "Only the two authored question bodies can request an unsigned preparation");
            assert(++unsignedQuotes <= 4, "At most three explicit preparations plus the original purchase quote");
            assert.equal(request.headers()["x-keryx-account-job"], undefined); assert.equal(request.headers().cookie, undefined);
            assert.equal(request.headers().authorization, undefined);
            await route.fulfill({ status: 402, contentType: "application/json", headers: { "Cache-Control": "no-store",
              "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [{
                scheme: "exact", network: "eip155:5042002", asset, amount: price, payTo: seller, maxTimeoutSeconds: 691200,
                extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: gateway },
              }] })).toString("base64") }, body: "{}" }); return;
          }
          assert.equal(request.postData(), requestBody, "The signed dispatch retains the exact original request");
          assert.equal(signedFixtures.length, 1); assert(payment.length < 4096);
          const decoded = JSON.parse(Buffer.from(payment, "base64").toString("utf8")), signed = signedFixtures[0];
          assert.deepEqual(Object.keys(decoded).sort(), ["authorization", "signature"]);
          assert.equal(decoded.signature, signed.signature);
          assert.deepEqual({ ...decoded.authorization, from: decoded.authorization.from.toLowerCase(), to: decoded.authorization.to.toLowerCase() }, { ...signed.typed.message,
            value: String(signed.typed.message.value), validAfter: String(signed.typed.message.validAfter), validBefore: String(signed.typed.message.validBefore) });
          signed.dispatchedAuthorization = decoded.authorization;
          assert.equal(unsignedQuotes, 4, "Three explicit preparations and the unchanged purchase quote precede dispatch");
          assert.equal(calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 5, "Exactly four unsigned quotes and one signed synthetic dispatch");
          await json({ error: "Synthetic seller unavailable; no settlement, receipt or owner association" }, 503); return;
        }
        assert.equal(request.method(), "GET", "No synthetic signed POST is fabricated");
        if (checkout && recoveryIds.has(url.searchParams.get("queryId") ?? "")) {
          assert.equal(url.search, `?queryId=${url.searchParams.get("queryId")}`);
          assert.equal(request.headers()["x-keryx-account-job"], undefined); assert.equal(request.headers().cookie, undefined);
          await json({ error: "Synthetic unknown original; never repay" }, 404); return;
        }
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
      if (checkout && url.pathname === "/api/session/credit") {
        assert.equal(request.method(), "GET"); assert.equal(url.search, `?address=${url.searchParams.get("address")}`); assert.equal(url.searchParams.get("address")?.toLowerCase(), wallet);
        assert.equal(request.headers()["x-keryx-account-job"], undefined); assert.equal(request.headers().cookie, undefined);
        if (checkout.credit === "unknown") await json({ error: "Synthetic credit unknown" }, 503);
        else await json({ status: "known", address: wallet, network: "eip155:5042002", available: checkout.credit === "insufficient" ? "0" : price });
        return;
      }
      if (url.pathname === "/api/me/private-jobs/history") {
        assert.equal(request.method(), "POST"); assert.deepEqual(request.postDataJSON(), { cursor: null });
        await json({ error: "Synthetic incidental history unavailable" }, 503); return;
      }
      if (["/api/me/locale-preference", "/api/payments", "/api/sources", "/maintenance/status"].includes(url.pathname)) {
        assert.equal(request.method(), "GET");
        if (url.pathname === "/api/payments") assert(["", "?limit=50"].includes(url.search));
        else if (url.pathname === "/api/sources") assert(["", "?limit=20"].includes(url.search));
        else assert.equal(url.search, "");
        await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
      }
      // Only the two actually observed incidental prefetch tuples are added.
      // Different query/token/header variants remain failures, never API/page fallback.
      if (url.pathname === "/api/docs" || (url.pathname === "/research" && url.search === "?_rsc=6he08rOtjDm7z2VJ")) {
        assert.equal(request.method(), "GET"); assert.equal(request.postData(), null);
        assert.equal(url.origin, displayOrigin);
        const h = request.headers();
        assert.equal(h["rsc"], "1"); assert.equal(h["next-router-prefetch"], "1"); assert.equal(h["next-url"], "/research");
        if (url.pathname === "/api/docs") {
          assert.equal(url.search, "?_rsc=fcIHXZ5rsQhtphpf");
          assert.equal(h["next-router-segment-prefetch"], "/_tree"); assert.equal(h["next-router-state-tree"], undefined);
        } else {
          assert.equal(h["next-router-state-tree"], "%5B%22%22%2C%7B%7D%2Cnull%2C%22metadata-only%22%5D");
          assert.equal(h["next-router-segment-prefetch"], undefined);
        }
        await route.fulfill({ status: 503, headers: { "Cache-Control": "no-store" }, body: "Synthetic prefetch unavailable" }); return;
      }
      assert(!url.pathname.startsWith("/api/"), `Unknown API blocked: ${url.pathname}`);
      assert.equal(request.method(), "GET");
      // Incidental link prefetch is refused locally, never forwarded or rendered.
      if (request.headers()["next-router-prefetch"] === "1" && url.pathname !== "/research" && !assetPaths.has(url.pathname)) {
        await route.fulfill({ status: 503, body: "Synthetic prefetch unavailable" }); return;
      }
      assert.equal(url.origin, displayOrigin);
      assert(url.pathname === "/research" ? pageQueries.has(url.search) : assetPaths.has(url.pathname) && url.search === "",
        `Unknown page/asset blocked: ${url.pathname}${url.search}`);
      const headers = new Headers();
      for (const name of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url"])
        if (request.headers()[name]) headers.set(name, request.headers()[name]);
      const response = await nativeFetch(`${loopback}${url.pathname}${url.search}`, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
      assert(Number(response.headers.get("content-length") ?? 0) <= 8_388_608);
      const reader = response.body?.getReader(); assert(reader);
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break;
        size += next.value.length; assert(size <= 8_388_608); chunks.push(next.value);
      } } finally { await reader.cancel(); reader.releaseLock(); }
      const responseHeaders = Object.fromEntries(response.headers.entries());
      delete responseHeaders["content-encoding"]; delete responseHeaders["content-length"]; // fetch decoded body; ship CSP/auth headers unchanged.
      await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.concat(chunks) });
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); await route.abort("failed"); }
  });
  return { context, fixture, calls, signedFixtures, providerMethods, requestBody, changedQuestionRequestBody, price, displayOrigin,
    signWaiting() { return signWaiting; }, releaseSigner() { assert(releaseSign, "Actual injected sign request pending"); releaseSign(); },
    cleanupSigner() { releaseSign?.(); },
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
  s.cleanupSigner();
  try { await closeContext(s.context); }
  catch (error) { process.exitCode = 1; throw failed ? new AggregateError([original, error], "Control and context cleanup failed") : error; }
  if (failed) throw original;
}
const checkoutPanel = (page: Page) => page.getByRole("heading", { name: checkoutCopy["researchCheckout.title"], exact: true }).locator("..");
const ownerConsent = (page: Page) => checkoutPanel(page).getByRole("checkbox", { name: ownerCopy.consent, exact: true });
async function waitConsent(page: Page, enabled: boolean) {
  await page.waitForFunction(({ label, enabled }) => [...document.querySelectorAll("label")].some(node => {
    const input = node.querySelector("input"); return node.textContent?.trim() === label && input?.disabled === !enabled;
  }), { label: ownerCopy.consent, enabled });
}
async function openPreparation(s: Awaited<ReturnType<typeof scenario>>, mode: "quick" | "deep") {
  const page = await s.context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(10000);
  // The real main519 entry requires an unsigned quote before checkout exists.
  const response = await page.goto(`${s.displayOrigin}/research?mode=${mode}&budget=0.03`); assert.equal(response?.status(), 200);
  assert.equal(new URL(page.url()).origin, s.displayOrigin);
  assert.equal(await page.evaluate(() => window.isSecureContext && !!crypto.subtle), true);
  assert.equal(await checkoutPanel(page).count(), 0, "No checkout or wallet selection before an explicit preparation");
  assert.equal(await ownerConsent(page).count(), 0);
  await page.locator("#research-question").fill("Explain isolated durable recovery");
  await page.getByRole("button", { name: entryCopy["pricing.checkout"], exact: true }).click();
  return page;
}
async function openCheckout(s: Awaited<ReturnType<typeof scenario>>, mode: "quick" | "deep") {
  assert.equal(s.displayOrigin, origin, "External-origin case exercises preparation refusal without mounting checkout");
  const page = await openPreparation(s, mode);
  const panel = checkoutPanel(page);
  await panel.waitFor();
  await panel.getByRole("button", { name: "Isolated 257 test wallet", exact: true }).click();
  const review = panel.getByRole("button", { name: checkoutCopy["researchCheckout.reviewPrice"].replace("{amount}", mode === "quick" ? "0.05" : "0.08"), exact: true });
  await review.click();
  await waitConsent(page, s.displayOrigin === origin);
  assert.equal(await ownerConsent(page).isChecked(), false, "Separate ownership consent defaults false for each fresh request");
  assert.equal(await panel.getByRole("checkbox", { name: checkoutCopy["researchCheckout.consent"], exact: true }).isChecked(), false);
  return { page, panel, review };
}
async function inspectJournal(page: Page, id: string) {
  // Observe the real unchanged browser journal. No inserted row, storage shim,
  // claim override or signature persistence. Self-contained unnamed callbacks.
  return page.evaluate(id => new Promise<any>((done, fail) => {
    const opened = indexedDB.open("keryx-buyer-jobs-v1");
    opened.onerror = [() => fail(opened.error)][0];
    opened.onsuccess = [() => {
      const db = opened.result, transaction = db.transaction("jobs", "readonly"), request = transaction.objectStore("jobs").get(id);
      let row: unknown;
      request.onsuccess = [() => { row = request.result; }][0];
      transaction.oncomplete = [() => { db.close(); done(row); }][0];
      transaction.onabort = [() => { db.close(); fail(transaction.error); }][0];
    }][0];
  }), id);
}
async function finishPurchase(page: Page, s: Awaited<ReturnType<typeof scenario>>, ownedPurchase: boolean, mode: "quick" | "deep") {
  const panel = checkoutPanel(page);
  if (ownedPurchase) await ownerConsent(page).check();
  await panel.getByRole("checkbox", { name: checkoutCopy["researchCheckout.consent"], exact: true }).check();
  const downloaded = page.waitForEvent("download", { timeout: 10000 });
  await panel.getByRole("button", { name: checkoutCopy["researchCheckout.buy"].replace("{amount}", mode === "quick" ? "0.050000" : "0.080000"), exact: true }).click();
  const recovery = await downloaded; // Original onPrepared download occurs before original sign policy.
  assert.equal(await recovery.failure(), null);
  return recovery;
}
try {
  await mkdir(run); await mkdir(fixture); // Exclusive runtime, never overwrite old captures.
  compiledCopyProof = copyStock(dist, join(fixture, ".next"), stockQualification);
  await cp(join(root, "public"), join(fixture, "public"), { recursive: true, dereference: true, force: false, errorOnExist: true });
  assert.deepEqual(compiledCopyProof.compiledPins, compiledPins,
    "Owned runtime copy begins as exact admitted current compiled bytes");
  await copyNextConfigFixture(root, fixture);
  await symlink(join(root, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(join(fixture, "data"));
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", NODE_OPTIONS: "", BASE_URL: origin,
    NEXT_TELEMETRY_DISABLED: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "0",
    // Fixed public content-encryption fixture key; never account or payment authority.
    CONTENT_MASTER_KEY: "11".repeat(32),
    SELLER_ADDRESS: seller, AGENT_FUNDER_PRIVATE_KEY: sellerKey,
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
    KERYX_RPC_WS_URL: "", TEMP: join(output, "temp"), TMP: join(output, "temp"), TSX_CACHE_DIR: join(output, "tsx-cache") };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"])
    if (previousEnvironment[name]) environment[name] = previousEnvironment[name];
  for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, environment); process.chdir(fixture);
  globalThis.fetch = () => { throw new Error("No compiled-server outbound fetch, including loopback/provider/search/payment"); };
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
      if (!selected(`${mode}-${kind}-${width}:detail-control`)) continue;
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
          "Unconnected detail context has no reviewed checkout; absence is separate from consent controls");
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
    if (!selected(`five-second-${hold}-bound-and-next-read`)) continue;
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
    if (!selected(`${loss}-native-auth-loss-late-body`)) continue;
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
  if (selected("exact-durable-tuple-rechecked-after-body-without-auth-hint")) {
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
  // Separate actual-route controls. Detail results above are never purchase,
  // native signed-cookie, new28 route-admission or financial acceptance.
  for (const width of [360, 1366]) for (const mode of ["quick", "deep"] as const) for (const associate of [false, true]) {
    if (!selected(`${mode}-${associate ? "opted-in" : "anonymous"}-${width}:compiled-synthetic-consent-and-get-only-recovery`)) continue;
    const s = await scenario(width, mode, "failed", {});
    await using(s, async () => {
      const { page, panel, review } = await openCheckout(s, mode);
      await ownerConsent(page).check(); assert.equal(await ownerConsent(page).isChecked(), true);
      await review.click(); assert.equal(await ownerConsent(page).isChecked(), false, "Fresh price review clears one-shot consent");
      await ownerConsent(page).check();
      await panel.getByRole("button", { name: ownerCopy.refresh, exact: true }).click();
      await waitConsent(page, true); assert.equal(await ownerConsent(page).isChecked(), false, "Refreshing durable session clears consent");
      await ownerConsent(page).check();
      await page.locator("#research-question").fill("A separately reviewed new question");
      await panel.waitFor({ state: "detached" });
      assert.equal(await ownerConsent(page).count(), 0, "A changed question unmounts the prior ownership consent");
      assert.equal(await review.count(), 0, "A changed question cannot reuse its prior checkout review");
      await page.getByRole("button", { name: entryCopy["pricing.checkout"], exact: true }).click();
      await panel.waitFor(); await review.click(); await waitConsent(page, true);
      assert.equal(await ownerConsent(page).isChecked(), false, "New request never inherits prior checked consent");
      assert.equal(await panel.getByRole("checkbox", { name: checkoutCopy["researchCheckout.consent"], exact: true }).isChecked(), false);
      await page.locator("#research-question").fill("Explain isolated durable recovery");
      await panel.waitFor({ state: "detached" });
      assert.equal(await ownerConsent(page).count(), 0, "Restoring question text cannot restore an accepted quote or consent");
      assert.equal(await review.count(), 0);
      await page.getByRole("button", { name: entryCopy["pricing.checkout"], exact: true }).click();
      await panel.waitFor(); await review.click(); await waitConsent(page, true);
      assert.equal(await ownerConsent(page).isChecked(), false, "Restored original request requires fresh ownership consent");
      assert.equal(await panel.getByRole("checkbox", { name: checkoutCopy["researchCheckout.consent"], exact: true }).isChecked(), false);
      const before = s.calls.length;
      await finishPurchase(page, s, associate, mode);
      await panel.getByRole("status").getByText(checkoutCopy["researchCheckout.uncertain"], { exact: true }).waitFor();
      assert.equal(s.signedFixtures.length, 1);
      const calls = await page.evaluate(() => (window as FixtureWindow).job257.state.calls);
      const posts = calls.filter(call => call.destination === "https://keryx.cc/api/agent/ask" && call.method === "POST");
      assert.equal(posts.length, 5); // Three preparations + original purchase quote + ONE intercepted signed request.
      assert.deepEqual(posts.map(post => post.body), [s.requestBody, s.changedQuestionRequestBody, s.requestBody, s.requestBody, s.requestBody]);
      for (const post of posts) assert.equal(post.redirect, "error");
      for (const post of posts.slice(0, 4)) {
        assert.equal(new Headers(post.headers).has("payment-signature"), false);
        assert.equal(new Headers(post.headers).has("x-keryx-account-job"), false);
        assert.equal(new Headers(post.headers).has("authorization"), false);
        assert.equal(post.credentials, "omit");
      }
      assert.equal(new Headers(posts[4].headers).has("payment-signature"), true);
      assert.equal(posts[4].credentials, associate ? "same-origin" : "omit");
      assert.equal(new Headers(posts[4].headers).get("x-keryx-account-job"), associate ? "associate" : null);
      const paid = s.calls.slice(before).filter(call => call.method === "POST" && call.path === "/api/agent/ask");
      assert.equal(paid.length, 2);
      if (associate) assert(s.calls.slice(before).filter(call => call.path === "/api/auth/sessions").length >= 8,
        "Unchanged four durable tuple assertions run before/after signing and immediately before ownership dispatch");
      const signed = s.signedFixtures[0], row = await inspectJournal(page, signed.queryId);
      assert.equal(row.origin, "created"); assert.equal(row.submission, "submission_possible");
      assert.equal(JSON.stringify(row.intent.request), s.requestBody);
      assert.equal(row.intent.authorization.nonce, signed.typed.message.nonce);
      assert.deepEqual(row.intent.authorization, signed.dispatchedAuthorization, "Byte-value original authorization is unchanged from actual journal to intercepted dispatch");
      assert.equal(JSON.stringify(row).includes('"signature"'), false); assert.equal(JSON.stringify(row).includes("accountConsent"), false);
      assert.equal(row.acknowledgement.httpStatus, 503); assert.equal(row.acknowledgement.evidence, null, "Unavailable synthetic seller never creates settlement evidence");
      assert.equal(await ownerConsent(page).count(), 0, "Purchase review clears after consumed uncertain dispatch");
      await page.getByRole("button", { name: words["savedResearch.refreshJob"], exact: true }).click();
      await page.getByText(words["savedResearch.notFoundUncertain"], { exact: true }).waitFor();
      assert.equal(s.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 5);
      await page.reload();
      assert.equal(await checkoutPanel(page).count(), 0, "Reload never restores a prepared checkout without a fresh quote");
      assert.equal(await ownerConsent(page).count(), 0);
      await page.getByRole("button", { name: /Explain isolated durable recovery/ }).click();
      await page.getByText(words["savedResearch.notFoundUncertain"], { exact: true }).waitFor();
      assert.equal(s.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 5, "Reload/recovery never quote, sign or repay");
      assert.equal(s.signedFixtures.length, 1);
      const recovered = await page.evaluate(() => (window as FixtureWindow).job257.state.calls);
      for (const get of recovered.filter(call => call.path === `/api/agent/ask?queryId=${signed.queryId}`)) {
        assert.equal(get.method, "GET"); assert.equal(get.credentials, "omit"); assert.equal(get.redirect, "error");
        assert.equal(new Headers(get.headers).has("x-keryx-account-job"), false); assert.equal(new Headers(get.headers).has("payment-signature"), false);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(run, `${mode}-${associate ? "opted-in" : "anonymous"}-${width}-checkout.png`), fullPage: true });
      results.push(`${mode}-${associate ? "opted-in" : "anonymous"}-${width}:compiled-synthetic-consent-and-get-only-recovery`);
    });
  }
  for (const loss of ["logout", "replacement", "foreign"] as const) {
    if (!selected(`${loss}:compiled-post-sign-durable-refusal-without-anonymous-fallback`)) continue;
    const s = await scenario(1366, "quick", "failed", { holdSign: true });
    await using(s, async () => {
      const { page, panel } = await openCheckout(s, "quick");
      await finishPurchase(page, s, true, "quick");
      await page.waitForFunction(() => (window as unknown as { job257Wallet: { signWaiting: boolean } }).job257Wallet.signWaiting);
      assert(s.signWaiting());
      if (loss === "logout") s.logout(); else if (loss === "replacement") s.replace(); else s.foreign();
      s.releaseSigner(); // No auth notice: the ORIGINAL post-sign durable check must reject changed authority.
      await panel.getByRole("status").getByText(checkoutCopy["researchCheckout.stopped"], { exact: true }).waitFor();
      assert.equal(s.signedFixtures.length, 1);
      const posts = await page.evaluate(() => (window as FixtureWindow).job257.state.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask"));
      assert.equal(posts.length, 2, "Only preparation and purchase quotes; opt-in refusal never falls back to anonymous signed dispatch");
      assert.equal(s.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 2);
      for (const post of posts) {
        assert.equal(post.body, s.requestBody); assert.equal(post.credentials, "omit"); assert.equal(post.redirect, "error");
        assert.equal(new Headers(post.headers).has("payment-signature"), false);
        assert.equal(new Headers(post.headers).has("x-keryx-account-job"), false);
        assert.equal(new Headers(post.headers).has("authorization"), false);
      }
      const row = await inspectJournal(page, s.signedFixtures[0].queryId);
      assert.equal(row.submission, "prepared"); assert.equal(row.acknowledgement, undefined);
      results.push(`${loss}:compiled-post-sign-durable-refusal-without-anonymous-fallback`);
    });
  }
  for (const credit of ["unknown", "insufficient"] as const) {
    if (!selected(`${credit}:compiled-credit-refusal-before-sign-or-paid-dispatch`)) continue;
    const s = await scenario(360, "quick", "failed", { credit });
    await using(s, async () => {
      const { page, panel } = await openCheckout(s, "quick");
      await ownerConsent(page).check();
      await panel.getByRole("checkbox", { name: checkoutCopy["researchCheckout.consent"], exact: true }).check();
      await panel.getByRole("button", { name: checkoutCopy["researchCheckout.buy"].replace("{amount}", "0.050000"), exact: true }).click();
      await panel.getByRole("status").getByText(checkoutCopy[credit === "unknown" ? "researchCheckout.stopped" : "researchCheckout.insufficient"], { exact: true }).waitFor();
      assert.equal(s.signedFixtures.length, 0); assert(!s.providerMethods.includes("eth_signTypedData_v4"));
      const posts = await page.evaluate(() => (window as FixtureWindow).job257.state.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask"));
      assert.equal(posts.length, 2, "Preparation and purchase quotes cannot authorize a paid request when credit is unavailable");
      assert.equal(s.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 2);
      for (const post of posts) {
        assert.equal(post.body, s.requestBody); assert.equal(post.credentials, "omit"); assert.equal(post.redirect, "error");
        assert.equal(new Headers(post.headers).has("payment-signature"), false);
        assert.equal(new Headers(post.headers).has("x-keryx-account-job"), false);
        assert.equal(new Headers(post.headers).has("authorization"), false);
      }
      results.push(`${credit}:compiled-credit-refusal-before-sign-or-paid-dispatch`);
    });
  }
  if (selected("external-loopback:compiled-fixed-origin-consent-unavailable-no-purchase")) {
    const s = await scenario(1366, "quick", "failed", { external: true });
    await using(s, async () => {
      const page = await openPreparation(s, "quick");
      await page.getByRole("status").getByText(checkoutCopy["researchCheckout.quoteChanged"], { exact: true }).waitFor();
      assert.equal(await checkoutPanel(page).count(), 0, "CSP-refused preparation never mounts checkout");
      assert.equal(await ownerConsent(page).count(), 0, "No owner consent UI exists before successful preparation");
      assert.equal(s.signedFixtures.length, 0); assert(!s.providerMethods.includes("eth_signTypedData_v4"));
      assert.equal(s.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask").length, 0);
      const attempts = await page.evaluate(() => (window as FixtureWindow).job257.state.calls.filter(call => call.method === "POST" && call.path === "/api/agent/ask"));
      assert.equal(attempts.length, 1, "One genuine fetch attempt is blocked by CSP before any intercepted network POST");
      assert.equal(attempts[0].destination, `${origin}/api/agent/ask`); assert.equal(attempts[0].body, s.requestBody);
      assert.equal(attempts[0].credentials, "omit"); assert.equal(attempts[0].redirect, "error");
      assert.equal(new Headers(attempts[0].headers).has("payment-signature"), false);
      assert.equal(new Headers(attempts[0].headers).has("x-keryx-account-job"), false);
      assert.equal(new Headers(attempts[0].headers).has("authorization"), false);
      // Original CSP now refuses cross-origin BUYER_ENDPOINT at preparation.
      // Do not relax it or inject a quote to manufacture checkout/paid dispatch.
      results.push("external-loopback:compiled-fixed-origin-consent-unavailable-no-purchase");
    });
  }
  assert.deepEqual(results, expectedResults, "Only every selected original control, in order; no skip-as-PASS");
  assert.deepEqual(await pinSources(), sourcePins); assertStockUnchanged(dist, stockQualification); assert.deepEqual(stockPins(stockQualification), compiledPins); assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []);
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
    assertStockUnchanged(dist, stockQualification);
    assert.deepEqual(stockPins(stockQualification), compiledPins, "Parent dist remains unchanged even on failed controls");
  } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  Socket.prototype.connect = nativeConnect; globalThis.fetch = nativeFetch;
  try { process.chdir(previousCwd); for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment); }
  catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  try {
    await writeFile(join(run, "outcome.json"), JSON.stringify({ status: cleanupFailures.length || mainFailed ? "FAILED" : "COMPILED_SYNTHETIC_SELECTED_CONTROLS_PASSED", selection, whole54Acceptance: false,
      scope: "Selected original controls only; other cases NOT RUN in this invocation. Actual compiled Next detail and consent UI/hooks with unchanged signer/journal policy; synthetic APIs and isolated typed signatures only. Native new28, genuine auth/owner admission, paid latency and settlement remain OPEN.",
      containment: { externalContinued: 0, realProviderCalls: 0, realSearchCalls: 0, realPaidApiCalls: 0, realFundingCalls: 0,
        fixtureSignatures, maximumFixtureSignatures: 16 },
      buildId, sourcePins, compiledPins, compiledCopyProof, admissionPath, buildEvidence: admission.buildEvidence, readOnlyDistProof: admission.readOnlyDistProof, coverage, results, observations, httpRequests, failures, pageErrors, externalAttempts,
      naturalClose: { browserClosed, httpDrained, instrumentationClosed, appClosed, tracesFlushed,
        processExitObserved: null, stdoutEofObserved: null, stderrEofObserved: null },
      error: mainFailure instanceof Error ? { name: mainFailure.name, message: mainFailure.message, stack: mainFailure.stack } : mainFailed ? String(mainFailure) : null,
      cleanupFailures: cleanupFailures.map(error => error instanceof Error ? { message: error.message, stack: error.stack } : String(error)),
      note: "Parent captures actual process exit/close/EOF. No forced exit, kill, retry, build or native acceptance." }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { process.exitCode = 1; cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures, "Compiled job257 natural close failed");
  if (mainFailed) throw mainFailure;
}
console.log("Selected compiled job257 synthetic controls completed; no whole54 acceptance. Native new28 and original257 financial/customer gates remain OPEN.");
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
