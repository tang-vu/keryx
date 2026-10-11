/** Actual production Next navigation/prefetch under delayed transport. No wallet or paid calls. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, webkit, type Route } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const source = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "keryx-mobile-navigation-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${address.port}`;
let child: ReturnType<typeof spawn> | undefined, didExit = false, stopped: Promise<void> | undefined;
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const browser = await engine.launch({ headless: true });
let held: Route | undefined;
try {
  await copyNextConfigFixture(source, temporary);
  await symlink(join(source, "node_modules"), join(temporary, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await symlink(join(source, ".next"), join(temporary, ".next"), process.platform === "win32" ? "junction" : "dir");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin,
    KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[name]) env[name] = process.env[name];
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(address.port)],
    { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", value => { output = (output + String(value)).slice(-4000); });
  child.stderr?.on("data", value => { output = (output + String(value)).slice(-4000); });
  stopped = new Promise<void>(done => child!.once("exit", () => { didExit = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, `Built navigation server unavailable: ${output}`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    assert.equal(request.method(), "GET", "No authentication, research or spending mutation is admitted");
    if (url.pathname === "/sources" && url.searchParams.has("_rsc") && request.headers()["next-router-prefetch"] !== "1") {
      assert(!held, "One original navigation request only"); held = route; return;
    }
    return route.continue();
  });
  await page.goto(origin);
  const prefetched = page.waitForResponse(response => new URL(response.url()).pathname === "/sources" && response.request().headers()["next-router-prefetch"] === "1");
  await page.getByRole("button", { name: "Open menu" }).tap();
  const response = await prefetched; await response.finished();
  assert((await response.text()).includes("Loading page"), "Real dynamic prefetch must include the public loading shell");
  await page.locator("#mobile-site-menu").getByRole("link", { name: "Sources", exact: true }).tap();
  await page.getByRole("status").filter({ hasText: "Loading page" }).waitFor();
  assert(held, "Final route response remains withheld while loading UI is visible");
  assert.equal(await page.getByRole("button", { name: "Connect Wallet" }).count(), 0, "Temporary shell cannot start a wallet flow");
  await held.continue(); held = undefined;
  await page.waitForURL(`${origin}/sources`);
  await page.getByRole("button", { name: "Open menu" }).waitFor();
  await page.getByRole("status").filter({ hasText: "Loading page" }).waitFor({ state: "detached" });
  assert.equal((await context.request.get(`${origin}/does-not-exist`)).status(), 404, "Unrelated not-found status remains unchanged");
  assert.deepEqual(errors, []);
  console.log(`PASS (${engine.name()}): built dynamic route partially prefetches; real touch navigation displays loading before delayed response; final header restores; no wallet flow in fallback; unrelated 404 preserved. Offline disposable store, GET only.`);
  await context.close();
} finally {
  if (held) await held.abort().catch(() => undefined);
  await browser.close();
  if (child && !didExit) { child.kill(); await stopped; }
  assert(!child || didExit, "Observe server exit before removing disposable fixture");
  // Only our checked temporary fixture is removed; node_modules/.next are links.
  await rm(temporary, { recursive: true, force: true });
}
