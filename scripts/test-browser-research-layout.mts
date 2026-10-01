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
        };
      });
      await page.screenshot({ path: join(screenshotDir, `home-${width}x${height}.png`) });
      assert.equal(measurements.docWidth, width, `Horizontal overflow at ${width}x${height}`);
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

      if (width === 320 || width === 1366) {
        await page.getByText(/Budget and model:/).click();
        assert.equal(await page.locator('[data-tour="budget"]').isVisible(), true);
        const range = await page.getByLabel("Maximum budget in USDC").boundingBox();
        assert(range && range.height >= 44, `Budget target under 44px at ${width}px`);
        await page.getByRole("button", { name: "How it works" }).click();
        await page.getByRole("dialog", { name: "How Keryx works" }).waitFor();
        await page.getByRole("button", { name: "Close tour" }).click();
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
