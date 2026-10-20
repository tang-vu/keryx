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
async function fixture(options: { enabled?: boolean; inject?: boolean; claimStatus?: number; defer?: "session" | "response" | "body"; failDeferred?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  let wallet: string | null = alice;
  let sessionReads = 0, releaseGate!: () => void, markPaused!: () => void, markDelivered!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; }), paused = new Promise<void>(resolve => { markPaused = resolve; });
  const delivered = new Promise<void>(resolve => { markDelivered = resolve; });
  if (options.defer === "body") await context.addInitScript(failDeferred => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.url === `${location.origin}/api/me/run-claims`) {
        const json = response.json.bind(response);
        response.json = async () => {
          const value = await json();
          Reflect.set(window, "claimBodyPaused", true);
          await new Promise<void>(resolve => { Reflect.set(window, "releaseClaimBody", resolve); });
          if (failDeferred) throw new Error("Synthetic late response-body failure");
          return value;
        };
      }
      return response;
    };
  }, options.failDeferred === true);
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
    if (url.pathname === "/api/auth/session") {
      if (++sessionReads === 2 && options.defer === "session") {
        markPaused(); await gate;
        if (options.failDeferred) return route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } });
      }
      return route.fulfill({ status: wallet ? 200 : 401, json: { session: wallet ? { address: wallet } : null } });
    }
    if (url.pathname === "/api/me/run-claims") {
      if (options.defer === "response") { markPaused(); await gate; }
      const claimStatus = options.defer === "response" && options.failDeferred ? 503 : options.claimStatus;
      await route.fulfill({ status: claimStatus ?? 200, json: claimStatus
        ? { error: "claim_unavailable" } : { version: 1, runId: "synthetic-run", wallet, binding: { origin, network: "eip155:5042002" } } });
      markDelivered(); return;
    }
    if (url.pathname === "/connect") return route.fulfill({ body: "<!doctype html><title>Synthetic sign-in window</title>" });
    external.push(request.url()); return route.abort();
  });
  await page.goto(`${origin}/claim-run#${token}`);
  return { context, page, calls, external, failures, switchWallet: (value: string | null) => { wallet = value; },
    waitForPause: () => options.defer === "body" ? page.waitForFunction(() => Reflect.get(window, "claimBodyPaused") === true) : paused,
    release: async () => {
      releaseGate();
      if (options.defer === "body") await page.evaluate(() => { const release = Reflect.get(window, "releaseClaimBody"); if (typeof release === "function") release(); });
      if (options.defer === "response") await delivered;
    } };
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

it.each((["session", "response", "body"] as const).flatMap(defer => [false, true].map(failDeferred => ({ defer, failDeferred }))))(
  "pagehide permanently retires a claim attempt paused at $defer (late failure=$failDeferred)", async ({ defer, failDeferred }) => {
  const f = await fixture({ defer, failDeferred });
  try {
    await f.page.getByText(copy.ready, { exact: true }).waitFor();
    await f.page.getByRole("button", { name: copy.claim, exact: true }).click(); await f.waitForPause();
    // Exercise the real handlers with controlled persisted-page lifecycle events.
    // This does not claim actual browser back/forward-cache navigation acceptance.
    await f.page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await f.page.getByText(copy.unavailable, { exact: true }).waitFor();
    // An abandoned claim response is actively cancelled, so network completion
    // is not an acknowledgement. The route gate confirms its late delivery.
    const response = defer === "session" ? f.page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session") : null;
    await f.release(); if (response) await (await response).finished();
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const posts = f.calls.filter(call => call.method === "POST");
    expect(posts).toHaveLength(defer === "session" ? 0 : 1);
    for (const post of posts) expect(JSON.parse(post.body!)).toEqual({ token });
    expect(await f.page.locator("#status").textContent()).toBe(copy.unavailable);
    expect(await f.page.getByRole("button", { name: copy.claim, exact: true }).isDisabled()).toBe(true);
    const beforeFocus = f.calls.length;
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page.getByRole("button", { name: copy.check, exact: true }).click();
    expect(f.calls).toHaveLength(beforeFocus);
    expect(await f.page.content()).not.toContain(token);
    expect(await f.page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect(f.external).toEqual([]); expect(f.failures).toEqual([]);
  } finally { await f.release(); await f.context.close(); }
});
