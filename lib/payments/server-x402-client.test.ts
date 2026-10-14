import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { payWithServerSigner, type ServerX402TransportObservation } from "./server-x402-client";
import { observeSettlementRequests, type AdmittedSettlementRequest } from "../gateway/settlement-events";
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

const ORIGINAL_TIME = "2026-01-01T00:00:00.000Z";
function admittedOriginal(): AdmittedSettlementRequest {
  return { requestId: "synthetic-owned-original", submittedAt: null, payment: { payer: PAYER, payee: PAYEE,
    network: config.networkId, amountUsdc: 0.002, authorizationId: NONCE, createdAt: ORIGINAL_TIME } };
}
const transportInput = () => ({ url: "https://example.test/paid", method: "POST" as const,
  expectedPayee: PAYEE, expectedAmount: 0.002, payer: PAYER, signer });

describe("passive server transport observation (synthetic only)", () => {
  it("retains an immutable exact journal original and hint without changing the signed request or public result", async () => {
    const baselineFetch = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
    const baseline = await payWithServerSigner({ ...transportInput(), fetchImpl: baselineFetch, beforeSubmit: async () => {} });
    const original = admittedOriginal();
    const observe = vi.fn((_signal: ServerX402TransportObservation) => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
    const beforeSubmit = vi.fn(async () => { (original.payment as { payer: string }).payer = PAYEE; });
    const beforeSignedSubmit = vi.fn(async () => {});
    const result = await payWithServerSigner({ ...transportInput(), fetchImpl, beforeSubmit, beforeSignedSubmit,
      settlementObserver: { admittedRequest: original, observe } });
    expect(result).toEqual(baseline);
    expect(fetchImpl.mock.calls).toEqual(baselineFetch.mock.calls);
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(beforeSignedSubmit).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
    const signal = observe.mock.calls[0][0];
    expect(Object.isFrozen(signal)).toBe(true);
    expect(Object.isFrozen(signal.admittedRequest)).toBe(true);
    expect(Object.isFrozen(signal.admittedRequest!.payment)).toBe(true);
    expect(Object.isFrozen(signal.receiptHint)).toBe(true);
    expect(observe.mock.calls[0][0]).toEqual({ kind: "server-x402-transport", admittedRequest: admittedOriginal(),
      receiptHint: { requestId: original.requestId, transferId: "circle-settlement-id" }, delivered: true, httpStatus: 200 });
    expect(JSON.stringify(observe.mock.calls[0][0])).not.toContain("signature");
    expect(JSON.stringify(observe.mock.calls[0][0])).not.toContain("paid content");
    expect(JSON.stringify(observe.mock.calls[0][0])).not.toContain("example.test");
  });

  it.each(["throw", "reject", "never"])("contains an observer that will %s without awaiting or retrying", async mode => {
    const observe = vi.fn(() => {
      if (mode === "throw") throw new Error("synthetic private observer error");
      return mode === "reject" ? Promise.reject(new Error("synthetic private observer error")) : new Promise<void>(() => {});
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
    const result = await payWithServerSigner({ ...transportInput(), fetchImpl, beforeSubmit: async () => {},
      settlementObserver: { admittedRequest: admittedOriginal(), observe } });
    expect(result).toMatchObject({ delivered: true, settlementStatus: "settled", transaction: "circle-settlement-id" });
    expect(result).not.toHaveProperty("reason");
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(signer.createPaymentPayload).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
  });

  it.each(["admission", "signed-journal"])("does not ignore %s failure or emit a completed signal", async failure => {
    const observe = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValueOnce(challenge());
    await expect(payWithServerSigner({ ...transportInput(), fetchImpl,
      beforeSubmit: async () => { if (failure === "admission") throw new Error("journal failed"); },
      beforeSignedSubmit: async () => { if (failure === "signed-journal") throw new Error("journal failed"); },
      settlementObserver: { admittedRequest: admittedOriginal(), observe } })).rejects.toThrow("journal failed");
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(observe).not.toHaveBeenCalled();
  });

  it("contains observer input getters and callback getters without changing admission or payment", async () => {
    for (const settlementObserver of [
      { get admittedRequest(): AdmittedSettlementRequest { throw new Error("private original getter"); }, observe: vi.fn() },
      { admittedRequest: admittedOriginal(), get observe(): (signal: ServerX402TransportObservation) => void { throw new Error("private callback getter"); } },
    ]) {
      const beforeSubmit = vi.fn(async () => {});
      const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
      expect(await payWithServerSigner({ ...transportInput(), fetchImpl, beforeSubmit, settlementObserver }))
        .toMatchObject({ delivered: true, settlementStatus: "settled", transaction: "circle-settlement-id" });
      expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("reports missing identity honestly for absent journals, mismatched tuples and oversized IDs", async () => {
    const original = admittedOriginal();
    const cases = [undefined, { ...original, requestId: "x".repeat(129) },
      ...[ { payer: PAYEE }, { payee: PAYER }, { authorizationId: `0x${"44".repeat(32)}` },
        { network: "foreign-network" }, { amountUsdc: 0.003 } ].map(patch => ({ ...original, payment: { ...original.payment, ...patch } }))];
    for (const admittedRequest of cases) {
      const observe = vi.fn();
      const fetchImpl = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse());
      await payWithServerSigner({ ...transportInput(), fetchImpl, beforeSubmit: async () => {},
        settlementObserver: { admittedRequest, observe } });
      expect(observe.mock.calls[0][0]).toMatchObject({ admittedRequest: null, receiptHint: null });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
    const observe = vi.fn();
    await payWithServerSigner({ ...transportInput(),
      fetchImpl: vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse()),
      settlementObserver: { admittedRequest: original, observe } });
    expect(observe.mock.calls[0][0]).toMatchObject({ admittedRequest: null, receiptHint: null });
  });

  it.each(["5xx", "invalid-json", "response-loss", "missing-receipt", "oversized-receipt"])("preserves %s behavior and redacts failures", async scenario => {
    const response = () => scenario === "5xx" ? paymentResponse(500)
      : scenario === "invalid-json" ? new Response("synthetic private body", { headers: paymentResponse().headers })
      : scenario === "oversized-receipt" ? Response.json({}, { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({
        success: true, transaction: "x".repeat(129), payer: PAYER, network: config.networkId })).toString("base64") } })
      : paymentResponse(200, scenario !== "missing-receipt");
    const makeFetch = () => {
      const f = vi.fn().mockResolvedValueOnce(challenge());
      return scenario === "response-loss" ? f.mockRejectedValueOnce(new Error("synthetic socket loss")) : f.mockResolvedValueOnce(response());
    };
    const baseline = await payWithServerSigner({ ...transportInput(), fetchImpl: makeFetch(), beforeSubmit: async () => {} });
    const observe = vi.fn(), fetchImpl = makeFetch();
    const result = await payWithServerSigner({ ...transportInput(), fetchImpl, beforeSubmit: async () => {},
      settlementObserver: { admittedRequest: admittedOriginal(), observe } });
    expect(result).toEqual(baseline); expect(fetchImpl).toHaveBeenCalledTimes(2); expect(observe).toHaveBeenCalledOnce();
    const signal = observe.mock.calls[0][0];
    expect(signal.httpStatus).toBe(result.httpStatus ?? null); expect(signal.delivered).toBe(result.delivered);
    expect(signal.receiptHint).toEqual(["5xx", "invalid-json"].includes(scenario)
      ? { requestId: admittedOriginal().requestId, transferId: "circle-settlement-id" } : null);
    expect(JSON.stringify(signal)).not.toMatch(/private body|socket loss|signature|reason/);
  });

  it("feeds the accepted observer a receipt hint, requiring independent exact proof while preserving payment authority", async () => {
    const summaries: ReturnType<typeof observeSettlementRequests>[] = [];
    const observe = (signal: ServerX402TransportObservation) => {
      const input = { requests: [signal.admittedRequest!], hints: [signal.receiptHint!], retainedBindings: [] };
      summaries.push(observeSettlementRequests(input, { readRetainedProof: () => ({ transfers: [], confirmedAt: null, confirmedTransferId: null }) }));
      summaries.push(observeSettlementRequests(input, { readRetainedProof: () => ({ transfers: [{
        id: "circle-settlement-id", status: "confirmed", token: "USDC", sendingNetwork: config.networkId,
        recipientNetwork: config.networkId, fromAddress: PAYER, toAddress: PAYEE, amount: "2000", nonce: NONCE,
        txHash: null, createdAt: ORIGINAL_TIME, updatedAt: ORIGINAL_TIME,
      }], confirmedAt: null, confirmedTransferId: null }) }));
    };
    const result = await payWithServerSigner({ ...transportInput(), beforeSubmit: async () => {},
      fetchImpl: vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paymentResponse()),
      settlementObserver: { admittedRequest: admittedOriginal(), observe } });
    expect(summaries[0].requests[0]).toMatchObject({ status: "awaiting", binding: null, latencyMs: null });
    expect(summaries[1].requests[0]).toMatchObject({ status: "confirmed", latencyMs: null,
      binding: { requestId: admittedOriginal().requestId, transferId: "circle-settlement-id" } });
    expect(result).toMatchObject({ delivered: true, settlementStatus: "settled", transaction: "circle-settlement-id" });
    expect(result).not.toHaveProperty("binding");
  });
});

describe("payWithServerSigner", () => {
  it("refuses an excluded resolved recipient before HTTP, signing or journal admission", async () => {
    const fetchImpl = vi.fn(), beforeSubmit = vi.fn();
    await expect(payWithServerSigner({ url: "https://example.test/paid", method: "GET", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer, fetchImpl, beforeSubmit, deniedRecipient: PAYEE.toUpperCase() }))
      .rejects.toThrow(/recipient is excluded/);
    expect(fetchImpl).not.toHaveBeenCalled(); expect(signer.createPaymentPayload).not.toHaveBeenCalled();
    expect(beforeSubmit).not.toHaveBeenCalled();
  });

  it("refuses an excluded final challenge recipient before authorization even if expected terms were independent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(challenge(requirements({ payTo: PAYER }))), beforeSubmit = vi.fn();
    await expect(payWithServerSigner({ url: "https://example.test/paid", method: "GET", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer, fetchImpl, beforeSubmit, deniedRecipient: PAYER }))
      .rejects.toThrow(/recipient is excluded/);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(signer.createPaymentPayload).not.toHaveBeenCalled();
    expect(beforeSubmit).not.toHaveBeenCalled();
  });

  it("does not journal or submit an unexpectedly altered signed recipient", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(challenge()), beforeSubmit = vi.fn();
    const altered = { createPaymentPayload: vi.fn(async () => ({ x402Version: 2, payload: {
      authorization: { from: PAYER, to: PAYER, value: "2000", nonce: NONCE, validBefore: VALID_BEFORE }, signature: "synthetic-only" } })) };
    await expect(payWithServerSigner({ url: "https://example.test/paid", method: "GET", expectedPayee: PAYEE,
      expectedAmount: 0.002, payer: PAYER, signer: altered, fetchImpl, beforeSubmit, deniedRecipient: PAYER }))
      .rejects.toThrow(/recipient is excluded/);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(beforeSubmit).not.toHaveBeenCalled();
  });

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
