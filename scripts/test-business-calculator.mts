/** Render the real calculator with browser-only arithmetic and intercepted HTTP. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {BusinessCalculator} from './components/keryx/business-calculator';
  createRoot(document.getElementById('root')).render(React.createElement(BusinessCalculator));
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": '"production"' }, metafile: true });
assert(!Object.keys(bundle.metafile.inputs).some(path => /^lib\/(config|db\/)/.test(path)));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  const requests: string[] = [], errors: string[] = [];
  await context.route("**/*", async route => {
    requests.push(route.request().method());
    await route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>' });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://calculator.test");
  if (process.env.BUYER_UI_CSS) await page.addStyleTag({ content: await readFile(process.env.BUYER_UI_CSS, "utf8") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const service = page.getByRole("article", { name: "Service fee only", exact: true });
  const retention = page.getByRole("article", { name: "Fixed-price reserve retention", exact: true });
  assert((await service.innerText()).includes("Unknown costs"));
  for (const [label, value] of [
    ["Paid jobs per month", "100"], ["Creator spend per job", "0.015"], ["AI model cost per job", "0.01"],
    ["Variable infrastructure per job", "0"], ["Payment and gas per job", "0"], ["Support cost per job", "0"],
    ["Refunds and losses per job", "0"], ["Fixed operating costs per month", "1"], ["Customer acquisition per month", "0"],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await service.getByText("$0.010000", { exact: true }).waitFor();
  await service.getByText("$0.000000", { exact: true }).waitFor();
  await service.getByText("100", { exact: true }).waitFor();
  await retention.getByText("$1.500000", { exact: true }).waitFor();
  await retention.getByText("40", { exact: true }).waitFor();
  const inputDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export inputs", exact: true }).click();
  const saved = await inputDownload, inputs = await readFile((await saved.path())!, "utf8");
  assert.equal(saved.suggestedFilename(), "keryx-business-inputs.json");
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scenario report", exact: true }).click();
  const report = JSON.parse(await readFile((await (await reportDownload).path())!, "utf8"));
  assert.equal(report.report.fixedPriceRetentionScenario.monthlyOperatingResultBeforeTaxUsd, "1.500000");
  assert.equal(report.report.label, "planning-scenario-not-realized-profit");
  await page.getByLabel("AI model cost per job", { exact: true }).fill("");
  assert((await service.innerText()).includes("Unknown costs"));
  assert(!(await retention.innerText()).includes("$1.500000"));
  await page.getByLabel("Creator spend per job", { exact: true }).fill("0.04");
  await page.getByRole("alert").waitFor(); assert.equal(await service.count(), 0);
  assert(await page.getByRole("button", { name: "Export inputs", exact: true }).isDisabled());
  await page.getByLabel("Import scenario inputs", { exact: true }).setInputFiles({ name: "inputs.json", mimeType: "application/json", buffer: Buffer.from(inputs) });
  await retention.getByText("$1.500000", { exact: true }).waitFor();
  await page.getByLabel("Import scenario inputs", { exact: true }).setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"serviceFeeUsdPerJob":"9"}') });
  await page.getByText("Could not import inputs.", { exact: false }).waitFor();
  await retention.getByText("$1.500000", { exact: true }).waitFor();
  await page.getByLabel("Paid jobs per month", { exact: true }).fill("");
  await retention.getByText("40", { exact: true }).waitFor();
  assert((await retention.innerText()).includes("Unknown"));
  if (process.env.BUYER_UI_CSS) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile overflow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desktop overflow");
  }
  await page.getByRole("button", { name: "Reset assumptions", exact: true }).click();
  assert.equal(await page.getByLabel("Fixed operating costs per month", { exact: true }).inputValue(), "");
  assert.deepEqual(errors, []); assert.deepEqual(requests, ["GET"]);
  console.log("PASS: browser business scenarios, alternative margins, exact break-even, unknown costs/demand, invalid edits hide stale results, private input/report exports, validated import and reset. No data or payment requests.");
} finally { await browser.close(); }
