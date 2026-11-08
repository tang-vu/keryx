import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PaymentRecord } from "../types";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";

const boundary = vi.hoisted(() => ({ db: vi.fn(), network: "eip155:5042" }));
vi.mock("../db", () => ({ getDb: boundary.db }));
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  // Control only the public route's selected network metadata. The native
  // storage fixture keeps its actual offline testnet profile and key guards.
  return { ...actual, config: { ...actual.config,
    get networkId() { return boundary.network; },
  } };
});
import { GET } from "../../app/api/activity/route";

const networks = [ARC_MAINNET_PROFILE.networkId, ARC_TESTNET_PROFILE.networkId] as const;
let db: SqliteAdapter, native: DatabaseSync;
beforeEach(async () => {
  vi.clearAllMocks(); boundary.network = ARC_MAINNET_PROFILE.networkId;
  // A fresh ordinary offline fixture, not an enrolled mainnet store. Both network
  // strings below are synthetic retained row metadata; no supplier is contacted.
  db = new SqliteAdapter(":memory:"); await db.init();
  native = Reflect.get(db, "db") as DatabaseSync;
});
afterEach(() => db.close());

function insert(id: string, network: string | null, settled = 1, status = "settled", extra: { query?: string; phase?: string; kind?: string } = {}) {
  native.prepare(`INSERT INTO payment_events(id,kind,query_id,source_id,source_name,payer,payee,amount_usdc,
    network,settled,settlement_status,authorization_phase,rationale,created_at,item_id,item_title,item_url,content_version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, extra.kind ?? "citation", extra.query ?? "public", id, id,
      "synthetic-payer", "synthetic-payee", .000001, network, settled, status, extra.phase ?? null,
      "Private custodian rationale must remain absent", "2026-11-09T01:00:00Z", "item-" + id, "Article " + id,
      "https://synthetic.example/" + id, "version-" + id);
}
function originalRows() { return JSON.stringify(native.prepare("SELECT * FROM payment_events ORDER BY id").all()); }
function bind() {
  const questions = vi.fn(async (ids: string[]) => ids.includes("public") ? [{ id: "public", question: "Canonical public question" }] : []);
  const legacy = vi.fn(() => { throw Error("No raw original fallback"); });
  const listPayments = vi.fn(db.listPayments.bind(db));
  boundary.db.mockResolvedValue({ listPayments, runPrivacyActive: true, runPrivacy: { questions }, getQueryRun: legacy });
  return { questions, legacy, listPayments };
}
function mixed(selected: string) {
  const other = selected === networks[0] ? networks[1] : networks[0];
  insert("valid", selected);
  insert("private-valid", selected, 1, "settled", { query: "private" });
  insert("other-network", other);
  insert("pending-conflict", selected, 1, "pending");
  insert("failed-conflict", selected, 1, "failed");
  insert("simulated-conflict", selected, 1, "simulated");
  insert("unknown-status", selected, 1, "future-state");
  insert("false-settled", selected, 0, "settled");
  insert("pending", selected, 0, "pending");
  insert("simulated", selected, 0, "simulated");
  insert("fetch", selected, 1, "settled", { kind: "fetch" });
  insert("prepared", selected, 1, "settled", { phase: "prepared" });
  insert("cancelled", selected, 1, "settled", { phase: "cancelled_unexposed" });
}

it.each(networks)("keeps the actual native rows for %s distinct from conflicting states and the other rail", async selected => {
  boundary.network = selected; mixed(selected); const ports = bind(), before = originalRows();
  const recent = await db.listPayments(80);
  // Reachability: the real adapter retains opaque conflicting/foreign history;
  // the public projection, rather than a repaired ledger, must refuse it.
  expect(recent.some(p => p.sourceId === "pending-conflict" && p.settled && p.settlementStatus === "pending")).toBe(true);
  expect(recent.some(p => p.sourceId === "other-network")).toBe(true);
  const response = await GET(), body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const wanted = recent.filter(row => ["valid", "private-valid"].includes(row.sourceId));
  expect(body.activity.map((row: { sourceId: string }) => row.sourceId)).toEqual(wanted.map(row => row.sourceId));
  for (const row of body.activity) {
    expect(Object.keys(row).sort()).toEqual(["sourceId", "sourceName", "itemId", "itemTitle", "itemUrl", "contentVersion", "itemPublishedAt", "question", "rewardUsdc", "origin", "createdAt"].sort());
    expect(row.rewardUsdc).toBe(.000001); expect(row.contentVersion).toBe("version-" + row.sourceId);
    expect(row.question).toBe(row.sourceId === "valid" ? "Canonical public question" : null);
  }
  expect(ports.listPayments).toHaveBeenCalledExactlyOnceWith(80);
  expect(ports.questions).toHaveBeenCalledExactlyOnceWith(wanted.map(p => p.queryId));
  expect(ports.legacy).not.toHaveBeenCalled(); expect(originalRows()).toBe(before);
});

it.each(networks)("filters before the15-row page and privacy enrichment on %s without increasing the80-row scan", async selected => {
  boundary.network = selected;
  const other = selected === networks[0] ? networks[1] : networks[0];
  for (let n = 0; n < 32; n++) insert("excluded-" + n, n % 2 ? selected : other, 1, n % 2 ? "pending" : "settled");
  for (let n = 0; n < 20; n++) insert("valid-" + n, selected, 1, "settled", { query: n % 2 ? "private" : "public" });
  const recent = await db.listPayments(80), wanted = recent.filter(row => row.sourceId.startsWith("valid-")).slice(0, 15);
  const ports = bind(), before = originalRows(); const response = await GET();
  expect((await response.json()).activity.map((row: { sourceId: string }) => row.sourceId)).toEqual(wanted.map(row => row.sourceId));
  expect(ports.questions).toHaveBeenCalledExactlyOnceWith([...new Set(wanted.map(row => row.queryId))]);
  expect(ports.listPayments).toHaveBeenCalledExactlyOnceWith(80); expect(originalRows()).toBe(before);
});

it.each(networks)("preserves only the existing undefined-network legacy-testnet convention on %s", async selected => {
  boundary.network = selected; insert("base", selected); const base = (await db.listPayments(1))[0];
  const missing = { ...base, sourceId: "legacy-unlabelled", network: undefined };
  const rows = [base, { ...base, sourceId: "legacy-status", settlementStatus: undefined }, missing,
    ...[null, "arc", "arcTestnet", "eip155:1", "eip155:5042 ", "EIP155:5042"].map((network, i) => ({ ...base, sourceId: "unattributed-" + i, network }))];
  const before = JSON.stringify(rows), ports = bind();
  boundary.db.mockResolvedValue({ listPayments: async () => rows, runPrivacyActive: true, runPrivacy: { questions: ports.questions } });
  expect((await (await GET()).json()).activity.map((row: { sourceId: string }) => row.sourceId))
    .toEqual(selected === ARC_TESTNET_PROFILE.networkId ? ["base", "legacy-status", "legacy-unlabelled"] : ["base", "legacy-status"]);
  expect(JSON.stringify(rows)).toBe(before);
});

it.each([[true, "pending"], [true, "failed"], [true, "simulated"], [false, "settled"]] as const)(
  "retains the ordinary writer refusal for settled=%s/status=%s", async (settled, settlementStatus) => {
    const before = originalRows();
    await expect(db.recordPayment({ id: "refused", kind: "citation", queryId: "public", sourceId: "source", sourceName: "Source",
      payer: "payer", payee: "payee", amountUsdc: .000001, network: ARC_TESTNET_PROFILE.networkId, settled, settlementStatus,
      txHash: "synthetic-circle-id", createdAt: "2026-11-09T01:00:00Z" } satisfies PaymentRecord)).rejects.toThrow("settled flag conflicts");
    expect(originalRows()).toBe(before);
  });

it("does not look up questions when only nonqualifying financial rows exist", async () => {
  insert("other", ARC_TESTNET_PROFILE.networkId); insert("conflict", ARC_MAINNET_PROFILE.networkId, 1, "pending");
  const ports = bind(); ports.questions.mockRejectedValue(Error("privacy_unavailable")); const before = originalRows();
  expect(await (await GET()).json()).toEqual({ activity: [] });
  expect(ports.questions).not.toHaveBeenCalled(); expect(ports.legacy).not.toHaveBeenCalled(); expect(originalRows()).toBe(before);
});
it("retains unavailable activity after an eligible row's privacy lookup fails, with no raw fallback", async () => {
  insert("valid", ARC_MAINNET_PROFILE.networkId); const ports = bind(); ports.questions.mockRejectedValue(Error("privacy_unavailable"));
  const before = originalRows(); expect(await (await GET()).json()).toEqual({ error: "privacy_unavailable", activity: [] });
  expect(ports.questions).toHaveBeenCalledOnce(); expect(ports.legacy).not.toHaveBeenCalled(); expect(originalRows()).toBe(before);
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ActivityTicker}from'./components/keryx/activity-ticker';
    createRoot(document.getElementById('root')).render(<ActivityTicker/>);
  ` }, bundle: true, minify: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  for (const path of ["components/keryx/activity-ticker.tsx", "components/keryx/activity-polling.ts", "components/keryx/display-time.tsx"])
    expect(Object.keys(result.metafile!.inputs).some(input => input.replaceAll("\\", "/").endsWith(path))).toBe(true);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());
it.each(networks)("renders only the actual %s route projection in the real ticker", async selected => {
  boundary.network = selected; mixed(selected); bind(); const before = originalRows(), response = await GET(), body = await response.text();
  const context = await browser.newContext({ serviceWorkers: "block" }), errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url()); requests.push(`${request.method()} ${url.pathname}`);
      if (url.origin !== "https://activity-boundary.test" || request.method() !== "GET") return route.abort();
      if (url.pathname === "/api/activity") return route.fulfill({ status: response.status, contentType: "application/json", body });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div>' });
      return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://activity-boundary.test/"); await page.addScriptTag({ content: bundle });
    await page.locator('a[href="/creator/valid"]').first().waitFor();
    expect(await page.locator("#root a").evaluateAll(links => [...new Set(links.map(link => link.getAttribute("href")))].sort()))
      .toEqual(["/creator/private-valid", "/creator/valid"]);
    expect(await page.locator('a[href="/creator/private-valid"]').first().getAttribute("title")).toBeNull();
    expect(requests).toEqual(["GET /", "GET /api/activity"]); expect(errors).toEqual([]); expect(originalRows()).toBe(before);
  } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
}, 10_000);
