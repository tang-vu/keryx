/** Real evidence browser, synthetic HTTP only. No database, research, signature or settlement. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { evidencePageSchema, evidencePreviewSchema, mergeEvidenceSources } from "../lib/research/evidence-browser";

const source = (id: string, name = id) => ({ id, name, description: `Description ${id}`, tags: ["gateway"], verified: true });
assert.equal(evidencePageSchema.safeParse({ sources: Array.from({ length: 21 }, (_, i) => source(String(i))), total: 21 }).success, false);
assert.equal(mergeEvidenceSources([source("same")], [source("same", "updated")])[0].name, "updated");
assert.equal(mergeEvidenceSources([], Array.from({ length: 120 }, (_, i) => source(String(i)))).length, 100);
const stripped = evidencePreviewSchema.parse({ id: "one", previewDepth: "full", content: "private body", preview: [{ itemId: "item", title: "Title", content: "private body" }] });
assert(!("content" in stripped));
assert(!("content" in stripped.preview[0]));

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ResearchEvidenceBrowser} from './components/keryx/research-evidence-browser';
    createRoot(document.getElementById('root')).render(<ResearchEvidenceBrowser/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
});
const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"),
  { from: resolve("app/globals.css") })).css;
const fonts = `@font-face{font-family:SourceDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:SourceSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:SourceMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
  :root{--font-bodoni:SourceDisplay;--font-spectral:SourceSerif;--font-spline-mono:SourceMono}`;
const screenshotDir = process.env.KERYX_UX_SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 740 } });
  let listMode: "normal" | "empty" | "error" | "cap" | "design" = "normal";
  let previewMode: "normal" | "error" | "wrong" | "empty" = "normal";
  let releaseOld: (() => void) | undefined;
  let oldRequested = false;
  let holdList = false, holdPreview = false;
  let releaseList: (() => void) | undefined, releasePreview: (() => void) | undefined;
  const errors: string[] = [];
  const calls: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.method(), "GET", "No write or payment request is permitted");
    assert.equal(url.origin, "https://evidence-browser.test");
    calls.push(url.pathname + url.search);
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/source.css"></head><body><div id="root" style="max-width:1080px;margin:24px auto;padding:0 16px"></div></body></html>' });
    if (url.pathname === "/source.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
    if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
    if (url.pathname === "/api/sources") {
      assert.equal(url.searchParams.get("limit"), "20");
      if (holdList) await new Promise<void>(done => { releaseList = done; });
      if (listMode === "error") return route.fulfill({ status: 503, json: {} });
      if (listMode === "empty") return route.fulfill({ json: { sources: [], total: 0 } });
      if (listMode === "cap") {
        const page = Number(url.searchParams.get("cursor") ?? "0");
        return route.fulfill({ json: { sources: Array.from({ length: 20 }, (_, i) => source(`${page * 20 + i}`)), total: 120, nextCursor: String(page + 1) } });
      }
      if (listMode === "design") return route.fulfill({ json: { sources: [
        { ...source("design", "Independent Research Journal"), description: "Methods, measured results and original research. Public excerpts can be inspected before deciding whether to commission a report." },
        { ...source("stress", "Nghiên cứu " + "LongUnbrokenPublisherName".repeat(8)), description: "A multilingual description: Tiếng Việt, 中文. " + "unbroken".repeat(30), verified: false, evidenceProvenance: "synthetic-demo" },
      ], total: 2 } });
      return route.fulfill({ json: url.searchParams.has("cursor")
        ? { sources: [source("second", "Second source")], total: 4 }
        : { sources: [source("slow", "Delayed source"), { ...source("one", "<img src=x onerror=alert(1)>"), description: "Circle integration evidence" }, { ...source("locked", "Locked source"), verified: false }], total: 4, nextCursor: "next+/=" } });
    }
    const id = /^\/api\/source\/([^/]+)\/preview$/.exec(url.pathname)?.[1];
    assert(id, `Unexpected HTTP request ${url}`);
    if (holdPreview && id === "design") await new Promise<void>(done => { releasePreview = done; });
    if (id === "slow") { oldRequested = true; await new Promise<void>((resolve) => { releaseOld = resolve; }); }
    if (previewMode === "error") return route.fulfill({ status: 503, json: {} });
    const locked = id === "locked";
    return route.fulfill({ json: { id: previewMode === "wrong" ? "different" : id,
      previewDepth: locked ? "locked" : "excerpt",
      preview: listMode === "design" ? Array.from({ length: 5 }, (_, index) => ({
        itemId: `public-${index}`, title: index === 0 ? "Reading the evidence behind a measured result" : `Public research note ${index + 1}`,
        summary: ("This is a synthetic public excerpt, not purchased article content. Read methods and limitations alongside the observed result. " + "記録された公開プレビュー。 ").repeat(7),
        itemPublishedAt: "2026-09-30", evidenceProvenance: "synthetic-demo",
      })) : previewMode === "empty" ? [] : [{ itemId: `item-${id}`, title: id === "slow" ? "Old stale title" : "Evidence article", summary: locked ? "MUST NOT SHOW" : "<script>window.compromised=true</script>", itemPublishedAt: "2026-09-30T10:00:00Z", content: "MUST NOT SHOW PAID BODY" }] } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  async function mount() {
    await page.goto("https://evidence-browser.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  }
  async function touchTarget(name: string) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `${name} retains a 44px target`);
  }
  function release(gate: (() => void) | undefined) {
    assert(gate, "The held synthetic request must have started");
    gate();
  }
  await mount();
  const select = page.getByLabel("Choose a source to inspect");
  await select.waitFor();
  await page.getByText("3 of 4 listed sources loaded", { exact: false }).waitFor();
  await page.getByLabel("Search loaded source names, descriptions and tags").fill("circle integration");
  assert.equal(await select.locator("option").count(), 2);
  await select.selectOption("one");
  await page.getByText("Evidence article", { exact: true }).waitFor();
  assert.equal(await page.locator("img, script[src]").count(), 0);
  assert.equal(await page.getByText("<script>window.compromised=true</script>", { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised ?? false), false);
  assert.equal(await page.getByText("MUST NOT SHOW PAID BODY").count(), 0);
  await page.getByText("Publisher date: 2026-09-30T10:00:00Z", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, "");
  await page.getByLabel("Search loaded source names, descriptions and tags").fill("absent corpus");
  await page.getByText("No match in loaded sources", { exact: false }).waitFor();
  assert.equal(await page.getByText("Evidence article", { exact: true }).count(), 0);
  await page.getByLabel("Search loaded source names, descriptions and tags").fill("");
  await select.selectOption("locked");
  await page.getByText("Title-only public preview", { exact: false }).waitFor();
  await page.getByText("Ownership unverified:", { exact: false }).waitFor();
  assert.equal(await page.getByText("MUST NOT SHOW", { exact: true }).count(), 0);
  await select.selectOption("slow");
  await page.waitForFunction(() => document.body.textContent?.includes("Loading public preview"));
  for (let i = 0; i < 50 && !oldRequested; i++) await page.waitForTimeout(20);
  assert(oldRequested, "Delayed request started");
  await select.selectOption("one");
  await page.getByText("Evidence article", { exact: true }).waitFor();
  releaseOld?.();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText("Old stale title", { exact: true }).count(), 0);
  previewMode = "error";
  await select.selectOption("locked");
  await page.getByRole("button", { name: "Retry preview" }).waitFor();
  await touchTarget("Retry preview");
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, "source-preview-error.png"), fullPage: true });
  assert.equal(await page.getByText("Evidence article", { exact: true }).count(), 0);
  previewMode = "wrong";
  await page.getByRole("button", { name: "Retry preview" }).click();
  await page.getByRole("button", { name: "Retry preview" }).waitFor();
  assert.equal(await page.getByText("Evidence article", { exact: true }).count(), 0);
  previewMode = "empty";
  await page.getByRole("button", { name: "Retry preview" }).click();
  await page.getByText("No public article previews", { exact: false }).waitFor();
  previewMode = "normal";
  await page.getByRole("button", { name: "Load more sources" }).click();
  await page.getByText("4 of 4 listed sources loaded", { exact: false }).waitFor();
  assert(calls.some((call) => call.includes("cursor=next%2B%2F%3D")), "Cursor encoded without changing query structure");
  listMode = "error";
  await mount();
  await page.getByText("Its availability is unknown", { exact: false }).waitFor();
  await touchTarget("Retry source list");
  assert.equal(await page.getByText("No creator sources are currently listed", { exact: false }).count(), 0);
  listMode = "empty";
  await page.getByRole("button", { name: "Retry source list" }).click();
  await page.getByText("No creator sources are currently listed", { exact: false }).waitFor();
  listMode = "cap";
  await mount();
  await select.waitFor();
  for (let count = 40; count <= 100; count += 20) {
    await touchTarget("Load more sources");
    await page.getByRole("button", { name: "Load more sources" }).click();
    await page.getByText(`${count} of 120 listed sources loaded`, { exact: false }).waitFor();
  }
  assert.equal(await page.getByRole("button", { name: "Load more sources" }).count(), 0);
  await page.getByText("This view is limited to 100 sources", { exact: false }).waitFor();
  for (const width of [320, 390, 768, 1366]) {
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion });
      listMode = "design"; holdList = true; holdPreview = true;
      releaseList = undefined; releasePreview = undefined;
      await mount();
      await page.getByText("Loading source list", { exact: false }).waitFor();
      const loading = await page.getByText("Loading source list", { exact: false }).evaluate(element => ({
        icon: getComputedStyle(element.querySelector("svg")!).animationName, animations: document.getAnimations().length,
      }));
      assert.equal(loading.icon === "none", reducedMotion === "reduce", "Loading activity follows the actual motion preference");
      if (screenshotDir && width === 390) await page.screenshot({ path: join(screenshotDir, `source-list-loading-${reducedMotion}.png`), fullPage: true });
      holdList = false; release(releaseList);
      await select.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const controls = await page.locator("#evidence-source-search, #evidence-source-select").evaluateAll(elements => elements.map(element => ({
        size: parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height,
      })));
      assert(controls.every(control => control.size >= 16 && control.height >= 44), "Native search/select retain 16px text and 44px targets");
      await select.focus();
      await select.selectOption("design");
      await page.getByText("Loading public preview", { exact: false }).waitFor();
      const pane = await page.locator(".kx-source-preview").elementHandle();
      assert(pane);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const sourceMotion = await pane.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.ready));
        return {
        start: element.getAnimations()[0]?.startTime ?? null,
        motions: element.getAnimations().map(animation => ({
          name: (animation as CSSAnimation).animationName, timing: animation.effect!.getTiming(),
          keys: (animation.effect as KeyframeEffect).getKeyframes(),
        })),
        };
      });
      if (reducedMotion === "reduce") assert.deepEqual(sourceMotion.motions, []);
      else {
        assert.notEqual(sourceMotion.start, null, "The source animation clock must be ready before comparing identity");
        assert(sourceMotion.motions.some(animation => animation.name === "kxSourceArrive"));
        for (const animation of sourceMotion.motions) {
          assert(Number(animation.timing.duration) <= 320 && animation.timing.iterations === 1);
          assert(animation.keys.every(key => Object.keys(key).every(property => ["offset", "computedOffset", "easing", "composite", "opacity", "transform"].includes(property))),
            "Source entrance cannot animate layout or filters");
        }
      }
      assert(await select.evaluate(element => document.activeElement === element), "Selecting a source must not move focus");
      if (screenshotDir && width === 390) await page.screenshot({ path: join(screenshotDir, `source-preview-loading-${reducedMotion}.png`), fullPage: true });
      holdPreview = false; release(releasePreview);
      await page.getByRole("heading", { name: "Reading the evidence behind a measured result" }).waitFor();
      assert(await pane.evaluate(element => element.isConnected), "Preview arrival keeps the selected source DOM stable");
      assert.equal(await pane.evaluate(element => element.getAnimations()[0]?.startTime ?? null), sourceMotion.start,
        "An arriving preview must not replay its source entrance");
      const articles = page.getByRole("region", { name: "Public preview summaries · not paid article content", exact: true });
      assert.equal(await articles.getByRole("listitem").count(), 5);
      await articles.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      await select.focus();
      await page.keyboard.press("Tab");
      assert(await articles.evaluate(element => document.activeElement === element), "Excerpt scroll region is reachable from the native select");
      const readingY = await page.evaluate(() => scrollY);
      await page.keyboard.press("PageDown");
      await page.waitForFunction(() => document.querySelector("[data-preview-articles]")!.scrollTop > 0);
      assert.equal(await page.evaluate(() => scrollY), readingY, "PageDown scrolls excerpts instead of the outer page");
      const geometry = await articles.evaluate(element => ({
        doc: document.documentElement.scrollWidth, viewport: innerWidth, scroll: element.scrollHeight,
        height: element.clientHeight, contentWidth: element.scrollWidth, width: element.clientWidth,
      }));
      assert(geometry.doc <= width && geometry.contentWidth <= geometry.width + 1, `Preview fits at ${width}px`);
      assert(geometry.scroll > geometry.height && geometry.height <= 449, "Five long excerpts retain a bounded reading surface");
      await articles.evaluate(async element => {
        // Let the native PageDown finish before capturing the top of the reader.
        let previous = element.scrollTop, stable = 0;
        for (let frame = 0; frame < 120; frame++) {
          await new Promise(requestAnimationFrame);
          const next = element.scrollTop;
          stable = Math.abs(next - previous) < .5 ? stable + 1 : 0;
          previous = next;
          if (stable >= 4) {
            element.scrollTo({ top: 0, behavior: "instant" });
            return;
          }
        }
        throw new Error("Native keyboard scroll did not settle");
      });
      await page.waitForFunction(() => document.querySelector("[data-preview-articles]")!.scrollTop === 0);
      await page.locator("section").evaluate(element => element.scrollIntoView({ behavior: "instant" }));
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `source-inspector-${width}-${reducedMotion}.png`), fullPage: true });
      const input = page.getByLabel("Search loaded source names, descriptions and tags");
      await input.focus();
      assert(await input.evaluate(element => getComputedStyle(element).outlineStyle !== "none" && parseFloat(getComputedStyle(element).outlineWidth) >= 2),
        "Keyboard focus has a visible outline");
      await select.selectOption("stress");
      await page.getByText("Ownership unverified:", { exact: false }).waitFor();
      await page.getByText("Synthetic demo content:", { exact: false }).waitFor();
      assert.equal(await page.getByRole("heading", { level: 3 }).textContent(), "Nghiên cứu " + "LongUnbrokenPublisherName".repeat(8));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, "Long multilingual/unbroken publisher metadata stays within the viewport");
      if (width === 390 && reducedMotion === "no-preference") {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".kx-source-preview")!).animationName === "none");
        assert.equal(await page.locator(".kx-source-preview").evaluate(element => getComputedStyle(element).transform), "none");
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: bounded pagination/search, public metadata only, hostile text, locked/unverified states, stale isolation, preview identity/error/retry/empty, list outage/empty and 100-source cap. All HTTP synthetic GET-only.");
  const base = process.env.KERYX_UX_BASE_URL ?? process.env.KERYX_TEST_BASE_URL;
  if (base) {
    const origin = new URL(base).origin;
    for (const width of [320, 1366]) {
      const built = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        await built.route("**/*", (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) return route.abort();
          assert.equal(request.method(), "GET", "Built research inspection must not write or buy");
          if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [source("fixture", "Independent publisher fixture")], total: 1 } });
          if (url.pathname === "/api/source/fixture/preview") return route.fulfill({ json: { id: "fixture", previewDepth: "full", preview: [{ itemId: "fixture-item", title: "Synthetic public article title", summary: "Synthetic preview summary, not real corpus evidence." }] } });
          if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
          return route.continue();
        });
        const builtPage = await built.newPage();
        const builtErrors: string[] = [];
        builtPage.on("pageerror", error => builtErrors.push(error.message));
        const response = await builtPage.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
        assert.equal(response?.status(), 200);
        const evidence = builtPage.getByRole("heading", { name: "Inspect the evidence before paying" });
        await evidence.waitFor();
        await builtPage.getByLabel("Choose a source to inspect").selectOption("fixture");
        await builtPage.getByText("Synthetic public article title", { exact: true }).waitFor();
        const positions = await builtPage.evaluate(() => ({
          evidence: document.getElementById("research-evidence-heading")!.getBoundingClientRect().top,
          price: document.getElementById("package-heading")!.getBoundingClientRect().top,
          width: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        assert(positions.evidence < positions.price, "Inspect evidence before the price and checkout");
        assert.equal(positions.width, positions.viewport, `Research page horizontal overflow at ${width}px`);
        const screenshotDir = process.env.KERYX_UX_SCREENSHOT_DIR;
        if (screenshotDir) {
          await mkdir(screenshotDir, { recursive: true });
          await builtPage.screenshot({ path: join(screenshotDir, `research-evidence-${width}.png`), fullPage: true });
        }
        assert.deepEqual(builtErrors, []);
      } finally { await built.close(); }
    }
    console.log("PASS: built /research hydration and inspect-before-price layout at 320/1366px; synthetic source/preview HTTP, all other API reads intercepted, no writes or external requests.");
  }
} finally { await browser.close(); }
