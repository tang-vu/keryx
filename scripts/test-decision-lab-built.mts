/** Compiled Next route + responsive UI, isolated from credentials and production data. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, type Browser } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { decisionLabCopy as copy } from "../lib/research-audit/decision-lab-copy.ts";

const source = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "keryx-decision-lab-built-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${address.port}`;
let child: ReturnType<typeof spawn> | undefined, stopped: Promise<void> | undefined, didExit = false;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  await copyNextConfigFixture(source, temporary);
  for (const folder of ["node_modules", ".next", "public"])
    await symlink(join(source, folder), join(temporary, folder), process.platform === "win32" ? "junction" : "dir");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin,
    KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[name]) env[name] = process.env[name];
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(address.port)],
    { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  stopped = new Promise<void>(done => child!.once("exit", () => { didExit = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    try { ready = (await fetch(origin + "/operator/decisions", { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break; await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, "Compiled Decision Lab unavailable");
  const response = await fetch(origin + "/operator/decisions"); assert.equal(response.status, 200);
  const html = await response.text(); assert(html.includes(copy.title)); assert(html.includes(copy.sample));
  assert(/<input(?=[^>]*value="0\.005")(?=[^>]*disabled)[^>]*>/.test(html), "SSR budget input is disabled until local handlers exist");
  assert(html.includes('href="' + origin + '/operator/decisions"') || html.includes('/operator/decisions"'));
  const context = await browser.newContext({ serviceWorkers: "block" });
  const writes: string[] = [], external: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== origin) { external.push(target.origin); return route.abort(); }
    if (request.method() !== "GET") { writes.push(request.method() + " " + target.pathname); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const screenshots = join(source, ".artifacts", "decision-lab"); await mkdir(screenshots, { recursive: true });
  for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await page.goto(origin + "/operator/decisions", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: copy.preview, exact: true }).waitFor();
    await page.getByLabel(copy.remaining, { exact: true }).fill("0"); await page.getByRole("button", { name: copy.preview, exact: true }).click();
    await page.getByText(copy.previewScope, { exact: true }).waitFor();
    assert.equal(await page.getByLabel(copy.remaining, { exact: true }).inputValue(), "0");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + " has no page-level horizontal overflow");
    await page.evaluate(() => new Promise<void>(done => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(() => done())); }));
    await page.screenshot({ path: join(screenshots, name + ".png"), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ compiledNext: true, route: "/operator/decisions", viewports: [1280, 390], noPageOverflow: true,
    noBrowserWrites: true, externalRequestsBlocked: external.length, screenshots: ".artifacts/decision-lab" }));
} finally {
  if (browser) await browser.close();
  if (child && !didExit) { child.kill(); await Promise.race([stopped, new Promise(done => setTimeout(done, 5000))]); assert(didExit, "Owned fixture process did not stop"); }
  // Each linked surface is removed as a junction, never traversed as source.
  for (const folder of ["node_modules", ".next", "public"]) await rm(join(temporary, folder), { force: true, recursive: true });
  await rm(temporary, { recursive: true, force: true });
}
