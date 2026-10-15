// UNRUN source controls. Browser fetch is intercepted; no payment or network.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accountOwnedPurchaseFetch, assertAccountPurchaseConsent, consentToAccountPurchase, invalidateAccountPurchaseConsent, readAccountPurchaseSession } from "./account-owned-transport";
import { BUYER_ENDPOINT } from "./protocol";
const account = `0x${"a".repeat(40)}`;
let id: string, active: boolean, issuedAt: number, expiresAt: number;
const http = vi.fn<typeof fetch>();
beforeEach(() => {
  id = "b".repeat(64); active = true; http.mockReset();
  issuedAt = 1; expiresAt = Date.now() + 300000;
  vi.stubGlobal("window", { location: { origin: "https://keryx.cc" } });
  http.mockImplementation(async (url, init) => {
    if (init?.method === "POST") return Response.json({});
    return Response.json(String(url).endsWith("/sessions") ? { sessions: [{ id, issuedAt, expiresAt, current: true }], truncated: false } : { session: { address: account, role: "asker" } });
  });
  vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const signed = () => ({ method: "POST", headers: { "content-type": "application/json", "payment-signature": "exact-original-header" }, body: "exact-original-body" });
async function consent() { return consentToAccountPurchase(await readAccountPurchaseSession(), () => active); }
it("uses only the fixed same-origin new signed POST, preserves bytes and consumes consent once", async () => {
  const proof = await consent();
  await accountOwnedPurchaseFetch(proof, BUYER_ENDPOINT, signed());
  const posts = http.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
  const [url, init] = posts[0]; expect(url).toBe(BUYER_ENDPOINT);
  expect(init).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store", body: signed().body });
  expect(new Headers(init!.headers).get("payment-signature")).toBe(signed().headers["payment-signature"]);
  expect(new Headers(init!.headers).get("x-keryx-account-job")).toBe("associate");
  await expect(accountOwnedPurchaseFetch(proof, BUYER_ENDPOINT, signed())).rejects.toThrow();
  expect(http.mock.calls.filter(([, value]) => value?.method === "POST")).toHaveLength(1);
});
it.each(["external", "query", "get", "authorization", "redirect", "credentials", "foreign-browser"])("refuses %s before dispatch", async reason => {
  const proof = await consent(); let url = BUYER_ENDPOINT; const init: RequestInit = signed();
  if (reason === "external") url = "https://foreign.test/api/agent/ask";
  if (reason === "query") url += "?replay=true";
  if (reason === "get") init.method = "GET";
  if (reason === "authorization") init.headers = { ...signed().headers, authorization: "Bearer caller" };
  if (reason === "redirect") init.redirect = "follow";
  if (reason === "credentials") init.credentials = "include";
  if (reason === "foreign-browser") vi.stubGlobal("window", { location: { origin: "https://foreign.test" } });
  await expect(accountOwnedPurchaseFetch(proof, url, init)).rejects.toThrow();
  expect(http.mock.calls.filter(([, value]) => value?.method === "POST")).toHaveLength(0);
});
it.each(["same-wallet-replacement", "logout", "event-invalidation"])("refuses current consent after %s", async reason => {
  const proof = await consent();
  if (reason === "same-wallet-replacement") id = "c".repeat(64);
  if (reason === "logout") http.mockResolvedValue(Response.json({}, { status: 401 }));
  if (reason === "event-invalidation") { active = false; invalidateAccountPurchaseConsent(proof); }
  await expect(assertAccountPurchaseConsent(proof)).rejects.toThrow();
  await expect(accountOwnedPurchaseFetch(proof, BUYER_ENDPOINT, signed())).rejects.toThrow();
  expect(http.mock.calls.filter(([, value]) => value?.method === "POST")).toHaveLength(0);
});
it("refuses replacement during an awaited body and aborts a stalled body at its finite deadline", async () => {
  const proof = await consent(); vi.useFakeTimers();
  let release!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const check = assertAccountPurchaseConsent(proof); const refusal = expect(check).rejects.toThrow();
  active = false; release(Response.json({ sessions: [{ id, current: true, issuedAt: 1, expiresAt: Date.now() + 300000 }] }));
  await refusal;
  http.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
  const stalled = readAccountPurchaseSession(); const timeout = expect(stalled).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await timeout;
  expect(http.mock.calls.filter(([, value]) => value?.method === "POST")).toHaveLength(0);
});
