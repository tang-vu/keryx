/** Cold-cache header transitions against the real production router. GET only,
 * offline disposable storage; no account, vendor, signing or payment requests. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, webkit, type Route } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const source = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "keryx-header-feedback-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const physicalOrigin = `http://127.0.0.1:${address.port}`, origin = "https://header-feedback.test";
const engine = process.argv.includes("--webkit") ? webkit : chromium;
let child: ReturnType<typeof spawn> | undefined, stopped: Promise<void> | undefined, didExit = false;
const browser = await engine.launch({ headless: true });
async function forward(route: Route) {
  const request = route.request(), url = new URL(request.url());
  assert.equal(request.method(), "GET");
  const response = await route.fetch({ url: physicalOrigin + url.pathname + url.search });
  const body = await response.body(), headers = { ...response.headers() };
  for (const name of ["content-encoding", "transfer-encoding", "content-length", "connection", "keep-alive"]) delete headers[name];
  await route.fulfill({ response, headers, body });
}
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
  child.stdout?.on("data", data => { output = (output + String(data)).slice(-4000); });
  child.stderr?.on("data", data => { output = (output + String(data)).slice(-4000); });
  stopped = new Promise<void>(done => child!.once("exit", () => { didExit = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    try { ready = (await fetch(physicalOrigin, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, `Built header server unavailable: ${output}`);

  for (const width of [390, 1366]) {
    for (const destination of ["/sources", "/pricing", "/register"]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390,
        isMobile: width === 390, reducedMotion: "reduce" });
      const held: Route[] = [];
      try {
        const page = await context.newPage(), errors: string[] = [];
        page.setDefaultTimeout(10_000);
        page.on("pageerror", error => errors.push(error.message));
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin || request.method() !== "GET") return route.abort();
          if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Read-only fixture" } });
          // Deliberately cold: the prior regression waited for successful prefetch.
          if (request.headers()["next-router-prefetch"] === "1") return route.abort();
          if ([destination, "/about"].includes(url.pathname) && url.searchParams.has("_rsc")) { held.push(route); return; }
          return forward(route);
        });
        await page.goto(origin);
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Connect Wallet")));
        const choose = async (path: string) => {
          if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).tap();
          const link = page.locator(`${width === 390 ? "#mobile-site-menu" : "header nav"} a[href="${path}"]`).first();
          await link.evaluate(anchor => anchor.addEventListener("click", () => performance.mark("header-click"), { once: true }));
          if (width === 390) await link.tap(); else await link.click();
        };
        await page.evaluate(() => {
          const observer = new MutationObserver(() => {
            if (!document.querySelector("[data-navigation-pending]")) return;
            observer.disconnect();
            requestAnimationFrame(() => performance.measure("header-feedback", "header-click"));
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        await choose(destination);
        const status = page.locator("[data-navigation-pending]");
        await status.waitFor({ state: "visible", timeout: 1000 });
        await page.waitForFunction(() => performance.getEntriesByName("header-feedback").length > 0);
        const feedbackMs = await page.evaluate(() => Math.round(performance.getEntriesByName("header-feedback")[0].duration));
        assert(feedbackMs < 1000, `Feedback before any route response (${feedbackMs}ms)`);
        assert.equal(new URL(page.url()).pathname, "/", "Old route has not committed yet");
        await status.getByRole("status").filter({ hasText: "Loading page" }).waitFor();
        assert.equal(await status.count(), 1);
        if (width === 390) assert.equal(await page.locator("#mobile-site-menu").isVisible(), false, "Menu closes immediately without hiding portal");
        assert.equal(await status.evaluate(element => getComputedStyle(element).pointerEvents), "none", "Navigation remains interruptible");
        assert.equal(await status.locator("svg").evaluate(element => getComputedStyle(element).animationName), "none", "Reduced motion honored");
        // Wait for the actual held request without supplying its response.
        for (let attempt = 0; !held.length && attempt < 40; attempt++) await new Promise(done => setTimeout(done, 25));
        assert(held.length > 0, "Actual unprefetched route response is withheld");
        if (destination === "/sources") {
          await choose("/about");
          assert.equal(await status.count(), 1, "Only latest navigation is pending");
          for (let attempt = 0; !held.some(route => new URL(route.request().url()).pathname === "/about") && attempt < 40; attempt++)
            await new Promise(done => setTimeout(done, 25));
          const next = held.find(route => new URL(route.request().url()).pathname === "/about");
          assert(next, "Replacement route is requested");
          await forward(next);
          await page.waitForURL(origin + "/about");
          await status.waitFor({ state: "detached" });
          for (const old of held.filter(route => route !== next)) await old.abort().catch(() => undefined);
          assert.equal(new URL(page.url()).pathname, "/about", "Superseded request cannot restore old destination");
        } else {
          await forward(held[0]);
          await page.waitForURL(origin + destination);
          await status.waitFor({ state: "detached" });
        }
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.goBack(); await page.waitForURL(origin + "/");
        await status.waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ engine: engine.name(), width, destination, feedbackMs, prefetched: false }));
      } finally {
        for (const route of held) await route.abort().catch(() => undefined);
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
      }
    }
  }
  console.log("PASS: cold header clicks acknowledge immediately; mobile closure, replacement, completion, history and reduced motion preserved.");
} finally {
  await browser.close();
  if (child && !didExit) { child.kill(); await stopped; }
  assert(!child || didExit);
  await rm(temporary, { recursive: true, force: true });
}
