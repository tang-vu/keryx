/** Actual session-management component, intercepted HTTP and synthetic non-credential selectors. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AccountSessions}from'./components/keryx/account-sessions';createRoot(document.getElementById('root')).render(<AccountSessions/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const current = { id: "a".repeat(64), current: true, issuedAt: 1788900000000, expiresAt: 1789500000000 };
  const other = { ...current, id: "b".repeat(64), current: false };
  let rows = [current, other], fail = true, writes = 0, failedWriteSeen = false;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/auth/sessions")) {
      if (route.request().method() === "DELETE") {
        writes++;
        if (fail) { failedWriteSeen = true; return route.fulfill({ status: 503, json: { error: "unavailable" } }); }
        assert(path === "/api/auth/sessions" || path === `/api/auth/sessions/${other.id}`);
        rows = [current]; return route.fulfill({ json: { ok: true } });
      }
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ json: { sessions: rows, truncated: false } });
    }
    assert.equal(route.request().method(), "GET", "No signing or payment endpoint may be called");
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://sessions.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByText("This browser session", { exact: true }).waitFor();
  const selected = page.getByRole("button", { name: "Sign out session bbbbbbbb", exact: true });
  await selected.click(); await page.getByRole("alert").waitFor();
  assert(failedWriteSeen); assert.equal(await selected.count(), 1); assert.equal(await page.getByRole("status").count(), 0);
  fail = false;
  await selected.click(); await page.getByText("The selected session has been signed out.", { exact: true }).waitFor();
  await selected.waitFor({ state: "detached" });
  assert(await page.getByRole("button", { name: "Sign out all other sessions", exact: true }).isDisabled());
  rows = [current, other];
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click(); await selected.waitFor();
  await page.getByRole("button", { name: "Sign out all other sessions", exact: true }).click();
  await page.getByText("Other sessions have been signed out. This session remains active.", { exact: true }).waitFor();
  await selected.waitFor({ state: "detached" });
  assert.equal(writes, 3); assert.deepEqual(errors, []);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile content must not overflow");
  console.log("PASS: session inventory preserves failed revocations, confirms selected/bulk removal, keeps current session, and fits mobile. HTTP intercepted; no wallet/signing/payment calls.");
} finally { await browser.close(); }
