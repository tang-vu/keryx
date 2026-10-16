// In-memory renderer smoke: isolated loopback port, fake native API, no hosted requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const renderer = await build({ entryPoints: [join(root, "desktop/src/renderer.tsx")], bundle: true,
  platform: "browser", format: "iife", write: false, logLevel: "silent" });
const style = await build({ entryPoints: [join(root, "desktop/src/style.css")], bundle: true,
  external: ["./fonts/*"], write: false, logLevel: "silent" });
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/renderer.js"></script></html>';
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'");
  if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  if (path === "/renderer.js" || path === "/style.css") {
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css");
    response.end(path.endsWith(".js") ? renderer.outputFiles[0].contents : style.outputFiles[0].contents); return;
  }
  if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
    try { response.setHeader("Content-Type", "font/woff2"); response.end(await readFile(join(root, "desktop/assets", path.slice(1)))); return; }
    catch { /* Missing assets return 404 below. */ }
  }
  response.writeHead(404).end();
});
await new Promise(yes => server.listen(0, "127.0.0.1", yes));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
  let externalRequests = 0;
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests++; return route.abort();
  });
  await page.addInitScript(() => {
    const privateTask = { handle: "private-task", question: "PRIVATE LOCAL TASK", mode: "deep", status: { stage: "ready" } };
    const view = { name: "Private workspace", path: "C:\\private\\workspace", tasks: [privateTask], references: [], invalidDirectories: 0 };
    window.sponsoredCalls = []; window.localWrites = 0;
    window.keryxDesktop = {
      refresh: async () => view, chooseWorkspace: async () => null, createWorkspace: async () => null,
      researchSponsored: input => { window.sponsoredCalls.push(input); return new Promise(resolveRequest => { window.finishSponsored = resolveRequest; }); },
      createTask: async () => { window.localWrites++; throw Error("Unexpected local task write"); },
      resumeTask: async () => { throw Error("Unexpected local resume"); }, readResult: async () => null,
      exportBrief: async () => false, exportTask: async () => false, importReference: async () => null,
    };
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Sponsored research", exact: true }).click();
  const question = page.getByRole("textbox", { name: "Shareable question" });
  assert.equal(await question.inputValue(), "");
  assert.equal(await page.getByText("PRIVATE LOCAL TASK", { exact: true }).count(), 0);
  const ask = page.getByRole("button", { name: "Ask", exact: true });
  await question.fill("Public browser question");
  await page.getByRole("spinbutton", { name: "Source budget (USDC)" }).fill("0");
  assert.equal(await ask.isDisabled(), true);
  await page.getByRole("radio", { name: /Deep/ }).check();
  await page.getByRole("checkbox").check();
  await page.locator(".sponsored-screen form").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await page.getByRole("button", { name: "Asking…", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.sponsoredCalls), [
    { question: "Public browser question", mode: "deep", budget: 0, publicReport: true },
  ]);
  await page.getByRole("button", { name: "Local tasks", exact: true }).click();
  await page.getByRole("button", { name: "Sponsored research", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Asking…", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.finishSponsored({ ok: true, result: {
    answer: "A plain public answer <img src='https://example.invalid/pixel'> [1]", queryId: "11111111-1111-4111-8111-111111111111",
    dispatchUrl: "https://keryx.cc/dispatch/11111111-1111-4111-8111-111111111111",
    citations: [{ sourceName: "Public citation", sourceUrl: "https://example.org/source" }],
  } }));
  await page.getByRole("heading", { name: "Research result", exact: true }).waitFor();
  assert.equal(await page.locator(".sponsored-result img").count(), 0);
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  assert.equal(await page.evaluate(() => window.localWrites), 0);
  const report = page.getByRole("textbox", { name: "Public report URL", exact: true });
  await page.locator(".sponsored-report").getByRole("button", { name: "Select URL", exact: true }).click();
  assert.equal(await report.evaluate(input => input.selectionEnd - input.selectionStart), (await report.inputValue()).length);
  for (const [width, height] of [[1240, 900], [760, 700], [390, 850]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => { await document.fonts.ready; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
    assert.equal(await page.getByRole("button", { name: "Sponsored research", exact: true }).isVisible(), true);
    assert.equal(await question.isVisible(), true);
  }
  const networkDenied = await page.evaluate(async () => {
    try { await fetch("https://keryx.cc/api/v1/chat/completions"); return false; } catch { return true; }
  });
  assert.equal(networkDenied, true); assert.equal(externalRequests, 0);
  if (process.env.KERYX_SPONSORED_UI_SCREENSHOT) await page.screenshot({ path: resolve(process.env.KERYX_SPONSORED_UI_SCREENSHOT), fullPage: true });
  console.log("Sponsored Desktop browser smoke passed: public intent, zero budget, duplicate lock, tab persistence, plain text, selectable URLs, 3 widths, no renderer network or private writes.");
} finally {
  await browser?.close();
  await new Promise(yes => server.close(yes));
}
