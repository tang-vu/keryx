import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import type { Source, SourceItem } from "../types";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { pendingPaymentFrom, settledPaymentFrom } from "./payment-state";

const grantMocks = vi.hoisted(() => ({
  isGrantValid: vi.fn(),
  reserveSpend: vi.fn(),
  releaseSpend: vi.fn(),
}));

vi.mock("./session-grants", () => grantMocks);

import {
  BrowserCoSignGateway,
  type PaymentRequirements,
} from "./browser-cosign-gateway";

const SESSION = `0x${"11".repeat(20)}`;
const PAYEE = `0x${"22".repeat(20)}`;
const ATTACKER = `0x${"33".repeat(20)}`;
const NONCE = `0x${"44".repeat(32)}`;

const source: Source = {
  id: "source-1",
  name: "Source One",
  url: "https://example.test",
  description: "A source",
  walletAddress: PAYEE,
  fetchPrice: 0.002,
  tags: ["payments"],
  authors: [],
  createdAt: "2026-08-04T00:00:00.000Z",
};

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
  const encoded = Buffer.from(
    JSON.stringify({ x402Version: 2, accepts: [req] }),
  ).toString("base64");
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encoded },
  });
}

function signedHeader(over: Partial<{ from: string; to: string; value: string; nonce: string }> = {}): string {
  const now = Math.floor(Date.now() / 1_000);
  return Buffer.from(
    JSON.stringify({
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: SESSION,
        to: PAYEE,
        value: "2000",
        validAfter: String(now - 600),
        validBefore: String(now + config.maxTimeoutSeconds),
        nonce: NONCE,
        ...over,
      },
    }),
  ).toString("base64");
}

function settledResponse(status = 200, body: Record<string, unknown> = {}): Response {
  const encoded = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: "circle-settlement-id",
      payer: SESSION,
      network: config.networkId,
    }),
  ).toString("base64");
  return Response.json(
    { content: "paid content", ...body },
    { status, headers: { "PAYMENT-RESPONSE": encoded } },
  );
}

describe("BrowserCoSignGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    grantMocks.isGrantValid.mockResolvedValue(true);
    grantMocks.reserveSpend.mockResolvedValue(true);
    grantMocks.releaseSpend.mockResolvedValue(undefined);
  });

  it("rejects a challenge whose amount differs from the reserved spend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge(requirements({ amount: "9000" })));
    vi.stubGlobal("fetch", fetchMock);
    const requestSignature = vi.fn().mockResolvedValue(signedHeader());
    const gateway = new BrowserCoSignGateway("session", SESSION, requestSignature);

    await expect(gateway.payFetch({ source, queryId: "q1" })).rejects.toThrow(
      /amount does not match/i,
    );
    expect(grantMocks.reserveSpend).not.toHaveBeenCalled();
    expect(requestSignature).not.toHaveBeenCalled();
  });

  it("releases the reservation when the browser returns a mismatched authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader({ from: ATTACKER })),
    );

    await expect(gateway.payFetch({ source, queryId: "q1" })).rejects.toThrow(
      /signer does not match/i,
    );
    expect(grantMocks.releaseSpend).toHaveBeenCalledWith("session", source.fetchPrice);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation and returns a durable pending record after a post-submit timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockRejectedValueOnce(new Error("socket reset"));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    let caught: unknown;
    try {
      await gateway.payFetch({ source, queryId: "q1" });
    } catch (error) {
      caught = error;
    }
    const payment = pendingPaymentFrom(caught);
    expect(payment).toMatchObject({
      queryId: "q1",
      settled: false,
      settlementStatus: "pending",
      authorizationId: NONCE,
      amountUsdc: source.fetchPrice,
    });
    expect(payment?.id).toBe(`x402:${NONCE}`);
    expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
  });

  it("marks a 2xx content response without valid settlement proof as pending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(Response.json({ content: "paid content" }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    const result = await gateway.payFetch({ source, queryId: "q1" });
    expect(result.content).toBe("paid content");
    expect(result.payment).toMatchObject({
      settled: false,
      settlementStatus: "pending",
      authorizationId: NONCE,
    });
  });

  it("marks a payment settled only with a valid Circle response reference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(settledResponse());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    const result = await gateway.payFetch({ source, queryId: "q1" });
    expect(result.payment).toMatchObject({
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-settlement-id",
      authorizationId: NONCE,
    });
  });

  it("binds an article payment and receipt to the selected content version", async () => {
    const item: SourceItem = {
      id: "article-1",
      sourceId: source.id,
      title: "Arc receipts",
      summary: "Preview",
      content: "Paid article",
      link: "https://example.test/arc-receipts",
      publishedAt: "2026-08-05T00:00:00.000Z",
    };
    const identity = sourceItemIdentity(item);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(settledResponse(200, { item: identity }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    const result = await gateway.payFetch({ source, item, queryId: "q1" });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `version=${encodeURIComponent(identity.contentVersion)}`,
    );
    expect(result.payment).toMatchObject(identity);
  });

  it("retains settlement but rejects content whose echoed article identity differs", async () => {
    const item: SourceItem = {
      id: "article-1",
      sourceId: source.id,
      title: "Arc receipts",
      summary: "Preview",
      content: "Paid article",
      link: "https://example.test/arc-receipts",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(
        settledResponse(200, {
          item: { ...sourceItemIdentity(item), itemId: "different-article" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    let caught: unknown;
    try {
      await gateway.payFetch({ source, item, queryId: "q1" });
    } catch (error) {
      caught = error;
    }

    expect(settledPaymentFrom(caught)).toMatchObject({
      settled: true,
      itemId: item.id,
      contentVersion: sourceItemIdentity(item).contentVersion,
    });
  });

  it("retains a confirmed settlement when paid content delivery returns 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(settledResponse(500));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader()),
    );

    let caught: unknown;
    try {
      await gateway.payFetch({ source, queryId: "q1" });
    } catch (error) {
      caught = error;
    }
    expect(settledPaymentFrom(caught)).toMatchObject({
      queryId: "q1",
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-settlement-id",
      authorizationId: NONCE,
    });
    expect(pendingPaymentFrom(caught)).toBeNull();
    expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
  });
});
