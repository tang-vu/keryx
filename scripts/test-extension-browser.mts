/** Real unpacked MV3 popup, synthetic transport only. No live research or payments. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extension = resolve("extension");
const profile = await mkdtemp(join(tmpdir(), "keryx-extension-fixture-"));
const context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
  acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  assert.equal(await worker.evaluate("chrome.runtime.getManifest().version"), "0.1.3");
  let failure = false;
  let includePage = false;
  const calls: unknown[] = [];
  const errors: string[] = [];
  const exports = { bibtex: { content: "@misc{fixture, title={Câu trả lời}}\n", count: 1, omitted: 0 },
    ris: { content: "TY  - WEB\r\nTI  - Fixture\r\nER  -\r\n", count: 1, omitted: 0 },
    cslJson: { content: '[{"id":"fixture","title":"Câu trả lời"}]\n', count: 1, omitted: 0 },
    evidenceCsv: 'claim,quote\r\n"fixture","literal evidence"\r\n' };
  const report = "https://keryx.cc/dispatch/12345678-1234-1234-1234-123456789abc";
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "chrome-extension:") return route.continue();
    assert.equal(url.origin, "https://keryx.cc", "Unexpected external network request");
    if (url.pathname === "/api/research/availability") {
      assert.equal(request.method(), "GET");
      return route.fulfill({ json: { state: "not-paused" } });
    }
    assert.equal(url.pathname, "/api/v1/chat/completions");
    assert.equal(request.method(), "POST");
    const body = request.postDataJSON();
    calls.push(body);
    assert.equal(body.budget, 0);
    assert.equal(body.mode, "deep");
    assert.equal(body.scholarly, true);
    assert.equal(body.messages[0].content, "Synthetic extension question" +
      (includePage ? "\n\nSource page to consider: https://source.example/article" : ""));
    const chunks = failure ? [{ choices: [{ delta: { content: "[keryx error] Synthetic selection refusal" } }], keryx_error: { code: "selection" } }] : [
      { id: "chatcmpl-12345678-1234-1234-1234-123456789abc", choices: [{ delta: { reasoning_content: "SKIP: synthetic source\n" } }] },
      { choices: [{ delta: { content: "Synthetic cited answer [1]." } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], keryx: { paymentMode: "offline", totalToCreators: 0.000001,
        pendingSpendUsdc: null, dispatchUrl: report, researchExports: exports,
        citations: [{ marker: "1", itemTitle: "<img src=x onerror=alert(1)>", itemUrl: "https://source.example/article",
          source: "Fixture", reward: 0.000001 }] } },
    ];
    return route.fulfill({ contentType: "text/event-stream", body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + (failure ? "" : "data: [DONE]\n\n") });
  });
  await worker.evaluate('chrome.storage.local.set({ keryx_pending: { question: "Synthetic extension question", sourceUrl: "https://source.example/article#part", sourceTitle: "Fixture" } })');
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html?src=menu`);
  await page.waitForFunction(() => (document.getElementById("question") as HTMLTextAreaElement).value === "Synthetic extension question");
  await page.locator("#budget").fill("0");
  await page.locator("#mode").selectOption("deep");
  await page.locator("#scholarly").check();
  assert.equal(await page.locator("#include-page").isChecked(), false);
  await page.locator("#ask").click();
  await page.waitForFunction(() => document.getElementById("status")!.textContent!.startsWith("done"));
  assert.equal(calls.length, 1);
  assert.equal(await page.locator("#paid-total-usd").textContent(), "$0.000001");
  assert.equal(await page.locator("#paid-list img").count(), 0);
  assert.equal(await page.locator("#dispatch-link").getAttribute("href"), report);
  for (const [key, value] of Object.entries(exports)) {
    const downloading = page.waitForEvent("download");
    await page.locator(`[data-export="${key}"]`).click();
    const download = await downloading;
    assert.equal(await readFile((await download.path())!, "utf8"), typeof value === "string" ? value : value.content);
  }
  assert.equal(calls.length, 1, "Exports must not start another research request");
  await page.setViewportSize({ width: 400, height: 740 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Toolbar popup overflows horizontally");
  await mkdir("output/extension-browser", { recursive: true });
  await page.screenshot({ path: "output/extension-browser/popup-400.png", fullPage: true });
  await page.setViewportSize({ width: 440, height: 680 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Context window overflows horizontally");
  await page.screenshot({ path: "output/extension-browser/popup-440.png", fullPage: true });
  includePage = true;
  await page.locator("#include-page").check();
  await page.locator("#ask").click();
  await page.waitForFunction(() => document.getElementById("status")!.textContent!.startsWith("done"));
  assert.equal(calls.length, 2);
  failure = true;
  await page.locator("#ask").click();
  await page.waitForFunction(() => document.getElementById("status")!.textContent === "failed");
  assert.equal(await page.locator("#error").textContent(), "Synthetic selection refusal");
  assert.equal(await page.locator("#exports").isVisible(), false);
  assert.equal(calls.length, 3);
  assert.equal(await page.locator("#recent-list a").count(), 1);
  await page.locator("#clear-recent").click();
  await page.waitForFunction(() => document.getElementById("recent-panel")!.hidden);
  assert.deepEqual(errors, []);
  console.log("Unpacked MV3: controls, explicit URL consent, exact exports, failure, device history and 400/440px layout passed; synthetic transport only");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
