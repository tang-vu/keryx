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
    const fixture = { available: true, environment: "production", bankTransfer: "provider-dependent", status: 200,
      sessionOverrides: {} as Record<string, unknown>, posts: [] as { origin: string | undefined; body: string | null }[] };
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://keryx.invalid" && url.pathname === "/api/onramp/session") {
        if (request.method() === "GET") return route.fulfill({ json: { available: fixture.available,
          environment: fixture.environment, bankTransfer: fixture.bankTransfer,
          widgetOrigin: fixture.environment === "sandbox" ? "https://onramp-sandbox.arc.io" : "https://onramp.arc.io" } });
        fixture.posts.push({ origin: request.headers().origin, body: request.postData() });
        return fixture.status === 200
          ? route.fulfill({ json: { session: { sessionToken: "synthetic-token", widgetUrl: launch,
            environment: "production", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            traceId: "synthetic-trace", destinationWallet: wallet, ...fixture.sessionOverrides } } })
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

    // Explicit sandbox cannot offer an Arc bank purchase, even if a stale response says available.
    fixture.environment = "sandbox"; fixture.bankTransfer = "unavailable"; fixture.available = true;
    await mount();
    await page.getByRole("note").filter({ hasText: /bank deposits are documented only for Ethereum/ }).waitFor();
    assert.equal(await page.getByRole("button").count(), 0);
    assert.equal(fixture.posts.length, 0);
    fixture.environment = "unknown"; await mount(); await page.waitForTimeout(300);
    assert.equal(await page.getByRole("button").count(), 0);
    fixture.environment = "production"; await mount(); await page.waitForTimeout(300);
    assert.equal(await page.getByRole("button").count(), 0, "unavailable method cannot offer preparation");

    // Refusals start nothing and never offer the purchase window.
    fixture.available = true; fixture.bankTransfer = "provider-dependent"; await mount();
    const prepare = page.getByRole("button", { name: "Check bank transfer eligibility" });
    await prepare.waitFor();
    const panel = page.getByRole("region", { name: "Buy USDC on Arc", exact: true });
    assert.match(await panel.innerText(), /credit cards are not supported/);
    assert.match(await panel.innerText(), /Purchasers still complete identity verification/);
    assert.match(await panel.innerText(), /Vietnam is not documented as supported/);
    for (const [code, text] of [[401, /Sign in with your wallet/], [429, /Wait a minute/], [503, /No purchase was started/]] as const) {
      fixture.status = code; await prepare.click();
      await status.filter({ hasText: text }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open Arc Onramp" }).count(), 0);
    }

    // Bad successful responses cannot cross environment/origin, substitute an invalid wallet or bypass expiry.
    fixture.status = 200;
    for (const invalid of [
      { environment: "sandbox" }, { environment: "unknown" },
      { widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=synthetic-token" },
      { widgetUrl: "https://onramp.arc.io.attacker.invalid/?sessionToken=synthetic-token" },
      { widgetUrl: "https://user:password@onramp.arc.io/?sessionToken=synthetic-token" },
      { destinationWallet: "0x1234" }, { destinationWallet: `0x${"0".repeat(40)}` },
      { expiresAt: new Date(Date.now() - 1_000).toISOString() },
      { expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }, { sessionToken: "" },
    ]) {
      fixture.sessionOverrides = invalid; await prepare.click();
      await status.filter({ hasText: /session is no longer valid/ }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open Arc Onramp" }).count(), 0);
      assert.equal(context.pages().length, 1);
    }
    fixture.sessionOverrides = {};

    // Prepare sends no body; the delivery wallet shown is the one the server returned.
    fixture.status = 200; fixture.posts.length = 0; await prepare.click();
    const open = page.getByRole("button", { name: "Open Arc Onramp" });
    await open.waitFor();
    assert.deepEqual(fixture.posts, [{ origin: "https://keryx.invalid", body: null }]);
    assert.match(await panel.innerText(), new RegExp(`Delivery wallet: ${wallet}`));
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
    await popup.evaluate(() => window.opener.postMessage({ event: "DEPOSIT_SETTLED", code: "DEPOSIT_SETTLED", payload: {} }, "*"));
    await status.filter({ hasText: /provider reports this purchase as settled/ }).waitFor();
    assert.match(await status.innerText(), /Confirm the USDC in your wallet balance/);
    await popup.evaluate(() => window.opener.postMessage({ event: "DEPOSIT_NOT_COMPLETED", code: "NO_PAYMENT_OPTIONS", payload: {} }, "*"));
    await status.filter({ hasText: /no eligible payment method/ }).waitFor();
    await popup.evaluate(() => window.opener.postMessage({ event: "DEPOSIT_NOT_COMPLETED", code: "PAYMENT_PROVIDER_ERROR", payload: {} }, "*"));
    await status.filter({ hasText: /provider did not complete this purchase/ }).waitFor();

    // Closing the window before submitting again is reported, not treated as a purchase.
    const [second] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await second.waitForLoadState(); await second.close();
    await status.filter({ hasText: /closed before a purchase was submitted/ }).waitFor();

    // Expiry between the two clicks is checked synchronously before attempting a new window.
    await page.evaluate(() => { const actualNow = Date.now; Date.now = () => actualNow() + 31 * 60_000; });
    await open.click(); await status.filter({ hasText: /session expired/ }).waitFor();
    assert.equal(context.pages().length, 1);
    assert.equal(await page.getByRole("button", { name: "Open Arc Onramp" }).count(), 0);

    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Arc bank-first onramp synthetic browser check passed");
} finally { await browser.close(); }
