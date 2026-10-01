/** Real built chat and SSE hook; all API calls intercepted, no signing, search or funds. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const base = process.env.KERYX_UX_BASE_URL ?? "http://127.0.0.1:3957";
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR ?? join(tmpdir(), "keryx-chat-first-ux");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

try {
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 768 : 740 }, reducedMotion: "reduce", acceptDownloads: true });
    const calls: Array<Record<string, unknown>> = [];
    let releaseStopped: (() => Promise<void>) | undefined;
    const errors: string[] = [];
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/ask") {
        const body = request.postDataJSON() as Record<string, unknown>;
        calls.push(body);
        const number = calls.length;
        if (number === 3) return route.fulfill({ status: 503, json: { message: "Fixture research unavailable" } });
        const id = `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
        const payment = { id: `payment-${number}`, queryId: id, kind: "citation", sourceId: "fixture", sourceName: "Fixture writer", payer: "fixture", payee: "fixture", amountUsdc: 0.003, network: "eip155:5042002", settled: false, settlementStatus: "simulated", createdAt: "2026-10-01T00:00:00Z" };
        const pending = { ...payment, id: `pending-${number}`, settlementStatus: "pending", amountUsdc: 0.002 };
        const steps = [{ phase: "discover", ts: 1, message: "Fixture sources discovered" }, { phase: "settle", ts: 2, message: "Explicit simulation", detail: payment }, { phase: "settle", ts: 3, message: "Pending proof fixture", detail: pending }];
        const run = { id, question: body.question, budget: body.budget, parentId: body.parentId, researchMode: body.mode, engine: "fixture", subClaims: ["A finding"], decisions: [], citations: [{ marker: "S1", sourceId: "fixture", sourceName: "Original fixture", itemUrl: "https://example.org/observed", weight: 1, reward: 0, rationale: "Public evidence", sourceKind: "public-reference" }], answer: `## Research finding\n\nSynthetic report ${number} [S1].`, evidence: [{ claimIndex: 0, claim: "A finding", marker: "S1", sourceId: "fixture", sourceName: "Original fixture", quote: "Synthetic observed evidence", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }], claimCoverage: [{ claimIndex: 0, claim: "A finding", coverage: 0.8, coveredBy: ["S1"] }], totalSpent: 0.003, totalToCreators: 0.003, trace: steps, paymentMode: "offline", createdAt: "2026-10-01T00:00:00Z" };
        const payload = frame("meta", { mode: "offline", engine: "fixture" }) + steps.map(step => frame("step", step)).join("") + frame("done", run);
        if (number === 4) {
          releaseStopped = async () => { await route.fulfill({ contentType: "text/event-stream", body: payload }).catch(() => {}); };
          return;
        }
        return route.fulfill({ contentType: "text/event-stream", body: payload });
      }
      if (url.pathname === "/api/activation") return route.fulfill({ json: {} });
      assert.equal(request.method(), "GET", `Unexpected write: ${url.pathname}`);
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "deepseek", label: "DeepSeek", note: "Default" }, { id: "fixture-model", label: "Fixture model", note: "Synthetic" }] } });
      if (url.pathname === "/api/auth/session") return route.fulfill({ json: { authenticated: false } });
      return route.fulfill({ json: { sources: [], payments: [], activity: [], runs: [], jobs: [] } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const question = page.getByLabel("What do you want to know?");
    await question.waitFor();
    await page.screenshot({ path: join(screenshots, `chat-idle-${width}.png`) });
    const ask = page.locator('[data-tour="dispatch-btn"]');
    await page.getByText(/Budget and model:/).click();
    await page.getByLabel("Maximum budget in USDC").fill("0.06");
    await page.getByLabel("AI model").selectOption("fixture-model");
    await page.getByText(/Budget and model:/).click();
    await question.fill("First research question");
    await question.press("Control+Enter");
    await page.getByText("Synthetic report 1", { exact: false }).waitFor();
    assert.equal(calls[0].budget, 0.06); assert.equal(calls[0].model, "fixture-model");
    await question.fill("Compare the tradeoffs");
    await ask.click();
    await page.getByText("Synthetic report 2", { exact: false }).waitFor();
    assert.equal(await page.getByTestId("research-turn").count(), 2);
    assert.equal(calls[1].parentId, "00000000-0000-4000-8000-000000000001");
    assert.equal(calls[1].budget, 0.06); assert.equal(calls[1].model, "fixture-model");
    await page.getByText(/previous question only/).waitFor();
    assert.equal(await page.getByLabel("Maximum budget in USDC").inputValue(), "0.06");
    await page.screenshot({ path: join(screenshots, `chat-two-turns-${width}.png`), fullPage: true });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report" }).last().click();
    const download = await downloading;
    const text = await readFile((await download.path())!, "utf8");
    assert(text.includes("https://example.org/observed"));
    assert(text.includes("Synthetic observed evidence"));
    assert(text.includes("· simulated")); assert(text.includes("· pending"));
    assert(!text.includes("· settled"));
    await page.getByRole("button", { name: "New research", exact: true }).click();
    await question.fill("New topic that fails"); await ask.click();
    await page.getByRole("alert").filter({ hasText: "Fixture research unavailable" }).waitFor();
    assert.equal(calls[2].parentId, undefined);
    await page.screenshot({ path: join(screenshots, `chat-error-${width}.png`), fullPage: true });
    await question.fill("New topic still independent"); await ask.click();
    await page.getByRole("button", { name: "Stop research" }).waitFor();
    assert.equal(calls[3].parentId, undefined);
    await page.getByText("Keryx · Research in progress").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, `chat-in-flight-viewport-${width}.png`) });
    await page.screenshot({ path: join(screenshots, `chat-in-flight-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Stop research" }).click();
    await page.getByText(/Payments already signed may still settle/).waitFor();
    await question.fill("After stopping, a fresh request"); await ask.click();
    await page.getByText("Synthetic report 5", { exact: false }).waitFor();
    assert.equal(calls[4].parentId, undefined);
    await releaseStopped?.();
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Synthetic report 4", { exact: false }).count(), 0, "Cancelled response must not overwrite a later turn");
    assert.equal(await page.getByTestId("research-turn").count(), 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    if (width === 390) {
      await page.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
      await question.waitFor();
      assert((await question.boundingBox())!.y < 740);
      await page.getByRole("link", { name: "Paid agent research & recovery" }).click();
      await page.getByRole("heading", { name: "Give your agent a research budget." }).waitFor();
      assert.equal(new URL(page.url()).hash, "#paid-research");
    }
    console.log(`PASS ${width}px: two-turn reports, exact follow-up/cap/model, export, new-topic error, stop and late-response isolation; synthetic HTTP only.`);
    await context.close();
  }
  console.log(`Chat screenshots: ${screenshots}`);
} finally { await browser.close(); }
