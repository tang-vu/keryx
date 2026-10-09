/** Actual built API with a disposable sealed offline store; production CSS UI with intercepted positive unit evidence.
 * No existing environment, provider, wallet, settlement or shared storage is admitted. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { chromium, type Browser } from "playwright";
import { canonicalJson } from "../lib/canonical-json.ts";
import { installSqliteApplicationSchema } from "../lib/db/sqlite-application-schema.ts";
import { writeSqliteQueryRun } from "../lib/db/query-run-record.ts";
import { syntheticStorageIdentity } from "../lib/db/storage-identity-fixture.ts";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "../lib/db/storage-identity-provision.ts";
import { ledgerFixture, ledgerRun, ledgerPayment } from "../lib/operator-ledger/test-fixture.ts";
import { ledgerDigest } from "../lib/operator-ledger/projection.ts";
import { operatorLedgerCsv, verifyOperatorLedger } from "../lib/operator-ledger/export.ts";

const source = resolve(import.meta.dirname, ".."), dist = join(source, ".next");
await readFile(join(dist, "BUILD_ID"));
const temporary = await mkdtemp(join(tmpdir(), "keryx-public-job-ledger-built-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const databasePath = join(temporary, "offline.sqlite"), manifestPath = join(temporary, "deployment.json");
let browser: Browser | undefined, child: ReturnType<typeof spawn> | undefined, stopped: Promise<unknown> | undefined;
let output = "", didExit = false, startError: Error | undefined, listener: ReturnType<typeof createServer> | undefined;
try {
  await mkdir(join(temporary, "lib"));
  for (const file of ["package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts"])
    await writeFile(join(temporary, file), await readFile(join(source, file)));
  await symlink(join(source, "node_modules"), join(temporary, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await symlink(dist, join(temporary, ".next"), process.platform === "win32" ? "junction" : "dir");
  const now = Date.now(), createdAt = new Date(now - 60_000).toISOString();
  const raw = new DatabaseSync(databasePath);
  try {
    raw.exec("BEGIN IMMEDIATE"); installSqliteApplicationSchema(raw);
    writeSqliteQueryRun(raw, ledgerRun({ createdAt, paymentMode: "offline", fundingOwner: "offline", settledPayments: 0 }), false);
    const p = ledgerPayment({ createdAt, settled: false, settlementStatus: "simulated", txHash: null });
    raw.prepare(`INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,origin)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id!, p.createdAt, p.kind, p.queryId, p.sourceId, p.sourceName, p.payer, p.payee, p.amountUsdc,
        p.network, 0, "simulated", "web");
    raw.exec("COMMIT");
  } finally { raw.close(); }
  const identity = syntheticStorageIdentity("testnet-offline"), inspection = await inspectSqliteEnrollment(databasePath, identity);
  await enrollSqliteStorage(databasePath, identity, { format: "keryx-reviewed-storage-enrollment-v1", inspection,
    provenanceDocumentDigest: identity.provenanceDigest, unknownClassAttestation: inspection.unknownClasses });
  await writeFile(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath } }));
  const databaseBefore = await readFile(databasePath);
  listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const address = listener.address(); assert(address && typeof address === "object"); const port = address.port;
  await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve())); listener = undefined;
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet",
    NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0",
    KERYX_STORAGE_MANIFEST: manifestPath, KERYX_SQLITE_PATH: databasePath };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[name]) env[name] = process.env[name];
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", value => { output = (output + String(value)).slice(-6000); });
  child.stderr?.on("data", value => { output = (output + String(value)).slice(-6000); });
  stopped = new Promise<void>(resolve => child!.once("exit", () => { didExit = true; resolve(); }));
  child.once("error", error => { startError = error; });
  const read = (path: string) => fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    if (startError) throw startError;
    try { ready = (await read("/operator/ledger")).ok; } catch { /* bounded local startup only */ }
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Built ledger server unavailable: ${output}`);
  const result = await read("/api/operator/ledger?days=7"); assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store"); assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  const native = verifyOperatorLedger(await result.json(), result.headers.get("X-Keryx-Ledger-Digest")!);
  assert.equal(native.payload.jobs.length, 1); assert.equal(native.payload.jobs[0].funding, "offline");
  assert.equal(native.payload.jobs[0].legs[0].state, "simulated"); assert.equal(native.payload.entries.length, 0);
  assert.equal(native.payload.scope.coverage, "partial"); assert.equal(native.payload.position.safeSpendMicroUsdc, "0");
  assert(!/PRIVATE-CUSTOMER|PRIVATE-ANSWER|PRIVATE-RATIONALE|auth-one|payment-one/.test(JSON.stringify(native)));
  const csv = await read("/api/operator/ledger?days=7&format=csv"); assert.equal(csv.status, 200);
  assert.equal(await csv.text(), operatorLedgerCsv(native));
  for (const query of ["?wallet=private", "?network=eip155:5042", "?days=7&days=7", "?days=32"])
    assert.equal((await read("/api/operator/ledger" + query)).status, 400);
  assert.deepEqual(await readFile(databasePath), databaseBefore, "Native observation must leave the fixture DB unchanged");

  browser = await chromium.launch({ headless: true });
  const screenshots = process.env.KERYX_LEDGER_SCREENSHOT_DIR ?? join(source, ".artifacts", "public-job-ledger");
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [], widths = [390, 1280]; let browserApiRequests = 0;
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    let mode: "native" | "positive" | "tamper" | "empty" = "native";
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      assert.equal(request.method(), "GET");
      if (url.pathname === "/api/operator/ledger" && !url.searchParams.has("format") && !url.searchParams.has("download")) {
        browserApiRequests++;
        if (mode === "native") return route.continue();
        const value = mode === "empty" ? ledgerFixture([], []) : structuredClone(ledgerFixture());
        value.payload.window.days = Number(url.searchParams.get("days") ?? 7);
        value.payload.window.from = new Date(Date.parse(value.payload.window.readStartedAt) - value.payload.window.days * 86_400_000).toISOString();
        value.integrity.digest = ledgerDigest(value.payload);
        if (mode === "tamper") value.payload.entries[0].debitMicroUsdc = "1";
        return route.fulfill({ json: value, headers: { "X-Keryx-Ledger-Digest": value.integrity.digest, "cache-control": "no-store" } });
      }
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/operator/ledger") return route.fulfill({ json: {} });
      return route.continue();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    assert.equal((await page.goto(origin + "/operator/ledger"))?.status(), 200);
    await page.getByText("Offline records", { exact: true }).first().waitFor();
    await page.locator("summary").first().click(); await page.getByText("Simulated — excluded", { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const download = page.waitForEvent("download"); await page.getByText("Download balanced CSV", { exact: true }).click();
    const stream = await (await download).createReadStream(); assert(stream);
    let text = ""; for await (const chunk of stream) { text += chunk.toString(); assert(Buffer.byteLength(text) <= 2_000_000); }
    assert.equal(text, operatorLedgerCsv(native));
    mode = "positive"; await page.getByRole("button", { name: "Read again", exact: true }).click();
    await page.getByText("0.015700 USDC", { exact: true }).first().waitFor();
    await page.locator("summary").first().click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(!/PRIVATE-CUSTOMER|PRIVATE-ANSWER|PRIVATE-RATIONALE|auth-one|payment-one/.test(await page.locator("body").innerText()));
    await page.screenshot({ path: join(screenshots, `public-ledger-${width}.png`), fullPage: true });
    await page.locator("#ledger-days").selectOption("31"); await page.getByText("0.015700 USDC", { exact: true }).first().waitFor();
    mode = "tamper"; await page.getByRole("button", { name: "Read again", exact: true }).click();
    await page.getByText(/Public transfer evidence is unavailable/).waitFor();
    mode = "empty"; await page.getByRole("button", { name: "Read again", exact: true }).click();
    await page.getByText("No eligible public web dispatches were observed in this bounded slice.", { exact: true }).waitFor();
    await context.close();
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(manifestPath, "{}");
  const denied = await read("/api/operator/ledger"); assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: "Public transfer ledger unavailable" });
  assert.deepEqual(await readFile(databasePath), databaseBefore);
  console.log(JSON.stringify({ gate: "public-job-ledger-built", actualSealedNativeApi: "offline-simulated-only", dbUnchanged: true,
    unsupportedStoreRefused: true, privateSelectorsRefused: true, builtCssWidths: widths, csvDownload: true,
    positiveUiEvidence: "intercepted-unit-fixture-only", browserApiRequests, screenshots }));
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      if (child && !didExit && child.pid !== undefined) {
        child.kill();
        const wait = async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { return await Promise.race([stopped!.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000); })]); }
          finally { if (timer) clearTimeout(timer); }
        };
        if (!await wait()) { child.kill("SIGKILL"); assert(await wait(), "Built fixture child exit was not observed"); }
      }
      assert(!child || didExit || child.pid === undefined, "Built fixture must be stopped before cleanup");
    } finally {
      if (listener?.listening) await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve()));
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
console.log(JSON.stringify({ gate: "public-job-ledger-built-cleanup", observedChildExit: didExit }));
