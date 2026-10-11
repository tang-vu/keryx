/** Actual popup bytes in an owned clean browser with synthetic extension API.
 * This proves module/DOM privacy; real MV3 distribution remains its own gate. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
const origin = "http://localhost:49301", id = "12345678-1234-1234-1234-123456789abc", token = "c".repeat(64);
const claimUrl = `${origin}/claim-run#${token}`;
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE }); });
afterAll(async () => { await browser?.close(); });
async function fixture(options: { complete?: boolean; packetId?: string; expired?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  const network: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    const state = { stored: [] as unknown[], opened: [] as unknown[], clipboard: [] as unknown[] };
    Object.assign(window, { fixtureState: state, chrome: { tabs: { query: async () => [], create: async (value: unknown) => { state.opened.push(value); } },
      scripting: { executeScript: async () => [] }, storage: { local: { get: async () => ({}), set: async (value: unknown) => { state.stored.push(value); }, remove: async () => {} } } } });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: unknown) => { state.clipboard.push(value); } } });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); network.push(request.url());
    if (url.origin !== origin) return route.abort();
    const staticFiles: Record<string, string> = { "/popup.html": "extension/popup.html", "/popup.js": "extension/popup.js",
      "/research-client.mjs": "extension/research-client.mjs", "/recorded-usdc.mjs": "extension/recorded-usdc.mjs" };
    if (url.pathname === "/keryx-config.js") return route.fulfill({ contentType: "text/javascript", body:
      `const KERYX_API=${JSON.stringify(origin + "/api/v1/chat/completions")},KERYX_PENDING_KEY="synthetic-pending",KERYX_REGISTER=${JSON.stringify(origin + "/register")};` });
    if (staticFiles[url.pathname]) return route.fulfill({ contentType: url.pathname.endsWith(".html") ? "text/html" : "text/javascript", body: readFileSync(staticFiles[url.pathname], "utf8") });
    if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
    if (url.pathname === "/api/v1/chat/completions") {
      const chunk = { id: `chatcmpl-${id}`, choices: [{ delta: { content: "Synthetic saved answer" }, finish_reason: "stop" }],
        keryx: { citations: [], totalToCreators: 0, paymentMode: "offline", dispatchUrl: `${origin}/dispatch/${id}`,
          researchExports: { bibtex: "synthetic-public-bibliography" } },
        keryx_private: { version: 1, runId: options.packetId ?? id, status: "available", delivery: { version: 1, claimUrl,
          expiresAt: new Date(Date.now() + (options.expired ? -1000 : 60000)).toISOString() } } };
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(chunk)}\n\n${options.complete === false ? "" : "data: [DONE]\n\n"}` });
    }
    return route.abort();
  });
  await page.goto(`${origin}/popup.html`); await page.locator("#question").fill("Synthetic private delivery"); await page.locator("#ask").click();
  await page.waitForFunction(() => document.getElementById("status")!.textContent!.startsWith("done") || document.getElementById("status")!.textContent === "failed");
  return { context, page, network, errors };
}
it("actual popup keeps ticket out of HTML/device history/clipboard/exports and opens only once on explicit click", async () => {
  const f = await fixture();
  try {
    expect(await f.page.locator("#claim-panel").isVisible()).toBe(true); expect(await f.page.content()).not.toContain(token);
    const state = () => f.page.evaluate(() => Reflect.get(window, "fixtureState"));
    expect(JSON.stringify(await state())).not.toContain(token); expect((await state()).clipboard).toEqual([]);
    expect((await state()).opened).toEqual([]); expect(f.network.every(url => !url.includes(token))).toBe(true);
    expect(await f.page.locator("#dispatch-link").getAttribute("href")).toBe(`${origin}/dispatch/${id}`);
    await f.page.locator("#claim-run").click(); await f.page.locator("#claim-run").evaluate((button: HTMLButtonElement) => button.click());
    expect((await state()).opened).toEqual([{ url: claimUrl }]); expect(JSON.stringify((await state()).stored)).not.toContain(token);
    expect((await state()).clipboard).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("actual popup clears transient delivery on close/pagehide", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await f.page.locator("#claim-run").evaluate((button: HTMLButtonElement) => button.click());
    expect(await f.page.evaluate(() => Reflect.get(window, "fixtureState").opened)).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("actual popup rejects incomplete stream, foreign run and expired private packets", async () => {
  for (const options of [{ complete: false }, { packetId: "foreign-run" }, { expired: true }]) {
    const f = await fixture(options);
    try {
      expect(await f.page.locator("#claim-panel").isVisible()).toBe(false);
      await f.page.locator("#claim-run").evaluate((button: HTMLButtonElement) => button.click());
      expect(await f.page.evaluate(() => Reflect.get(window, "fixtureState").opened)).toEqual([]); expect(f.errors).toEqual([]);
      expect(JSON.stringify(await f.page.evaluate(() => Reflect.get(window, "fixtureState").stored))).not.toContain(token);
    } finally { await f.context.close(); }
  }
});
