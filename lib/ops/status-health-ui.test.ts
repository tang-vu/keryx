import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { operationsMessages } from "../../locales/en/operations";

// Real StatusPage, React, Chromium, fetch and native HTTP responses. The surrounding
// site shell/optional proof sections and rich copy are isolated presentation adapters.
const root = process.cwd();
const copy = operationsMessages;
let server: Server, browser: Browser, context: BrowserContext | undefined, base = "";
let mode = "healthy", outbound = 0, abortedHealthResponses = 0;
const requests: { method: string; path: string }[] = [];
function payload() {
  const value: Record<string, unknown> = { name: "keryx", ok: true, db: "ok", status: "operational",
    commit: "fixture-original-source", uptimeSeconds: 123, reasoning: "fixture-provider", settles: "offline",
    network: "arcTestnet", rpcProvider: "Fixture RPC", time: new Date().toISOString(),
    monitoring: { state: "incomplete", checks: [] } };
  if (mode === "stale") value.time = new Date(Date.now() - 180_000).toISOString();
  if (mode === "foreign") value.name = "foreign";
  if (mode === "missing-status") delete value.status;
  if (mode === "bad-db") value.db = "unreachable";
  if (mode === "degraded") value.status = "degraded";
  return value;
}

beforeAll(async () => {
  const sections: Record<string, string> = {
    "monitoring-status-section": "MonitoringStatusSection", "registry-status-section": "RegistryStatusSection",
    "dispatch-health-section": "DispatchHealthSection", "settlement-proof-section": "SettlementProofSection",
    "pending-reconciliation-section": "PendingReconciliationSection",
  };
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/status/page';createRoot(document.getElementById('root')).render(React.createElement(Page));`,
    resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "isolated-status-shell", setup(plugin) {
      plugin.onResolve({ filter: /^@\// }, args => {
        const leaf = args.path.split("/").at(-1)!;
        if (args.path === "@/lib/i18n/ui-copy" || leaf === "site-header" || leaf === "site-footer"
          || leaf === "display-time" || sections[leaf]) return { path: leaf, namespace: "fixture" };
        const file = resolve(root, args.path.slice(2));
        return { path: [file, ...[".ts", ".tsx", ".mjs"].map(extension => file + extension)].find(candidate => existsSync(candidate))! };
      });
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        if (args.path === "ui-copy") return { contents: `import {operationsMessages as copy} from ${JSON.stringify(resolve(root, "locales/en/operations.ts"))};export const useUiMessages=()=>key=>copy[key]??key;export const useUiRichMessages=()=>()=>null;`, resolveDir: root };
        const name = sections[args.path] ?? ({ "site-header": "SiteHeader", "site-footer": "SiteFooter", "display-time": "DisplayTime" } as Record<string, string>)[args.path];
        return { contents: `import React from 'react';export const ${name}=()=>React.createElement('aside',{'data-fixture-section':${JSON.stringify(name)}});`, resolveDir: root };
      });
    } }] });
  const bytes = bundle.outputFiles[0].contents;
  server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture.invalid").pathname;
    requests.push({ method: req.method!, path });
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (path === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bytes); return; }
    if (path === "/api/health") {
      if (mode === "redirect") { res.writeHead(302, { Location: "/api/redirect-target" }); res.end(); return; }
      res.writeHead(mode === "http" ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      if (mode === "held") { res.write('{"name":"keryx"'); res.on("close", () => abortedHealthResponses++); return; }
      if (mode === "malformed") { res.end('{PRIVATE invalid'); return; }
      res.end(JSON.stringify(mode === "oversize" ? { ...payload(), padding: "x".repeat(32_769) } : payload())); return;
    }
    if (path === "/api/treasury") { res.setHeader("Content-Type", "application/json"); res.end('{"available":false,"unifiedBalance":null}'); return; }
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
});
afterEach(async () => { await context?.close(); context = undefined; expect(outbound).toBe(0); expect(requests.every(req => req.method === "GET")).toBe(true); });
afterAll(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });

async function pageFor(nextMode: string): Promise<Page> {
  mode = nextMode; requests.length = 0; outbound = 0; abortedHealthResponses = 0;
  context = await browser.newContext();
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== base) { outbound++; return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date() });
  await page.goto(base, { waitUntil: "load" });
  return page;
}
async function heading(page: Page, value: string, timeout = 3_000) { await page.getByRole("heading", { name: value, exact: true, level: 1 }).waitFor({ timeout }); }

it("shows a current operational response while retaining independent incomplete monitoring", async () => {
  const page = await pageFor("healthy"); await heading(page, copy["statusPage.serviceAvailable"]);
  expect(await page.getByText("fixture-original-source", { exact: true }).count()).toBe(1);
  expect(await page.locator('[data-fixture-section="MonitoringStatusSection"]').count()).toBe(1);
});
it("preserves a current degraded response and its ordinary details", async () => {
  const page = await pageFor("degraded"); await heading(page, copy["statusPage.degraded"]);
  expect(await page.getByText("fixture-original-source", { exact: true }).count()).toBe(1);
});
it.each(["http", "stale", "foreign", "missing-status", "bad-db", "redirect", "malformed", "oversize"])("refuses available for a native %s health response", async bad => {
  const page = await pageFor(bad); await heading(page, copy["statusPage.unavailable"]);
  expect(await page.getByText("fixture-original-source", { exact: true }).count()).toBe(0);
  expect(requests.some(req => req.path === "/api/redirect-target")).toBe(false);
});
it("clears an earlier green response on a failed poll and recovers on the next successful GET", async () => {
  const page = await pageFor("healthy"); await heading(page, copy["statusPage.serviceAvailable"]);
  mode = "http"; await page.clock.fastForward(10_000); await heading(page, copy["statusPage.unavailable"]);
  expect(await page.getByText("fixture-original-source", { exact: true }).count()).toBe(0);
  expect(await page.locator('[data-fixture-section="MonitoringStatusSection"]').count()).toBe(0);
  mode = "healthy"; await page.clock.fastForward(10_000); await heading(page, copy["statusPage.serviceAvailable"]);
  expect(requests.filter(req => req.path === "/api/health")).toHaveLength(3);
  expect(requests.filter(req => req.path === "/api/treasury")).toHaveLength(1);
});
it("bounds a native unfinished body with the existing health request deadline", async () => {
  const page = await pageFor("held"); await heading(page, copy["statusPage.unavailable"], 11_000);
  await expect.poll(() => abortedHealthResponses).toBe(1);
  expect(requests.filter(req => req.path === "/api/health")).toHaveLength(1);
});
