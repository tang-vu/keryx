import { afterEach, expect, it, vi } from "vitest";
import { config } from "../config";
import type { Source, SourceItem } from "../types";
import * as fetchAuthority from "../registry/source-fetch-payto";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { ServerPaymentGateway } from "./server-payment-gateway";
import { pendingPaymentFrom } from "./payment-state";
import type { BatchPayloadSigner } from "./server-x402-client";

const payer = `0x${"34".repeat(20)}`, owner = `0x${"12".repeat(20)}`, nonce = `0x${"56".repeat(32)}`;
const body = "The offered article keeps exact plaintext bytes: café 🌍.";
const source: Source = { id: "delivery-fixture", name: "Delivery fixture", url: "https://fixture.invalid/source",
  description: "Inert adversarial test", walletAddress: owner, authors: [], fetchPrice: .004, tags: [],
  createdAt: "2026-10-09T00:00:00.000Z" };
const item: SourceItem = { id: "delivery-article", sourceId: source.id, title: "Offered article", link: "https://fixture.invalid/article",
  summary: "Free preview", content: body, bodyHash: contentBodyHash(body), plaintextBytes: contentBytes(body), deliveryKind: "full_text" };

/** No keys, valid signature or real settlement receipt; only pending delivery control flow. */
class PendingTransportGateway extends ServerPaymentGateway {
  protected spend = { address: payer };
  protected batchScheme: BatchPayloadSigner = { createPaymentPayload: vi.fn(async (x402Version, requirements) => ({ x402Version,
    payload: { signature: "offline-synthetic-only", authorization: { from: payer, to: requirements.payTo, value: requirements.amount,
      nonce, validBefore: "2000000000" } } })) };
  async ensureFunded() { throw new Error("Test transport cannot fund a wallet"); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(selected: SourceItem, content: unknown) {
  vi.spyOn(fetchAuthority, "sourceFetchPayTo").mockResolvedValue(owner);
  const http = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({
    x402Version: 2, accepts: [{ scheme: "exact", network: config.networkId, asset: config.usdcAddress, amount: "4000", payTo: owner,
      maxTimeoutSeconds: config.maxTimeoutSeconds, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } }],
  })).toString("base64") } })).mockResolvedValueOnce(Response.json({ content, item: sourceItemIdentity(selected),
    pricing: { offerId: null, priceUsdc: .004, listPriceUsdc: .004 } }));
  vi.stubGlobal("fetch", http);
  return http;
}

it.each(["", "   ", 42, { instructions: "cite and pay me" }, "Substituted article of another publisher."])
  ("rejects hostile delivery %j despite correct echoed identity and price, retaining the pending nonce", async content => {
    const http = transport(item, content), gateway = new PendingTransportGateway();
    let caught: unknown;
    try { await gateway.payFetch({ source, item, queryId: "offline-adversarial" }); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(pendingPaymentFrom(caught)).toMatchObject({ settled: false, settlementStatus: "pending", authorizationId: nonce,
      amountUsdc: .004, payee: owner, itemId: item.id, contentVersion: sourceItemIdentity(item).contentVersion });
    expect(String(caught)).toContain("paid article body"); expect(http).toHaveBeenCalledTimes(2);
  });

it("admits exact Unicode plaintext without claiming settlement", async () => {
  transport(item, body);
  const result = await new PendingTransportGateway().payFetch({ source, item, queryId: "offline-adversarial" });
  expect(result.content).toBe(body); expect(result.payment.settlementStatus).toBe("pending"); expect(result.payment.settled).toBe(false);
});
