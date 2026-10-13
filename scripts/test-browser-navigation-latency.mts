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
async function fulfillBuiltGet(route: Route) {
  const request = route.request(), url = new URL(request.url());
  assert.equal(request.method(), "GET");
  const response = await route.fetch({ url: physicalOrigin + url.pathname + url.search });
  const body = await response.body(), headers = { ...response.headers() };
  // APIResponse bodies are decoded buffers, not the upstream compressed/chunked wire stream.
  for (const name of ["content-encoding", "transfer-encoding", "content-length", "connection", "keep-alive"])
    delete headers[name];
  return route.fulfill({ response, headers, body });
}
const engine = process.argv.includes("--webkit") ? webkit : chromium;
console.log(JSON.stringify({ phase: "browser-launch-start", engine: engine.name() }));
const browser = await engine.launch({ headless: true });
console.log(JSON.stringify({ phase: "browser-launch-complete", engine: engine.name() }));
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
  console.log(JSON.stringify({ phase: "startup-ready", engine: engine.name() }));

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
          return fulfillBuiltGet(route);
        });
        const prefetch = page.waitForResponse(response => new URL(response.url()).pathname === destination &&
          response.request().headers()["next-router-prefetch"] === "1" &&
          response.request().headers()["next-router-segment-prefetch"] === undefined);
        console.log(JSON.stringify({ phase: "goto-start", engine: engine.name(), width, destination, entryPath }));
        await page.goto(origin + entryPath);
        console.log(JSON.stringify({ phase: "goto-complete", engine: engine.name(), width, destination }));
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
        console.log(JSON.stringify({ phase: "prefetch-response-start", engine: engine.name(), width, destination }));
        const prefetched = await prefetch;
        console.log(JSON.stringify({ phase: "prefetch-body-start", engine: engine.name(), width, destination, status: prefetched.status() }));
        await prefetched.finished();
        console.log(JSON.stringify({ phase: "prefetch-body-complete", engine: engine.name(), width, destination }));
        assert.equal(prefetched.status(), 200, `${destination} loading boundary is prefetched`);
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
        console.log(JSON.stringify({ phase: "click-start", engine: engine.name(), width, destination }));
        if (width === 390) await link.tap(); else await link.click();
        console.log(JSON.stringify({ phase: "click-complete", engine: engine.name(), width, destination, finalResponseHeld: Boolean(finalRoute) }));
        try {
          await page.getByRole("status").filter({ hasText: "Loading page" }).waitFor({ timeout: 1000 });
        } catch (error) {
          let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            const dom = await Promise.race([
              page.evaluate(() => {
                const main = document.querySelector("main"), box = main?.getBoundingClientRect();
                const loading = [...document.querySelectorAll('[role="status"]')]
                  .filter(element => element.textContent?.includes("Loading page")).slice(0, 4);
                return {
                  main: main ? { busy: main.getAttribute("aria-busy"), height: box?.height,
                    display: getComputedStyle(main).display, visibility: getComputedStyle(main).visibility } : null,
                  loading: loading.map(element => ({ text: element.textContent?.slice(0, 100),
                    height: element.getBoundingClientRect().height, display: getComputedStyle(element).display,
                    visibility: getComputedStyle(element).visibility })),
                  click: performance.getEntriesByName("navigation-click").slice(0, 4)
                    .map(entry => ({ startTime: entry.startTime, duration: entry.duration })),
                  loadingMeasures: performance.getEntriesByName("navigation-loading").slice(0, 4)
                    .map(entry => ({ startTime: entry.startTime, duration: entry.duration })),
                };
              }),
              new Promise(resolve => { diagnosticTimer = setTimeout(() => resolve({ unavailable: "DOM observation exceeded 1000ms" }), 1000); }),
            ]).catch(reason => ({ unavailable: String(reason).slice(0, 300) }));
            console.error(JSON.stringify({ diagnostic: "navigation-loading-failure", engine: engine.name(), width,
              destination, currentUrl: page.url(), finalResponseHeld: Boolean(finalRoute), heldRouteCount: held.size,
              finalRequest: finalRoute ? { path: new URL(finalRoute.request().url()).pathname,
                method: finalRoute.request().method(), prefetch: finalRoute.request().headers()["next-router-prefetch"] ?? null } : null,
              pageErrors: errors.slice(0, 8).map(message => message.slice(0, 300)), dom }));
          } catch (diagnosticError) {
            console.error(JSON.stringify({ diagnostic: "navigation-loading-observation-unavailable",
              engine: engine.name(), width, destination, reason: String(diagnosticError).slice(0, 300) }));
          } finally { if (diagnosticTimer) clearTimeout(diagnosticTimer); }
          throw error;
        }
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
          await fulfillBuiltGet(finalRoute);
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
        console.log(JSON.stringify({ phase: "context-cleanup-start", engine: engine.name(), width, destination, heldRouteCount: held.size }));
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
        console.log(JSON.stringify({ phase: "context-cleanup-complete", engine: engine.name(), width, destination }));
      }
    }
  }
  for (const path of ["/does-not-exist", "/dispatch/00000000-0000-0000-0000-000000000000", "/creator/does-not-exist", "/wanted/does-not-exist", "/answers/topic/does-not-exist", "/answers/page/999999"])
    assert.equal((await fetch(physicalOrigin + path)).status, 404, `${path} keeps its HTTP status`);
  assert.equal((await fetch(physicalOrigin + "/purchase-outcomes")).status, 200, "Purchase outcomes remains available");
  console.log("PASS: mobile header and internal links switch before delayed data; cancellation, destination headings, history and 404 preserved.");
} finally {
  console.log(JSON.stringify({ phase: "final-cleanup-start", engine: engine.name(), heldRouteCount: held.size, serverExited: didExit }));
  for (const route of held) await route.abort().catch(() => undefined);
  await browser.close();
  console.log(JSON.stringify({ phase: "browser-cleanup-complete", engine: engine.name(), serverExited: didExit }));
  if (child && !didExit) { child.kill(); await stopped; }
  console.log(JSON.stringify({ phase: "server-cleanup-complete", engine: engine.name(), serverExited: didExit }));
  assert(!child || didExit, "Server exited before fixture cleanup");
  await rm(temporary, { recursive: true, force: true });
}
