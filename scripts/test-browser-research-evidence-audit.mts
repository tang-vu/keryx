/** Compiled local-memory web audit: no credentials, research, payment, upload or persisted inputs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, type Browser } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const source = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "keryx-evidence-audit-built-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${address.port}`;
let child: ReturnType<typeof spawn> | undefined, stopped: Promise<void> | undefined, didClose = false;
let browser: Browser | undefined;
try {
  await copyNextConfigFixture(source, temporary);
  for (const folder of ["node_modules", ".next", "public"])
    await symlink(join(source, folder), join(temporary, folder), process.platform === "win32" ? "junction" : "dir");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet",
    NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[name]) env[name] = process.env[name];
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(address.port)],
    { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  stopped = new Promise<void>(done => child!.once("close", () => { didClose = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didClose; attempt++) {
    try { ready = (await fetch(origin + "/research-audit", { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break; await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, "Compiled evidence audit unavailable");
  const html = await (await fetch(origin + "/research-audit")).text();
  assert(html.includes("Research evidence audit")); assert(!html.includes("illustrative-synthetic-review"), "Example is not preloaded into form HTML");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  const writes: string[] = [], external: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (request.method() !== "GET") { writes.push(request.method() + " " + url.pathname); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const screenshots = join(source, ".artifacts", "evidence-audit"); await mkdir(screenshots, { recursive: true });
  const expectedExample = JSON.stringify(JSON.parse(await readFile(join(source, "docs/research-evidence-audit-example.json"), "utf8")), null, 2);
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin + "/research-audit");
    await page.getByRole("button", { name: "Load illustrative example", exact: true }).click();
    await page.waitForFunction(expected => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Audit input JSON"]')?.value === expected, expectedExample);
    await page.getByRole("button", { name: "Check locally", exact: true }).click();
    await page.getByRole("heading", { name: "Local audit result", exact: true }).waitFor();
    assert(await page.getByText("Access: simulated", { exact: false }).isVisible());
    assert(await page.getByText("Unknown", { exact: true }).count() >= 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `${width}.png`), fullPage: true });
  }
  const downloadWait = page.waitForEvent("download"); await page.getByRole("button", { name: "Download local result", exact: true }).click();
  const download = await downloadWait, path = await download.path(); assert(path);
  const exported = JSON.parse(await readFile(path, "utf8"));
  assert.equal(exported.economics.sourceCostPerSupportedClaim, null); assert.equal(exported.decisionLinks[0].access, "simulated");
  const retained = JSON.stringify({ expectedReceiptDigest: exported.receiptDigest });
  await page.getByLabel("Separately retained digests JSON (optional)").fill(retained);
  assert.equal(await page.getByRole("heading", { name: "Local audit result", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Check locally", exact: true }).click();
  await page.getByText("Receipt: retained-digest-match", { exact: false }).waitFor();
  await page.getByLabel("Separately retained digests JSON (optional)").fill(JSON.stringify({ expectedReceiptDigest: "sha256:" + "f".repeat(64) }));
  await page.getByRole("button", { name: "Check locally", exact: true }).click(); await page.locator('p[role="alert"]').waitFor();
  assert.equal(await page.getByRole("button", { name: "Download local result", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Load illustrative example", exact: true }).click();
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (...args) => {
      crypto.subtle.digest = original;
      return new Promise<ArrayBuffer>((resolveDigest, reject) => {
        (window as unknown as { releaseAudit: () => void }).releaseAudit = () => { original(...args).then(resolveDigest, reject); };
      });
    };
  });
  await page.getByRole("button", { name: "Check locally", exact: true }).click();
  await page.waitForFunction(() => "releaseAudit" in window);
  await page.getByLabel("Audit input JSON", { exact: true }).fill('{"privateSentinel":"must-stay-local"}');
  await page.evaluate(() => (window as unknown as { releaseAudit: () => void }).releaseAudit());
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole("heading", { name: "Local audit result", exact: true }).count(), 0, "Old async result cannot return after editing");
  assert(!page.url().includes("must-stay-local"));
  assert(await page.evaluate(() => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes("must-stay-local")));
  await page.getByRole("button", { name: "Clear data", exact: true }).click();
  assert.equal(await page.getByLabel("Audit input JSON", { exact: true }).inputValue(), "");
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ compiledRoute: "/research-audit", widths: [320, 390, 1366], noBrowserWrites: true,
    simulationNotMoney: true, retainedDigest: true, staleResultDiscarded: true, downloads: true, externalRequestsBlocked: external.length }));
} finally {
  if (browser) await browser.close();
  if (child && !didClose) { child.kill(); await Promise.race([stopped, new Promise(done => setTimeout(done, 5000))]); assert(didClose, "Owned fixture process did not close"); }
  for (const folder of ["node_modules", ".next", "public"]) await rm(join(temporary, folder), { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}
