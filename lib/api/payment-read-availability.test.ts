import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SupabaseAdapter, throwingSupabaseFetch } from "../db/supabase-adapter";
import { createMessages } from "../i18n/messages";

const boundary = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("../db", () => ({ getDb: boundary.db }));
import { GET as payments } from "../../app/api/payments/route";
import { GET as activity } from "../../app/api/activity/route";

const origin = "https://synthetic-db.test", sentinel = "private-upstream-diagnostic-do-not-publish";
type Mode = "empty" | "rows" | "400" | "401" | "503" | "network" | "abort" | "invalid-json" | "null" | "204" | "object";
let mode: Mode, requests: Array<{ method: string; url: string }>;
const rawRows = [
  { id: "settled", query_id: "public", kind: "citation", source_id: "source", source_name: "Source", payer: "payer", payee: "payee",
    amount_usdc: "0.000001", network: "eip155:5042002", settled: true, settlement_status: "settled", tx_hash: "synthetic-circle-id",
    created_at: "2026-11-09T00:00:00Z", rationale: sentinel, authorization_id: sentinel, grant_epoch: sentinel,
    item_id: "original", item_title: "Original", item_url: "https://original.test/paper", content_version: "original-v1" },
  { id: "pending", query_id: "public", kind: "fetch", source_id: "source", source_name: "Source", payer: "payer", payee: "payee",
    amount_usdc: "0.000002", network: "eip155:5042", settled: false, settlement_status: "pending", created_at: "2026-11-09T00:00:01Z" },
  { id: "simulated", query_id: "public", kind: "citation", source_id: "source", source_name: "Source", payer: "payer", payee: "payee",
    amount_usdc: "0.000003", network: "eip155:5042002", settled: false, settlement_status: "simulated", created_at: "2026-11-09T00:00:02Z" },
];
beforeEach(() => {
  mode = "empty"; requests = []; boundary.db.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET"); requests.push({ method, url: url.href });
    if (url.origin !== origin || url.pathname !== "/rest/v1/payment_events" || method !== "GET")
      throw Error("Unexpected synthetic HTTP boundary");
    if (mode === "network") throw new TypeError(sentinel);
    if (mode === "abort") throw Object.assign(new Error(sentinel), { name: "AbortError" });
    if (["400", "401", "503"].includes(mode)) return Response.json({ message: sentinel, hint: sentinel }, { status: Number(mode) });
    if (mode === "204") return new Response(null, { status: 204 });
    if (mode === "invalid-json") return new Response(sentinel, { headers: { "content-type": "application/json" } });
    return Response.json(mode === "rows" ? rawRows : mode === "null" ? null : mode === "object" ? { unexpected: sentinel } : []);
  }));
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterEach(() => {
  expect(requests.every(request => request.method === "GET" && new URL(request.url).origin === origin
    && new URL(request.url).pathname === "/rest/v1/payment_events")).toBe(true);
});
const request = (query = "") => new NextRequest("https://payments.test/api/payments" + query);
// Pinned SDK2.112.3 retries rejected idempotent fetches three times. Keep its
// actual defaults; this fixture distinguishes SDK attempts from application calls.
const sdkAttempts = (value: Mode) => ["400", "401", "503", "network"].includes(value) ? 4 : 1;

it("demonstrates the actual SDK's resolved error result despite the throwing transport wrapper", async () => {
  mode = "503";
  await expect(throwingSupabaseFetch(origin + "/rest/v1/payment_events")).rejects.toThrow("Supabase request failed (503)");
  const client = createClient(origin, "synthetic-key-no-authority", { auth: { persistSession: false }, global: { fetch: throwingSupabaseFetch } });
  const result = await client.from("payment_events").select("*");
  expect(result.data).toBeNull(); expect(result.error?.message).toContain("Supabase request failed (503)");
  expect(requests).toHaveLength(5); await client.auth.stopAutoRefresh();
});

it.each(["400", "401", "503", "network", "abort", "invalid-json", "null", "204"] as const)(
  "keeps the actual SDK/ordinary adapter %s read unavailable rather than returning empty history", async failure => {
    mode = failure;
    await expect(new SupabaseAdapter().listPayments(80)).rejects.toThrow("Payment history unavailable");
    expect(requests).toHaveLength(sdkAttempts(failure));
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("limit")).toBe("80"); expect(url.searchParams.get("order")).toBe("created_at.desc");
    expect(url.searchParams.get("or")).toBe("(authorization_phase.is.null,authorization_phase.not.in.(prepared,cancelled_unexposed))");
  });
it("refuses a successful but non-array payment payload with a fixed availability error", async () => {
  mode = "object"; await expect(new SupabaseAdapter().listPayments(5)).rejects.toThrow("Payment history unavailable");
  expect(requests).toHaveLength(1);
});
it("preserves a genuine empty SDK result as an empty no-store200 response", async () => {
  boundary.db.mockResolvedValue(new SupabaseAdapter());
  const response = await payments(request()); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ payments: [] });
  expect(requests).toHaveLength(1); expect(new URL(requests[0].url).searchParams.get("limit")).toBe("50");
});
it("preserves exact successful normalization and the historical public payload across states and networks", async () => {
  mode = "rows"; const before = JSON.stringify(rawRows); boundary.db.mockResolvedValue(new SupabaseAdapter());
  const response = await payments(request("?limit=17")), body = await response.json(); expect(response.status).toBe(200);
  expect(body.payments.map((p: { id: string }) => p.id)).toEqual(["settled", "pending", "simulated"]);
  expect(body.payments.map((p: { amountUsdc: number }) => p.amountUsdc)).toEqual([.000001, .000002, .000003]);
  expect(body.payments.map((p: { settlementStatus: string }) => p.settlementStatus)).toEqual(["settled", "pending", "simulated"]);
  expect(body.payments.map((p: { network: string }) => p.network)).toEqual(["eip155:5042002", "eip155:5042", "eip155:5042002"]);
  expect(body.payments[0]).toMatchObject({ payer: "payer", payee: "payee", itemId: "original", itemUrl: "https://original.test/paper", contentVersion: "original-v1", txHash: "synthetic-circle-id" });
  expect(JSON.stringify(body)).not.toContain(sentinel); expect(JSON.stringify(rawRows)).toBe(before);
  expect(requests).toHaveLength(1); expect(new URL(requests[0].url).searchParams.get("limit")).toBe("17");
});

it.each(["503", "invalid-json"] as const)("returns an explicit sanitized no-store503 for the real SDK %s failure", async failure => {
  mode = failure; boundary.db.mockResolvedValue(new SupabaseAdapter());
  const response = await payments(request()); expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ error: "Payment history unavailable" });
  expect(requests).toHaveLength(sdkAttempts(failure));
});
it("keeps failed DB acquisition separate from empty history without issuing HTTP", async () => {
  boundary.db.mockRejectedValue(new Error(sentinel)); const response = await payments(request());
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Payment history unavailable" }); expect(requests).toEqual([]);
});
it("sanitizes an unavailable payment reader from another backend without retrying it", async () => {
  const listPayments = vi.fn(async () => { throw new Error(sentinel); }); boundary.db.mockResolvedValue({ listPayments });
  const response = await payments(request("?limit=200")); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Payment history unavailable" }); expect(listPayments).toHaveBeenCalledExactlyOnceWith(200); expect(requests).toEqual([]);
});
it("preserves invalid-limit refusal before DB/SDK acquisition", async () => {
  for (const query of ["?limit=0", "?limit=-1", "?limit=NaN", "?limit=2&limit=3"]) {
    const response = await payments(request(query)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_limit" });
  }
  expect(boundary.db).not.toHaveBeenCalled(); expect(requests).toEqual([]);
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ActivityTicker}from'./components/keryx/activity-ticker';
    createRoot(document.getElementById('root')).render(<ActivityTicker/>);
  ` }, bundle: true, minify: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  for (const suffix of ["components/keryx/activity-ticker.tsx", "components/keryx/activity-polling.ts"])
    expect(Object.keys(result.metafile!.inputs).some(path => path.replaceAll("\\", "/").endsWith(suffix))).toBe(true);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());
it.each(["503", "empty"] as const)("renders the actual SDK/adapter/activity-route %s result as unavailable or genuinely empty", async scenario => {
  mode = scenario; boundary.db.mockResolvedValue(new SupabaseAdapter());
  const response = await activity(), body = await response.text();
  const context = await browser.newContext({ serviceWorkers: "block" }), errors: string[] = [], calls: string[] = [];
  try {
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url()); calls.push(`${req.method()} ${url.pathname}`);
      if (url.origin !== "https://payment-availability.test" || req.method() !== "GET") return route.abort();
      if (url.pathname === "/api/activity") return route.fulfill({ status: response.status, contentType: "application/json", body });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div>' });
      return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://payment-availability.test/"); await page.addScriptTag({ content: bundle });
    if (scenario === "503") {
      await expect.poll(() => page.getByRole("status").textContent()).toBe(createMessages("en")("landingActivity.unavailable"));
      expect(body).toBe(JSON.stringify({ error: "Payment history unavailable", activity: [] }));
    } else {
      await expect.poll(() => page.locator("#root").textContent()).toBe(""); expect(body).toBe(JSON.stringify({ activity: [] }));
    }
    expect(requests).toHaveLength(sdkAttempts(scenario)); expect(calls).toEqual(["GET /", "GET /api/activity"]); expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
}, 20_000);
