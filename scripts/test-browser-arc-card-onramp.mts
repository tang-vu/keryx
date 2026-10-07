/** Real React, real Circle browser kit and a real popup; synthetic HTTP only. No Circle call, key or purchase. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const wallet = `0x${"Ab".repeat(20)}`;
const launch = "https://onramp.arc.io/?sessionToken=synthetic-token&pairs=USDC%3Aarc";
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ArcCardOnrampPanel} from './components/keryx/arc-card-onramp-panel';
  createRoot(document.getElementById('root')).render(React.createElement(ArcCardOnrampPanel));
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": '"development"' } });

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport });
    const fixture = { available: true, status: 200, posts: [] as { origin: string | undefined; body: string | null }[] };
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://keryx.invalid" && url.pathname === "/api/onramp/session") {
        if (request.method() === "GET") return route.fulfill({ json: { available: fixture.available } });
        fixture.posts.push({ origin: request.headers().origin, body: request.postData() });
        return fixture.status === 200
          ? route.fulfill({ json: { session: { sessionToken: "synthetic-token", widgetUrl: launch,
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), traceId: "synthetic-trace", destinationWallet: wallet } } })
          : route.fulfill({ status: fixture.status, json: { error: "synthetic refusal" } });
      }
      return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    });
    const page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const mount = async () => { await page.goto("https://keryx.invalid"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
    const status = page.getByRole("status");

    // Unconfigured server: the option stays hidden.
    fixture.available = false; await mount();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole("button").count(), 0);

    // Refusals start nothing and never offer the purchase window.
    fixture.available = true; await mount();
    const prepare = page.getByRole("button", { name: "Prepare card purchase" });
    await prepare.waitFor();
    assert.match(await page.getByLabel("Buy USDC with a card").innerText(), /credit cards are not supported/);
    for (const [code, text] of [[401, /Sign in with your wallet/], [429, /Wait a minute/], [503, /No purchase was started/]] as const) {
      fixture.status = code; await prepare.click();
      await status.filter({ hasText: text }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open Arc Onramp" }).count(), 0);
    }

    // Prepare sends no body; the delivery wallet shown is the one the server returned.
    fixture.status = 200; fixture.posts.length = 0; await prepare.click();
    const open = page.getByRole("button", { name: "Open Arc Onramp" });
    await open.waitFor();
    assert.deepEqual(fixture.posts, [{ origin: "https://keryx.invalid", body: null }]);
    assert.match(await page.getByLabel("Buy USDC with a card").innerText(), new RegExp(`Delivery wallet: ${wallet}`));
    assert.equal(context.pages().length, 1, "preparing must not open a window");

    // The second click opens Circle's origin with the minted launch URL.
    const [popup] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), launch);
    await status.filter({ hasText: /Purchase window opened/ }).waitFor();

    // Widget events are shown as hints; a foreign origin cannot inject one.
    await page.evaluate(() => window.postMessage({ event: "DEPOSIT_SETTLED", code: "DEPOSIT_SETTLED", payload: {} }, "*"));
    await page.waitForTimeout(200);
    assert.doesNotMatch(await status.innerText(), /settled/);
    await popup.evaluate(() => window.opener.postMessage({ event: "DEPOSIT_SUBMITTED", code: "DEPOSIT_SUBMITTED", payload: {} }, "*"));
    await status.filter({ hasText: /refresh your wallet balance/ }).waitFor();

    // Closing the window before submitting again is reported, not treated as a purchase.
    const [second] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await second.waitForLoadState(); await second.close();
    await status.filter({ hasText: /closed before a purchase was submitted/ }).waitFor();

    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("arc card onramp browser check passed");
} finally { await browser.close(); }
