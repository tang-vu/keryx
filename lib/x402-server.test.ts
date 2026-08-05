/**
 * settleThenServe money-path invariants around the bazaar discovery extension:
 * the declared metadata rides through facilitator verify/settle, and a facilitator that
 * rejects the extended payload shape can never break a payment — every path falls back
 * to the bare payload the buyer actually signed.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyMock, settleMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  settleMock: vi.fn(),
}));

vi.mock("@circle-fin/x402-batching/server", () => ({
  BatchFacilitatorClient: class {
    verify = verifyMock;
    settle = settleMock;
  },
}));

import { settleThenServe, type PaidOptions } from "./x402-server";

const DISCOVERY = { path: "/api/agent/ask", method: "POST" };

const baseOpts: PaidOptions = {
  priceUsdc: 0.02,
  payTo: "0x00000000000000000000000000000000000000aa",
  endpoint: "/api/agent/ask",
  description: "test endpoint",
};

/** Full SDK-buyer PaymentPayload riding in the payment-signature header. */
function paidRequest(): NextRequest {
  const payload = {
    x402Version: 2,
    resource: { url: "/api/agent/ask", description: "test", mimeType: "application/json" },
    accepted: { scheme: "exact" },
    payload: { authorization: { from: "0xbuyer" }, signature: "0xsig" },
  };
  return new NextRequest("http://localhost/api/agent/ask", {
    method: "POST",
    headers: { "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") },
  });
}

const VALID = { isValid: true, payer: "0xbuyer" };
const SETTLED = { success: true, transaction: "0xtx", payer: "0xbuyer" };

beforeEach(() => {
  verifyMock.mockReset();
  settleMock.mockReset();
});

describe("settleThenServe bazaar discovery passthrough", () => {
  it("without discovery: forwards the buyer payload untouched", async () => {
    verifyMock.mockResolvedValue(VALID);
    settleMock.mockResolvedValue(SETTLED);

    const res = await settleThenServe(paidRequest(), baseOpts, () => ({ ok: true }));

    expect(res.status).toBe(200);
    expect(verifyMock.mock.calls[0][0].extensions).toBeUndefined();
    expect(settleMock.mock.calls[0][0].extensions).toBeUndefined();
  });

  it("with discovery: verify and settle both carry extensions.bazaar.info", async () => {
    verifyMock.mockResolvedValue(VALID);
    settleMock.mockResolvedValue(SETTLED);

    const res = await settleThenServe(paidRequest(), { ...baseOpts, discovery: DISCOVERY }, (s) => ({
      payer: s.payer,
    }));

    expect(res.status).toBe(200);
    expect(verifyMock.mock.calls[0][0].extensions).toEqual({ bazaar: { info: DISCOVERY } });
    expect(settleMock.mock.calls[0][0].extensions).toEqual({ bazaar: { info: DISCOVERY } });
    // The signed inner payload is untouched by the merge.
    expect(settleMock.mock.calls[0][0].payload).toEqual({
      authorization: { from: "0xbuyer" },
      signature: "0xsig",
    });
  });

  it("verify throwing on the extended payload falls back to bare and still settles", async () => {
    verifyMock.mockImplementation(async (p: { extensions?: unknown }) => {
      if (p.extensions) throw new Error("schema rejection");
      return VALID;
    });
    settleMock.mockResolvedValue(SETTLED);

    const res = await settleThenServe(paidRequest(), { ...baseOpts, discovery: DISCOVERY }, () => ({ ok: true }));

    expect(res.status).toBe(200);
    // Extended attempts (withRetry ×2) then a bare verify that succeeds.
    expect(verifyMock.mock.calls.at(-1)?.[0].extensions).toBeUndefined();
    expect(settleMock.mock.calls[0][0].extensions).toBeUndefined();
  }, 15_000);

  it("verify soft-rejecting the extended payload retries bare before failing", async () => {
    verifyMock.mockImplementation(async (p: { extensions?: unknown }) =>
      p.extensions ? { isValid: false, invalidReason: "unknown field" } : VALID,
    );
    settleMock.mockResolvedValue(SETTLED);

    const res = await settleThenServe(paidRequest(), { ...baseOpts, discovery: DISCOVERY }, () => ({ ok: true }));

    expect(res.status).toBe(200);
    expect(settleMock.mock.calls[0][0].extensions).toBeUndefined();
  });

  it("settle throwing on the extended payload falls back to bare (nonce unconsumed)", async () => {
    verifyMock.mockResolvedValue(VALID);
    settleMock.mockImplementation(async (p: { extensions?: unknown }) => {
      if (p.extensions) throw new Error("schema rejection");
      return SETTLED;
    });

    const res = await settleThenServe(paidRequest(), { ...baseOpts, discovery: DISCOVERY }, () => ({ ok: true }));

    expect(res.status).toBe(200);
    expect(settleMock.mock.calls.at(-1)?.[0].extensions).toBeUndefined();
  }, 15_000);

  it("a genuinely invalid payment still fails with 402", async () => {
    verifyMock.mockResolvedValue({ isValid: false, invalidReason: "bad signature" });

    const res = await settleThenServe(paidRequest(), { ...baseOpts, discovery: DISCOVERY }, () => ({ ok: true }));

    expect(res.status).toBe(402);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("retains settlement proof when the paid resource producer fails", async () => {
    verifyMock.mockResolvedValue(VALID);
    settleMock.mockResolvedValue(SETTLED);

    const res = await settleThenServe(paidRequest(), baseOpts, () => {
      throw new Error("database unavailable");
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "paid resource unavailable after settlement",
    });
    const encoded = res.headers.get("PAYMENT-RESPONSE");
    expect(encoded).toBeTruthy();
    expect(JSON.parse(Buffer.from(encoded!, "base64").toString("utf-8"))).toEqual({
      success: true,
      transaction: SETTLED.transaction,
      payer: SETTLED.payer,
      network: "eip155:5042002",
    });
  });
});
