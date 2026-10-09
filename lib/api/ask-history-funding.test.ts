import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { NextRequest } from "next/server";
import { afterAll, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { issueWebSession } from "../auth-session";
import type { QueryRun } from "../types";

const mocked = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocked.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocked.db }));
vi.mock("@/lib/config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, jwtSecret: "synthetic-history-secret-with-no-live-authority" } };
});
import { GET } from "../../app/api/me/asks/route";

const owner = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`;
const root = mkdtempSync(join(tmpdir(), "keryx-ask-funding-history-"));
const db = new SqliteAdapter(join(root, "fixture.sqlite")); await db.init();
const session = new AsyncLocalStorage<string | undefined>();
let browser: Browser | undefined;
mocked.db.mockResolvedValue(db);
mocked.cookies.mockImplementation(async () => ({ get: () => session.getStore() ? { value: session.getStore() } : undefined }));
afterAll(async () => { await browser?.close(); db.close(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

function run(id: string, totalSpent: number, totalToCreators: number, extra: Partial<QueryRun>): QueryRun {
  return { id, question: id, budget: 0.1, engine: "synthetic-history-fixture", subClaims: [], decisions: [],
    citations: [], answer: "Synthetic fixture; no payment or settlement", trace: [],
    totalSpent, totalToCreators, paymentMode: "offline", createdAt: "2026-10-09T00:00:00.000Z", asker: owner, ...extra };
}

it("keeps mixed wallet funding totals without inferring service price or a payer for keyed/prepaid/legacy history", async () => {
  for (const value of [
    run("Browser-funded result", 0.04, 0.03, { askerFunded: true, fundingOwner: "browser",
      provenance: { version: 1, surface: "web", ownershipMethod: "session" } }),
    run("Keyed result", 0.03, 0.02, { askerFunded: false, fundingOwner: "treasury",
      provenance: { version: 1, surface: "api", ownershipMethod: "api-key" } }),
    run("Prepaid A2A result", 0.06, 0.05, { askerFunded: false, fundingOwner: "treasury",
      provenance: { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } }),
    run("Legacy result", 0.02, 0.01, {}),
    run("Foreign private question", 0.99, 0.98, { asker: foreign, askerFunded: true }),
    run("Ownerless question", 0.99, 0.98, { asker: undefined }),
  ]) await db.saveQueryRun(value);
  const request = new NextRequest(`https://history.test/api/me/asks?wallet=${foreign}&limit=200`);
  expect((await GET(request)).status).toBe(401);
  const { token } = await issueWebSession(db, "synthetic-history-secret-with-no-live-authority", owner, "asker");
  const response = await session.run(token, () => GET(request));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.wallet).toBe(owner); expect(body.asks).toHaveLength(4);
  expect(body.totals).toMatchObject({ dispatches: 4, spentUsdc: 0.04, toCreatorsUsdc: 0.03, trialDispatches: 3 });
  expect(body.totals.trialToCreatorsUsdc).toBeCloseTo(0.08, 6);
  expect(body.asks.filter((value: { funded: boolean }) => value.funded)).toHaveLength(1);
  expect(body.asks.find((value: { id: string }) => value.id === "Legacy result")).not.toHaveProperty("provenance");
  expect(JSON.stringify(body)).not.toContain("Foreign private question");
  expect(JSON.stringify(body)).not.toContain("Ownerless question");

  const bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents:
    "import React from 'react';import{createRoot}from'react-dom/client';import{MyAsksView}from'./app/me/asks/my-asks-view';createRoot(document.getElementById('root')).render(<MyAsksView/>);" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-next-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ resolveDir: process.cwd(), loader: "js",
        contents: "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}" }));
    } }],
  })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const requests: string[] = [];
    await context.route("**/*", route => {
      requests.push(route.request().url());
      if (route.request().url() === "https://history.test/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (route.request().url() === "https://history.test/api/me/asks") return route.fulfill({ json: body });
      return route.abort();
    });
    const page = await context.newPage(); await page.goto("https://history.test/");
    await page.addScriptTag({ content: bundle });
    await page.getByRole("link", { name: "Prepaid A2A result", exact: true }).waitFor();
    const text = await page.locator("body").textContent();
    expect(text).not.toMatch(/free trial|free service|Keryx funding|funded by Keryx/i);
    expect(text).toContain("3 of these have no recorded browser-wallet creator funding");
    expect(text).toContain("$0.08 recorded to creators");
    expect(text).toContain("Original purchases, service fees and gas are separate");
    expect(await page.getByText("· creator funding not recorded from your browser wallet", { exact: true }).count()).toBe(3);
    expect(await page.getByRole("link", { name: "Legacy result", exact: true }).locator("..").textContent()).toContain("creator funding not recorded from your browser wallet");
    expect(await page.getByRole("link", { name: "Browser-funded result", exact: true }).locator("..").textContent()).not.toContain("creator funding not recorded");
    expect(requests).toEqual(["https://history.test/", "https://history.test/api/me/asks"]);
  } finally { await context.close(); }
}, 30000);
