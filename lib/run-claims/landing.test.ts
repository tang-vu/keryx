import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { runClaimLandingCsp, runClaimLandingResponse } from "./landing";
import { runClaimCopy as copy } from "../../locales/en/run-claims.cjs";
import nextConfig from "../../next.config";
const token = "c".repeat(64), alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const origin = "http://localhost:3939";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE }); });
afterAll(async () => { await browser?.close(); });
async function fixture(options: { enabled?: boolean; inject?: boolean; claimStatus?: number } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  let wallet: string | null = alice;
  const calls: { url: string; method: string; body: string | null; expected: string | undefined; referrer: string | undefined }[] = [];
  const external: string[] = [], failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  const response = runClaimLandingResponse(options.enabled !== false);
  let html = await response.text();
  if (options.inject) html = html.replace("<script>", `<script>window.injectedSecret=location.hash</script><script src="https://static.cloudflareinsights.com/beacon.min.js"></script><script src="/analytics.js"></script><script>`);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    calls.push({ url: request.url(), method: request.method(), body: request.postData(), expected: request.headers()["x-keryx-expected-wallet"], referrer: request.headers().referer });
    if (url.origin !== origin) { external.push(request.url()); return route.abort(); }
    if (url.pathname === "/claim-run") return route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: html });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: wallet ? 200 : 401, json: { session: wallet ? { address: wallet } : null } });
    if (url.pathname === "/api/me/run-claims") return route.fulfill({ status: options.claimStatus ?? 200, json: options.claimStatus
      ? { error: "claim_unavailable" } : { version: 1, runId: "synthetic-run", wallet, binding: { origin, network: "eip155:5042002" } } });
    if (url.pathname === "/connect") return route.fulfill({ body: "<!doctype html><title>Synthetic sign-in window</title>" });
    external.push(request.url()); return route.abort();
  });
  await page.goto(`${origin}/claim-run#${token}`);
  return { context, page, calls, external, failures, switchWallet: (value: string | null) => { wallet = value; } };
}
it("hashes exactly the emitted script/style bytes and supplies HTTP privacy/frame headers without tokens", async () => {
  const response = runClaimLandingResponse(true), html = await response.text();
  const hash = (value: string) => `sha256-${createHash("sha256").update(value).digest("base64")}`;
  expect(response.headers.get("content-security-policy")).toBe(runClaimLandingCsp);
  for (const [tag, directive] of [["script", "script-src"], ["style", "style-src"]]) {
    const bytes = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))![1];
    expect(runClaimLandingCsp).toContain(`${directive} '${hash(bytes)}'`);
  }
  expect(runClaimLandingCsp).not.toMatch(/unsafe-inline|unsafe-eval|cloudflare|https:/);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow"); expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(html).not.toContain(token); expect(html).not.toMatch(/__NEXT_DATA__|walletconnect|google-analytics/);
});
it("Next's final matching fixed rules retain the exact private response CSP/referrer/cache/frame policy", async () => {
  const rules = await nextConfig.headers!();
  const globalIndex = rules.findIndex(rule => rule.source === "/(.*)");
  const claimIndex = rules.findIndex(rule => rule.source === "/claim-run"); expect(claimIndex).toBeGreaterThan(globalIndex);
  const effective = new Map(rules[globalIndex].headers.map(header => [header.key.toLowerCase(), header.value]));
  for (const header of rules[claimIndex].headers) effective.set(header.key.toLowerCase(), header.value);
  const response = runClaimLandingResponse(true);
  for (const key of ["content-security-policy", "referrer-policy", "cache-control", "x-robots-tag", "x-frame-options"])
    expect(effective.get(key)).toBe(response.headers.get(key));
  for (const source of ["/api/me/run-claims", "/api/me/run-history/:path*"]) {
    const index = rules.findIndex(rule => rule.source === source); expect(index).toBeGreaterThan(globalIndex);
    expect(rules[index].headers).toEqual(expect.arrayContaining([{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }]));
  }
});
it("strips fragment before auth, blocks injected analytics, keeps secret out of DOM/storage/GET, and submits only explicitly", async () => {
  const f = await fixture({ inject: true });
  try {
    await f.page.getByText(copy.ready, { exact: true }).waitFor(); expect(f.page.url()).toBe(`${origin}/claim-run`);
    expect(await f.page.content()).not.toContain(token);
    expect(await f.page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, leaked: Reflect.get(window, "injectedSecret") })))
      .toEqual({ local: 0, session: 0, leaked: undefined });
    expect(f.calls.every(call => !call.url.includes(token) && !call.body)).toBe(true);
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await f.page.getByText(copy.ready, { exact: true }).waitFor();
    expect(f.calls.some(call => call.method === "POST")).toBe(false);
    await f.page.getByRole("button", { name: copy.claim, exact: true }).click(); await f.page.getByText(copy.saved, { exact: true }).waitFor();
    const posts = f.calls.filter(call => call.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body!)).toEqual({ token }); expect(posts[0].expected).toBe(alice); expect(posts[0].referrer).toBeUndefined();
    expect(await f.page.getByRole("button", { name: copy.claim, exact: true }).isDisabled()).toBe(true);
    expect(f.external).toEqual([]); expect(f.failures).toEqual([]);
  } finally { await f.context.close(); }
});
it("wallet/session return never auto-claims; a change between display and click requires another confirmation", async () => {
  const f = await fixture();
  try {
    await f.page.getByText(copy.ready, { exact: true }).waitFor(); f.switchWallet(bob);
    await f.page.getByRole("button", { name: copy.claim, exact: true }).click(); await f.page.getByText(copy.changed, { exact: true }).waitFor();
    expect(f.calls.some(call => call.method === "POST")).toBe(false); expect(await f.page.locator("#owner").textContent()).toBe(bob);
    await f.page.getByRole("button", { name: copy.claim, exact: true }).click(); await f.page.getByText(copy.saved, { exact: true }).waitFor();
    expect(f.calls.filter(call => call.method === "POST")[0].expected).toBe(bob);
    expect(f.external).toEqual([]); expect(f.failures).toEqual([]);
  } finally { await f.context.close(); }
});
it("sign-in uses a secret-free separate window, and reload permanently loses this delivery", async () => {
  const f = await fixture();
  try {
    await f.page.getByText(copy.ready, { exact: true }).waitFor(); f.switchWallet(null);
    await f.page.getByRole("button", { name: copy.check, exact: true }).click(); await f.page.getByText(copy.signedOut, { exact: true }).waitFor();
    const popupPromise = f.context.waitForEvent("page"); await f.page.getByRole("button", { name: copy.signIn, exact: true }).click();
    const popup = await popupPromise; await popup.waitForLoadState(); expect(popup.url()).toBe(`${origin}/connect`);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(f.calls.every(call => !call.url.includes(token) && !call.referrer)).toBe(true); await popup.close();
    await f.page.reload(); await f.page.getByText(copy.unavailable, { exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: copy.claim, exact: true }).isDisabled()).toBe(true);
    expect(f.calls.some(call => call.method === "POST")).toBe(false); expect(f.failures).toEqual([]);
  } finally { await f.context.close(); }
});
it.each([false, true])("inactive or refused landing forgets secret without replay: enabled=%s", async enabled => {
  const f = await fixture({ enabled, claimStatus: 404 });
  try {
    if (enabled) { await f.page.getByText(copy.ready, { exact: true }).waitFor(); await f.page.getByRole("button", { name: copy.claim, exact: true }).click(); }
    await f.page.getByText(enabled ? copy.unavailable : copy.serviceUnavailable, { exact: true }).waitFor();
    expect(f.page.url()).toBe(`${origin}/claim-run`); expect(await f.page.content()).not.toContain(token);
    expect(await f.page.getByRole("button", { name: copy.claim, exact: true }).isDisabled()).toBe(true);
    expect(f.calls.filter(call => call.method === "POST")).toHaveLength(enabled ? 1 : 0); expect(f.external).toEqual([]); expect(f.failures).toEqual([]);
  } finally { await f.context.close(); }
});
