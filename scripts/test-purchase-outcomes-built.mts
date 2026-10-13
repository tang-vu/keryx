/** Actual built public API/report/CSS in a fresh ordinary SQLite fixture. No provider/funds. */
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { assertPurchaseOutcomePrivacy } from "../test-support/purchase-outcome-privacy";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import type { QueryRun } from "../lib/types";
import { config } from "../lib/config";
import { projectPurchaseOutcomes } from "../lib/research/purchase-outcomes-projector";
import { validatePurchaseOutcomes } from "../lib/research/purchase-outcomes-contract";
import { validatePurchaseAggregate } from "../lib/research/purchase-outcome-aggregate";
import { createTrustedUsageContext, newRunUsage } from "../lib/research/usage-provenance";
import { purchaseAggregateMessages as aggregateCopy } from "../locales/en/purchase-outcome-aggregate";
import copy from "../locales/en/purchase-outcomes.json" with { type: "json" };

assert.equal(config.networkId, "eip155:5042002"); assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8");
const fixture = join(source, ".artifacts", `purchase-outcomes-built-${randomUUID()}`);
await mkdir(join(fixture, "lib"), { recursive: true }); await mkdir(join(fixture, "data"));
await copyNextConfigFixture(source, fixture);
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const retained = JSON.parse(await readFile(join(source, "fixtures/purchase-outcomes/retained-testnet.json"), "utf8"));
const { archive: _archive, ...snapshot } = retained.snapshot;
// This is an explicit isolated replay of minimized real inputs, not enrollment of
// the frozen archive or a new live settlement assertion.
const run: QueryRun = { ...snapshot, question: "Synthetic public replay of retained purchase inputs", budget: 0,
  engine: "heuristic", subClaims: [], totalSpent: 0, totalToCreators: 0, paymentMode: "offline",
  // The new local records are explicitly scripted; neither replayed settlement shapes
  // nor this annotation attest fresh settlement, outside ownership or independent use.
  usage: newRunUsage({ usageContext: createTrustedUsageContext("eip155:5042002",
    { actor: "unknown", funding: "unknown", scripted: true }) }, "eip155:5042002", []),
  decisions: snapshot.decisions.map((row: object) => ({ ...row, sourceName: "Public fixture source", rationale: "Retained fixture decision" })) };
const sqlite = new SqliteAdapter(join(fixture, "data/keryx.sqlite")); await sqlite.init(); await sqlite.saveQueryRun(run);
const empty = { ...run, id: randomUUID(), decisions: [], citations: [], trace: [] }; await sqlite.saveQueryRun(empty);
const incomplete = { ...run, id: randomUUID(), answer: "" }; await sqlite.saveQueryRun(incomplete);
assert(sqlite.decisionReviews);
await sqlite.decisionReviews.capture(`0x${"a".repeat(40)}`, { policyVersion: "captured-owner-decisions-v1", runId: run.id,
  round: 0, ordinal: 0, engine: "synthetic", requestedModel: null, sourceName: "PRIVATE SIDECAR SOURCE", modelAction: "BUY", codeAction: "SKIP", codeRule: "budget",
  reviewFirst: false, cohort: "unknown", cohortEvidence: null,
  terms: { assetId: "private-asset", sourceId: "private-source", owned: true, network: "eip155:5042002", payTo: `0x${"b".repeat(40)}`,
    priceMicroUsdc: "1000", listPriceMicroUsdc: "1000", citationBudgetMicroUsdc: "5000" } });
const original = JSON.stringify(await sqlite.getQueryRun(run.id));
const privateFixtureValues = [run.question, ...run.decisions.map(decision => decision.rationale),
  "PRIVATE SIDECAR SOURCE", "private-asset", "private-source", `0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`];
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address(); assert(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const origin = `http://127.0.0.1:${port}`;
const environment = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  NODE_ENV: "production", BASE_URL: origin, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_EXTERNAL_DISCOVERY: "0", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
const log = openSync(join(fixture, "server.log"), "a"), child = spawn(process.execPath,
  [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: fixture, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
let didExit = false, startupError: Error | undefined;
const stopped = new Promise<void>(resolve => child.once("exit", () => { didExit = true; resolve(); })); child.once("error", error => { startupError = error; });
const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), milliseconds);
  void stopped.then(() => { clearTimeout(timer); resolve(true); }); });
const request = (path: string, init: RequestInit = {}) => { assert.equal(new URL(origin + path).origin, origin);
  return fetch(origin + path, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8000) }); };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const path = `/api/dispatch/${run.id}/purchase-outcomes`; let ready = false;
  for (let tries = 0; tries < 80; tries++) {
    if (startupError || didExit) throw new Error("Owned built fixture could not start");
    try { if ((await request(path)).status === 200) { ready = true; break; } } catch { /* Startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, "Actual built public outcome route required");
  const response = await request(path), result = validatePurchaseOutcomes(await response.json(), run.id);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(result, projectPurchaseOutcomes(run, "eip155:5042002"));
  assertPurchaseOutcomePrivacy(result, privateFixtureValues);
  assert.equal(result.uncitedAccessMicros, "2000"); assert.equal(result.counts.scoredPurchases, 1); assert.equal(result.cohort, "unknown");
  assert.match((await request(path + "?download=1")).headers.get("content-disposition") ?? "", /attachment/);
  assert.equal((await request(path + "?network=eip155:5042")).status, 400);
  assert.equal((await request(`/api/dispatch/${randomUUID()}/purchase-outcomes`)).status, 404);
  assert.equal((await request(`/api/dispatch/${incomplete.id}/purchase-outcomes`)).status, 503);
  const pooled = await request("/api/purchase-outcomes?network=eip155:5042002");
  assert.equal(pooled.status, 200); assert.equal(pooled.headers.get("cache-control"), "no-store");
  const aggregate = validatePurchaseAggregate(await pooled.json());
  assert.equal(aggregate.network, "eip155:5042002");
  assert.deepEqual(aggregate.columns.map(row => [row.cohort, row.sampledRuns, row.scoredPurchases, row.unscorableRuns]),
    [["outside", 0, 0, 0], ["team", 0, 0, 0], ["scripted", 3, 1, 1], ["unknown", 0, 0, 0]]);
  assert.equal(aggregate.columns[2].uncitedAccessMicros, "2000");
  assertPurchaseOutcomePrivacy(aggregate, privateFixtureValues, true);
  for (const query of ["period=1y", "period=7d&period=30d", "cohort=outside", "network=eip155:1"])
    assert.equal((await request(`/api/purchase-outcomes?${query}`)).status, 400);
  const remote = await request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "keryx_purchase_outcomes", arguments: { dispatchId: run.id } } }) });
  assert.equal(remote.status, 200); const rpc = await remote.json(); assert(!rpc.result.isError);
  assert.deepEqual(validatePurchaseOutcomes(JSON.parse(rpc.result.content[0].text), run.id), result);
  const receiptResponse = await request(`/api/dispatch/${run.id}/receipt`); assert.equal(receiptResponse.status, 200);
  const receiptBefore = await receiptResponse.text();
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" }), page = await context.newPage();
    const external: string[] = [], errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => new URL(route.request().url()).origin === origin && route.request().method() === "GET"
      ? route.continue() : (external.push(route.request().url()), route.abort()));
    try {
      await page.goto(`${origin}/dispatch/${run.id}`); const panel = page.getByRole("region", { name: copy.title, exact: true });
      await panel.getByRole("heading", { name: copy.title, exact: true }).waitFor();
      await panel.getByText(copy.partialTrace, { exact: true }).waitFor();
      // The access cost is also present in the initially closed observation
      // details. Bind this assertion to its visible summary metric, not every
      // duplicate text node including hidden details.
      await panel.getByText(copy.uncitedCost, { exact: true }).locator("..").getByText("0.002 test USDC", { exact: true }).waitFor({ state: "visible" });
      await panel.getByText(copy.observations, { exact: true }).click();
      assert.equal(await panel.getByText(run.decisions.find(row => row.action === "BUY")!.contentVersion!, { exact: true }).count(), 1);
      assert.equal(await panel.getByText("PRIVATE SIDECAR SOURCE", { exact: true }).count(), 0);
      assert.equal(await panel.getByRole("link", { name: copy.viewJson, exact: true }).getAttribute("href"), path);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await panel.screenshot({ path: join(fixture, `outcome-${width}.png`) });
      await panel.getByRole("link", { name: copy.allReports, exact: true }).click();
      await page.getByRole("heading", { name: aggregateCopy.title, exact: true }).waitFor();
      await page.getByText(aggregateCopy.recordedOnly, { exact: true }).waitFor();
      await page.getByLabel(aggregateCopy.network, { exact: true }).selectOption("eip155:5042002");
      await page.getByRole("button", { name: aggregateCopy.apply, exact: true }).click();
      const sampled = page.getByRole("table", { name: aggregateCopy.cohortLimit, exact: true });
      assert.equal(await sampled.getByRole("row", { name: /^Scored purchases / }).getByRole("cell").nth(2).innerText(), "1");
      for (const [label, rule] of [aggregateCopy.rows.missed, aggregateCopy.rows.questionType]) {
        const row = sampled.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
        assert.equal(await row.count(), 1, "One visible metric row in the captioned aggregate table");
        await row.getByRole("cell", { name: rule, exact: true }).waitFor();
        assert.equal(await row.getByRole("cell", { name: aggregateCopy.unmeasured, exact: true }).count(), 4,
          "Every cohort remains explicitly unmeasured");
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(fixture, `pooled-outcome-${width}.png`) });
      await page.getByLabel(aggregateCopy.network, { exact: true }).selectOption("eip155:5042");
      await page.getByRole("button", { name: aggregateCopy.apply, exact: true }).click();
      assert.equal(await sampled.getByRole("row", { name: /^Scored purchases / }).getByRole("cell").nth(2).innerText(), "0");
      await page.goto(`${origin}/dispatch/${empty.id}`);
      await page.getByText(copy.noSample, { exact: true }).waitFor();
      assert.deepEqual(external, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  assert.equal(await (await request(`/api/dispatch/${run.id}/receipt`)).text(), receiptBefore, "Original receipt must remain byte-identical");
  assert.equal(JSON.stringify(await sqlite.getQueryRun(run.id)), original, "Original retained run must not change");
} finally {
  try { await browser?.close(); } finally {
    try { if (!didExit && child.pid !== undefined) { child.kill(); if (!await waitForExit(5000)) { child.kill("SIGKILL"); assert(await waitForExit(5000), "Owned fixture child exit required"); } } }
    finally { sqlite.close(); closeSync(log); }
  }
}
assert(didExit, "Actual owned process exit required");
console.log(JSON.stringify({ gate: "purchase-outcomes-built-public-api-report", syntheticReplay: true, actualHostedMcpPublicRead: true, pooledPageAndApi: true, privateSidecarOmitted: true,
  networkBound: true, sampleAndUnmeasured: true, immutableRunAndReceipt: true, widths: [320, 390, 768, 1366], observedChildExit: true, evidence: fixture }));
