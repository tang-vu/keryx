/** Real evidence browser, synthetic HTTP only. No database, research, signature or settlement. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 740 } });
  let listMode: "normal" | "empty" | "error" | "cap" = "normal";
  let previewMode: "normal" | "error" | "wrong" | "empty" = "normal";
  let releaseOld: (() => void) | undefined;
  let oldRequested = false;
  const errors: string[] = [];
  const calls: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.method(), "GET", "No write or payment request is permitted");
    assert.equal(url.origin, "https://evidence-browser.test");
    calls.push(url.pathname + url.search);
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    if (url.pathname === "/api/sources") {
      assert.equal(url.searchParams.get("limit"), "20");
      if (listMode === "error") return route.fulfill({ status: 503, json: {} });
      if (listMode === "empty") return route.fulfill({ json: { sources: [], total: 0 } });
      if (listMode === "cap") {
        const page = Number(url.searchParams.get("cursor") ?? "0");
        return route.fulfill({ json: { sources: Array.from({ length: 20 }, (_, i) => source(`${page * 20 + i}`)), total: 120, nextCursor: String(page + 1) } });
      }
      return route.fulfill({ json: url.searchParams.has("cursor")
        ? { sources: [source("second", "Second source")], total: 4 }
        : { sources: [source("slow", "Delayed source"), { ...source("one", "<img src=x onerror=alert(1)>"), description: "Circle integration evidence" }, { ...source("locked", "Locked source"), verified: false }], total: 4, nextCursor: "next+/=" } });
    }
    const id = /^\/api\/source\/([^/]+)\/preview$/.exec(url.pathname)?.[1];
    assert(id, `Unexpected HTTP request ${url}`);
    if (id === "slow") { oldRequested = true; await new Promise<void>((resolve) => { releaseOld = resolve; }); }
    if (previewMode === "error") return route.fulfill({ status: 503, json: {} });
    const locked = id === "locked";
    return route.fulfill({ json: { id: previewMode === "wrong" ? "different" : id,
      previewDepth: locked ? "locked" : "excerpt",
      preview: previewMode === "empty" ? [] : [{ itemId: `item-${id}`, title: id === "slow" ? "Old stale title" : "Evidence article", summary: locked ? "MUST NOT SHOW" : "<script>window.compromised=true</script>", itemPublishedAt: "2026-09-30T10:00:00Z", content: "MUST NOT SHOW PAID BODY" }] } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  async function mount() {
    await page.goto("https://evidence-browser.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
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
  assert.equal(await page.getByText("No creator sources are currently listed", { exact: false }).count(), 0);
  listMode = "empty";
  await page.getByRole("button", { name: "Retry source list" }).click();
  await page.getByText("No creator sources are currently listed", { exact: false }).waitFor();
  listMode = "cap";
  await mount();
  await select.waitFor();
  for (let count = 40; count <= 100; count += 20) {
    await page.getByRole("button", { name: "Load more sources" }).click();
    await page.getByText(`${count} of 120 listed sources loaded`, { exact: false }).waitFor();
  }
  assert.equal(await page.getByRole("button", { name: "Load more sources" }).count(), 0);
  await page.getByText("This view is limited to 100 sources", { exact: false }).waitFor();
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
