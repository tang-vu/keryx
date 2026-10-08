/** Built shared-agent output through real chat/SSE/export UI. Every API call is intercepted. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import type { QueryRun } from "../lib/types";
import { parseResearchAvailability } from "../lib/research/availability-contract";

const require = createRequire(import.meta.url);
const target = new URL(process.env.KERYX_UX_BASE_URL ?? "http://127.0.0.1:3964");
assert(target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  && !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash,
"Synthetic UI requires a loopback HTTP origin");
const base = target.origin;
const artifacts = process.env.KERYX_UX_SCREENSHOT_DIR ? join(process.env.KERYX_UX_SCREENSHOT_DIR, "source-recency")
  : join(process.cwd(), ".artifacts", "source-recency-ui");
await mkdir(artifacts, { recursive: true });
const runFile = join(artifacts, "built-runs.json");
const env = { ...process.env, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_FORCE_OFFLINE: "1", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", KERYX_RECENCY_RUN_FILE: runFile };
const fixture = spawn(process.execPath, ["scripts/test-built-empty-evidence.cjs"], {
  cwd: process.cwd(), env, windowsHide: true, stdio: "inherit",
});
assert.equal(await new Promise((resolve, reject) => { fixture.once("exit", resolve); fixture.once("error", reject); }), 0);
const runs = JSON.parse(await readFile(runFile, "utf8")) as QueryRun[];
assert.equal(runs.length, 2);
const available = parseResearchAvailability({ state: "not-paused" });
assert(available);
const server = process.env.KERYX_UX_BASE_URL ? null : spawn(process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3964"],
  { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
const exited = new Promise<void>(resolve => {
  if (!server) return resolve();
  server.once("exit", () => resolve()); server.once("error", () => resolve());
  server.stdout.on("data", value => { output = (output + String(value)).slice(-4000); });
  server.stderr.on("data", value => { output = (output + String(value)).slice(-4000); });
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
try {
  browser = await chromium.launch({ headless: true });
  let ready = false;
  for (let attempt = 0; attempt < 100 && (!server || server.exitCode === null); attempt++) {
    try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting */ }
    if (ready) break; await delay(250);
  }
  assert(ready, `Built offline server failed: ${output}`);
  for (const width of [320, 390, 768, 1440]) for (const [index, run] of runs.entries()) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    let asks = 0;
    const errors: string[] = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) {
        assert(["GET", "HEAD"].includes(request.method()), `Unexpected non-API write: ${url.pathname}`);
        return route.continue();
      }
      if (url.pathname === "/api/ask") {
        asks++; assert.equal(request.postDataJSON().question, run.question);
        return route.fulfill({ contentType: "text/event-stream", body: frame("meta", { mode: "offline", engine: run.engine })
          + run.trace.map(step => frame("step", step)).join("") + frame("done", run) });
      }
      if (url.pathname === "/api/activation") return route.fulfill({ json: {} });
      assert.equal(request.method(), "GET", `Unexpected write/payment: ${url.pathname}`);
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
      if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
      if (url.pathname === "/api/auth/session") return route.fulfill({ json: { authenticated: false } });
      return route.fulfill({ json: { sources: [], payments: [], activity: [], runs: [], jobs: [] } });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    // This effect-driven copy proves React consumed availability. Filling the SSR
    // textarea before hydration can lose the draft while leaving dispatch disabled.
    await page.getByText(available.message, { exact: true }).waitFor();
    const question = page.getByLabel("What do you want to know?");
    const dispatch = page.locator('[data-tour="dispatch-btn"]');
    await question.fill(run.question);
    assert.equal(await question.inputValue(), run.question);
    await page.locator('[data-tour="dispatch-btn"]:enabled').waitFor();
    assert.equal(await dispatch.isEnabled(), true);
    assert.equal(asks, 0, "Readiness and entering a draft must not submit research");
    await dispatch.click();
    await page.getByText(index ? "Giới hạn bản phát hành mới nhất" : "Newest-release limitation", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `${index ? "vi" : "en"}-${width}.png`), fullPage: true });
    await page.screenshot({ path: join(artifacts, `${index ? "vi" : "en"}-${width}-viewport.png`) });
    const overflow = await page.evaluate(() => ({ exceeded: document.documentElement.scrollWidth > innerWidth + 1,
      elements: [...document.querySelectorAll("p, code, article, div")].filter(element => element.getBoundingClientRect().right > innerWidth + 1)
        .slice(-12).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 120), right: element.getBoundingClientRect().right })) }));
    assert.equal(overflow.exceeded, false, `Horizontal overflow at ${width}: ${JSON.stringify(overflow.elements)}`);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report" }).click();
    const download = await downloading, markdown = await readFile((await download.path())!, "utf8");
    assert(markdown.includes(run.answer));
    assert(markdown.includes("https://creator.example/releases.atom"));
    assert.equal(asks, 1); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: built bilingual newest-feed gaps and downloaded reports at four widths, no automatic retry/payment API.");
} finally {
  try { await browser?.close(); }
  finally { if (server) { server.kill(); await exited; } }
}
