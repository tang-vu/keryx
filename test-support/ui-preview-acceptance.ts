import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { preparedLocales, uiLocaleNames } from "../lib/i18n/locales";
import { productGuideCopy } from "../locales/en/product-guide";

/** Real compiled pages and language controls; no research, payment or external requests. */
export async function checkUiPreviews(browser: Browser, base: string, output?: string) {
  assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local preview only");
  if (output) await mkdir(output, { recursive: true });
  const locales = preparedLocales.filter(locale => locale !== "en");
  const drafts = Object.fromEntries(await Promise.all(locales.map(async locale => [locale,
    Object.fromEntries(await Promise.all(["core-inline", "get-started", "ui-preference", "product-guide"].map(async namespace =>
      [namespace, JSON.parse(await readFile(`locales/${locale}/ui-drafts/${namespace}.json`, "utf8"))])))])));
  const results = [];
  for (const width of [390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: "en-US" });
    try {
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
      for (const locale of locales) {
        assert.equal(await select().locator(`option[value="${locale}"]`).textContent(), uiLocaleNames[locale]);
        await page.locator("#ask-question").fill(original);
        await select().selectOption(locale);
        const expected = drafts[locale]["core-inline"].entries["researchEntry.question"].text;
        await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
        assert.equal(await page.locator(`label[for="ask-question"] [lang="${locale}"]`).count(), 1, `${locale} question label exposes its language`);
        assert.equal(await page.locator(`h1 [lang="${locale}"]`).count(), 1, `${locale} headline exposes its language`);
        assert.equal(await page.locator('.kx-research-intro [lang="en"]').count(), 1, "Critical English introduction retains its own language");
        assert.equal(await page.locator("option span").count(), 0, "Native select options retain text-only content");
        assert.equal(await page.locator("#ask-question").inputValue(), original);
        assert.equal(await page.locator("#ask-question").getAttribute("placeholder"), drafts[locale]["core-inline"].entries["researchEntry.placeholder"].text);
        assert.equal(await select().getAttribute("title"), drafts[locale]["ui-preference"].entries.previewNotice.text);
        const [headline, guide, globe] = await Promise.all([page.locator("h1").evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number };
        }),
          page.getByTestId("hero-guide").boundingBox(), page.getByTestId("chat-globe").boundingBox()]);
        assert(headline && guide && globe, `${locale}/${width} hero elements are present`);
        for (const [name, obstacle] of [["guide", guide], ["globe", globe]] as const) {
          assert(headline.x + headline.width <= obstacle.x || headline.x >= obstacle.x + obstacle.width ||
            headline.y + headline.height <= obstacle.y || headline.y >= obstacle.y + obstacle.height,
          `${locale}/${width} headline must not overlap ${name}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${locale}/${width} homepage overflow`);
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-home.png`), fullPage: true });
        await page.goto(`${base}/about`, { waitUntil: "networkidle" });
        const about = drafts[locale]["product-guide"].entries;
        const aboutHeading = page.getByRole("heading", { level: 1, name: about["about.title"].text, exact: true });
        await aboutHeading.waitFor();
        assert.equal(await aboutHeading.locator(`[lang="${locale}"]`).count(), 1, `${locale} About headline exposes its language`);
        const explanation = page.getByText(about["about.projectBody"].text, { exact: true });
        await explanation.waitFor();
        assert.equal(await explanation.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), locale);
        const legalNotice = page.getByText(productGuideCopy("about.projectLegalNotice"), { exact: true });
        await legalNotice.waitFor();
        assert.equal(await legalNotice.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), "en");
        const scope = page.locator('a[href="https://github.com/tang-vu/keryx/blob/main/docs/licensing.md"]');
        assert.equal(await scope.textContent(), productGuideCopy("about.projectLegalLink"));
        assert.equal(await scope.evaluate(element => (element.querySelector("[lang]") ?? element).closest("[lang]")?.getAttribute("lang")), "en");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${locale}/${width} About overflow`);
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-about.png`), fullPage: true });
        await page.goto(`${base}/get-started`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${locale}/${width} setup overflow`);
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-setup.png`), fullPage: true });
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
        await page.goto(base, { waitUntil: "networkidle" });
        await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
      }
      await select().selectOption("en");
      await page.locator('label[for="ask-question"]').filter({ hasText: "What do you want to know?" }).waitFor();
      assert.equal(askRequests, 0, "Language changes must never submit or sign research");
      assert.deepEqual(errors, [], "No browser runtime errors");
      results.push({ width, locales: ["en", ...locales], routes: ["/", "/about", "/get-started"], errors, askRequests });
    } finally {
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
  if (output) await writeFile(resolve(output, "result.json"), JSON.stringify(results, null, 2));
  console.log(`PASS: ${locales.length} interface previews at 390/1366px, About explanations, English legal copy, navigation, reload, exact drafts and English reset.`);
}
