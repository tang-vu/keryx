/** Real Next production navigation, with final route responses held indefinitely.
 * GET-only, offline, disposable storage; no wallet, authentication or paid calls. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, webkit, type Route } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const source = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "keryx-navigation-latency-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const physicalOrigin = `http://127.0.0.1:${address.port}`, origin = "https://navigation-latency.test";
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const browser = await engine.launch({ headless: true });
let child: ReturnType<typeof spawn> | undefined, didExit = false, stopped: Promise<void> | undefined;
const held = new Set<Route>();
try {
  await copyNextConfigFixture(source, temporary);
  for (const folder of ["node_modules", ".next", "public"])
    await symlink(join(source, folder), join(temporary, folder), process.platform === "win32" ? "junction" : "dir");
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
    try { ready = (await fetch(physicalOrigin, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, `Built navigation server unavailable: ${output}`);

  for (const width of [390, 1366]) {
    for (const destination of ["/research", "/proof", "/usage", "/history/testnet"]) {
      const entryPath = destination === "/usage" ? "/proof" : destination === "/history/testnet" ? "/dashboard" : "/";
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, isMobile: width === 390 });
      try {
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        let finalRoute: Route | undefined;
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin || request.method() !== "GET") return route.abort();
          if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Read-only fixture" } });
          if (url.pathname === destination && url.searchParams.has("_rsc") && request.headers()["next-router-prefetch"] !== "1") {
            assert(!finalRoute, "One final navigation request");
            finalRoute = route; held.add(route); return;
          }
          return route.fulfill({ response: await route.fetch({ url: physicalOrigin + url.pathname + url.search }) });
        });
        const prefetch = page.waitForResponse(response => new URL(response.url()).pathname === destination &&
          response.request().headers()["next-router-prefetch"] === "1");
        await page.goto(origin + entryPath);
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Connect Wallet")));
        let link;
        if (width === 390 && destination === "/research") {
          await page.getByRole("button", { name: "Open menu" }).tap();
          await page.locator("#mobile-site-menu").getByText("More tools", { exact: true }).tap();
          link = page.locator(`#mobile-site-menu a[href="${destination}"]`);
        } else {
          link = page.locator(`a[href="${destination}"]`).first();
        }
        await link.scrollIntoViewIfNeeded();
        const prefetched = await prefetch; await prefetched.finished();
        assert.equal(prefetched.status(), 200, `${destination} route tree is prefetched`);
        // Measure from the actual input event to the fallback's next animation frame.
        // Playwright's scroll/actionability waits precede the user's click.
        await link.evaluate(anchor => {
          anchor.addEventListener("click", () => performance.mark("navigation-click"), { once: true });
          const observer = new MutationObserver(() => {
            if (!performance.getEntriesByName("navigation-click").length ||
              !document.querySelector('main[aria-busy="true"]')?.getBoundingClientRect().height) return;
            observer.disconnect();
            requestAnimationFrame(() => performance.measure("navigation-loading", "navigation-click"));
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        });
        if (width === 390) await link.tap(); else await link.click();
        await page.getByRole("status").filter({ hasText: "Loading page" }).waitFor({ timeout: 1000 });
        await page.waitForFunction(() => performance.getEntriesByName("navigation-loading").length > 0, undefined, { timeout: 1000 });
        const loadingMs = await page.evaluate(() => Math.round(performance.getEntriesByName("navigation-loading")[0].duration));
        assert(loadingMs < 1000, `Immediate route shell (${loadingMs}ms), before final response`);
        assert(finalRoute, "Final response is still withheld");
        assert.equal(await page.getByRole("button", { name: "Connect Wallet" }).count(), 0, "Fallback cannot start an ephemeral wallet flow");
        assert.equal(await page.locator("main[aria-busy=true]").count(), 1);

        if (destination === "/research") {
          // A slow navigation remains interruptible through the fallback home link.
          await page.locator('header a[href="/"]').click();
          await page.waitForURL(origin + "/");
          await page.locator('header button[aria-label="Open menu"]').waitFor({ state: "attached" });
          await finalRoute.abort(); held.delete(finalRoute);
        } else {
          const url = new URL(finalRoute.request().url());
          await finalRoute.fulfill({ response: await finalRoute.fetch({ url: physicalOrigin + url.pathname + url.search }) });
          held.delete(finalRoute);
          await page.waitForURL(origin + destination);
          await page.getByRole("status").filter({ hasText: "Loading page" }).waitFor({ state: "detached" });
          await page.getByRole("heading", { level: 1 }).waitFor();
          await page.locator('header button[aria-label="Open menu"]').waitFor({ state: "attached" });
          await page.goBack(); await page.waitForURL(origin + entryPath);
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ engine: engine.name(), width, destination, loadingMs, finalResponseWithheld: true }));
      } finally {
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
      }
    }
  }
  for (const path of ["/does-not-exist", "/dispatch/00000000-0000-0000-0000-000000000000", "/creator/does-not-exist", "/wanted/does-not-exist", "/answers/topic/does-not-exist", "/answers/page/999999"])
    assert.equal((await fetch(physicalOrigin + path)).status, 404, `${path} keeps its HTTP status`);
  assert.equal((await fetch(physicalOrigin + "/purchase-outcomes")).status, 200, "Purchase outcomes remains available");
  console.log("PASS: mobile header and internal links switch before delayed data; cancellation, destination headings, history and 404 preserved.");
} finally {
  for (const route of held) await route.abort().catch(() => undefined);
  await browser.close();
  if (child && !didExit) { child.kill(); await stopped; }
  assert(!child || didExit, "Server exited before fixture cleanup");
  await rm(temporary, { recursive: true, force: true });
}
