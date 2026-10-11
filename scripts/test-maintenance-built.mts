/** Real Linux TLS ingress -> existing front door -> built Next. No canned application responses. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { createMaintenanceFrontDoor } from "../lib/maintenance/front-door";
import { readWindowControl, WINDOW_FORMAT, type PlannedWindow } from "../lib/maintenance/planned-window";
import { parseAskHttpError } from "../lib/hooks/ask-error-response";

assert.equal(process.platform, "linux", "Native Linux controls required");
assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
assert.equal(process.env.KERYX_NETWORK, "arcTestnet");
assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK, "arcTestnet");
// The hosted procedure runs in a fresh network namespace with loopback only.
assert.equal(process.env.KERYX_MAINTENANCE_REHEARSAL, "isolated-network");
assert.deepEqual((await readFile("/proc/net/dev", "utf8")).split("\n").slice(2).filter(line => line.includes(":"))
  .map(line => line.split(":")[0].trim()), ["lo"]);
const source = resolve(import.meta.dirname, ".."), dist = join(source, ".next");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim(); assert.ok(buildId);
const evidence = resolve(process.env.KERYX_MAINTENANCE_EVIDENCE ?? join(source, ".artifacts", "maintenance-built"));
await mkdir(evidence, { recursive: true });
const fixture = await mkdtemp(join(tmpdir(), "keryx-maintenance-built-"));
await mkdir(join(fixture, "data")); await mkdir(join(fixture, "control"), { mode: 0o700 });
await copyNextConfigFixture(source, fixture);
await symlink(join(source, "node_modules"), join(fixture, "node_modules"));
await symlink(dist, join(fixture, ".next"));
await symlink(join(source, "public"), join(fixture, "public"));
const control = join(fixture, "control"), marker = join(control, "window.json");
const database = join(fixture, "data", "keryx.sqlite");
const environment = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  NODE_ENV: "production", JWT_SECRET: "isolated-maintenance-rehearsal-secret-281",
  BASE_URL: "https://keryx.cc", KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_EXTERNAL_DISCOVERY: "0", NEXT_TELEMETRY_DISABLED: "1", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
const audit: { method: string; path: string }[] = [], observations: unknown[] = [], exits: unknown[] = [];
let app: ChildProcess | undefined, exited: Promise<void> | undefined, appExited = false;
let front: ReturnType<typeof createMaintenanceFrontDoor> | undefined, ingress: ReturnType<typeof httpsServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const log = openSync(join(evidence, "application.log"), "a");
let passed = false;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const proof: Record<string, unknown> = { format: "keryx-maintenance-built-rehearsal-v1", buildId,
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(),
  sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: source, encoding: "utf8" }).trim(),
  profile: "offline-arcTestnet-loopback-network-namespace", fixture, syntheticAuthorization: true, realPayment: false,
  observations, exits, productionIngressAcceptance: false };
async function publish(window: PlannedWindow) {
  const temporary = join(control, "window.next");
  await writeFile(temporary, JSON.stringify(window), { mode: 0o600, flag: "wx" }); await rename(temporary, marker);
  assert.equal(readWindowControl(control).kind, "valid");
}
function snapshot() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    const rows = tables.map(row => ({ table: row.name, rows: db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`).all()
      .map(value => JSON.stringify(value)).sort() }));
    return JSON.stringify({ schema, rows });
  } finally { db.close(); }
}
async function stopApp() {
  assert.ok(app?.pid && exited);
  if (!appExited) { app.kill("SIGTERM"); await Promise.race([exited, delay(10000, undefined, { ref: false }).then(() => { throw Error("Owned app did not drain"); })]); }
  const output = await readFile(join(evidence, "application.log"), "utf8");
  assert.match(output, /"httpDrained":true/); assert.equal(app.exitCode, 143);
}
try {
  app = spawn(process.execPath, [join(source, "scripts/test-fixtures/maintenance-built-app.mjs")],
    { cwd: fixture, env: environment, stdio: ["ignore", log, log, "ipc"] });
  exited = new Promise<void>(accept => app!.once("exit", (code, signal) => { appExited = true; exits.push({ code, signal }); accept(); }));
  const ready = new Promise<number>((accept, reject) => {
    app!.once("error", reject); app!.once("exit", () => reject(Error("Built application exited before ready")));
    app!.on("message", (packet: { kind: string; physicalPort: number; method: string; path: string }) => {
      if (packet.kind === "ready") accept(packet.physicalPort);
      if (packet.kind === "application-request") audit.push({ method: packet.method, path: packet.path });
    });
  });
  const appPort = await Promise.race([ready, delay(45000, undefined, { ref: false }).then(() => { throw Error("Built application readiness deadline"); })]);
  proof.applicationPort = appPort;
  front = createMaintenanceFrontDoor({ upstreamPort: appPort, readControl: () => readWindowControl(control) });
  await new Promise<void>(accept => front!.server.listen(0, "127.0.0.1", accept));
  const frontPort = (front.server.address() as { port: number }).port;
  // A local, disposable TLS reverse proxy supplies the same trusted metadata as the documented ingress.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-keyout", join(fixture, "tls.key"), "-out", join(fixture, "tls.crt")], { stdio: "ignore" });
  await chmod(join(fixture, "tls.key"), 0o600);
  ingress = httpsServer({ key: readFileSync(join(fixture, "tls.key")), cert: readFileSync(join(fixture, "tls.crt")) }, (req, res) => {
    const headers = { ...req.headers, host: "keryx.cc", "x-forwarded-proto": "https", "x-forwarded-host": "keryx.cc", "x-forwarded-port": "443" };
    delete headers.connection;
    const outgoing = httpRequest({ host: "127.0.0.1", port: frontPort, method: req.method, path: req.url, headers, agent: false }, incoming => {
      res.writeHead(incoming.statusCode!, incoming.headers); incoming.on("error", () => res.destroy()); incoming.pipe(res);
    });
    outgoing.on("error", () => res.destroy()); req.on("aborted", () => outgoing.destroy()); req.pipe(outgoing);
  });
  // Deliberately do not send preliminary permission to signed/paid request bodies.
  ingress.on("checkContinue", (req, res) => ingress!.emit("request", req, res));
  await new Promise<void>(accept => ingress!.listen(0, "127.0.0.1", accept));
  const ingressPort = (ingress.address() as { port: number }).port, origin = `https://127.0.0.1:${ingressPort}`;
  proof.ingressPort = ingressPort; proof.frontDoorPort = frontPort;
  async function request(path: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
    return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((accept, reject) => {
      const outgoing = httpsRequest(origin + path, { method, headers, agent: false, rejectUnauthorized: false, timeout: 8000 }, incoming => {
        const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(chunk)); incoming.on("error", reject);
        incoming.on("end", () => accept({ status: incoming.statusCode!, headers: incoming.headers, body: Buffer.concat(chunks).toString("utf8") }));
      });
      outgoing.on("error", reject); outgoing.on("timeout", () => outgoing.destroy(Error("Ingress request deadline"))); outgoing.end(body);
    });
  }
  const health = await request("/api/health"); assert.equal(health.status, 200); assert.equal(JSON.parse(health.body).settles, "offline");
  assert.equal(JSON.parse(health.body).network, "arcTestnet");
  assert.equal((await request("/api/metrics")).status, 200);
  assert.equal((await request("/mcp")).status, 405, "The actual built remote MCP route is present");
  const { SqliteAdapter } = await import("../lib/db/sqlite-adapter");
  const nonce = "Maintenance281DeterministicNonce", hash = digest(`keryx-siwe-v1:${nonce}`);
  const authHeaders = { Cookie: `siwe_nonce=${nonce}`, Origin: "https://keryx.cc", "Content-Type": "application/json" };
  const authBody = JSON.stringify({ message: "isolated invalid SIWE message", signature: "0xdeadbeef" });
  const sqlite = new SqliteAdapter(database); await sqlite.init();
  try { await sqlite.createAuthChallenge(hash, Date.now(), Date.now() + 300000); } finally { sqlite.close(); }
  // Positive control: the real built verify route consumes this deterministic challenge before rejecting a fake signature.
  assert.equal((await request("/api/auth/verify", "POST", authHeaders, authBody)).status, 400);
  const challengePresent = () => {
    const db = new DatabaseSync(database, { readOnly: true });
    try { return db.prepare("SELECT count(*) AS count FROM auth_challenges WHERE hash=?").get(hash)!.count; } finally { db.close(); }
  };
  assert.equal(challengePresent(), 0);
  const retained = new SqliteAdapter(database); await retained.init();
  try {
    await retained.createAuthChallenge(hash, Date.now(), Date.now() + 300000);
    const wallet = `0x${"11".repeat(20)}`, payee = `0x${"22".repeat(20)}`;
    await retained.upsertSessionGrant({ sessionId: wallet, sessAddr: wallet, ownerAddr: wallet, cap: 0.01,
      expiry: Date.now() + 300000, txHash: "synthetic-unfunded-rehearsal", grantEpoch: "isolated281" });
    await retained.recordPayment({ id: "isolated281-pending", kind: "fetch", queryId: "isolated281-retained", sourceId: "isolated281",
      sourceName: "Synthetic retained pending record", payer: wallet, payee, amountUsdc: 0.002, network: "eip155:5042002",
      settled: false, settlementStatus: "pending", authorizationId: `0x${"44".repeat(32)}`, grantEpoch: "isolated281",
      createdAt: new Date().toISOString(),
      rationale: "Synthetic offline recovery sentinel; no authorization signed or payment sent." });
  } finally { retained.close(); }
  const now = Date.now();
  const window: PlannedWindow = { format: WINDOW_FORMAT, id: "isolated-built-281", announcedAt: new Date(now - 1000).toISOString(),
    startsAt: new Date(now + 15000).toISOString(), endsAt: new Date(now + 120000).toISOString(), phase: "draining",
    message: "Isolated built Linux maintenance rehearsal. No payment or provider calls." };
  await publish(window);
  const upcoming = await request("/maintenance/status"); assert.equal(upcoming.status, 200); assert.equal(JSON.parse(upcoming.body).state, "upcoming");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  const forbidden: string[] = [];
  await context.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin || req.method() !== "GET") { forbidden.push(`${req.method()} ${url.pathname}`); return route.abort(); }
    return route.continue(); // Real API, status and application responses only; no fulfill/mocks.
  });
  const page = await context.newPage();
  const document = await page.goto(origin + "/decision-reviews"); assert.equal(document?.status(), 200);
  assert.equal(document.headers()["x-keryx-maintenance-starts-at"], window.startsAt);
  await page.getByRole("status").filter({ hasText: window.message }).waitFor({ timeout: 10000 });
  assert.ok((await page.getByRole("status").filter({ hasText: window.message }).innerText()).includes(window.endsAt));
  await page.screenshot({ path: join(evidence, "advance-announcement.png"), fullPage: true });
  await page.close(); assert.deepEqual(forbidden, []);
  await delay(Math.max(0, Date.parse(window.startsAt) - Date.now() + 20));
  const baseline = snapshot(), admittedBefore = audit.length;
  await writeFile(join(evidence, "database-before.json"), baseline);
  const refusedPaths = ["/api/auth/verify", "/api/ask", "/api/ask/sign", "/api/session/grant", "/api/source/isolated281",
    "/api/cite/isolated281", "/api/agent/ask", "/api/telegram/webhook", "/api/discord/interactions", "/mcp", "/mcp/"];
  async function refusal(path: string, method = "POST", expectedState = "draining") {
    // Health/metrics GETs carry no body. Signed-shaped POSTs carry the retained deterministic body.
    const result = await request(path, method, { ...authHeaders, Authorization: "Bearer isolated281", "Payment-Signature": "isolated-not-a-payment" }, method === "POST" ? authBody : undefined);
    observations.push({ path, method, ...result });
    assert.equal(result.status, 503); assert.match(String(result.headers["content-type"]), /^application\/json/);
    const { error } = JSON.parse(result.body);
    assert.equal(error.code, "KERYX_PLANNED_MAINTENANCE"); assert.equal(error.planned, true);
    assert.equal(error.maintenance.state, expectedState); assert.deepEqual(error.maintenance.window, { ...window, phase: expectedState });
    assert.equal(error.upstreamOutcome, "not-dispatched"); assert.equal(error.authorizationConsumedByFrontDoor, false); assert.equal(error.automaticRetry, false);
    assert.deepEqual(parseAskHttpError(result.body, result.status, String(result.headers["retry-after"])).maintenance,
      { statusPath: "/maintenance/status", upstreamOutcome: "not-dispatched" });
    assert.equal(error.retryAfterSeconds, Number(result.headers["retry-after"]));
    assert.equal(error.retryAfterSeconds, Math.max(1, Math.min(1800, Math.ceil((Date.parse(window.endsAt) - Date.parse(error.maintenance.checkedAt)) / 1000))));
    assert.equal(result.headers["cache-control"], "no-store");
  }
  for (const path of refusedPaths) await refusal(path);
  await delay(100); assert.equal(audit.length, admittedBefore, "No refused request reaches the actual built listener");
  assert.equal(snapshot(), baseline); assert.equal(challengePresent(), 1);
  await publish({ ...window, phase: "active" });
  await stopApp();
  // Prove the application listener is actually gone, independently of the maintenance response.
  await assert.rejects(new Promise<void>((accept, reject) => { const req = httpRequest({ host: "127.0.0.1", port: appPort, agent: false }, () => accept()); req.on("error", reject); req.end(); }), { code: "ECONNREFUSED" });
  for (const path of [...refusedPaths, "/api/health", "/api/metrics"]) await refusal(path, path.includes("health") || path.includes("metrics") ? "GET" : "POST", "active");
  const offlinePage = await context.newPage();
  const browserRefusal = await offlinePage.goto(origin + "/"); assert.equal(browserRefusal?.status(), 503);
  await offlinePage.getByRole("heading", { name: "Keryx maintenance", exact: true }).waitFor();
  assert.ok((await offlinePage.locator("body").innerText()).includes(window.startsAt));
  assert.ok((await offlinePage.locator("body").innerText()).includes(window.endsAt));
  assert.equal(await offlinePage.locator("script").count(), 0);
  await offlinePage.screenshot({ path: join(evidence, "stopped-app-static.png"), fullPage: true });
  await offlinePage.getByRole("link", { name: "Machine-readable status" }).click();
  const active = JSON.parse(await offlinePage.locator("body").innerText()); assert.equal(active.state, "active"); assert.equal(active.applicationStatus, "not-probed");
  assert.equal((await request("/maintenance")).status, 200); assert.equal((await request("/maintenance/status", "HEAD")).body, "");
  assert.equal((await request("/maintenance/status", "POST")).status, 405);
  assert.equal(snapshot(), baseline); assert.equal(challengePresent(), 1); assert.equal(audit.length, admittedBefore);
  proof.refusedRequestCount = observations.length; proof.authorizationPositiveControlConsumed = true;
  proof.wholeDatabaseBefore = digest(baseline); proof.wholeDatabaseAfter = digest(snapshot()); proof.applicationAudit = audit;
  await writeFile(join(evidence, "database-after.json"), snapshot());
  const late = Date.now();
  await publish({ ...window, announcedAt: new Date(late - 180000).toISOString(), startsAt: new Date(late - 120000).toISOString(),
    endsAt: new Date(late - 1000).toISOString(), phase: "active" });
  const overrun = await request("/api/health"); assert.equal(overrun.status, 503);
  assert.equal(JSON.parse(overrun.body).error.code, "KERYX_MAINTENANCE_WINDOW_EXPIRED");
  assert.equal(JSON.parse(overrun.body).error.maintenance.admissionClosed, true); observations.push({ overrun });
  await writeFile(marker, "invalid-control", { mode: 0o600 });
  const invalid = await request("/api/health"); assert.equal(JSON.parse(invalid.body).error.code, "KERYX_MAINTENANCE_CONTROL_UNAVAILABLE"); observations.push({ invalid });
  await unlink(marker); // Test-only remove the hold after stopped-app evidence; this is not a production reopening procedure.
  const failure = await request("/api/health"); assert.equal(failure.status, 503);
  const error = JSON.parse(failure.body).error;
  assert.equal(error.code, "KERYX_UPSTREAM_UNAVAILABLE"); assert.equal(error.planned, false); assert.equal(error.upstreamOutcome, "unknown"); assert.equal(error.automaticRetry, false);
  observations.push({ unplanned: failure });
  assert.equal((await request("/maintenance/status")).status, 200);
  assert.equal((await offlinePage.goto(origin + "/"))?.status(), 503);
  await offlinePage.getByRole("heading", { name: "Keryx is unavailable", exact: true }).waitFor();
  await offlinePage.screenshot({ path: join(evidence, "unplanned-failure.png"), fullPage: true });
  await context.close(); assert.deepEqual(forbidden, []); passed = true;
} catch (error) {
  proof.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error); throw error;
} finally {
  const cleanupFailures: string[] = [];
  try { await browser?.close(); } catch { cleanupFailures.push("Owned browser close failed"); }
  if (app && !appExited) {
    app.kill("SIGTERM");
    await Promise.race([exited, delay(10000, undefined, { ref: false })]);
    if (!appExited) { app.kill("SIGKILL"); await Promise.race([exited, delay(5000, undefined, { ref: false })]); cleanupFailures.push("Owned app required forced cleanup"); }
  }
  try { if (ingress) await new Promise<void>((accept, reject) => ingress!.close(error => error ? reject(error) : accept())); }
  catch { cleanupFailures.push("Owned TLS ingress close failed"); }
  try { await front?.close(); } catch { cleanupFailures.push("Owned front door close failed"); }
  closeSync(log); proof.applicationAudit = audit; proof.cleanupFailures = cleanupFailures;
  proof.passed = passed && appExited && cleanupFailures.length === 0; proof.ownedApplicationExited = appExited;
  proof.frontDoorSources = Object.fromEntries(["lib/maintenance/front-door.ts", "lib/maintenance/planned-window.ts", "scripts/next-public-server.mjs"]
    .map(file => [file, digest(readFileSync(join(source, file)).toString().replace(/\r\n/g, "\n"))]));
  await writeFile(join(evidence, "proof.json"), JSON.stringify(proof, null, 2));
  assert.deepEqual(cleanupFailures, [], "Owned resource cleanup must complete");
  // Preserve failure logs and isolated DB/control evidence. Hosted runner removal cleans only this disposable profile.
}
console.log(`Real built Linux maintenance rehearsal passed. Evidence: ${evidence}`);
