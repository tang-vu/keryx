import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { payWithServerSigner } from "./server-x402-client";
import type { PaymentRequirements } from "./x402-payment-evidence";

const PAYER = `0x${"11".repeat(20)}`;
const PAYEE = `0x${"22".repeat(20)}`;
const NONCE = `0x${"33".repeat(32)}`;

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.networkId,
    asset: config.usdcAddress,
    amount: "2000",
    payTo: PAYEE,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: config.gatewayWallet,
    },
    ...over,
  };
}

function challenge(req = requirements()): Response {
  const encoded = Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: "/paid", mimeType: "application/json" },
    accepts: [req],
  })).toString("base64");
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encoded },
  });
}

function paymentResponse(status = 200, includeReceipt = true): Response {
  const headers = new Headers();
  if (includeReceipt) {
    headers.set("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
      success: true,
      transaction: "circle-settlement-id",
      payer: PAYER,
      network: config.networkId,
    })).toString("base64"));
  }
  return Response.json({ content: "paid content" }, { status, headers });
}

const signer = {
  createPaymentPayload: vi.fn(async (x402Version: number) => ({
    x402Version,
    payload: {
      authorization: { nonce: NONCE },
      signature: `0x${"ab".repeat(65)}`,
    },
  })),
};

beforeEach(() => {
  signer.createPaymentPayload.mockClear();
});

describe("payWithServerSigner", () => {
  it("retains a valid settlement receipt on a paid 5xx", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(paymentResponse(500));

    const result = await payWithServerSigner({
      url: "https://example.test/paid",
      method: "GET",
      expectedPayee: PAYEE,
      expectedAmount: 0.002,
      payer: PAYER,
      signer,
      fetchImpl,
    });

    expect(result).toMatchObject({
      delivered: false,
      settlementStatus: "settled",
      transaction: "circle-settlement-id",
      authorizationId: NONCE,
      httpStatus: 500,
    });
  });

  it("classifies a post-submit transport failure as pending", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(challenge())
      .mockRejectedValueOnce(new Error("socket reset"));

    const result = await payWithServerSigner({
      url: "https://example.test/paid",
      method: "GET",
      expectedPayee: PAYEE,
      expectedAmount: 0.002,
      payer: PAYER,
      signer,
      fetchImpl,
    });

    expect(result).toMatchObject({
      delivered: false,
      settlementStatus: "pending",
      transaction: null,
      authorizationId: NONCE,
      reason: "socket reset",
    });
  });

  it("returns delivered content as pending when a 2xx omits settlement proof", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(paymentResponse(200, false));

    const result = await payWithServerSigner<{ content: string }>({
      url: "https://example.test/paid",
      method: "GET",
      expectedPayee: PAYEE,
      expectedAmount: 0.002,
      payer: PAYER,
      signer,
      fetchImpl,
    });

    expect(result).toMatchObject({
      delivered: true,
      data: { content: "paid content" },
      settlementStatus: "pending",
      transaction: null,
    });
  });

  it("rejects a changed payee before creating a bearer authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      challenge(requirements({ payTo: `0x${"44".repeat(20)}` })),
    );

    await expect(payWithServerSigner({
      url: "https://example.test/paid",
      method: "GET",
      expectedPayee: PAYEE,
      expectedAmount: 0.002,
      payer: PAYER,
      signer,
      fetchImpl,
    })).rejects.toThrow(/payTo does not match/i);
    expect(signer.createPaymentPayload).not.toHaveBeenCalled();
  });
});
