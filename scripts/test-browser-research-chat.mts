/** Real built chat and SSE hook; all API calls intercepted, no signing, search or funds. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { parseResearchAvailability } from "../lib/research/availability-contract";
import { signingDisplayPrefetchPath, SIGNING_DISPLAY_PREFETCH_LIMIT } from "../test-support/signing-display-prefetch";

const base = process.env.KERYX_UX_BASE_URL ?? "http://127.0.0.1:3957";
const args = process.argv.slice(2);
const signingDisplayOnly = args.length === 1 && args[0] === "--signing-display-only";
assert(args.length === 0 || signingDisplayOnly, "Use no arguments or --signing-display-only");
if (signingDisplayOnly) assert(process.env.KERYX_UX_BASE_URL, "Signing display requires an explicitly bound built cohort URL");
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR ?? join(tmpdir(), "keryx-chat-first-ux");
if (!signingDisplayOnly) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Observe the compiled idle grant preview only; never invoke a wallet or research action. */
async function checkSigningDisplay() {
  const target = new URL(base);
  assert(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "Bind a plain HTTP(S) built cohort URL without credentials, query or fragment");
  const cases = [
    { input: "1000.000001", amount: "1000.000001 USDC", micros: "1000000001", enabled: true },
    { input: "0.000001", amount: "0.000001 USDC", micros: "1", enabled: false },
  ];
  for (const width of [320, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 768 }, locale: "en-US",
      reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      // Model an already-observed landing in this synthetic tab. The ordinary root's
      // daily telemetry must not dispatch a POST during a read-only signing review.
      // This stores no wallet, authentication, grant, payment or recovery state.
      await context.addInitScript(() => {
        const day = new Date().toISOString().slice(0, 10);
        sessionStorage.setItem(`keryx:activation:landing:${day}`, "1");
      });
      const apiGets: string[] = [], blocked: string[] = [], workers: string[] = [], errors: string[] = [];
      const builtAssets: Array<{ path: string; status: number }> = [], failedBuiltAssets: string[] = [];
      let popups = 0;
      let isolatedPrefetchCount = 0;
      const isolatedPrefetchPaths: string[] = [];
      await context.routeWebSocket("**/*", socket => { blocked.push(`WebSocket ${socket.url()}`); socket.close(); });
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== target.origin || request.method() !== "GET") {
          blocked.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort();
        }
        // Preserve real navigation prefetch. Only this idle observation aborts
        // recognisable unrelated root-link RSC prefetch GETs before dispatch.
        const prefetchPath = signingDisplayPrefetchPath({ url: request.url(), method: request.method(),
          resourceType: request.resourceType(), navigation: request.isNavigationRequest(), headers: await request.allHeaders() }, target.origin);
        if (prefetchPath) {
          if (isolatedPrefetchCount >= SIGNING_DISPLAY_PREFETCH_LIMIT) {
            if (!blocked.includes("Idle prefetch isolation bound exceeded")) blocked.push("Idle prefetch isolation bound exceeded");
          } else isolatedPrefetchCount++;
          if (isolatedPrefetchPaths.length < 32) isolatedPrefetchPaths.push(prefetchPath);
          return route.abort();
        }
        if (!url.pathname.startsWith("/api/")) {
          return route.continue();
        }
        // Idle without a connected wallet must not even dispatch a recovery/status request.
        if (url.pathname.startsWith("/api/session/") || url.pathname === "/api/ask" || url.pathname.startsWith("/api/agent/")) {
          blocked.push(`Forbidden GET ${url.pathname}`); return route.abort();
        }
        apiGets.push(url.pathname);
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 200,
          json: { session: { address: `0x${"11".repeat(20)}`, role: "reader" } } });
        if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: {
          wallet: `0x${"11".repeat(20)}`, defaultVisibility: "public", privacyActive: true } });
        if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
        if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
        if (url.pathname === "/api/onramp/session") return route.fulfill({ json: { available: false } });
        return route.fulfill({ json: { sources: [], payments: [], activity: [], runs: [], jobs: [] } });
      });
      const page = await context.newPage();
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.origin !== target.origin || !url.pathname.startsWith("/_next/static/")) return;
        const status = response.status();
        if (status !== 200) failedBuiltAssets.push(`${url.pathname}: HTTP ${status}`);
        else if (/\.(js|css)$/.test(url.pathname)) builtAssets.push({ path: url.pathname, status });
      });
      page.on("requestfailed", request => {
        const url = new URL(request.url());
        if (url.origin === target.origin && url.pathname.startsWith("/_next/static/"))
          failedBuiltAssets.push(`${url.pathname}: ${request.failure()?.errorText ?? "request failed"}`);
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("worker", worker => workers.push(worker.url()));
      page.on("popup", () => { popups++; });
      const response = await page.goto(base, { waitUntil: "domcontentloaded" });
      assert(response?.ok(), "The bound built cohort must serve the actual page successfully");
      await page.evaluate(() => document.fonts.ready);
      const input = page.getByLabel("Total budget (USDC)", { exact: true });
      await input.waitFor();
      assert.equal(await input.getAttribute("id"), "research-total-budget");
      const panel = input.locator("xpath=../..");
      await panel.getByText("Research budget", { exact: true }).waitFor();
      await panel.getByLabel("Maximum per question (USDC)", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Recover a saved budget", exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(await page.evaluate(() => typeof (window as unknown as { ethereum?: unknown }).ethereum), "undefined");
      assert(apiGets.includes("/api/auth/session"), "Actual hydration must consume the synthetic authenticated GET");
      assert.deepEqual(failedBuiltAssets, [], "Every actual Next static load must succeed with HTTP 200");
      assert(builtAssets.some(asset => asset.status === 200 && asset.path.endsWith(".js"))
        && builtAssets.some(asset => asset.status === 200 && asset.path.endsWith(".css")),
        "Observe successful HTTP 200 compiled Next JS and CSS responses; requested paths alone are not acceptance");
      for (const value of cases) {
        await input.fill(value.input);
        assert.equal(await input.inputValue(), value.input, "Display never rewrites the control value");
        const details = panel.getByText(`(${value.micros} micro-USDC; decimal point, no grouping)`, { exact: true });
        await details.waitFor();
        assert.equal(await details.evaluate(node => node.tagName), "SMALL", "Exact micros are real visible verification details");
        const amount = details.locator("..");
        assert.equal((await amount.evaluate(node => Array.from(node.childNodes).filter(child => child.nodeType === Node.TEXT_NODE)
          .map(child => child.textContent).join(""))).trim(), value.amount, "Pre-sign text has six places, USDC and no grouping");
        assert(await amount.isVisible());
        assert.equal(await panel.getByRole("button", { name: "Enable research budget", exact: true }).isEnabled(), value.enabled,
          "The original per-question cap still controls readiness; never click enable");
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, "Built English signing display fits the viewport");
        assert(await amount.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }),
          "Exact signing amount and micro details stay within the viewport");
        assert.equal(await page.getByLabel("What do you want to know?").inputValue(), "", "No research draft or submission");
        assert.deepEqual(blocked, [], "Zero writes, asks, recovery dispatches, external requests or WebSockets");
        assert.deepEqual(workers, [], "Disconnected idle preview never dispatches a signer/recovery worker");
        assert.equal(popups, 0); assert.deepEqual(errors, []);
        assert.deepEqual(failedBuiltAssets, [], "Reject late failed/non-200 Next static loads before accepting each observation");
        console.log(JSON.stringify({ mode: "built-signing-display-only", width, input: value.input, amount: value.amount,
          exactMicros: value.micros, visibleDetails: await details.textContent(), compiledAssets: builtAssets.length,
          successfulCompiledAssets: builtAssets,
          isolatedPrefetchCount, isolatedPrefetchPaths,
          authenticatedReadOnlyGet: true, forbiddenCalls: blocked.length, workers: workers.length, popups, overflow: false }));
      }
    } finally { await context.close(); }
  }
  console.log("PASS: four built English idle grant signing-display observations; no activation, research, recovery, wallet, signing or funding action. Registering/connected-wallet states are not observed.");
}

try {
  if (signingDisplayOnly) await checkSigningDisplay();
  else {
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
      if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "deepseek", label: "DeepSeek", note: "Default" }, { id: "fixture-model", label: "Fixture model", note: "Synthetic" }] } });
      if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
      if (url.pathname === "/api/auth/session") return route.fulfill({ json: { authenticated: false } });
      return route.fulfill({ json: { sources: [], payments: [], activity: [], runs: [], jobs: [] } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const question = page.getByLabel("What do you want to know?");
    await question.waitFor();
    await page.getByText("Free trial. Keryx pays. No wallet.", { exact: true }).waitFor();
    await page.getByTestId("composer-publication-notice").waitFor();
    assert.equal(await page.getByRole("complementary", { name: "Sponsored research trial" }).count(), 0);
    assert.equal(calls.length, 0, "Opening the sponsored composer never starts research");
    await page.screenshot({ path: join(screenshots, `chat-idle-${width}.png`) });
    const ask = page.locator('[data-tour="dispatch-btn"]');
    await page.getByText("More options", { exact: true }).click();
    await page.getByLabel("Maximum budget in USDC").fill("0.06");
    await page.getByLabel("AI model").selectOption("fixture-model");
    await page.getByText("More options", { exact: true }).click();
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
    await page.waitForFunction(() => {
      const current = document.querySelectorAll('[data-testid="research-turn"]');
      const status = current[current.length - 1]?.querySelector('[role="status"]');
      if (!status) return false;
      const box = status.getBoundingClientRect();
      return box.top >= 66 && box.bottom <= innerHeight;
    });
    const stop = await page.getByRole("button", { name: "Stop research" }).boundingBox();
    assert(stop && stop.y >= 66 && stop.y + stop.height <= page.viewportSize()!.height,
      "Stop must be naturally visible after submitting research");
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
    // An explicitly synthetic open SSE stream permits a reader to inspect an older
    // report between steps. Every other fetch continues through the intercepted HTTP.
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (input !== "/api/ask") return original(input, init);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(encoder.encode('event: meta\ndata: {"engine":"fixture","mode":"offline"}\n\n'));
          (window as unknown as { fixtureStep: () => void }).fixtureStep = () => controller.enqueue(encoder.encode('event: step\ndata: {"phase":"discover","ts":10,"message":"Additional synthetic source step"}\n\n'));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Stopped fixture", "AbortError")), { once: true });
        } });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      };
    });
    await question.fill("Inspect earlier reports during streaming"); await ask.click();
    await page.getByText("Keryx · Research in progress").waitFor();
    await page.getByTestId("research-turn").first().scrollIntoViewIfNeeded();
    const inspectedScroll = await page.evaluate(() => scrollY);
    await page.evaluate(() => (window as unknown as { fixtureStep: () => void }).fixtureStep());
    await page.waitForFunction(() => document.body.textContent?.includes("Additional synthetic source step"));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert(Math.abs(await page.evaluate(() => scrollY) - inspectedScroll) <= 1,
      "Streamed steps must not scroll a reader away from an older report");
    await page.getByRole("button", { name: "Stop research" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    if (width === 390) {
      await page.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
      const researchAvailability = parseResearchAvailability({ state: "not-paused" });
      assert(researchAvailability);
      // This rendered status exists only after the real availability effect consumes the intercepted GET.
      await page.getByRole("main").getByText(researchAvailability.message, { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const researchQuestion = page.getByRole("main").getByRole("textbox", { name: "What do you want to know?", exact: true });
      await researchQuestion.waitFor({ state: "visible" });
      // Measure visibility and position in one DOM task, rather than handing a node across two protocol queries.
      const researchQuestionBox = await researchQuestion.evaluate(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { visible: element.isConnected && element.getClientRects().length > 0 && box.width > 0 && box.height > 0 &&
          style.display !== "none" && style.visibility === "visible", y: box.y, width: box.width, height: box.height };
      });
      console.log(JSON.stringify({ observation: "hydrated-research-composer-viewport", viewportHeight: 740, ...researchQuestionBox }));
      assert(researchQuestionBox.visible && Number.isFinite(researchQuestionBox.y) && researchQuestionBox.y < 740,
        "The visible research-page composer must remain inside the 740px viewport");
      await page.getByRole("link", { name: "Paid agent research & recovery" }).click();
      await page.getByRole("heading", { name: "Give your agent a research budget." }).waitFor();
      assert.equal(new URL(page.url()).hash, "#paid-research");
    }
    const quotaPage = await context.newPage();
    const quotaDraft = "A question held by trial capacity";
    const available = parseResearchAvailability({ state: "not-paused" });
    assert(available);
    let quotaAsks = 0;
    await quotaPage.route("**/api/ask", route => {
      quotaAsks++;
      assert.equal(route.request().postDataJSON().question, quotaDraft);
      return route.fulfill({ status: 429, headers: { "Retry-After": "60" }, json: {} });
    });
    await quotaPage.goto(base, { waitUntil: "domcontentloaded" });
    // Rendered effect-driven availability proves hydration consumed the fixture.
    await quotaPage.getByText(available.message, { exact: true }).waitFor();
    const quotaQuestion = quotaPage.getByLabel("What do you want to know?");
    const quotaDispatch = quotaPage.locator('[data-tour="dispatch-btn"]');
    await quotaQuestion.fill(quotaDraft);
    assert.equal(await quotaQuestion.inputValue(), quotaDraft);
    await quotaPage.locator('[data-tour="dispatch-btn"]:enabled').waitFor();
    assert.equal(await quotaDispatch.isEnabled(), true);
    assert.equal(quotaAsks, 0, "Readiness and entering a draft never submit research");
    await quotaDispatch.click();
    const quotaAlert = quotaPage.getByRole("alert");
    await quotaAlert.getByText("Try again in 60s.", { exact: false }).waitFor();
    assert.equal(await quotaAlert.getByText(/connect.*funded|deposit|top.up/i).count(), 0,
      "Trial throttling gives a wait path without treating wallet funding as quota recovery");
    assert.equal(await quotaPage.getByLabel("What do you want to know?").inputValue(), "A question held by trial capacity");
    assert.equal(quotaAsks, 1, "One ordinary click makes one quota request without retry");
    await quotaPage.screenshot({ path: join(screenshots, `chat-quota-${width}.png`), fullPage: true });
    await quotaPage.close();
    console.log(`PASS ${width}px: natural progress/Stop visibility, older-report scroll retained on steps, two turns, follow-up/settings, export, errors and stop isolation; synthetic requests only.`);
    await context.close();
  }
  console.log(`Chat screenshots: ${screenshots}`);
  }
} finally { await browser.close(); }
