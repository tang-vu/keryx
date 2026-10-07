/** Actual built Next pages, local metadata and localStorage. All client API and external HTTP intercepted. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const require = createRequire(import.meta.url), port = 3963, base = `http://127.0.0.1:${port}`;
const screenshots = process.env.KERYX_LITERATURE_SCREENSHOT_DIR ?? join(process.cwd(), ".artifacts", "literature-ux");
await mkdir(screenshots, { recursive: true });
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" },
});
let output = "";
server.stdout.on("data", value => { output = (output + String(value)).slice(-4000); });
server.stderr.on("data", value => { output = (output + String(value)).slice(-4000); });
const exited = new Promise<void>(resolve => { server.once("exit", () => resolve()); server.once("error", () => resolve()); });
const browser = await chromium.launch({ headless: true });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && server.exitCode === null; attempt++) {
    try { ready = (await fetch(`${base}/literature`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting */ }
    if (ready) break; await delay(250);
  }
  assert(ready, `Built offline server failed: ${output}`);
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const errors: string[] = [], researchRequests: string[] = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        if (/\/ask(?:\/|$)|\/source(?:\/|$)|\/cite(?:\/|$)/.test(url.pathname)) researchRequests.push(url.pathname);
        return route.fulfill({ json: url.pathname === "/api/models" ? { models: [] } : {} });
      }
      assert.equal(request.method(), "GET"); return route.continue();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    assert.equal((await page.goto(`${base}/literature`))?.status(), 200);
    await page.getByRole("heading", { name: "Start with your review question" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `empty-${width}.png`), fullPage: true });
    await page.screenshot({ path: join(screenshots, `empty-viewport-${width}.png`) });
    await page.getByRole("link", { name: "Browse research papers" }).click();
    const cards = page.locator("#research-papers article"); await cards.first().getByRole("button", { name: "Save to literature workspace" }).waitFor();
    const savedTitles = [await cards.first().locator("h3").innerText(), await cards.nth(1).locator("h3").innerText()];
    await cards.first().getByRole("button", { name: "Save to literature workspace" }).click();
    await cards.nth(1).getByRole("button", { name: "Save to literature workspace" }).click();
    await cards.first().getByRole("link", { name: "Saved · Open literature workspace" }).click();
    await page.getByRole("heading", { name: "Your papers 2/50" }).waitFor();
    await page.getByLabel("Review title", { exact: true }).fill("Retrieval review");
    await page.getByLabel("Research question or inclusion criteria").fill("A".repeat(600));
    await page.getByRole("button", { name: "Save review focus" }).click();
    await page.getByText("Review focus saved on this browser.", { exact: true }).waitFor();
    const entries = page.locator("main article");
    await entries.first().getByText("Edit screening and notes", { exact: true }).click();
    await entries.first().getByLabel("Your screening decision").selectOption("include");
    await entries.first().getByLabel("Why keep or exclude this paper? What needs checking?").fill("User notes: verify methods against the original paper.");
    await entries.first().getByRole("button", { name: "Save screening and notes" }).click();
    await page.getByText("Screening and notes saved on this browser.", { exact: true }).waitFor();
    await page.reload(); await page.getByText("User notes: verify methods", { exact: false }).first().waitFor();
    await page.getByRole("checkbox", { name: `Compare ${savedTitles[0]}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Compare ${savedTitles[1]}`, exact: true }).check();
    await page.getByText("Edit screening and notes", { exact: true }).first().click();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const control of await page.locator("main button:visible, main select:visible, main textarea:visible, main input:visible").all()) {
      const box = await control.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width + 1);
      if (await control.getAttribute("type") !== "checkbox") assert(box.height >= 43, "Touch/keyboard controls retain a readable hit area");
    }
    await page.screenshot({ path: join(screenshots, `saved-${width}.png`), fullPage: true });
    await page.screenshot({ path: join(screenshots, `saved-viewport-${width}.png`) });
    const comparison = page.getByRole("link", { name: "Prepare comparison" });
    const href = await comparison.getAttribute("href"); assert(href);
    const expected = new URL(href, base).searchParams.get("q")!;
    await comparison.click();
    const composer = page.getByRole("textbox", { name: "What do you want to know?" });
    await composer.waitFor(); await page.waitForFunction(value => (document.querySelector('[data-tour="ask-form"] textarea') as HTMLTextAreaElement)?.value === value, expected);
    assert.equal(await composer.inputValue(), expected, "Actual Next navigation preserves every paper URL and the full comparison draft");
    assert.equal(await page.locator('input[name="research-depth"][value="deep"]').isChecked(), true);
    assert.equal(researchRequests.length, 0, "Preparing a comparison never runs research");
    assert.deepEqual(errors, []); await context.close();
  }
  console.log(`PASS: actual built Sources → save → literature → notes/reload → full draft composer navigation, responsive controls/no overflow at 320/390/768/1440px. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  if (server.exitCode === null) server.kill();
  await exited;
}
