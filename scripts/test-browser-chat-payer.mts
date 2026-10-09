/** Real chat/hook with a synthetic grant binding; no wallet, signature or real HTTP. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { assertResearchBrowserFixtureGraph, signedOutResearchAuthFixture } from "../test-support/research-browser-auth-fixture";

const session = "0x1111111111111111111111111111111111111111";
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';createRoot(document.getElementById('root')).render(<ResearchChat/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  external: ["@/lib/x402-client-sign", "@/lib/payments/browser-fetch-price-policy"],
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [signedOutResearchAuthFixture(), { name: "synthetic-grant", setup(api) {
    api.onResolve({ filter: /session-grant-panel$/ }, () => ({ path: "grant", namespace: "fixture" }));
    api.onResolve({ filter: /client-payto-allowlist$/ }, () => ({ path: "authority", namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents: args.path === "authority"
      ? "export const buildSourceIndex=()=>new Map();"
      : `import{useEffect}from'react';export function SessionGrantPanel({onBindingChange}){useEffect(()=>{const bind=paused=>onBindingChange({sessionId:'${session}',getSessionWalletClient:()=>null,expired:!paused,paused});bind(false);const listener=()=>bind(true);window.addEventListener('fixture:paused',listener);return()=>window.removeEventListener('fixture:paused',listener)},[onBindingChange]);return null}` }));
  } }],
});
assertResearchBrowserFixtureGraph(bundle.metafile);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
  page.on("pageerror", error => console.error(error.message));
  const calls: Record<string, unknown>[] = [];
  await page.route("**/*", route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/ask") { calls.push(request.postDataJSON()); return route.fulfill({ status: 401, json: { error: "session_expired", message: "Fixture session requires recovery" } }); }
    assert.equal(request.method(), "GET", "Only the synthetic ask may write");
    if (path === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
    if (path.startsWith("/api/")) return route.fulfill({ json: { sources: [], models: [] } });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://chat-payer.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByText(/Session expired\. Recover/).waitFor();
  await page.getByLabel("What do you want to know?").fill("Expired session question");
  await page.locator('[data-tour="dispatch-btn"]').click();
  await page.getByRole("alert").filter({ hasText: "Fixture session requires recovery" }).waitFor();
  assert.equal(calls[0].sessionId, session, "Expired grant identity must remain on the request");
  const turn = page.getByTestId("research-turn");
  assert((await turn.textContent())!.includes("your expired funded session (recovery required)"));
  assert(!(await turn.textContent())!.includes("treasury"));
  await page.evaluate(() => window.dispatchEvent(new Event("fixture:paused")));
  await page.getByText(/Session status unavailable/).waitFor();
  await page.getByLabel("What do you want to know?").fill("Paused session question");
  assert.equal(await page.locator('[data-tour="dispatch-btn"]').isDisabled(), true);
  await page.getByLabel("What do you want to know?").press("Control+Enter");
  assert.equal(calls.length, 1, "Paused grant must not silently send a treasury ask");
  console.log("PASS: expired grant preserves request identity and honest payer/error; paused grant blocks button and keyboard ask. Synthetic binding only, no signing.");
} finally { await browser.close(); }
