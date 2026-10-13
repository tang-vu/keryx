import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";

const output = resolve("output/research-mandates-browser"); await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{ResearchMandateWorkspace}from'./components/keryx/research-mandate-workspace';createRoot(document.getElementById('root')).render(<ResearchMandateWorkspace/>);",
  loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const css = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
const browser = await chromium.launch({ headless: true });
const failures: string[] = [];
try {
  for (const width of [360, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
    const page = await context.newPage(); const blocked: string[] = [];
    page.on("pageerror", error => failures.push(error.message));
    await context.route("**/*", route => {
      if (route.request().url() === "https://mandates.test/") return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body style="background:#f1e9d7;color:#272a22"><div id="root"></div></body></html>` });
      blocked.push(route.request().url()); return route.abort();
    });
    await page.goto("https://mandates.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("heading", { name: "Give research a clear spending boundary.", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Assess supplied policy", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Within budget", exact: true }).click();
    await page.getByRole("button", { name: "Assess supplied policy", exact: true }).click();
    await page.getByRole("heading", { name: "Fits the supplied policy", exact: true }).waitFor();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export assessment", exact: true }).click();
    const file = await downloading; const result = JSON.parse(await readFile((await file.path())!, "utf8"));
    assert.equal(result.executionAuthorized, false); assert.equal(result.basis, "caller-supplied-policy-and-books");
    assert(result.prepareCalldata?.startsWith("0x"));
    await page.getByLabel("Proposed purchase (USDC)", { exact: true }).fill("0.0000001");
    assert.equal(await page.getByRole("button", { name: "Export assessment", exact: true }).count(), 0, "An edit invalidates the displayed assessment");
    await page.getByRole("button", { name: "Assess supplied policy", exact: true }).click();
    await page.getByRole("alert").waitFor();
    for (const scenario of ["Overdue obligation", "Pending exposure", "Wrong recipient", "Unknown books"]) {
      await page.getByRole("button", { name: scenario, exact: true }).click();
      await page.getByRole("button", { name: "Assess supplied policy", exact: true }).click();
      await page.getByRole("heading", { name: "Hold purchase", exact: true }).waitFor();
    }
    await page.screenshot({ path: resolve(output, `mandate-en-${width}.png`), fullPage: true });
    const input = page.getByLabel("Policy, books and proposed purchase (JSON)", { exact: true });
    await page.getByText("Policy, books and proposed purchase (JSON)", { exact: true }).click();
    await input.fill('{"proposal":{"amountUsdc":{}},"books":{"balanceUsdc":[]}}');
    await page.getByRole("button", { name: "Assess supplied policy", exact: true }).click(); await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "VI", exact: true }).click();
    await page.getByRole("heading", { name: "Đặt giới hạn rõ ràng cho chi phí nghiên cứu.", exact: true }).waitFor();
    await page.getByRole("button", { name: "Nghĩa vụ quá hạn", exact: true }).click();
    await page.getByRole("button", { name: "Kiểm tra chính sách", exact: true }).click();
    await page.getByRole("heading", { name: "Tạm giữ khoản mua", exact: true }).waitFor();
    await page.getByText("Tiền mặt phải đủ cho nghĩa vụ chưa trả, khoản đang giữ và khoản mua này cùng lúc.", { exact: true }).waitFor();
    const policyDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Xuất chính sách", exact: true }).click();
    const policyFile = await policyDownload; const policy = JSON.parse(await readFile((await policyFile.path())!, "utf8"));
    assert.equal(policy.policy.liabilities[0].state, "open");
    assert(Date.parse(policy.policy.liabilities[0].dueAt) < Date.now());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile has no horizontal overflow");
    await page.screenshot({ path: resolve(output, `mandate-vi-${width}.png`), fullPage: true });
    assert.deepEqual(blocked, [], "The workspace does not call an API, wallet, model or remote asset");
    await context.close();
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, widths: [360, 1440], languages: ["en", "vi"], scope: "bundled real component, synthetic inputs; not deployed Next route", networkRequests: 0, executionAuthorized: false }, null, 2));
  console.log("PASS: bilingual desktop/mobile mandate scenarios, refusal paths, edit invalidation and exports; no network or payment");
} finally { await browser.close(); }
