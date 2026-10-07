/** Actual built Next pages, local metadata and localStorage. All client API and external HTTP intercepted. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
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
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    const errors: string[] = [], researchRequests: string[] = [], metadataRequests: string[] = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/papers") metadataRequests.push(url.search);
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
    await page.getByLabel("Show screening decisions").selectOption("include");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download shown references (RIS)" }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "keryx-literature-references.ris");
    const references = await readFile((await download.path())!, "utf8");
    assert.equal((references.match(/^TY  - /gm) ?? []).length, 1);
    assert(references.includes(savedTitles[0]) && !references.includes(savedTitles[1]));
    assert(!references.includes("User notes: verify methods") && !references.includes("A".repeat(600)));
    await page.getByLabel("Show screening decisions").selectOption("all");
    await page.getByRole("checkbox", { name: `Compare ${savedTitles[0]}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Compare ${savedTitles[1]}`, exact: true }).check();
    await page.getByLabel("Show screening decisions").selectOption("include");
    const selection = page.getByRole("region", { name: "Comparison selection" });
    assert.equal(await selection.locator("li").count(), 2);
    for (const title of savedTitles) await selection.getByRole("link", { name: title, exact: true }).waitFor();
    assert.equal(await selection.getByText("Outside the current screening filter; still selected.", { exact: true }).count(), 1);
    await selection.getByText("Review prepared question", { exact: true }).click();
    const preparedHref = await page.getByRole("link", { name: "Prepare comparison" }).getAttribute("href"); assert(preparedHref);
    assert.equal(await selection.getByLabel("Prepared comparison question").textContent(), new URL(preparedHref, base).searchParams.get("q"));
    const comparison = page.getByRole("link", { name: "Prepare comparison" });
    const contrast = await comparison.evaluate(element => {
      const styles = getComputedStyle(element), canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminances: number[] = [], weights = [0.2126, 0.7152, 0.0722];
      for (const color of [styles.color, styles.backgroundColor]) {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const pixels = context.getImageData(0, 0, 1, 1).data;
        if (pixels[3] !== 255) throw new Error("Comparison colors must be opaque for this contrast measurement");
        let luminance = 0;
        for (let index = 0; index < 3; index++) {
          const channel = pixels[index] / 255;
          luminance += weights[index] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        }
        luminances.push(luminance);
      }
      const [foreground, background] = luminances;
      return { color: styles.color, background: styles.backgroundColor, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
    });
    assert(contrast.ratio >= 4.5, `Prepare comparison must retain readable text contrast: ${JSON.stringify(contrast)}`);
    console.log(`PASS: ${width}px comparison text contrast ${contrast.ratio.toFixed(2)}:1`);
    await comparison.evaluate(element => element.scrollIntoView({ block: "center" }));
    await comparison.screenshot({ path: join(screenshots, `prepare-${width}.png`) });
    await page.getByText("Edit screening and notes", { exact: true }).first().click();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const control of await page.locator("main button:visible, main select:visible, main textarea:visible, main input:visible").all()) {
      const box = await control.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width + 1);
      if (await control.getAttribute("type") !== "checkbox") assert(box.height >= 43, "Touch/keyboard controls retain a readable hit area");
    }
    await page.screenshot({ path: join(screenshots, `saved-${width}.png`), fullPage: true });
    await page.screenshot({ path: join(screenshots, `saved-viewport-${width}.png`) });
    await selection.screenshot({ path: join(screenshots, `comparison-${width}.png`) });
    const href = await comparison.getAttribute("href"); assert(href);
    const expected = new URL(href, base).searchParams.get("q")!;
    await comparison.click();
    const composer = page.getByRole("textbox", { name: "What do you want to know?" });
    await composer.waitFor(); await page.waitForFunction(value => (document.querySelector('[data-tour="ask-form"] textarea') as HTMLTextAreaElement)?.value === value, expected);
    assert.equal(await composer.inputValue(), expected, "Actual Next navigation preserves every paper URL and the full comparison draft");
    assert.equal(await page.locator('input[name="research-depth"][value="deep"]').isChecked(), true);
    await composer.fill("Private draft: identify the title and first author of arXiv 2005.11401v4");
    const metadataLink = page.getByTestId("paper-metadata-handoff");
    await metadataLink.waitFor();
    assert.equal(await metadataLink.getAttribute("href"), "/sources?kind=paper&q=2005.11401v4#research-papers");
    const box = await metadataLink.boundingBox(); assert(box && box.height >= 43 && box.x >= 0 && box.x + box.width <= width + 1);
    await metadataLink.screenshot({ path: join(screenshots, `metadata-handoff-${width}.png`) });
    await metadataLink.click();
    const exactCard = page.locator("#research-papers article");
    await exactCard.getByRole("heading", { name: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", exact: true }).waitFor();
    assert.equal(await exactCard.count(), 1);
    assert((await exactCard.innerText()).includes("Patrick Lewis"));
    assert.equal(await page.getByRole("textbox", { name: "Title, topic, DOI or versioned arXiv identifier" }).inputValue(), "2005.11401v4");
    assert.equal(metadataRequests.length, 0, "Opening a metadata handoff must not search external repositories");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(researchRequests.length, 0, "Preparing a comparison never runs research");
    assert.deepEqual(errors, []); await context.close();
  }
  console.log(`PASS: actual built Sources → literature → full draft composer → exact free metadata, responsive controls/no overflow at 320/390/768/1440px; no research or provider search. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  if (server.exitCode === null) server.kill();
  await exited;
}
