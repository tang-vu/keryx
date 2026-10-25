/** Actual globe + authored Tailwind CSS, with only the shipped atlas chunk held. No live HTTP or app state. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Page } from "playwright";

const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === "--baseline" && /^[a-f0-9]{40}$/.test(args[1]), "Only an exact baseline commit may be selected");
const baseline = args[1];
const component = "components/keryx/globe-watermark.tsx";
const plugins: Plugin[] = baseline ? [{ name: "exact-historical-globe", setup(api) {
  const source = execFileSync("git", ["--no-pager", "-c", "core.fsmonitor=false", "show", `${baseline}:${component}`],
    { encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
  api.onLoad({ filter: /[\\/]components[\\/]keryx[\\/]globe-watermark\.tsx$/ }, () => ({ contents: source, loader: "tsx", resolveDir: path.resolve("components/keryx") }));
} }] : [];
// Reuse the canonical placement rather than recreating its mobile scale in fixture CSS.
const chat = await readFile("components/keryx/research-chat.tsx", "utf8");
const section = chat.match(/return <section className="([^"]+)"/)?.[1];
const header = chat.match(/<header className="([^"]+)"/)?.[1];
const placement = chat.match(/<div aria-hidden="true" data-testid="chat-globe"[\s\S]*?<\/div>/)?.[0];
assert(section && header && placement && placement.includes("<GlobeWatermark"), "Canonical globe placement changed; review the fixture");
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{GlobeWatermark}from'./${component}';
    createRoot(document.getElementById('root')).render(<React.StrictMode><section className=${JSON.stringify(section)}><header className=${JSON.stringify(header)}>${placement}</header></section></React.StrictMode>);`,
    loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, splitting: true, format: "esm", platform: "browser", jsx: "automatic",
  outdir: ".artifacts/globe-fixture-memory", entryNames: "entry", chunkNames: "chunks/[name]-[hash]", metafile: true,
  define: { "process.env.NODE_ENV": '"production"' }, plugins,
});
const outputDir = path.resolve(".artifacts/globe-fixture-memory");
const files = new Map(bundle.outputFiles.map(file => ["/" + path.relative(outputDir, file.path).replaceAll("\\", "/"), file.text]));
const atlasEntries = Object.entries(bundle.metafile.outputs).filter(([, value]) => value.entryPoint?.replaceAll("\\", "/").endsWith("world-atlas/countries-110m.json"));
assert.equal(atlasEntries.length, 1, "Hold the exact shipped atlas module, not a mocked import");
const atlasPath = "/" + path.relative(outputDir, path.resolve(atlasEntries[0][0])).replaceAll("\\", "/");
assert(files.has(atlasPath));
assert(Object.keys(bundle.metafile.inputs).some(file => file.replaceAll("\\", "/").endsWith("world-atlas/countries-110m.json")));
assert(!Object.keys(bundle.metafile.inputs).some(file => /(?:lib\/(?:agent|db|payments)|session-grant|use-ask-stream)/.test(file.replaceAll("\\", "/"))), "Globe fixture must not import application state");
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR ?? path.resolve(".artifacts/globe-initial-layout");
await mkdir(screenshots, { recursive: true });
async function geometry(page: Page) {
  return page.locator('[data-testid="chat-globe"]').evaluate(wrapper => {
    const canvas = wrapper.querySelector("canvas")!, root = canvas.parentElement!;
    const rectangles = [];
    for (const node of [wrapper, root, canvas]) { const r = node.getBoundingClientRect();
      rectangles.push({ left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }); }
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let land = 0, water = 0, opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) opaque++;
      if (pixels[i] === 34 && pixels[i + 1] === 25 && pixels[i + 2] === 15 && pixels[i + 3] === 255) land++;
      if (pixels[i] === 241 && pixels[i + 1] === 233 && pixels[i + 2] === 215 && pixels[i + 3] === 255) water++;
    }
    return { viewport: innerWidth, docWidth: document.documentElement.scrollWidth, dpr: devicePixelRatio,
      wrapper: rectangles[0], root: rectangles[1], rootClientWidth: root.clientWidth, canvas: rectangles[2],
      backing: { width: canvas.width, height: canvas.height }, inlineWidth: canvas.style.width, inlineHeight: canvas.style.height,
      land, water, opaque };
  });
}
function bounded(value: Awaited<ReturnType<typeof geometry>>) {
  assert.equal(value.docWidth, value.viewport, "Globe must not create document overflow");
  assert(value.canvas.left >= value.wrapper.left - 1 && value.canvas.right <= value.wrapper.right + 1, "Canvas escapes the canonical globe wrapper");
  assert(Math.abs(value.canvas.width - value.canvas.height) <= 1, "Canvas CSS must be square before atlas initialization");
  assert(Math.abs(value.canvas.width - value.root.width * 0.78) <= 1, "Canvas must retain the shipped 78% globe proportion");
}
async function pixelsChange(page: Page) {
  const before = await page.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(150);
  return before !== await page.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
}
async function orbitState(page: Page, state: "running" | "paused") {
  await page.waitForFunction(state => {
    const orbit = document.querySelector('[data-testid="chat-globe"] g');
    if (!orbit) return false;
    const style = getComputedStyle(orbit);
    return style.animationPlayState === state || state === "paused" && style.animationName === "none";
  }, state);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
const browser = await chromium.launch({ headless: true,
  ...(process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE ? { executablePath: process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE } : {}) });
try {
  for (const [width, height, dpr] of [[320, 640, 1], [390, 640, 2], [768, 768, 1], [1366, 768, 2]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "reduce", serviceWorkers: "block" });
    let release!: () => void, atlasRequests = 0;
    const held = new Promise<void>(done => { release = done; });
    const errors: string[] = [], page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, "https://globe-layout.test", "No external origin is permitted");
      assert.equal(request.method(), "GET", "Globe fixture cannot write");
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>' });
      if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      const source = files.get(url.pathname); assert(source, `Unexpected fixture request: ${url.pathname}`);
      if (url.pathname === atlasPath) { atlasRequests++; await held; }
      return route.fulfill({ contentType: "text/javascript", body: source });
    });
    try {
      const request = page.waitForRequest(request => new URL(request.url()).pathname === atlasPath);
      await page.goto("https://globe-layout.test/", { waitUntil: "domcontentloaded" }); await request;
      await page.locator('[data-testid="chat-globe"] canvas').waitFor();
      const before = await geometry(page);
      console.log(JSON.stringify({ phase: "atlas-held", baseline: baseline ?? null, width, height, ...before }));
      await page.screenshot({ path: path.join(screenshots, `globe-${width}-dpr${dpr}-held.png`) });
      assert.equal(atlasRequests, 1); assert.deepEqual(before.backing, { width: 300, height: 150 });
      assert.equal(before.inlineWidth, ""); assert.equal(before.inlineHeight, ""); assert.equal(before.opaque, 0);
      bounded(before);
      release();
      await page.waitForFunction(() => { const canvas = document.querySelector('[data-testid="chat-globe"] canvas') as HTMLCanvasElement;
        return canvas?.style.width !== "" && canvas.width === Math.round(Math.round(Math.max(140, canvas.parentElement!.clientWidth) * 0.78) * devicePixelRatio); });
      const after = await geometry(page); bounded(after);
      assert.equal(after.backing.width, after.backing.height); assert.equal(after.dpr, dpr);
      assert(after.land > 100 && after.water > 100, "Actual shipped atlas must render both land and ocean, not just a blank/disc placeholder");
      assert(Math.abs(after.canvas.width - before.canvas.width) <= 1 && Math.abs(after.canvas.height - before.canvas.height) <= 1, "Initialization must preserve the CSS footprint");
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ phase: "atlas-rendered", width, height, ...after }));
      await page.screenshot({ path: path.join(screenshots, `globe-${width}-dpr${dpr}-rendered.png`) });
      assert.equal(await pixelsChange(page), false, "Reduced-motion atlas remains static");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await orbitState(page, "running");
      assert.equal(await pixelsChange(page), true, "Canvas resumes after live motion-preference change");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await orbitState(page, "paused");
      assert.equal(await pixelsChange(page), false, "Canvas pauses after live reduced-motion change");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await orbitState(page, "running");
      await page.evaluate(() => { document.body.style.minHeight = "2400px"; scrollTo(0, 1200); });
      await orbitState(page, "paused");
      assert(await page.locator("canvas").evaluate(canvas => canvas.getBoundingClientRect().bottom < 0));
      assert.equal(await pixelsChange(page), false, "Offscreen canvas retains its last rendered frame");
      await page.evaluate(() => scrollTo(0, 0));
      await orbitState(page, "running");
      assert.equal(await pixelsChange(page), true, "Visible canvas resumes");
      // Synthetic browser-visibility signal only; canvas, atlas, media changes and intersection are real.
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await orbitState(page, "paused");
      assert.equal(await pixelsChange(page), false, "Hidden document pauses canvas and SVG");
      await page.evaluate(() => {
        delete (document as unknown as { hidden?: boolean }).hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await orbitState(page, "running");
      assert.equal(await pixelsChange(page), true, "Restored visible document resumes canvas");
      assert.deepEqual(errors, []);
    } finally { release(); await context.close(); }
  }
  console.log("PASS: delayed shipped atlas stays bounded at mobile/desktop DPR1/2 under Strict Mode; actual canvas/SVG follow dynamic reduced motion, real viewport intersections and synthetic document visibility; all HTTP intercepted.");
} finally { await browser.close(); }
