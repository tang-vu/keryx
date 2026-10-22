import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import { researchGuidesCopy as copy } from "../locales/en/research-guides";
import { checkLiteratureMatrixFiles } from "./literature-matrix-file-acceptance";

/** Run against an isolated spending-free server, including the compiled CI build. */
export async function checkResearchGuides(browser: Browser, origin: string, evidence?: string) {
  const paths = ["/guides", "/tools/literature-review-matrix", ...copy.guides.map(guide => `/guides/${guide.slug}`)];
  for (const path of paths) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
    assert(canonical && new URL(canonical).pathname === path && !new URL(canonical).search, `${path}: own canonical`);
    assert(!html.includes('content="noindex'), `${path}: indexable HTML`);
    assert(html.includes('application/ld+json'), `${path}: structured data`);
    const guide = copy.guides.find(item => path.endsWith(`/guides/${item.slug}`));
    if (guide) {
      assert(html.includes(guide.summary), `${path}: answer available without hydration`);
      for (const section of guide.sections) assert(html.includes(`id="${section.id}"`), `${path}: section anchor`);
    }
  }
  assert.equal((await fetch(origin + "/guides/unknown-guide")).status, 404);
  const template = await fetch(origin + "/tools/literature-review-matrix/template.csv");
  assert.equal(template.status, 200);
  assert(template.headers.get("content-disposition")?.includes("attachment"));
  assert((await template.text()).startsWith('"research_question"'));
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const forbidden: string[] = [], errors: string[] = [];
    try {
      await context.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!["GET", "HEAD"].includes(request.method())) { forbidden.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: '{}' });
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      for (const path of paths) {
        await page.goto(origin + path);
        await page.locator("main h1").waitFor();
        assert.equal(await page.locator("main h1").count(), 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: fits ${width}px`);
      }
      await page.goto(origin + "/tools/literature-review-matrix");
      await page.getByLabel(copy.tool.question, { exact: true }).fill("Does retrieval improve factuality?");
      await page.getByRole("button", { name: copy.tool.add, exact: true }).click();
      await page.getByLabel(copy.tool.columns.title, { exact: true }).fill('Nguyễn, "source"');
      await page.getByLabel(copy.tool.columns.finding, { exact: true }).fill("=1+2");
      await page.getByLabel(copy.tool.columns.locator, { exact: true }).fill("Table 2");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: copy.tool.download, exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), "literature-review-matrix.csv");
      const stream = await download.createReadStream(); assert(stream);
      let csv = ""; for await (const chunk of stream) csv += chunk.toString();
      assert(csv.includes('"Nguyễn, ""source"""') && csv.includes('"\'=1+2"') && csv.includes('"Table 2"'));
      await page.evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })");
      await page.getByRole("button", { name: copy.tool.copy, exact: true }).click();
      await page.getByText(copy.tool.copied, { exact: true }).waitFor();
      await page.evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('test refusal')) } })");
      await page.getByRole("button", { name: copy.tool.copy, exact: true }).click();
      await page.getByText(copy.tool.copyFailed, { exact: true }).waitFor();
      await checkLiteratureMatrixFiles(page);
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => window.scrollY === 0);
        await page.screenshot({ path: join(evidence, `matrix-viewport-${width}.png`), animations: "disabled" });
        await page.screenshot({ path: join(evidence, `matrix-${width}.png`), fullPage: true, animations: "disabled" });
      }
      await page.getByRole("button", { name: `${copy.tool.remove} 1`, exact: true }).click();
      assert.equal(await page.locator("fieldset").count(), 0);
      assert.equal(await page.getByLabel(copy.tool.question, { exact: true }).inputValue(), "Does retrieval improve factuality?");
      assert.deepEqual(forbidden, [], "Guide and matrix browsing never submits notes, research or payments");
      assert.deepEqual(errors, [], "No page runtime errors");
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }
  console.log("PASS: research guides, canonical HTML, 404, no-JS template, mobile matrix save/reopen/import, stale and invalid file refusal, spreadsheet safety, clipboard refusal and no data submission.");
}
