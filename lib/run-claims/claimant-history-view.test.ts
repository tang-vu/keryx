import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLAIMANT_HISTORY_DETAIL_MAX_BYTES, parseClaimantHistoryDetail, parseClaimantHistoryPage } from "@/app/me/asks/claimant-history-contract";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { createMessages, englishMessages, validateMessageCatalogue } from "@/lib/i18n/messages";
import { createRunClaimRoutes } from "./http";
import type { KeryxDB } from "@/lib/db/keryx-db";
import type { RunOwnershipHistoryQuery } from "./history";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
const binding = { network: "eip155:5042002" as const, origin: "https://claimant-history.invalid" };
const identity = { owner, ...binding };
const createdAt = "2026-10-11T00:00:00.000Z", claimedAt = "2026-10-11T00:01:00.000Z";
const row = { id: "synthetic-claimed", createdAt, question: "Synthetic <claimed> question", provenance: null,
  funding: "other-or-unknown" as const, recordedSpendUsdc: 0, recordedCreatorAllocationUsdc: 0, paymentMode: "offline" as const,
  isFollowUp: false, ownership: { method: "claimed" as const, claimedAt } };
const history = (rows = [row], nextCursor: string | null = null) => ({ version: 1, wallet: owner, binding, scope: "ownership-current-store", rows, nextCursor });
const original = { id: row.id, question: row.question, answer: "Synthetic saved <answer>\n[link](https://external.invalid/)", createdAt,
  budget: 0, engine: "heuristic", subClaims: [], decisions: [], citations: [{ marker: "S1", sourceName: "Synthetic source <name>",
    sourceId: "source", weight: 1, reward: 0, rationale: "Synthetic" }], trace: [], totalSpent: 0, totalToCreators: 0, paymentMode: "offline" as const };
const detail = () => ({ version: 1, wallet: owner, binding, ownership: row.ownership, run: original });

describe("private ownership display projection", () => {
  it("validates the actual closed list packet and projects detail without changing the original", () => {
    const before = JSON.stringify(original);
    expect(parseClaimantHistoryPage(history(), identity).rows).toEqual([row]);
    const projected = parseClaimantHistoryDetail({ ...detail(), run: { ...original, syntheticPrivateExtra: "must-not-be-retained" } }, identity, row);
    expect(projected.run).toEqual({ id: row.id, createdAt, question: row.question, answer: original.answer,
      citations: [{ marker: "S1", sourceName: "Synthetic source <name>" }] });
    expect(JSON.stringify(projected)).not.toContain("must-not-be-retained"); expect(JSON.stringify(original)).toBe(before);
  });
  it.each(["owner", "network", "origin"])("refuses a different %s identity on list and detail", field => {
    const changed = { ...identity, [field]: field === "owner" ? other : field === "network" ? "eip155:5042" : "https://other.invalid" };
    expect(() => parseClaimantHistoryPage(history(), changed)).toThrow();
    expect(() => parseClaimantHistoryDetail(detail(), changed, row)).toThrow();
  });
  it("refuses oversized, duplicate, unordered, secret-bearing and malformed summaries", () => {
    for (const packet of [history(Array.from({ length: 26 }, (_, index) => ({ ...row, id: `row-${index}` }))), history([row, row]),
      history([row, { ...row, id: "newer", createdAt: "2026-10-12T00:00:00.000Z" }]),
      { ...history(), credential: "forbidden" }, history([{ ...row, ownership: { method: ["claimed"], claimedAt } } as unknown as typeof row]),
      history([{ ...row, question: "broken\ud800" }]), history([], "?credential=forbidden")])
      expect(() => parseClaimantHistoryPage(packet, identity)).toThrow();
  });
  it("refuses changed detail identity, ownership, original metadata or renderable objects", () => {
    for (const packet of [{ ...detail(), run: { ...original, id: "other" } }, { ...detail(), run: { ...original, question: "Changed" } },
      { ...detail(), run: { ...original, createdAt: claimedAt } }, { ...detail(), ownership: { method: "recorded", claimedAt: null } },
      { ...detail(), run: { ...original, answer: { message: "unsafe" } } }, { ...detail(), run: { ...original, citations: [{ marker: "S1", sourceName: {} }] } }])
      expect(() => parseClaimantHistoryDetail(packet, identity, row)).toThrow();
  });
  it("registers whole English caution and plural messages without interpreting inserted data", () => {
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    const message = createMessages("en");
    for (const count of [0, 1, 25]) expect(message(count === 1 ? "claimantHistory.rows.one" : "claimantHistory.rows.other", { count }))
      .toBe(`Showing ${count} ${count === 1 ? "run" : "runs"} on this page.`);
    expect(renderToStaticMarkup(createElement("p", null, message("claimantHistory.claimedAt", { date: "<date>{count}" }))))
      .toBe("<p>Claimed at &lt;date&gt;{count}</p>");
    expect(message("claimantHistory.authority")).toContain("does not change its original asker, payer, funding, receipts or settlement");
  });
  it("admits a valid saved answer above two MiB while bounding the ordinary original envelope", async () => {
    const packet = { ...detail(), run: { ...original, answer: "x".repeat(2_200_000) } };
    const value = parseClaimantHistoryDetail(await readBoundedJson(Response.json(packet), CLAIMANT_HISTORY_DETAIL_MAX_BYTES), identity, row);
    expect(value.run.answer.length).toBe(2_200_000);
    await expect(readBoundedJson(new Response("x".repeat(CLAIMANT_HISTORY_DETAIL_MAX_BYTES + 1)), CLAIMANT_HISTORY_DETAIL_MAX_BYTES)).rejects.toThrow("size limit");
  });
  it("catalogues every new UI label without adding an inline-copy allowance", async () => {
    const { extractUiCopy } = await import("../../scripts/check-ui-copy.mjs");
    for (const file of ["app/me/asks/claimant-history-view.tsx", "app/me/asks/my-asks-view.tsx"])
      expect(extractUiCopy(file, readFileSync(file, "utf8"))).toEqual([]);
  });
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  const output = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ClaimantHistoryPane}from'./app/me/asks/claimant-history-view';
    import{MyAsksView}from'./app/me/asks/my-asks-view';
    const root=createRoot(document.getElementById('root'));
    window.mount=(tabs=false)=>root.render(tabs?<MyAsksView/>:<ClaimantHistoryPane/>);
    window.unmount=()=>root.unmount();window.mount(window.useTabs);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "controlled-account-boundaries", setup(builder) {
    builder.onResolve({ filter: /\/lib\/hooks\/use-siwe-auth$|^@\/lib\/hooks\/use-siwe-auth$/ }, () => ({ path: "session", namespace: "fixture" }));
    builder.onResolve({ filter: /^\.\/current-history-view$/ }, () => ({ path: "current-history", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onResolve({ filter: /^sonner$/ }, () => ({ path: "toast", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "session"
      ? `import{useState,useEffect}from'react';export function useSiweAuth(){const[value,set]=useState(window.fixtureSession);useEffect(()=>{const changed=()=>set(window.fixtureSession);window.addEventListener('fixture-session',changed);return()=>window.removeEventListener('fixture-session',changed)},[]);return{session:value}}`
      : args.path === "current-history" ? `import React from'react';export function CurrentHistoryPane(){return <p data-fixture="current-history">Synthetic existing browse boundary</p>}`
      : args.path === "link" ? `import React from'react';export default function Link(props){return <a {...props}/>} `
      : `export const toast={error:()=>{}}`, loader: "tsx", resolveDir: process.cwd() }));
  } }], define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } });
  bundle = output.outputFiles[0].text;
  expect(bundle).not.toContain("node:crypto");
  browser = await chromium.launch({ headless: true, executablePath: process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE });
});
afterAll(async () => { await browser?.close(); });

async function fixture(options: { listStatus?: number; detailStatus?: number; tabs?: boolean; session?: "signed-out" | "checking";
  late?: boolean; malformed?: boolean; cyclic?: boolean; hanging?: boolean; many?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(5000);
  const calls: { path: string; method: string; expected: string | undefined }[] = [], errors: string[] = [];
  const list = vi.fn(async (_wallet: string, query: RunOwnershipHistoryQuery) => options.many ? Array.from({ length: 26 }, (_, index) => {
    const stamp = Date.parse(query.before?.createdAt ?? createdAt) - (index + 1) * 1000;
    return { ...row, id: `run-${stamp}`, createdAt: new Date(stamp).toISOString() };
  }) : query.before ? [{ ...row, id: "older", createdAt: "2026-10-10T00:00:00.000Z" }]
    : [row, { ...row, id: "older", createdAt: "2026-10-10T00:00:00.000Z" }]);
  const read = vi.fn(async () => ({ run: original, ownership: row.ownership }));
  const routes = createRunClaimRoutes({ enabled: true, binding, session: async () => ({ wallet: owner, currentId: "d".repeat(64),
    db: { runOwnershipHistory: { list, read } } as unknown as KeryxDB }), key: async () => null, db: async () => { throw new Error("No DB"); } });
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(({ owner, session, tabs }) => {
    Reflect.set(window, "fixtureSession", session === "signed-out" ? null : session === "checking" ? undefined : { address: owner, role: "researcher" });
    Reflect.set(window, "useTabs", tabs);
  }, { owner, session: options.session, tabs: options.tabs });
  let release: (() => void) | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== binding.origin) throw new Error("External request refused");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    calls.push({ path: url.pathname + url.search, method: request.method(), expected: request.headers()["x-keryx-expected-wallet"] });
    expect(request.method()).toBe("GET"); expect(request.postData()).toBeNull();
    if (options.tabs && url.pathname === "/api/me/asks") return route.fulfill({ json: { asks: [], totals: null, truncated: false } });
    if (url.pathname === "/api/me/run-history") {
      if (options.late || options.hanging) await delayed;
      const status = options.listStatus ?? (request.headers()["x-keryx-expected-wallet"] === other ? 409 : 200);
      if (status !== 200) return route.fulfill({ status, json: { error: "history_unavailable" } });
      // Page size remains 25 in real UI. A controlled HTTP fixture supplies 26
      // rows so the real server route emits its genuine bound cursor.
      if (options.malformed) return route.fulfill({ json: { ...history(), wallet: other } });
      if (options.cyclic && url.searchParams.has("cursor")) return route.fulfill({ json: history([{ ...row, id: "older", createdAt: "2026-10-10T00:00:00.000Z" }], url.searchParams.get("cursor")) });
      if (!options.many && !url.searchParams.has("cursor")) list.mockResolvedValueOnce(Array.from({ length: 26 }, (_, index) => ({ ...row, id: index === 0 ? row.id : `run-${String(100 - index).padStart(3, "0")}`, createdAt: new Date(Date.parse(createdAt) - index * 1000).toISOString() })));
      const response = await routes.LIST(new Request(request.url(), { headers: request.headers() }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    if (url.pathname.startsWith("/api/me/run-history/")) {
      if (options.detailStatus) return route.fulfill({ status: options.detailStatus, json: { error: "run_unavailable" } });
      const response = await routes.DETAIL(new Request(request.url(), { headers: request.headers() }), url.pathname.split("/").at(-1)!);
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    throw new Error(`Unexpected synthetic request ${url.pathname}`);
  });
  await page.goto(binding.origin); await page.addScriptTag({ content: bundle });
  return { page, context, calls, errors, release: () => release!() };
}
async function settle(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

it("real pane reads a claimed original via actual controlled owner API and paginates only on explicit actions", async () => {
  const f = await fixture();
  try {
    await f.page.getByText("Synthetic <claimed> question", { exact: true }).first().waitFor();
    expect(f.calls).toHaveLength(1); expect(f.calls[0]).toMatchObject({ path: "/api/me/run-history?limit=25", expected: owner, method: "GET" });
    await f.page.getByRole("button", { name: "Read saved run", exact: true }).first().click();
    await f.page.getByText(original.answer, { exact: true }).waitFor();
    expect(await f.page.locator("a").count()).toBe(0); expect(await f.page.locator("script[src]").count()).toBe(0);
    expect(await f.page.locator("img").count()).toBe(0); expect(await f.page.locator("body").innerText()).not.toContain("must-not-be-retained");
    expect(f.calls).toHaveLength(2);
    await f.page.getByRole("button", { name: "Older runs", exact: true }).click();
    await f.page.getByText("Saved at 2026-10-10T00:00:00.000Z", { exact: true }).waitFor();
    expect(await f.page.getByText(original.answer, { exact: true }).count()).toBe(0);
    expect(f.calls[2].path).toMatch(/^\/api\/me\/run-history\?limit=25&cursor=[A-Za-z0-9_-]+$/);
    await f.page.getByRole("button", { name: "Newer runs", exact: true }).click();
    await f.page.getByText("Saved at 2026-10-11T00:00:00.000Z", { exact: true }).waitFor();
    expect(f.calls).toHaveLength(4); await settle(f.page); expect(f.calls).toHaveLength(4); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("existing current/browse/testnet actions survive the distinct claimant tab", async () => {
  const f = await fixture({ tabs: true });
  try {
    await f.page.getByRole("button", { name: "Recorded and claimed runs", exact: true }).click();
    await f.page.getByText("Saved at 2026-10-11T00:00:00.000Z", { exact: true }).waitFor();
    await f.page.getByRole("button", { name: "Arc testnet history", exact: true }).click();
    await expect.poll(() => f.calls.filter(call => call.path === "/api/me/asks?network=arcTestnet&limit=200").length).toBe(1);
    expect(await f.page.getByText("Claimed account ownership", { exact: true }).count()).toBe(0);
    await f.page.getByRole("button", { name: "Current network", exact: true }).click();
    await f.page.getByRole("button", { name: "Return to dispatch ledger", exact: true }).click();
    await f.page.getByRole("button", { name: "Browse attributed history", exact: true }).click();
    await f.page.locator('[data-fixture="current-history"]').waitFor(); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("explicit pagination stops at its finite forty-page bound and reset starts at the newest page", async () => {
  const f = await fixture({ many: true });
  try {
    for (let count = 1; count < 40; count++) {
      await f.page.getByRole("button", { name: "Older runs", exact: true }).click();
      await expect.poll(() => f.calls.length).toBe(count + 1);
    }
    await f.page.getByText("This browse is limited to 40 pages of 25 runs. Refresh to start again from the newest page.", { exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: "Older runs", exact: true }).isDisabled()).toBe(true);
    expect(f.calls).toHaveLength(40);
    await f.page.getByRole("button", { name: "Refresh this history", exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(41);
    expect(f.calls.at(-1)?.path).toBe("/api/me/run-history?limit=25"); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
}, 20_000);
it.each([401, 403, 404, 409, 503])("list refusal %i has no silent retry, alternate store or body promotion", async status => {
  const f = await fixture({ listStatus: status });
  try {
    await f.page.getByText(status === 401 ? "Sign in to browse recorded and claimed runs." : status === 409
      ? "The signed-in account changed. Return to the ledger and open this history again."
      : "Recorded and claimed history is unavailable for this account or store. No other history store will be used.", { exact: true }).waitFor();
    await settle(f.page); expect(f.calls).toHaveLength(1); expect(await f.page.getByRole("button", { name: "Read saved run" }).count()).toBe(0);
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("detail 404 keeps the private refusal and never falls back to public reports", async () => {
  const f = await fixture({ detailStatus: 404 });
  try {
    await f.page.getByRole("button", { name: "Read saved run", exact: true }).first().click();
    await f.page.getByText("This saved run is unavailable or its ownership changed. No public report will be used instead.", { exact: true }).waitFor();
    await settle(f.page); expect(f.calls).toHaveLength(2); expect(f.calls.every(call => call.path.startsWith("/api/me/run-history"))).toBe(true);
    expect(await f.page.locator("a").count()).toBe(0); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
it("account switch removes prior-owner rows/details and rejects late old-owner response", async () => {
  for (const late of [false, true]) {
    const f = await fixture({ late });
    try {
      await expect.poll(() => f.calls.length).toBe(1);
      if (!late) { await f.page.getByRole("button", { name: "Read saved run", exact: true }).first().click(); await f.page.getByText(original.answer, { exact: true }).waitFor(); }
      await f.page.evaluate(other => { Reflect.set(window, "fixtureSession", { address: other, role: "researcher" }); window.dispatchEvent(new Event("fixture-session")); }, other);
      f.release();
      await f.page.getByText("The signed-in account changed. Return to the ledger and open this history again.", { exact: true }).waitFor();
      expect(await f.page.getByText(original.answer, { exact: true }).count()).toBe(0);
      expect(await f.page.getByText(row.question, { exact: true }).count()).toBe(0); expect(f.calls.at(-1)?.expected).toBe(other); expect(f.errors).toEqual([]);
    } finally { f.release(); await f.context.close(); }
  }
});
it("malformed owner and repeated cursor refuse without another page or automatic retry", async () => {
  for (const options of [{ malformed: true }, { cyclic: true }]) {
    const f = await fixture(options);
    try {
      if (options.cyclic) { await f.page.getByRole("button", { name: "Older runs", exact: true }).click(); }
      await f.page.getByText("Recorded and claimed history is unavailable for this account or store. No other history store will be used.", { exact: true }).waitFor();
      await settle(f.page); expect(f.calls).toHaveLength(options.cyclic ? 2 : 1); expect(f.errors).toEqual([]);
    } finally { await f.context.close(); }
  }
});
it("checking/signed-out sessions make no history reads", async () => {
  for (const session of ["checking", "signed-out"] as const) {
    const f = await fixture({ session });
    try { await f.page.getByText(session === "checking" ? "Checking signed-in account…" : "Sign in to browse recorded and claimed runs.", { exact: true }).waitFor(); await settle(f.page); expect(f.calls).toEqual([]); }
    finally { await f.context.close(); }
  }
});
it("a hanging read reaches its finite deadline and unmount aborts without another request", async () => {
  const f = await fixture({ hanging: true });
  try {
    await expect.poll(() => f.calls.length).toBe(1);
    await f.page.getByText("Recorded and claimed history is unavailable for this account or store. No other history store will be used.", { exact: true }).waitFor({ timeout: 12_000 });
    await f.page.evaluate(() => Reflect.get(window, "unmount")()); f.release(); await settle(f.page); expect(f.calls).toHaveLength(1); expect(f.errors).toEqual([]);
  } finally { f.release(); await f.context.close(); }
}, 20_000);

it("the original page metadata and history callback bodies remain intact outside the tab insertion", () => {
  const source = readFileSync("app/me/asks/my-asks-view.tsx", "utf8");
  expect(source).toContain("setBrowse(value => !value)");
  expect(source).toContain('onClick={() => setHistorical(false)}'); expect(source).toContain('onClick={() => setHistorical(true)}');
  expect(source).toContain('onClick={() => { setLoading(true); setFailed(false); setRevision(value => value + 1); }}');
  expect(source).toContain('historical ? "/api/me/asks?network=arcTestnet&limit=200" : "/api/me/asks?view=recent"');
});
