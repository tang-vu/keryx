import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { payWithServerSigner } from "./server-x402-client";
import type { PaymentRequirements } from "./x402-payment-evidence";

const PAYER = `0x${"11".repeat(20)}`;
const PAYEE = `0x${"22".repeat(20)}`;
const NONCE = `0x${"33".repeat(32)}`;
const VALID_BEFORE = "2000000000";
const EXPIRES_AT = "2033-05-18T03:33:20.000Z";

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
      authorization: { nonce: NONCE, validBefore: VALID_BEFORE, from: PAYER, to: PAYEE, value: "2000" },
      signature: `0x${"ab".repeat(65)}`,
    },
  })),
};

beforeEach(() => {
  signer.createPaymentPayload.mockClear();
});

describe("payWithServerSigner", () => {
  it("awaits durable admission before sending a signed request and supplies only exact non-bearer evidence", async () => {
    let admit!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { admit = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const beforeSubmit = vi.fn(async (evidence) => { entered(); await gate;
      expect(Object.isFrozen(evidence)).toBe(true);
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
    const running = payWithServerSigner({ url: "https://example.test/paid", method: "POST", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer, fetchImpl, beforeSubmit });
    await reached;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(beforeSubmit.mock.calls[0][0]).toEqual({ authorizationId: NONCE, authorizationExpiresAt: EXPIRES_AT,
      payer: PAYER, payee: PAYEE, amountMicros: "2000", network: config.networkId, asset: config.usdcAddress.toLowerCase() });
    admit();
    expect(await running).toMatchObject({ settlementStatus: "settled", authorizationId: NONCE });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit or retry if durable admission fails or its acknowledgement is lost", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge());
    const beforeSubmit = vi.fn().mockRejectedValue(new Error("synthetic journal acknowledgement lost"));
    await expect(payWithServerSigner({ url: "https://example.test/paid", method: "POST", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer, fetchImpl, beforeSubmit })).rejects.toThrow("acknowledgement lost");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
  });

  it("refuses journal admission for a signer payload with a different payer, payee or integer amount", async () => {
    for (const altered of [{ from: PAYEE }, { to: PAYER }, { value: "3000" }, { value: 2000 }, { value: "02000" }]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(challenge());
      const beforeSubmit = vi.fn();
      const wrongSigner = { createPaymentPayload: vi.fn(async () => ({ x402Version: 2,
        payload: { authorization: { nonce: NONCE, validBefore: VALID_BEFORE, from: PAYER, to: PAYEE, value: "2000", ...altered }, signature: "synthetic" } })) };
      await expect(payWithServerSigner({ url: "https://example.test/paid", method: "POST", expectedPayee: PAYEE,
        expectedAmount: 0.002, payer: PAYER, signer: wrongSigner, fetchImpl, beforeSubmit })).rejects.toThrow("journal identity");
      expect(beforeSubmit).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps an admitted ambiguous submission pending and does not journal or submit it twice", async () => {
    const beforeSubmit = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockRejectedValueOnce(new Error("synthetic response loss"));
    expect(await payWithServerSigner({ url: "https://example.test/paid", method: "POST", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer, fetchImpl, beforeSubmit })).toMatchObject({ settlementStatus: "pending", authorizationId: NONCE, transaction: null });
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
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
      authorizationExpiresAt: EXPIRES_AT,
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
      authorizationExpiresAt: EXPIRES_AT,
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

  it("rejects a signer payload without an exact validBefore", async () => {
    signer.createPaymentPayload.mockResolvedValueOnce({
      x402Version: 2,
      payload: {
        authorization: { nonce: NONCE, validBefore: undefined as unknown as string, from: PAYER, to: PAYEE, value: "2000" },
        signature: `0x${"ab".repeat(65)}`,
      },
    });
    await expect(payWithServerSigner({
      url: "https://example.test/paid",
      method: "GET",
      expectedPayee: PAYEE,
      expectedAmount: 0.002,
      payer: PAYER,
      signer,
      fetchImpl: vi.fn().mockResolvedValueOnce(challenge()),
    })).rejects.toThrow(/validBefore/i);
  });
});
