/** Actual built routes and browser DOM; isolated ordinary SQLite and synthetic sessions only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { issueWebSession } from "../lib/auth-session";
import { decisionReviewMetricsSchema } from "../lib/research/decision-review-types";
import { decisionReviewCopy as copy } from "../lib/research/decision-review-copy";
import { config } from "../lib/config";

assert.equal(config.profile.networkId, "eip155:5042002"); assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8");
const fixture = join(source, ".artifacts", `decision-reviews-built-${randomUUID()}`);
await mkdir(join(fixture, "lib"), { recursive: true }); await mkdir(join(fixture, "data"));
for (const file of ["package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts"])
  await writeFile(join(fixture, file), await readFile(join(source, file)));
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const sqlite = new SqliteAdapter(join(fixture, "data", "keryx.sqlite")); await sqlite.init(); assert.ok(sqlite.decisionReviews);
const secret = randomBytes(32).toString("hex"), alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, runId = randomUUID();
const aliceSession = await issueWebSession(sqlite, secret, alice, "asker"), bobSession = await issueWebSession(sqlite, secret, bob, "asker");
const until = new Date(); until.setUTCHours(0, 0, 0, 0); const since = new Date(until.getTime() - 2 * 86400000), capturedAt = until.getTime() - 3600000;
const captured = { policyVersion: "captured-owner-decisions-v1" as const, engine: "synthetic", requestedModel: null, runId, round: 0, ordinal: 0,
  sourceName: "PRIVATE BUILT FIXTURE SOURCE", modelAction: "BUY" as const, codeAction: "SKIP" as const, codeRule: "budget" as const,
  reviewFirst: false, cohort: "unknown" as const, cohortEvidence: null,
  terms: { assetId: "private-fixture-asset", sourceId: "private-fixture-source", owned: true, network: "eip155:5042002" as const, payTo: bob,
    priceMicroUsdc: "1000", listPriceMicroUsdc: "1000", citationBudgetMicroUsdc: "5000" } };
const record = await sqlite.decisionReviews.capture(alice, captured, capturedAt);
const gate = await sqlite.decisionReviews.capture(alice, { ...captured, ordinal: 1, reviewFirst: true, codeAction: "BUY", codeRule: "selected" }, capturedAt);
await sqlite.decisionReviews.begin(alice, gate.id);
await sqlite.saveQueryRun({ id: runId, question: "Synthetic public fixture report", budget: 0, engine: "heuristic", subClaims: [], decisions: [], citations: [],
  answer: "Synthetic retained result. No payment or provider was requested.", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: new Date(capturedAt).toISOString(), paymentMode: "offline" });
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address(); assert.ok(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const origin = `http://127.0.0.1:${port}`;
// Whitelist process inputs: no inherited credentials, provider configuration, storage selectors or ENV files.
const environment = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  NODE_ENV: "production", JWT_SECRET: secret, BASE_URL: origin, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_EXTERNAL_DISCOVERY: "0", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
const log = openSync(join(fixture, "server.log"), "a"), child = spawn(process.execPath,
  [join(source, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: fixture, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
let didExit = false, startupError: Error | undefined;
const stopped = new Promise<void>(resolve => child.once("exit", () => { didExit = true; resolve(); })); child.once("error", error => { startupError = error; });
const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), milliseconds); void stopped.then(() => { clearTimeout(timer); resolve(true); }); });
const request = (path: string, init: RequestInit = {}) => { assert.equal(new URL(origin + path).origin, origin); return fetch(origin + path, { ...init, redirect: "error", signal: AbortSignal.timeout(8000) }); };
const owned = (method = "GET", value?: unknown, wallet = alice, token = aliceSession.token): RequestInit => ({ method,
  headers: { Cookie: `keryx_session=${token}`, Origin: origin, "X-Keryx-Expected-Wallet": wallet, ...(value === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const privatePath = `/api/me/decision-reviews?runId=${runId}`; let ready = false;
  for (let tries = 0; tries < 80; tries++) {
    if (startupError) throw new Error("Fixture server could not start", { cause: startupError }); if (didExit) throw new Error("Fixture server exited before readiness");
    try { if ((await request(privatePath, owned())).status === 200) { ready = true; break; } } catch { /* Startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Actual built private route must be ready");
  const list = await request(privatePath, owned()), text = await list.text(); assert.match(text, /PRIVATE BUILT FIXTURE SOURCE/);
  for (const [header, value] of [["cache-control", "private, no-store"], ["referrer-policy", "no-referrer"]]) assert.equal(list.headers.get(header), value);
  assert.match(list.headers.get("vary") ?? "", /Cookie/); assert.match(list.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.equal((await request(privatePath, { headers: { "X-Keryx-Expected-Wallet": alice } })).status, 401);
  assert.equal((await request(privatePath, owned("GET", undefined, alice, bobSession.token))).status, 409);
  assert.deepEqual(await (await request(privatePath, owned("GET", undefined, bob, bobSession.token))).json(), { reviews: [] });
  assert.equal((await request(privatePath, { headers: { Authorization: "Bearer synthetic", "X-Keryx-Expected-Wallet": alice } })).status, 401);
  const opinion = { id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "SKIP", rule: "budget" }, value: "disagree", reason: "PRIVATE BUILT REASON" };
  const preAuth = { method: "POST", headers: { Origin: origin, "X-Keryx-Expected-Wallet": alice, "Content-Type": "application/json" }, body: "{}" };
  assert.equal((await request("/api/me/decision-reviews", preAuth)).status, 401);
  assert.equal((await request("/api/me/decision-reviews", { ...preAuth, headers: { ...preAuth.headers, Origin: "https://foreign.example" } })).status, 403);
  assert.equal((await request("/api/me/decision-reviews", owned("POST", { id: gate.id, key: randomUUID(), context: "gate", value: "agree" }))).status, 409);
  assert.equal((await request("/api/me/decision-reviews", owned("POST", opinion, bob, bobSession.token))).status, 404);
  const saved = await request("/api/me/decision-reviews", owned("POST", opinion)); assert.equal(saved.status, 200);
  assert.equal((await saved.json()).review.verdict.reason, opinion.reason);
  assert.equal((await request("/api/me/decision-reviews", owned("POST", opinion))).status, 200);
  assert.equal((await request("/api/me/decision-reviews", owned("POST", { ...opinion, value: "agree" }))).status, 409);
  const metrics = decisionReviewMetricsSchema.parse(await (await request(`/api/decision-reviews/metrics?since=${since.toISOString()}&until=${until.toISOString()}`)).json());
  assert.equal(metrics.cohorts[3].decisions, 2); assert.equal(metrics.cohorts[3].disagrees, 1); assert.equal(metrics.cohorts[0].agreementRate, null);
  assert.doesNotMatch(JSON.stringify(metrics), /PRIVATE|private-fixture|wallet|runId|0xaaaa|reason"/);
  const ask = { question: "Synthetic question", sessionId: alice, reviewFirst: true, browserAuthorizationProtocol: "durable-v1" };
  const closedAsk = await request("/api/ask", { ...preAuth, body: JSON.stringify(ask) });
  assert.equal(closedAsk.status, 503); assert.deepEqual(await closedAsk.json(), { error: "browser_authorization_cutover_pending" });
  assert.equal(closedAsk.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await request("/api/ask", { ...preAuth, headers: { ...preAuth.headers, Origin: "https://foreign.example" }, body: JSON.stringify(ask) })).status, 409);
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" }), page = await context.newPage();
    const external: string[] = [], errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
    try {
      await page.goto(`${origin}/decision-reviews`); await page.getByRole("heading", { name: copy.metrics, exact: true }).waitFor();
      await page.getByLabel(copy.since).fill(since.toISOString().slice(0, 10)); await page.getByLabel(copy.until).fill(until.toISOString().slice(0, 10));
      await page.getByRole("button", { name: copy.loadMetrics, exact: true }).click(); await page.getByRole("table").waitFor();
      assert.equal(await page.getByText("PRIVATE BUILT FIXTURE SOURCE", { exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(fixture, `public-${width}.png`), fullPage: true });
      await context.addCookies([{ name: "keryx_session", value: aliceSession.token, url: origin }]);
      await page.goto(`${origin}/dispatch/${runId}`); await page.getByRole("button", { name: copy.load, exact: true }).waitFor();
      assert.equal(await page.getByText(captured.sourceName, { exact: true }).count(), 0);
      await page.getByRole("button", { name: copy.load, exact: true }).click(); await page.getByText(captured.sourceName, { exact: true }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(fixture, `owner-${width}.png`), fullPage: true }); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  await sqlite.revokeWebSession((await sqlite.listWebSessions(alice, Date.now()))[0].hash, alice);
  assert.equal((await request(privatePath, owned())).status, 401);
} finally {
  try { await browser?.close(); }
  finally {
    try { if (!didExit && child.pid !== undefined) { child.kill(); if (!await waitForExit(5000)) { child.kill("SIGKILL"); assert.ok(await waitForExit(5000), "Owned fixture child exit was not observed"); } } }
    finally { sqlite.close(); closeSync(log); }
  }
}
assert.ok(didExit, "Owned fixture process must have actually exited");
console.log(`Built decision reviews passed: actual owner/privacy/Origin/intent readback, closed live gate, whole private-free public counts and authenticated explicit DOM at four widths; observed child exit. Synthetic/offline only. Evidence ${fixture}`);
