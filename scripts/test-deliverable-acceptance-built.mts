/** Built private/public routes + actual Next report UI; synthetic durable sessions and bookkeeping only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { SqliteAdapter } from "../lib/db/sqlite-adapter.ts";
import { seedSyntheticA2aOriginal, syntheticA2aOriginal } from "../lib/db/a2a-original-fixture.ts";
import { issueWebSession } from "../lib/auth-session.ts";
import { acceptanceInputSchema, acceptanceSnapshotSchema } from "../lib/deliverable-acceptance/contracts.ts";
const source = resolve(import.meta.dirname, ".."), dist = join(source, ".next"); await readFile(join(dist, "BUILD_ID"));
const fixture = join(source, ".artifacts", `acceptance-built-${randomUUID()}`); await mkdir(join(fixture, "lib"), { recursive: true }); await mkdir(join(fixture, "data"));
for (const file of ["package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts"]) await writeFile(join(fixture, file), await readFile(join(source, file)));
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const sqlite = new SqliteAdapter(join(fixture, "data", "keryx.sqlite")); await sqlite.init();
const originals = [];
const answer = "Synthetic delivered answer 😀", owner = `0x${"11".repeat(20)}`, other = `0x${"33".repeat(20)}`;
for (let index = 1; index <= 5; index++) {
  const original = await seedSyntheticA2aOriginal(sqlite, syntheticA2aOriginal(index)); originals.push(original);
  await sqlite.completeA2aOrder(original.order.id, { status: "completed", queryId: original.order.id, answer, researchPackage: original.order.researchPackage }, "2026-10-09T00:00:00.000Z");
  await sqlite.saveQueryRun({ id: original.order.id, question: `Synthetic acceptance fixture ${index}`, answer, budget: 0.01,
    engine: "heuristic", subClaims: [], decisions: [], citations: [], trace: [], totalSpent: 0, totalToCreators: 0,
    paymentMode: "offline", fundingOwner: "offline", origin: "engine", createdAt: "2026-10-09T00:00:00.000Z" });
}
const secret = randomBytes(32).toString("hex"), session = await issueWebSession(sqlite, secret, owner, "asker"), otherSession = await issueWebSession(sqlite, secret, other, "dev");
const key = `kx_live_${"1".repeat(96)}`, keyRow = await sqlite.mintApiKey(owner, key.slice(0, 16), createHash("sha256").update(key).digest("hex"), "synthetic acceptance", "deliverable:read,deliverable:write");
const legacyKey = `kx_live_${"2".repeat(96)}`; await sqlite.mintApiKey(owner, legacyKey.slice(0, 16), createHash("sha256").update(legacyKey).digest("hex"), "synthetic legacy");
const raw = Reflect.get(sqlite, "db") as DatabaseSync, retained = () => JSON.stringify(raw.prepare("SELECT * FROM a2a_orders ORDER BY id").all()) + JSON.stringify(raw.prepare("SELECT * FROM payment_events ORDER BY id").all());
const before = retained();
const listener = createServer(); await new Promise<void>(resolveReady => listener.listen(0, "127.0.0.1", resolveReady)); const address = listener.address(); assert(address && typeof address !== "string");
const port = address.port; await new Promise<void>((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose())); const origin = `http://127.0.0.1:${port}`;
const networkGuard = join(fixture, "loopback.mjs");
await writeFile(networkGuard, `import net from'node:net';import dns from'node:dns';import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';
const deny=capability=>{const error=Error('Synthetic fixture denies '+capability);process.stderr.write(error.stack+'\\n');throw error;};const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...raw){const args=Array.isArray(raw[0])?raw[0]:raw;const first=args[0];const host=typeof first==='object'?first.host??'localhost':args[1]??'localhost';const port=typeof first==='object'?first.port:first;
if(!['127.0.0.1','localhost','::1'].includes(host)||Number(port)!==${port})return deny('socket');return connect.apply(this,raw);};
for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']){if(name in dns)dns[name]=()=>deny('dns.'+name);if(name in dns.promises)dns.promises[name]=()=>deny('dns.promises.'+name);}
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>deny('child_process.'+name);
const fetcher=globalThis.fetch;globalThis.fetch=(input,...args)=>{const url=new URL(typeof input==='string'?input:input.url??String(input));if(url.origin!==${JSON.stringify(origin)})return Promise.reject(Error('Synthetic fixture denies outbound fetch'));return fetcher(input,...args);};syncBuiltinESMExports();`);
const env: NodeJS.ProcessEnv = {};
for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT", "LOCALAPPDATA", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
Object.assign(env, { NODE_ENV: "production", BASE_URL: origin, JWT_SECRET: secret, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_EXTERNAL_DISCOVERY: "0",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "" });
const child = spawn(process.execPath, ["--import", pathToFileURL(networkGuard).href, join(source, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let didExit = false, startupError: Error | undefined, browser: Browser | undefined, output = "";
child.stdout.on("data", chunk => { output = (output + chunk).slice(-6000); }); child.stderr.on("data", chunk => { output = (output + chunk).slice(-6000); });
const exited = new Promise<void>(resolveExit => child.once("exit", () => { didExit = true; resolveExit(); })); child.once("error", error => { startupError = error; });
const waitForExit = (milliseconds: number) => new Promise<boolean>(resolveWait => { const timer = setTimeout(() => resolveWait(false), milliseconds); void exited.then(() => { clearTimeout(timer); resolveWait(true); }); });
const request = (path: string, init: RequestInit = {}) => fetch(origin + path, { redirect: "error", ...init, signal: AbortSignal.timeout(10000) });
const ownerRequest = (method: string, body?: unknown, wallet = owner, token = session.token) => ({ method,
  headers: { Origin: origin, Cookie: `keryx_session=${token}`, "X-Keryx-Expected-Wallet": wallet, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const privacy = (response: Response) => { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary") ?? "", /Authorization/); assert.match(response.headers.get("vary") ?? "", /Cookie/); assert.equal(response.headers.get("referrer-policy"), "no-referrer"); };
try {
  const id = originals[0].order.id, path = `/api/me/deliverables/${id}/acceptance`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    assert(!startupError && !didExit, `Owned built server startup failed: ${output}`);
    try { ready = (await request(path, ownerRequest("GET"))).ok; } catch { /* startup */ }
    if (ready) break; await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  assert(ready, `Owned built server unavailable: ${output}`);
  const read = await request(path, ownerRequest("GET")); privacy(read); const initial = acceptanceSnapshotSchema.parse(await read.json());
  const input = acceptanceInputSchema.parse({ originalFingerprint: initial.originalFingerprint, deliveredDigest: initial.deliveredDigest, expectedRevision: 0, idempotencyKey: "synthetic-built-request-0001", choice: "revise", reason: "Private synthetic request", publishState: true });
  const refusals: Array<{ init: RequestInit; status: number }> = [
    { init: { method: "POST", headers: { Origin: origin, Cookie: `keryx_session=${session.token}`, "Content-Type": "application/json" }, body: "invalid" }, status: 428 },
    { init: ownerRequest("POST", "invalid", owner, otherSession.token), status: 409 },
    { init: { ...ownerRequest("POST", input), headers: { ...ownerRequest("POST").headers, Origin: "https://foreign.invalid", "X-Forwarded-Host": "foreign.invalid", "Content-Type": "application/json" }, body: "invalid" }, status: 403 },
    { init: { method: "POST", headers: { Authorization: `Bearer ${legacyKey}`, "Content-Type": "application/json" }, body: "invalid" }, status: 403 },
  ];
  for (const attempt of refusals) { const refusal = await request(path, attempt.init); assert.equal(refusal.status, attempt.status); privacy(refusal); }
  const submitted = await request(path, ownerRequest("POST", input)); assert.equal(submitted.status, 200); privacy(submitted); assert.equal((await submitted.json()).revisionExecution, "withheld");
  assert.equal((await (await request(path, ownerRequest("POST", input))).json()).revision, 1);
  const conflicting = await request(path, ownerRequest("POST", { ...input, reason: "Conflicting replay" })); assert.equal(conflicting.status, 409); privacy(conflicting);
  const shared = await request(`/api/deliverables/${id}/acceptance`); privacy(shared); const publicResult = await shared.json(); assert.deepEqual(Object.keys(publicResult).sort(), ["format", "state", "submittedAt"]); assert.equal(publicResult.state, "revision_requested");
  const keyRead = await request(path, { headers: { Authorization: `Bearer ${key}` } }); assert.equal(keyRead.status, 200); privacy(keyRead);
  await sqlite.revokeApiKey(keyRow.id, owner); assert.equal((await request(path, { headers: { Authorization: `Bearer ${key}` } })).status, 401);
  browser = await chromium.launch({ headless: true });
  for (const [index, width] of [320, 390, 768, 1440].entries()) {
    const currentId: string = originals[index + 1].order.id;
    const context: BrowserContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await context.addCookies([{ name: "keryx_session", value: session.token, url: origin, httpOnly: true, sameSite: "Lax" }]);
    let lostAck = true, posts = 0; const errors: string[] = [];
    try {
      await context.route("**/*", async (route: Route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort("blockedbyclient");
        const privatePath = `/api/me/deliverables/${currentId}/acceptance`;
        if (url.pathname.startsWith("/api/") && ![privatePath, `/api/deliverables/${currentId}/acceptance`, "/api/auth/session"].includes(url.pathname)) return route.fulfill({ status: 503, json: { error: "synthetic_fixture_unavailable" } });
        if (route.request().method() === "POST") { assert.equal(url.pathname, privatePath); posts++; if (lostAck) { lostAck = false; const result = await route.fetch(); assert.equal(result.status(), 200); return route.abort("failed"); } }
        return route.continue();
      });
      const page: Page = await context.newPage(); page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(`${origin}/dispatch/${currentId}`);
      const journal = page.getByRole("region", { name: "Your prepaid A2A deliverable choice" }); await journal.waitFor();
      const revise = journal.getByRole("button", { name: "Request revision", exact: true }); await revise.waitFor(); await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Request revision" && !button.disabled));
      await journal.getByLabel("Optional private reason").fill("Private synthetic browser reason"); await journal.getByRole("checkbox").check(); await revise.click();
      const replay = page.getByRole("button", { name: "Replay the same submission", exact: true }); await replay.waitFor(); await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Replay the same submission" && !button.disabled));
      await replay.click(); await page.getByText("Customer acceptance: Revision requested — awaiting owner review", { exact: true }).waitFor(); assert.equal(posts, 2);
      assert.equal((await sqlite.deliverableAcceptance!.read(owner, originals[index + 1].binding.network, currentId)).revision, 1);
      await journal.getByRole("checkbox").uncheck(); await journal.getByRole("button", { name: "Reject", exact: true }).click();
      await page.getByText("The customer has not shared an acceptance state.", { exact: true }).waitFor();
      assert.equal((await sqlite.deliverableAcceptance!.read(owner, originals[index + 1].binding.network, currentId)).revision, 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Overflow at ${width}`);
      await page.screenshot({ path: join(fixture, `acceptance-${width}.png`), fullPage: true }); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  assert.equal(retained(), before, "No original or payment mutation");
  const metrics = await request("/api/deliverables/acceptance/metrics"); privacy(metrics); const counts = await metrics.json(); assert.equal(counts.revisionRequested, 1); assert.equal(counts.acceptanceRate, null);
  const durable = (await sqlite.listWebSessions(owner, Date.now()))[0]; await sqlite.revokeWebSession(durable.hash, owner); assert.equal((await request(path, ownerRequest("GET"))).status, 401);
} finally {
  try { await browser?.close(); }
  finally { try { if (!didExit && child.pid !== undefined) { child.kill(); if (!await waitForExit(5000)) { child.kill("SIGKILL"); assert(await waitForExit(5000), "Owned server exit not observed"); } } } finally { sqlite.close(); } }
}
console.log("PASS built acceptance routes/cookie/key/privacy, original/payment byte parity and actual Next report/hydration/production-CSS 320/390/768/1440 owner UI with actual durable API, lost-ack exact-key replay and public consent withdrawal; owned server exit observed. Synthetic durable sessions/bookkeeping only; no SIWE provider, live settlement, revision/refund execution or native enrollment proof.");
