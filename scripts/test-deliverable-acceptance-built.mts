/** Built private/public routes + actual client component/production CSS; synthetic durable sessions and bookkeeping only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
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
const deny=()=>{throw Error('Synthetic fixture denies outbound/subprocess capability');};const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...raw){const args=Array.isArray(raw[0])?raw[0]:raw;const first=args[0];const host=typeof first==='object'?first.host??'localhost':args[1]??'localhost';const port=typeof first==='object'?first.port:first;
if(!['127.0.0.1','localhost','::1'].includes(host)||Number(port)!==${port})return deny();return connect.apply(this,raw);};
for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']){if(name in dns)dns[name]=deny;if(name in dns.promises)dns.promises[name]=deny;}
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;
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
  const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{DeliverableAcceptance}from'./components/keryx/deliverable-acceptance';window.renderAcceptance=(id,answer)=>root.render(<DeliverableAcceptance id={id} answer={answer}/>);const root=createRoot(document.getElementById('root'));`, loader: "tsx", resolveDir: source }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-owner-display", setup(plugin) {
    plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", contents: args.path === "next/link" ? "import React from'react';export default function Link(p){return <a {...p}/>;}" : `export function useSiweAuth(){return{session:{address:${JSON.stringify(owner)}}};}` }));
  } }] });
  const chunks = join(dist, "static", "chunks"), cssFiles = (await readdir(chunks)).filter(file => file.endsWith(".css")); assert(cssFiles.length);
  const css = (await Promise.all(cssFiles.map(file => readFile(join(chunks, file), "utf8")))).join("\n");
  browser = await chromium.launch({ headless: true });
  for (const [index, width] of [320, 390, 768, 1440].entries()) {
    const currentId: string = originals[index + 1].order.id;
    const context: BrowserContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await context.addCookies([{ name: "keryx_session", value: session.token, url: origin, httpOnly: true, sameSite: "Lax" }]);
    let lostAck = true, posts = 0; const errors: string[] = [];
    try {
      await context.route("**/*", async (route: Route) => {
        const url = new URL(route.request().url()); assert.equal(url.origin, origin, "No external browser traffic");
        if (url.pathname === "/__acceptance_fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="max-width:900px;margin:auto"></main>' });
        assert(url.pathname === `/api/me/deliverables/${currentId}/acceptance` || url.pathname === `/api/deliverables/${currentId}/acceptance`);
        if (route.request().method() === "POST") { posts++; if (lostAck) { lostAck = false; const result = await route.fetch(); assert.equal(result.status(), 200); return route.abort("failed"); } }
        return route.continue();
      });
      const page: Page = await context.newPage(); page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(`${origin}/__acceptance_fixture`); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ id, answer }: { id: string; answer: string }) => (window as unknown as { renderAcceptance(id: string, answer: string): void }).renderAcceptance(id, answer), { id: currentId, answer });
      const revise = page.getByRole("button", { name: "Request revision", exact: true }); await revise.waitFor(); await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Request revision" && !button.disabled));
      await page.getByLabel("Optional private reason").fill("Private synthetic browser reason"); await page.getByRole("checkbox").check(); await revise.click();
      const replay = page.getByRole("button", { name: "Replay the same submission", exact: true }); await replay.waitFor(); await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Replay the same submission" && !button.disabled));
      await replay.click(); await page.getByText("Customer acceptance: Revision requested — awaiting owner review", { exact: true }).waitFor(); assert.equal(posts, 2);
      assert.equal((await sqlite.deliverableAcceptance!.read(owner, originals[index + 1].binding.network, currentId)).revision, 1);
      await page.getByRole("checkbox").uncheck(); await page.getByRole("button", { name: "Reject", exact: true }).click();
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
console.log("PASS built acceptance routes/cookie/key/privacy, original/payment byte parity and production-CSS 320/390/768/1440 owner UI with actual durable API, lost-ack exact-key replay and public consent withdrawal; owned server exit observed. Synthetic identity display/bookkeeping only; no SIWE provider, live settlement, revision/refund execution or native enrollment proof.");
