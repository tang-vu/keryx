/** Browser regression for the public reading entry point. Run against a local dev server:
 * KERYX_TEST_BASE_URL=http://localhost:3939 node --import tsx scripts/test-reading-ux-browser.mts
 * HTTP payment data is intercepted; this test never signs or spends. */
import assert from "node:assert/strict";
import { chromium, type Page, type Route } from "playwright";

const base = process.env.KERYX_TEST_BASE_URL || "http://localhost:3939";
const browser = await chromium.launch({ headless: true });
const sample = (overrides: Record<string, unknown>) => ({
  id: "one", kind: "citation", queryId: "q", sourceId: "s", sourceName: "Verified writer",
  payer: "buyer", payee: "creator", amountUsdc: 0.012345, network: "eip155:5042002",
  settled: true, settlementStatus: "settled", createdAt: new Date().toISOString(), ...overrides,
});

async function openPage(width: number, height: number, responder: (route: Route) => Promise<void>, blockStorage = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  if (blockStorage) await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get: () => { throw new Error("Storage blocked by browser"); } }));
  await page.route("**/api/payments?*", responder);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  return page;
}

async function assertInside(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `${selector} should be visible`);
  const viewport = page.viewportSize()!;
  assert(box.x >= -1 && box.y >= -1, `${selector} starts outside viewport: ${JSON.stringify(box)}`);
  assert(box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${selector} exceeds viewport: ${JSON.stringify(box)}`);
}

try {
  const loading = await openPage(320, 480, async () => { /* held until page closes */ });
  await loading.getByText("Loading settlements…").waitFor();
  await assertInside(loading, "header.sticky + div");
  await loading.close();

  const empty = await openPage(320, 480, async route => route.fulfill({ json: { payments: [] } }));
  await empty.getByText("No recent settled citations.").waitFor();
  await empty.close();

  const failed = await openPage(320, 480, async route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await failed.getByText("Payment feed unavailable.").waitFor();
  await failed.getByRole("button", { name: "Retry" }).waitFor();
  await failed.close();

  const mixed = await openPage(320, 480, async route => route.fulfill({ json: { payments: [
    sample({ id: "settled" }), sample({ id: "simulated", sourceName: "Simulated writer", settled: false, settlementStatus: "simulated" }),
    sample({ id: "pending", sourceName: "Pending writer", settled: false, settlementStatus: "pending" }),
    sample({ id: "fetch", sourceName: "Fetch writer", kind: "fetch" }),
  ] } }));
  await mixed.getByText("Verified writer").waitFor();
  assert.equal(await mixed.getByText("Simulated writer").count(), 0);
  assert.equal(await mixed.getByText("Pending writer").count(), 0);
  assert.equal(await mixed.getByText("Fetch writer").count(), 0);
  await mixed.getByRole("button", { name: "Open menu" }).click();
  await assertInside(mixed, "#mobile-site-menu");
  assert.equal(await mixed.locator('#mobile-site-menu a[href="/register"]').isVisible(), true);
  await mixed.keyboard.press("Escape");
  assert.equal(await mixed.locator("#mobile-site-menu").count(), 0);
  assert.equal(await mixed.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Open menu");
  await mixed.close();

  const activity = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await activity.route("**/api/payments?*", route => route.fulfill({ json: { payments: [] } }));
  await activity.route("**/api/activity", route => route.fulfill({ json: { activity: [{ sourceId: "s", sourceName: "Actual citation", question: null, rewardUsdc: 0.01, origin: "web", createdAt: new Date().toISOString() }] } }));
  await activity.goto(base, { waitUntil: "domcontentloaded" });
  await activity.getByText("Actual citation").first().waitFor();
  await activity.getByRole("button", { name: "Pause" }).click();
  await activity.getByRole("button", { name: "Play" }).waitFor();
  assert.equal(await activity.locator(".group.relative.flex").first().locator("div[style]").first().evaluate(element => getComputedStyle(element).animationName), "none");
  await activity.close();

  for (const [width, height] of [[1366, 768], [320, 480], [320, 360]]) {
    const page = await openPage(width, height, async route => route.fulfill({ json: { payments: [] } }), true);
    const start = page.getByRole("button", { name: "How it works" });
    await start.click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.evaluate(() => [...document.body.children].filter(element => element.tagName !== "SCRIPT" && !element.hasAttribute("data-keryx-tour-portal")).every(element => element.hasAttribute("inert"))), true);
    await page.evaluate(() => document.querySelector<HTMLElement>("header a")?.focus());
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true,
      "Background links must not take focus while the tour is open");
    await page.getByRole("button", { name: "Close tour" }).focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Next", "Reverse Tab wraps inside tour");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close tour", "Tab wraps inside tour");
    for (let step = 0; step < 4; step++) {
      await page.waitForTimeout(500);
      await assertInside(page, '[role="dialog"][aria-label="How Keryx works"]');
      if (width < 640) {
        const target = await page.locator(`[data-tour="${["hero", "ask-form", "budget", "dispatch-btn"][step]}"]`).boundingBox();
        const sheet = await page.getByRole("dialog").boundingBox();
        assert(target && sheet && target.y < sheet.y && target.y + target.height > 106,
          `Tour target must remain visible above the mobile sheet at step ${step + 1}`);
      }
      await page.getByRole("button", { name: "Close tour" }).waitFor();
      if (step < 3) await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.evaluate(() => [...document.body.children].filter(element => element.tagName !== "SCRIPT").some(element => element.hasAttribute("inert"))), false,
      "Background must be interactive again after closing tour");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "How it works");
    await page.close();
  }
  console.log("PASS: loading, empty, error, and mixed settlement states; activity pause; mobile navigation; tour bounds, inert background, focus trap, and restoration at desktop and short mobile viewports.");
} finally {
  await browser.close();
}
