/** Actual production page; synthetic observation, loopback only, no payments. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { operatorBusinessStatusSchema } from "../lib/business-operator/contracts";

const require = createRequire(import.meta.url);
const base = "http://127.0.0.1:3961";
const screenshots = await mkdtemp(join(tmpdir(), "keryx-operator-page-"));
const server = spawn(process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3961"], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
      KERYX_FORCE_OFFLINE: "1", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "" },
  });
let output = "";
for (const pipe of [server.stdout, server.stderr]) {
  pipe.on("data", chunk => { output = (output + String(chunk)).slice(-4096); });
}
const exited = new Promise<void>(resolve => {
  server.once("exit", () => resolve());
  server.once("error", () => resolve());
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let i = 0; i < 80 && server.exitCode === null; i++) {
    try { ready = (await fetch(`${base}/operator`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { /* bounded startup */ }
    if (ready) break;
    await delay(250);
  }
  assert(ready, `Owned offline server did not start: ${output}`);
  const actual = await fetch(`${base}/api/operator/status`);
  assert.equal(actual.status, 200);
  assert.equal(actual.headers.get("cache-control"), "no-store");
  const observation = operatorBusinessStatusSchema.parse(await actual.json());
  assert.equal(observation.network, "eip155:5042002");
  assert.equal(observation.operator.state, "unavailable"); // no synthetic worker heartbeat
  const openapi = await (await fetch(`${base}/api/openapi.json`)).json();
  assert.equal(openapi.info.version, "0.27.0");
  assert.deepEqual(openapi.paths["/api/operator/status"].get.security, []);

  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    let calls = 0;
    let writes = 0;
    await context.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (request.method() !== "GET") { writes++; return route.abort(); }
      if (url.pathname !== "/api/operator/status") return route.continue();
      calls++;
      if (calls > 1) return route.fulfill({ status: 503, json: { error: "fixture outage" } });
      return route.fulfill({ json: operatorBusinessStatusSchema.parse({
        version: 1, network: "eip155:5042",
        operator: { state: "working", observedAt: new Date().toISOString(), auditRecorded: true,
          decision: { action: "run-next", reason: "liquidity-covered", liquidity: "covered", observedAt: new Date().toISOString() } },
        jobs: { queued: 7, processing: 1, reviewRequired: 0, completedLast24h: 4, failedLast24h: 1,
          completionRateLast24h: 0.8, oldestQueuedAgeSeconds: 60, oldestProcessingAgeSeconds: 10,
          completionLatencyP50Ms: 100, completionLatencyP95Ms: 200, degraded: false },
        creatorCatalog: { registered: 3 },
      }) });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    assert.equal((await page.goto(`${base}/operator`))?.status(), 200);
    await page.getByText("Active · working", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Request research", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `working-${width}.png`), fullPage: true });
    await page.clock.runFor(31_000);
    await page.getByText("Previous counts are hidden", { exact: false }).waitFor();
    await page.getByText("The queue is unknown.", { exact: false }).waitFor();
    assert.equal(calls, 2);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Built Operator page passed at 390/1440px, including fresh-to-outage polling; screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  await exited;
}
