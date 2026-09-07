import { afterEach, expect, it, vi } from "vitest";
import { buyerFetch, readBuyerJson } from "./transport";
import { BUYER_ENDPOINT } from "./policy";

afterEach(() => vi.unstubAllGlobals());
it("rejects another origin before a signature can leave and disables redirects", async () => {
  const http = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", http);
  await expect(buyerFetch("https://attacker.example/api/agent/ask", { headers: { "payment-signature": "test-bearer" } })).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
  await buyerFetch(BUYER_ENDPOINT, { method: "POST", redirect: "follow", credentials: "include" });
  expect(http.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
  expect(http.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it("bounds response bytes before decoding or hashing untrusted JSON", async () => {
  await expect(readBuyerJson(new Response("x".repeat(2_000_001)))).rejects.toThrow("2 MB");
  await expect(readBuyerJson(Response.json({ status: "queued" }))).resolves.toEqual({ status: "queued" });
});
