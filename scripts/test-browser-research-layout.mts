/** Responsive checks against the built Next app. All API writes are blocked. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const externalBase = process.env.KERYX_UX_BASE_URL;
const port = 3957;
const base = externalBase ?? `http://127.0.0.1:${port}`;
const screenshotDir = process.env.KERYX_UX_SCREENSHOT_DIR ?? await mkdtemp(join(tmpdir(), "keryx-research-ux-"));
await mkdir(screenshotDir, { recursive: true });

const child = externalBase ? null : spawn(process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: process.cwd(), env: { ...process.env, KERYX_FORCE_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
const exited = new Promise<void>(resolve => {
  if (!child) return resolve();
  child.once("exit", () => resolve());
  child.once("error", () => resolve());
  child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-4096); });
  child.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-4096); });
});

const browser = await chromium.launch({ headless: true });
try {
  if (child) {
    let ready = false;
    for (let i = 0; i < 120 && child.exitCode === null; i++) {
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* server starting */ }
      if (ready) break;
      await delay(250);
    }
    assert(ready, `Local production server did not start: ${output}`);
  }

  const dimensions = [
    [320, 640], [360, 640], [390, 640], [430, 740],
    [768, 900], [1024, 768], [1366, 768], [1440, 900], [390, 480],
  ] as const;
  const baseOrigin = new URL(base).origin;
  for (const [width, height] of dimensions) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseOrigin) return route.abort();
      if (url.pathname.startsWith("/api/") && request.method() !== "GET") return route.abort();
      return route.continue();
    });
    try {
      const page = await context.newPage();
      const response = await page.goto(base, { waitUntil: "domcontentloaded" });
      assert.equal(response?.status(), 200, `Home response at ${width}x${height}`);
      const question = page.getByRole("textbox", { name: "What do you want to know?" });
      await question.waitFor();
      await page.evaluate(() => document.fonts.ready);
      // Wait for the shipped atlas to paint countries, not merely an empty ocean disc.
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="chat-globe"] canvas');
        const context = canvas?.getContext("2d");
        if (!canvas || !context || !canvas.width) return false;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let landPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60 && pixels[i + 3] > 200) landPixels++;
        return landPixels > 700;
      });
      const measurements = await page.evaluate(() => {
        const kicker = document.querySelector('[data-testid="hero-kicker"]');
        const range = document.createRange();
        if (kicker) range.selectNodeContents(kicker);
        return {
          input: document.querySelector("textarea")?.getBoundingClientRect().toJSON(),
          cta: document.querySelector('[data-tour="dispatch-btn"]')?.getBoundingClientRect().toJSON(),
          cap: document.querySelector('[data-testid="composer-source-cap"]')?.getBoundingClientRect().toJSON(),
          guide: document.querySelector('[data-testid="hero-guide"]')?.getBoundingClientRect().toJSON(),
          kickerText: kicker ? range.getBoundingClientRect().toJSON() : null,
          headline: document.querySelector("h1")?.getBoundingClientRect().toJSON(),
          docWidth: document.documentElement.scrollWidth,
          windowWidth: window.innerWidth,
          heroTop: document.querySelector('[data-tour="hero"]')?.getBoundingClientRect().top,
          globe: document.querySelector('[data-testid="chat-globe"]')?.getBoundingClientRect().toJSON(),
          canvas: document.querySelector('[data-testid="chat-globe"] canvas')?.getBoundingClientRect().toJSON(),
          header: document.querySelector('[aria-label="Research conversation"] > header')?.getBoundingClientRect().toJSON(),
        };
      });
      await page.screenshot({ path: join(screenshotDir, `home-${width}x${height}.png`) });
      assert.equal(measurements.docWidth, width, `Horizontal overflow at ${width}x${height}`);
      assert(measurements.globe && measurements.canvas && measurements.header, "Signature globe missing");
      assert(measurements.globe.left >= measurements.header.left && measurements.globe.right <= measurements.header.right && measurements.globe.bottom <= measurements.header.bottom + 1,
        `Globe must stay inside the chat header at ${width}px`);
      assert(measurements.canvas.left >= measurements.globe.left && measurements.canvas.right <= measurements.globe.right && measurements.canvas.bottom <= measurements.globe.bottom,
        `Globe canvas must fit its visible wrapper at ${width}px`);
      assert.equal(await page.locator('[data-testid="chat-globe"]').getAttribute("aria-hidden"), "true");
      assert.equal(await page.locator('[data-testid="chat-globe"]').evaluate(element => getComputedStyle(element).pointerEvents), "none");
      assert.equal(await page.locator('[data-testid="chat-globe"] svg g').first().evaluate(element => getComputedStyle(element).animationName), "none");
      assert(measurements.input && measurements.cta, `Question and action missing at ${width}x${height}`);
      assert(measurements.input.top >= 0 && measurements.input.top < height,
        `Question misses first viewport at ${width}x${height}: ${measurements.input.top}`);
      assert(measurements.cta.top > measurements.input.bottom,
        `Action precedes question at ${width}x${height}`);
      assert(measurements.cap && measurements.cap.bottom <= measurements.cta.top,
        `Source cap must be visible before the action at ${width}x${height}`);
      if (width <= 430 && height >= 640) assert(measurements.cta.bottom <= height,
        `Mobile action is cut off in the first viewport at ${width}x${height}: ${measurements.cta.bottom}`);
      if (width >= 1024) assert(measurements.cta.bottom <= height,
        `Desktop action misses first viewport at ${width}x${height}: ${measurements.cta.bottom}`);
      assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
      assert.equal(await page.locator('[aria-label="Example questions"] button').count(), 2);
      assert.equal(await page.getByRole("button", { name: "How it works" }).isVisible(), true);
      if (width >= 768) {
        assert(measurements.guide && measurements.kickerText && measurements.headline);
        assert(measurements.kickerText.right + 8 <= measurements.guide.left,
          `Guide overlaps the intro label at ${width}px`);
        assert(measurements.guide.bottom <= measurements.headline.top,
          `Guide overlaps the headline at ${width}px`);
      }
      assert.equal(await page.locator('[data-tour="budget"]').isVisible(), false);

      if (width === 320 && height === 640) {
        const cap = page.getByTestId("composer-source-cap");
        const previousStyle = await cap.getAttribute("style");
        try {
          // The Linux CI capture wrapped this disclosure into two lines. Keep the
          // action reachable with wider fallback glyphs even on a narrower host font.
          await cap.evaluate(element => {
            element.style.fontFamily = "monospace";
            element.style.maxWidth = "200px";
          });
          const wrapped = await cap.evaluate(element => ({
            height: element.getBoundingClientRect().height,
            width: element.getBoundingClientRect().width,
            font: getComputedStyle(element).fontFamily,
            lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
            text: element.textContent,
          }));
          assert(wrapped.height >= wrapped.lineHeight * 2 - 1,
            `Fallback fixture must positively wrap the source cap: ${JSON.stringify(wrapped)}`);
          const action = await page.locator('[data-tour="dispatch-btn"]').boundingBox();
          const metadata = await page.getByTestId("paper-metadata-handoff").boundingBox();
          await page.screenshot({ path: join(screenshotDir, "home-320x640-wrapped-cap.png") });
          assert(action && action.y + action.height <= height,
            `Mobile action is cut off with a wrapped source cap: ${action && action.y + action.height}`);
          assert(metadata && metadata.height >= 44 && metadata.y + metadata.height <= action.y,
            "Free metadata must retain a 44px target before research");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        } finally {
          await cap.evaluate((element, style) => {
            if (style === null) element.removeAttribute("style");
            else element.setAttribute("style", style);
          }, previousStyle);
        }
      }

      if (width === 320 || width === 1366) {
        await page.getByText(/Budget and model:/).click();
        assert.equal(await page.locator('[data-tour="budget"]').isVisible(), true);
        const range = await page.getByLabel("Maximum budget in USDC").boundingBox();
        assert(range && range.height >= 44, `Budget target under 44px at ${width}px`);
        await page.getByRole("button", { name: "How it works" }).click();
        await page.getByRole("dialog", { name: "How Keryx works" }).waitFor();
        await page.getByRole("button", { name: "Close tour" }).click();
      }
      if ((width === 390 && height >= 640) || width === 1366) {
        await page.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
        await page.getByRole("textbox", { name: "What do you want to know?" }).waitFor();
        await page.waitForFunction(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="chat-globe"] canvas');
          const context = canvas?.getContext("2d");
          if (!canvas || !context || !canvas.width) return false;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let landPixels = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60 && pixels[i + 3] > 200) landPixels++;
          return landPixels > 700;
        });
        await page.screenshot({ path: join(screenshotDir, `research-${width}x${height}.png`) });
        const action = await page.locator('[data-tour="dispatch-btn"]').boundingBox();
        assert(action && action.y + action.height <= height, `Shared research action misses first viewport at ${width}px`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      }
      if (width === 320 || width === 768 || width === 1440) {
        await page.goto(`${base}/sources`, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Find a source" }).waitFor();
        await page.evaluate(() => { (window as unknown as { sourceDocument: string }).sourceDocument = "same-next-document"; });
        await page.getByRole("navigation", { name: "Browse source topics" }).getByRole("link", { name: "Payments", exact: true }).click();
        await page.waitForURL(url => url.searchParams.get("topic") === "payments");
        await page.waitForFunction(() => (document.querySelector('select[name="topic"]') as HTMLSelectElement)?.value === "payments");
        assert.equal(await page.evaluate(() => (window as unknown as { sourceDocument?: string }).sourceDocument), "same-next-document",
          "The filter must reflect a real Next client transition, not merely a fresh document");
        await page.getByLabel("Collection", { exact: true }).selectOption("explore");
        await page.getByLabel("Sort", { exact: true }).selectOption("name");
        await page.getByLabel("Search titles, publishers, domains, authors or identifiers").fill("circle.com");
        await page.getByRole("button", { name: "Find sources" }).click();
        await page.waitForURL(url => url.searchParams.get("q") === "circle.com" && url.searchParams.get("kind") === "explore");
        await page.getByRole("heading", { name: "Publisher directory", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => (window as unknown as { sourceDocument?: string }).sourceDocument), "same-next-document",
          "GET search submission must preserve Next history navigation");
        assert.equal(await page.getByLabel("Collection", { exact: true }).inputValue(), "explore");
        assert.equal(await page.getByLabel("Sort", { exact: true }).inputValue(), "name");
        assert.equal(await page.locator("#publisher-directory article").count(), 2);
        await page.goBack();
        await page.waitForFunction(() => (document.querySelector('select[name="topic"]') as HTMLSelectElement)?.value === "payments"
          && (document.querySelector('select[name="kind"]') as HTMLSelectElement)?.value === "all");
        assert.equal(await page.getByLabel("Search titles, publishers, domains, authors or identifiers").inputValue(), "");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await page.screenshot({ path: join(screenshotDir, `sources-navigation-${width}x${height}.png`) });
      }
      console.log(`PASS ${width}x${height}: input y=${Math.round(measurements.input.top)}, action y=${Math.round(measurements.cta.top)}, no horizontal overflow`);
    } finally {
      await context.close();
    }
  }
  console.log(`Responsive screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
  if (child) { child.kill(); await exited; }
}
