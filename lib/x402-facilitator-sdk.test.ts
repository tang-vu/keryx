import { afterEach, expect, it, vi } from "vitest";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

afterEach(() => vi.unstubAllGlobals());

it("SDK 3.5 sends verify and settle to the explicitly selected testnet host", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ isValid: false, invalidReason: "synthetic refusal" }))
    .mockResolvedValueOnce(Response.json({ success: false, errorReason: "synthetic refusal" }));
  vi.stubGlobal("fetch", fetchMock);

  const client = new BatchFacilitatorClient({ url: "https://gateway-api-testnet.circle.com" });
  const paymentPayload = { x402Version: 2, payload: {} } as Parameters<typeof client.verify>[0];
  const requirements = { network: "eip155:5042002" } as Parameters<typeof client.verify>[1];

  expect(client.url).toBe("https://gateway-api-testnet.circle.com");
  expect((await client.verify(paymentPayload, requirements)).isValid).toBe(false);
  expect((await client.settle(paymentPayload, requirements)).success).toBe(false);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "https://gateway-api-testnet.circle.com/v1/x402/verify",
    "https://gateway-api-testnet.circle.com/v1/x402/settle",
  ]);
  for (const [, options] of fetchMock.mock.calls) {
    expect(JSON.parse(options.body)).toEqual({ paymentPayload, paymentRequirements: requirements });
  }
});
