import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.UI_PREVIEW_BASE_URL ?? "http://127.0.0.1:4067";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local preview only");
const output = resolve(process.env.UI_PREVIEW_OUTPUT ?? "output/ui-preview-browser");
await mkdir(output, { recursive: true });
const drafts = Object.fromEntries(await Promise.all(["vi", "zh-Hans"].map(async locale => [locale,
  Object.fromEntries(await Promise.all(["core-inline", "get-started", "product-guide"].map(async namespace =>
    [namespace, JSON.parse(await readFile(`locales/${locale}/ui-drafts/${namespace}.json`, "utf8"))])))])));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: "en-US" });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let askRequests = 0;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      if (url.pathname === "/api/ask" || url.pathname === "/api/ask/sign") { askRequests++; return route.abort(); }
      return route.continue();
    });
    await page.goto(base, { waitUntil: "networkidle" });
    const select = () => page.locator("[data-language-switcher] select:visible").first();
    await select().waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>("[data-language-switcher] select")?.disabled);
    const original = "Keep my exact unsent draft: <Question> {count} USDC";
    await page.locator("#ask-question").fill(original);
    for (const locale of ["vi", "zh-Hans"] as const) {
      await page.locator("#ask-question").fill(original);
      await select().selectOption(locale);
      const expected = drafts[locale]["core-inline"].entries["researchEntry.question"].text;
      await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
      assert.equal(await page.locator("#ask-question").inputValue(), original);
      assert.equal(await page.locator("#ask-question").getAttribute("placeholder"), drafts[locale]["core-inline"].entries["researchEntry.placeholder"].text);
      await page.screenshot({ path: resolve(output, `${locale}-${width}-home.png`), fullPage: true });
      await page.goto(`${base}/get-started`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, `${locale}-${width}-setup.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `${locale}/${width} horizontal overflow`);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
      await page.goto(base, { waitUntil: "networkidle" });
      await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
    }
    await select().selectOption("en");
    await page.locator('label[for="ask-question"]').filter({ hasText: "What do you want to know?" }).waitFor();
    assert.equal(askRequests, 0, "Language changes must never submit or sign research");
    assert.deepEqual(errors, [], "No browser runtime errors");
    results.push({ width, locales: ["en", "vi", "zh-Hans"], routes: ["/", "/get-started"], errors, askRequests });
    await context.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify(results, null, 2));
  console.log("Built UI previews passed for VI/Chinese at 390/1366px, navigation, reload, draft preservation and English reset.");
} finally { await browser.close(); }
