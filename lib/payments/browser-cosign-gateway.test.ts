import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import type { Source, SourceItem } from "../types";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import {
  PaymentPendingError,
  pendingPaymentFrom,
  settledPaymentFrom,
} from "./payment-state";
import { prepareBrowserJournal } from "../db/browser-authorization-journal";

const grantMocks = vi.hoisted(() => ({
  getGrant: vi.fn(),
  reserveSpend: vi.fn(),
  releaseSpend: vi.fn(),
  admitBrowserJournal: vi.fn(),
  exposeBrowserJournal: vi.fn(),
  signBrowserJournal: vi.fn(),
  submitBrowserJournal: vi.fn(),
  settlePendingPayment: vi.fn(),
  getBrowserJournal: vi.fn(),
  cancelPreparedBrowserJournal: vi.fn(),
}));

vi.mock("./session-grants", () => grantMocks);
vi.mock("../db", () => ({ getDb: vi.fn(async () => grantMocks) }));
vi.mock("../notify/alert", () => ({
  sendAlert: vi.fn().mockResolvedValue(true),
}));
// Cryptographic recovery has separate real-key tests; these fixtures exercise transport/content.
vi.mock("./verify-browser-signature", () => ({
  verifyBrowserSignature: vi.fn(async (header, challenge) => {
    const auth = JSON.parse(
      Buffer.from(header, "base64").toString()
    ).authorization;
    if (auth.nonce !== challenge.expectedNonce)
      throw new Error("nonce mismatch");
    return auth;
  }),
}));

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

function requirements(
  over: Partial<PaymentRequirements> = {}
): PaymentRequirements {
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
    JSON.stringify({ x402Version: 2, accepts: [req] })
  ).toString("base64");
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encoded },
  });
}

function signedHeader(
  over: Partial<{
    from: string;
    to: string;
    value: string;
    nonce: string;
    validBefore: string;
  }> = {}
): string {
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
    })
  ).toString("base64");
}

function settledResponse(
  status = 200,
  body: Record<string, unknown> = {}
): Response {
  const encoded = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: "circle-settlement-id",
      payer: SESSION,
      network: config.networkId,
    })
  ).toString("base64");
  return Response.json(
    { content: "paid content", ...body },
    { status, headers: { "PAYMENT-RESPONSE": encoded } }
  );
}

describe("BrowserCoSignGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    grantMocks.getGrant.mockResolvedValue({
      sessAddr: SESSION,
      grantEpoch: "legacy-test-grant",
    });
    grantMocks.reserveSpend.mockResolvedValue(true);
    grantMocks.releaseSpend.mockResolvedValue(undefined);
    grantMocks.admitBrowserJournal.mockImplementation(async (input) => {
      if (
        !(await grantMocks.reserveSpend(
          input.sessionId,
          input.grantEpoch,
          input.signer,
          input.payment.amountUsdc
        ))
      )
        return { status: "grant_or_cap_refused" };
      const journal = prepareBrowserJournal(input);
      journal.nonce = NONCE;
      journal.payment.id = `x402:${NONCE}`;
      journal.payment.authorizationId = NONCE;
      return { status: "admitted", journal };
    });
    grantMocks.exposeBrowserJournal.mockResolvedValue(true);
    grantMocks.signBrowserJournal.mockResolvedValue(true);
    grantMocks.submitBrowserJournal.mockResolvedValue(true);
    grantMocks.settlePendingPayment.mockResolvedValue(true);
    grantMocks.cancelPreparedBrowserJournal.mockResolvedValue(false);
    grantMocks.getBrowserJournal.mockResolvedValue(null);
  });

  it.each(["exposed", "submission_attempted"] as const)(
    "retains a durable pending record when %s commits but its acknowledgement is lost",
    async (phase) => {
      const fetchMock = vi.fn().mockResolvedValue(challenge());
      vi.stubGlobal("fetch", fetchMock);
      let recovered: import("../db/browser-authorization-journal").BrowserAuthorizationJournal | undefined;
      grantMocks.admitBrowserJournal.mockImplementation(async (input) => {
        const journal = prepareBrowserJournal(input);
        journal.nonce = NONCE;
        journal.payment.authorizationId = NONCE;
        journal.payment.id = `x402:${NONCE}`;
        recovered = {
          ...journal,
          phase,
          payment: { ...journal.payment, authorizationPhase: phase },
        };
        return { status: "admitted", journal };
      });
      grantMocks.getBrowserJournal.mockImplementation(async () => recovered);
      (phase === "exposed"
        ? grantMocks.exposeBrowserJournal
        : grantMocks.submitBrowserJournal
      ).mockRejectedValueOnce(new Error("response lost after commit"));
      const requestSignature = vi.fn().mockResolvedValue(signedHeader());
      const gateway = new BrowserCoSignGateway(
        "session",
        SESSION,
        requestSignature
      );
      let caught;
      try {
        await gateway.payFetch({ source, queryId: "q" });
      } catch (error) {
        caught = error;
      }
      expect(pendingPaymentFrom(caught)).toMatchObject({
        authorizationId: NONCE,
        authorizationPhase: phase,
        settlementStatus: "pending",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
      if (phase === "exposed") expect(requestSignature).not.toHaveBeenCalled();
    }
  );

  it("keeps the citation job identity out of both HTTP requests while retaining local payment attribution", async () => {
    const queryId = "private-job-transport-marker";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(settledResponse());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader())
    );
    const payment = await gateway.payCitation({
      source,
      author: { name: "Author", walletAddress: PAYEE, splitWeight: 1 },
      amount: 0.002,
      weight: 1,
      queryId,
      rationale: "Synthetic citation",
    });
    expect(payment).toMatchObject({
      queryId,
      kind: "citation",
      amountUsdc: 0.002,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      const target = new URL(url, "https://synthetic.example");
      expect([...target.searchParams.keys()].sort()).toEqual([
        "amount",
        "author",
      ]);
      expect(target.searchParams.get("author")).toBe(PAYEE);
      expect(target.searchParams.get("amount")).toBe("0.002000");
      expect(JSON.stringify([url, options])).not.toContain(queryId);
      expect(options.method).toBe("POST");
    }
  });

  it("rejects a challenge whose amount differs from the reserved spend", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(challenge(requirements({ amount: "9000" })));
    vi.stubGlobal("fetch", fetchMock);
    const requestSignature = vi.fn().mockResolvedValue(signedHeader());
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      requestSignature
    );

    await expect(gateway.payFetch({ source, queryId: "q1" })).rejects.toThrow(
      /amount does not match/i
    );
    expect(grantMocks.reserveSpend).not.toHaveBeenCalled();
    expect(requestSignature).not.toHaveBeenCalled();
  });

  it("retains the exposed reservation when the browser returns a mismatched authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader({ from: ATTACKER }))
    );

    await expect(gateway.payFetch({ source, queryId: "q1" })).rejects.toThrow(
      /exposed authorization remains reserved/i
    );
    expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a dual-payload callback before the paid retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    const outer = JSON.parse(
      Buffer.from(signedHeader(), "base64").toString("utf8")
    );
    const header = Buffer.from(
      JSON.stringify({
        ...outer,
        payload: {
          ...outer,
          authorization: {
            ...outer.authorization,
            nonce: `0x${"99".repeat(32)}`,
          },
        },
      })
    ).toString("base64");
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(header)
    );

    await expect(
      gateway.payFetch({ source, queryId: "q1" })
    ).rejects.toBeInstanceOf(PaymentPendingError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a replacement between gateway construction and reservation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    grantMocks.getGrant.mockResolvedValue({
      sessAddr: SESSION,
      grantEpoch: "replacement",
    });
    const requestSignature = vi.fn().mockResolvedValue(signedHeader());
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      requestSignature
    );

    await expect(gateway.payFetch({ source, queryId: "q1" })).rejects.toThrow(
      /grant expired or revoked/
    );
    expect(grantMocks.reserveSpend).not.toHaveBeenCalled();
    expect(requestSignature).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a pending nonce when replacement follows signing, without submitting or releasing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    grantMocks.getGrant
      .mockResolvedValueOnce({
        sessAddr: SESSION,
        grantEpoch: "legacy-test-grant",
      })
      .mockResolvedValueOnce({
        sessAddr: SESSION,
        grantEpoch: "legacy-test-grant",
      })
      .mockResolvedValueOnce({ sessAddr: SESSION, grantEpoch: "replacement" });
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader())
    );

    let caught: unknown;
    try {
      await gateway.payFetch({ source, queryId: "q1" });
    } catch (error) {
      caught = error;
    }
    expect(pendingPaymentFrom(caught)).toMatchObject({
      authorizationId: NONCE,
      grantEpoch: "legacy-test-grant",
      settlementStatus: "pending",
      settled: false,
      rationale: expect.stringContaining("withheld submission"),
    });
    expect(caught).toBeInstanceOf(PaymentPendingError);
    expect((caught as PaymentPendingError).submissionAttempted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
  });

  it("records a pending nonce when the client aborts after signing", async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockImplementation(async () => {
        abort.abort();
        return signedHeader();
      }),
      abort.signal
    );

    let caught: unknown;
    try {
      await gateway.payFetch({ source, queryId: "q1" });
    } catch (error) {
      caught = error;
    }
    expect(pendingPaymentFrom(caught)).toMatchObject({
      authorizationId: NONCE,
      settlementStatus: "pending",
      rationale: expect.stringContaining("withheld submission"),
    });
    expect((caught as PaymentPendingError).submissionAttempted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
  });

  it("keeps the reservation and returns a durable pending record after a post-submit timeout", async () => {
    grantMocks.getGrant.mockResolvedValue({
      sessAddr: SESSION,
      grantEpoch: "epoch-pending",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockRejectedValueOnce(new Error("socket reset"));
    vi.stubGlobal("fetch", fetchMock);
    const validBefore = String(
      Math.floor(Date.now() / 1_000) + config.maxTimeoutSeconds
    );
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader({ validBefore })),
      undefined,
      "epoch-pending"
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
      authorizationExpiresAt: new Date(
        Number(validBefore) * 1_000
      ).toISOString(),
      grantEpoch: "epoch-pending",
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
      vi.fn().mockResolvedValue(signedHeader())
    );

    const result = await gateway.payFetch({ source, queryId: "q1" });
    expect(result.content).toBe("paid content");
    expect(result.payment).toMatchObject({
      settled: false,
      settlementStatus: "pending",
      authorizationId: NONCE,
      authorizationExpiresAt: expect.any(String),
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
      vi.fn().mockResolvedValue(signedHeader())
    );

    const result = await gateway.payFetch({ source, queryId: "q1" });
    expect(result.payment).toMatchObject({
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-settlement-id",
      authorizationId: NONCE,
      authorizationExpiresAt: expect.any(String),
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
      .mockResolvedValueOnce(
        settledResponse(200, {
          item: identity,
          pricing: {
            offerId: null,
            priceUsdc: source.fetchPrice,
            listPriceUsdc: source.fetchPrice,
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader())
    );

    const result = await gateway.payFetch({ source, item, queryId: "q1" });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `version=${encodeURIComponent(identity.contentVersion)}`
    );
    expect(result.payment).toMatchObject(identity);
  });

  it("binds a creator offer id, discounted amount, and list price through co-signing", async () => {
    const item: SourceItem = {
      id: "article-offer",
      sourceId: source.id,
      title: "Offer market",
      summary: "Preview",
      content: "Paid article",
      link: "https://example.test/offer-market",
    };
    const identity = sourceItemIdentity(item);
    const offer = {
      id: `0x${"55".repeat(32)}`,
      priceUsdc: 0.001,
      listPriceUsdc: 0.002,
      expiresAt: 2_000_000_000,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challenge(requirements({ amount: "1000" })))
      .mockResolvedValueOnce(
        settledResponse(200, {
          item: identity,
          pricing: {
            offerId: offer.id,
            priceUsdc: offer.priceUsdc,
            listPriceUsdc: offer.listPriceUsdc,
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader({ value: "1000" }))
    );

    const result = await gateway.payFetch({
      source,
      item,
      queryId: "q1",
      priceUsdc: offer.priceUsdc,
      offer,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain(`offer=${offer.id}`);
    expect(grantMocks.reserveSpend).toHaveBeenCalledWith(
      "session",
      "legacy-test-grant",
      SESSION,
      0.001
    );
    expect(result.payment).toMatchObject({
      amountUsdc: 0.001,
      offerId: offer.id,
      listPriceUsdc: 0.002,
    });
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
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new BrowserCoSignGateway(
      "session",
      SESSION,
      vi.fn().mockResolvedValue(signedHeader())
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

  it.each([true, false])("retains the original receipt/cap when hostile body delivery is settled=%s", async settled => {
    const content = "Selected plaintext body: café 🌍.", item: SourceItem = { id: "integrity-article", sourceId: source.id,
      title: "Committed article", summary: "Preview", content, link: "https://example.test/committed",
      bodyHash: contentBodyHash(content), plaintextBytes: contentBytes(content) };
    for (const hostile of ["", "  \n", 42, "Substituted content."]) {
      const response = { content: hostile, item: sourceItemIdentity(item),
        pricing: { offerId: null, priceUsdc: source.fetchPrice, listPriceUsdc: source.fetchPrice } };
      const http = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(settled ? settledResponse(200, response) : Response.json(response));
      vi.stubGlobal("fetch", http);
      const gateway = new BrowserCoSignGateway("session", SESSION, vi.fn().mockResolvedValue(signedHeader()));
      let caught: unknown;
      try { await gateway.payFetch({ source, item, queryId: "q-integrity" }); } catch (error) { caught = error; }
      expect(String(caught)).toContain("paid article body");
      expect(settled ? settledPaymentFrom(caught) : pendingPaymentFrom(caught)).toMatchObject({ authorizationId: NONCE,
        settled, settlementStatus: settled ? "settled" : "pending", amountUsdc: source.fetchPrice, payee: PAYEE,
        contentVersion: sourceItemIdentity(item).contentVersion });
      expect(http).toHaveBeenCalledTimes(2); expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
      expect(grantMocks.cancelPreparedBrowserJournal).not.toHaveBeenCalled();
    }
  });

  it("admits committed Unicode plaintext and legacy encrypted rows without inferred plaintext constraints", async () => {
    const content = "Selected plaintext body: café 🌍.", base: SourceItem = { id: "integrity-article", sourceId: source.id,
      title: "Committed article", summary: "Preview", content, link: "https://example.test/committed" };
    for (const item of [{ ...base, bodyHash: contentBodyHash(content), plaintextBytes: contentBytes(content) },
      { ...base, content: "unrelated-legacy-ciphertext-bytes", storageMode: "db_encrypted" as const }]) {
      const http = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(settledResponse(200, { content,
        item: sourceItemIdentity(item), pricing: { offerId: null, priceUsdc: source.fetchPrice, listPriceUsdc: source.fetchPrice } }));
      vi.stubGlobal("fetch", http);
      const gateway = new BrowserCoSignGateway("session", SESSION, vi.fn().mockResolvedValue(signedHeader()));
      expect((await gateway.payFetch({ source, item, queryId: "q-integrity" })).content).toBe(content);
    }
  });

  it.each([true, false])("retains original payment evidence for non-object response envelopes settled=%s", async settled => {
    for (const envelope of [null, [], "a root JSON string"]) {
      const response = Response.json(envelope);
      if (settled) response.headers.set("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ success: true,
        transaction: "synthetic-fixture-receipt", payer: SESSION, network: config.networkId })).toString("base64"));
      const http = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(response);
      vi.stubGlobal("fetch", http);
      const gateway = new BrowserCoSignGateway("session", SESSION, vi.fn().mockResolvedValue(signedHeader()));
      let caught: unknown;
      try { await gateway.payFetch({ source, queryId: "q-integrity" }); } catch (error) { caught = error; }
      expect(String(caught)).toContain("paid article body");
      expect(settled ? settledPaymentFrom(caught) : pendingPaymentFrom(caught)).toMatchObject({ authorizationId: NONCE,
        settled, settlementStatus: settled ? "settled" : "pending", amountUsdc: source.fetchPrice, payee: PAYEE });
      expect(http).toHaveBeenCalledTimes(2); expect(grantMocks.releaseSpend).not.toHaveBeenCalled();
    }
  });

  it("rejects conflicting selected commitments before browser journal admission or HTTP", async () => {
    const item: SourceItem = { id: "malformed", sourceId: source.id, title: "Malformed", summary: "Preview", content: "Selected article",
      link: "https://example.test/article", plaintextBytes: -1 };
    const http = vi.fn(), sign = vi.fn(); vi.stubGlobal("fetch", http);
    await expect(new BrowserCoSignGateway("session", SESSION, sign).payFetch({ source, item, queryId: "q-integrity" }))
      .rejects.toThrow("selected paid article body byte count is malformed");
    expect(http).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled(); expect(grantMocks.admitBrowserJournal).not.toHaveBeenCalled();
  });

  it("refuses excluded fetch/citation recipients before admission, signature exposure or HTTP", async () => {
    const http = vi.fn(), sign = vi.fn(); vi.stubGlobal("fetch", http);
    const gateway = new BrowserCoSignGateway("session", SESSION, sign);
    await expect(gateway.payFetch({ source, queryId: "q", deniedRecipient: PAYEE })).rejects.toThrow(/recipient is excluded/);
    await expect(gateway.payCitation({ source, author: { name: "Author", walletAddress: ATTACKER, splitWeight: 1 },
      amount: 0.002, weight: 1, queryId: "q", rationale: "Qualified", deniedRecipient: ATTACKER })).rejects.toThrow(/recipient is excluded/);
    expect(http).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
    expect(grantMocks.admitBrowserJournal).not.toHaveBeenCalled(); expect(grantMocks.reserveSpend).not.toHaveBeenCalled();
  });

  it("refuses an excluded changed challenge before admitting or exposing a browser authorization", async () => {
    const http = vi.fn().mockResolvedValue(challenge(requirements({ payTo: ATTACKER }))), sign = vi.fn();
    vi.stubGlobal("fetch", http);
    const gateway = new BrowserCoSignGateway("session", SESSION, sign);
    await expect(gateway.payFetch({ source, queryId: "q", deniedRecipient: ATTACKER })).rejects.toThrow(/recipient is excluded/);
    expect(http).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
    expect(grantMocks.admitBrowserJournal).not.toHaveBeenCalled(); expect(grantMocks.exposeBrowserJournal).not.toHaveBeenCalled();
    expect(grantMocks.reserveSpend).not.toHaveBeenCalled();
  });

  it("preserves browser-owned self-payment when no outside-funding restriction applies", async () => {
    const http = vi.fn().mockResolvedValueOnce(challenge(requirements({ payTo: SESSION }))).mockResolvedValueOnce(settledResponse());
    const sign = vi.fn().mockResolvedValue(signedHeader({ to: SESSION })); vi.stubGlobal("fetch", http);
    const gateway = new BrowserCoSignGateway("session", SESSION, sign);
    expect((await gateway.payFetch({ source: { ...source, walletAddress: SESSION }, queryId: "q" })).payment)
      .toMatchObject({ payee: SESSION, settled: true, amountUsdc: 0.002 });
    expect(sign).toHaveBeenCalledOnce(); expect(grantMocks.admitBrowserJournal).toHaveBeenCalledOnce();
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
      vi.fn().mockResolvedValue(signedHeader())
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
