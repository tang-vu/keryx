import { afterEach, expect, it, vi } from "vitest";
import { privateIncomingFacilitator } from "./private-incoming-payment";
afterEach(() => vi.unstubAllGlobals());

it("pins both facilitator operations to testnet with bounded, redirect-denying single HTTP requests", async () => {
  const http = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
  vi.stubGlobal("fetch", http);
  const body = { paymentPayload: { synthetic: true }, paymentRequirements: { synthetic: true } };
  for (const action of ["verify", "settle"] as const) {
    await privateIncomingFacilitator(action, body);
    const [url, init] = http.mock.calls.at(-1)!;
    expect(url).toBe(`https://gateway-api-testnet.circle.com/v1/x402/${action}`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify(body) });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(http).toHaveBeenCalledTimes(2);
});

it("does not retry HTTP failures, oversized or malformed facilitator responses", async () => {
  for (const response of [new Response("private-error-body", { status: 503 }), new Response("x".repeat(65537)), new Response("invalid-json")]) {
    const http = vi.fn<typeof fetch>(async () => response); vi.stubGlobal("fetch", http);
    await expect(privateIncomingFacilitator("settle", { paymentPayload: {}, paymentRequirements: {} })).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  }
});
