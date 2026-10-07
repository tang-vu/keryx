/** Real AskForm in Chromium with synthetic HTTP; no request can reach a payment route. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

async function fixtureBundle(network: "arcTestnet" | "arc") { return build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { AskForm } from './components/keryx/ask-form';
      window.calls = [];
      function Probe() {
        const [payer, setPayer] = useState('treasury');
        return <><button id="payer-session" onClick={() => setPayer('session')}>Session</button>
          <button id="payer-expired" onClick={() => setPayer('expired')}>Expired</button>
          <AskForm payer={payer} onAsk={(...args) => window.calls.push(args)} /></>;
      }
      createRoot(document.getElementById('root')).render(<Probe />);
    `,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' },
}); }
const bundle = await fixtureBundle("arcTestnet");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).pathname === "/api/research/availability") {
      assert.equal(route.request().method(), "GET", "Availability is read-only");
      return route.fulfill({ json: { state: "not-paused" } });
    }
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/models") return route.fulfill({ json: { models: [
      { id: "deepseek", label: "DeepSeek", note: "Default" },
      { id: "other", label: "Other model", note: "Alternate" },
    ] } });
    assert.equal(route.request().method(), "GET", "The form test must not reach a write endpoint");
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://research-form.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const question = page.getByLabel("What do you want to know?");
  await question.waitFor();
  assert.equal(await page.getByRole("button", { name: "Ask Keryx" }).isDisabled(), true);
  assert.equal(await page.locator('[data-tour="budget"]').isVisible(), false);
  assert.equal(await page.locator('[aria-label="Example questions"] button').count(), 2);
  const textOrder = await page.locator('[data-tour="ask-form"]').evaluate(el => ({
    question: el.querySelector("textarea")?.compareDocumentPosition(el.querySelector('button[data-tour="dispatch-btn"]')!) ?? 0,
    budget: el.querySelector('button[data-tour="dispatch-btn"]')?.compareDocumentPosition(el.querySelector('details')!) ?? 0,
  }));
  assert(textOrder.question & 4); // Node.DOCUMENT_POSITION_FOLLOWING
  assert(textOrder.budget & 4);

  await question.fill("  How are citations rewarded?  ");
  const scholarly = page.getByRole("checkbox", { name: "Search scholarly papers (Crossref and arXiv)" });
  assert.equal(await scholarly.isChecked(), false);
  await scholarly.check();
  await page.locator('input[name="research-depth"][value="deep"]').check();
  await page.getByText(/Budget and model:/).click();
  await page.getByLabel("Maximum budget in USDC").fill("0.06");
  await page.getByLabel("AI model").selectOption("other");
  await page.getByText(/Budget and model:/).click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("keryx:tour-budget")));
  assert.equal(await page.locator('[data-tour="budget"]').isVisible(), true);
  await page.getByRole("button", { name: "Ask Keryx" }).click();
  const call = await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls[0]);
  assert.equal(call[0], "How are citations rewarded?");
  assert.equal(call[1], 0.06);
  assert.equal(call[2] ?? null, null);
  assert.equal(call[3], "other");
  assert.equal(call[4], "deep");
  assert.equal(call[5], true);
  assert.equal(call[6], false);
  const paidManuscriptLabel = "Include reviewed paid manuscripts (experimental testnet rights protocol)";
  const paidScholarly = page.getByRole("checkbox", { name: paidManuscriptLabel });
  assert.equal(await paidScholarly.isDisabled(), true);
  await page.locator("#payer-session").click();
  await page.getByText(/Your research budget pays/).waitFor();
  assert.equal(await paidScholarly.isDisabled(), false);
  await paidScholarly.check();
  await page.getByRole("button", { name: "Ask Keryx" }).click();
  const paidCall = await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls[1]);
  assert.equal(paidCall[6], true);
  await page.getByText(/your question is sent to our search provider/).waitFor();
  await page.locator("#payer-expired").click();
  await page.getByText(/Session expired\. Recover/).waitFor();
  assert.equal(await paidScholarly.isDisabled(), true);
  const shared = await context.newPage();
  await shared.goto("https://research-form.test/?q=Shared%20question&budget=0.04&model=other&mode=deep&run=1");
  await shared.addScriptTag({ content: bundle.outputFiles[0].text });
  await shared.waitForFunction(() => (window as unknown as { calls: unknown[][] }).calls.length === 1);
  const sharedCall = await shared.evaluate(() => (window as unknown as { calls: unknown[][] }).calls[0]);
  assert.equal(sharedCall[0], "Shared question");
  assert.equal(sharedCall[1], 0.04);
  assert.equal(sharedCall[3], "other");
  assert.equal(sharedCall[4], "deep");
  // Public mainnet research never admits the experimental testnet rights role.
  const mainnet = await context.newPage();mainnet.on("pageerror", error => errors.push(error.message));
  await mainnet.goto("https://research-form.test/");
  await mainnet.addScriptTag({ content: (await fixtureBundle("arc")).outputFiles[0].text });
  await mainnet.locator("#payer-session").click();
  assert.equal(await mainnet.getByRole("checkbox", { name: paidManuscriptLabel }).isDisabled(), true);
  await mainnet.getByText("Paid manuscript rights are not yet available on mainnet. Ordinary registered articles remain available.", { exact: true }).waitFor();
  await mainnet.getByLabel("What do you want to know?").fill("Read ordinary mainnet sources");
  await mainnet.getByRole("button", { name: "Ask Keryx" }).click();
  assert.equal(await mainnet.evaluate(() => (window as unknown as { calls: unknown[][] }).calls[0][6]), false);
  assert.deepEqual(errors, []);
  console.log("PASS: question priority, two examples, advanced budget/model, Quick/Deep and payer labels with exact submit arguments. All HTTP intercepted.");
} finally {
  await browser.close();
}
