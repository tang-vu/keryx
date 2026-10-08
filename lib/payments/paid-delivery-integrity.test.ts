import { afterEach, expect, it, vi } from "vitest";
import { config } from "../config";
import type { PaymentRecord, Source, SourceItem } from "../types";
import * as fetchAuthority from "../registry/source-fetch-payto";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { ServerPaymentGateway } from "./server-payment-gateway";
import { pendingPaymentFrom, settledPaymentFrom } from "./payment-state";
import type { BatchPayloadSigner } from "./server-x402-client";
import { runAgent } from "../agent/run-agent";
import type { KeryxDB } from "../db/keryx-db";
import type { ResearchEffects } from "../agent/research-effects";
import type { ReasoningEngine } from "../llm/reasoning-engine";

const payer = `0x${"34".repeat(20)}`, owner = `0x${"12".repeat(20)}`, nonce = `0x${"56".repeat(32)}`;
const body = "The offered article keeps exact plaintext bytes: café 🌍.";
const source: Source = { id: "delivery-fixture", name: "Delivery fixture", url: "https://fixture.invalid/source",
  description: "Inert adversarial test", walletAddress: owner, authors: [], fetchPrice: .004, tags: [],
  createdAt: "2026-10-09T00:00:00.000Z" };
const item: SourceItem = { id: "delivery-article", sourceId: source.id, title: "Offered article", link: "https://fixture.invalid/article",
  summary: "Free preview", content: body, bodyHash: contentBodyHash(body), plaintextBytes: contentBytes(body), deliveryKind: "full_text" };

/** No keys or valid signature. Injected receipts test classification, never prove a real debit. */
class PendingTransportGateway extends ServerPaymentGateway {
  protected spend = { address: payer };
  protected batchScheme: BatchPayloadSigner = { createPaymentPayload: vi.fn(async (x402Version, requirements) => ({ x402Version,
    payload: { signature: "offline-synthetic-only", authorization: { from: payer, to: requirements.payTo, value: requirements.amount,
      nonce, validBefore: "2000000000" } } })) };
  async ensureFunded(): Promise<{ address: string }> { throw new Error("Test transport cannot fund a wallet"); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(selected: SourceItem, content: unknown, settled = false) {
  vi.spyOn(fetchAuthority, "sourceFetchPayTo").mockResolvedValue(owner);
  const http = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({
    x402Version: 2, accepts: [{ scheme: "exact", network: config.networkId, asset: config.usdcAddress, amount: "4000", payTo: owner,
      maxTimeoutSeconds: config.maxTimeoutSeconds, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } }],
  })).toString("base64") } })).mockResolvedValueOnce(Response.json({ content, item: sourceItemIdentity(selected),
    pricing: { offerId: null, priceUsdc: .004, listPriceUsdc: .004 } }, settled ? { headers: { "PAYMENT-RESPONSE":
      Buffer.from(JSON.stringify({ success: true, transaction: "synthetic-fixture-receipt", payer, network: config.networkId })).toString("base64") } } : {}));
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

it("retains an injected settled receipt when correct metadata accompanies a substituted body", async () => {
  const http = transport(item, "Substituted article.", true);
  let caught: unknown;
  try { await new PendingTransportGateway().payFetch({ source, item, queryId: "offline-adversarial" }); } catch (error) { caught = error; }
  expect(settledPaymentFrom(caught)).toMatchObject({ settled: true, settlementStatus: "settled", authorizationId: nonce,
    txHash: "synthetic-fixture-receipt", amountUsdc: .004, payee: owner, contentVersion: sourceItemIdentity(item).contentVersion });
  expect(http).toHaveBeenCalledTimes(2);
});

it("refuses malformed selected commitments before HTTP or signing", async () => {
  const malformed = { ...item, bodyHash: "not-a-sha256" }, http = transport(malformed, body);
  await expect(new PendingTransportGateway().payFetch({ source, item: malformed, queryId: "offline-adversarial" }))
    .rejects.toThrow("selected paid article body hash is malformed");
  expect(http).not.toHaveBeenCalled();
});

it("does not confuse legacy encrypted ciphertext bytes with the delivered plaintext", async () => {
  const legacy = { ...item, content: "legacy-ciphertext-with-an-unrelated-byte-count", storageMode: "db_encrypted" as const,
    bodyHash: undefined, plaintextBytes: undefined };
  expect(sourceItemIdentity(legacy).contentReceipt?.plaintextBytes).not.toBe(contentBytes(body));
  transport(legacy, body);
  expect((await new PendingTransportGateway().payFetch({ source, item: legacy, queryId: "offline-adversarial" })).content).toBe(body);
});

it("continues a run after pending integrity failure without cache, evidence or attribution", async () => {
  transport(item, "Substituted article.");
  const gateway = new PendingTransportGateway();
  vi.spyOn(gateway, "ensureFunded").mockResolvedValue({ address: payer });
  const payments: PaymentRecord[] = [], setCached = vi.fn(), attribute = vi.fn();
  const db = { listSources: async () => [source], getItems: async () => [item], getArticleOffer: async () => null } as unknown as KeryxDB;
  const effects: ResearchEffects = { scope: { kind: "public" }, recordPayment: async payment => { payments.push(payment); },
    getCached: async () => null, getCachedAt: async () => null, setCached, saveQueryRun: async () => {}, discoverExternal: async () => [],
    decisionContext: async () => ({ sample: 0 }), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const engine: ReasoningEngine = { name: "offline-integrity-fault", decompose: async () => ["Offered article"],
    decide: async input => input.candidates.map(candidate => ({ sourceId: candidate.id, sourceName: candidate.name, action: "BUY",
      price: candidate.fetchPrice, expectedValue: .9, confidence: .9, targets: [0], rationale: "Read selected article" })),
    sufficiency: async () => ({ sufficient: false, rationale: "No usable delivery", perClaim: [] }),
    reevaluate: async () => ({ claims: [], shouldBuyMore: false, recommendedIds: [], rationale: "No retry authorized" }),
    synthesize: async () => ({ answer: "", citedMarkers: [], evidence: [], conflicts: [] }), attribute };
  const generator = runAgent({ question: "Read the offered article", budget: .02 }, { db, effects, gateway, engine });
  const trace = []; let next = await generator.next();
  while (!next.done) { trace.push(next.value); next = await generator.next(); }
  expect(payments).toHaveLength(1); expect(payments[0]).toMatchObject({ kind: "fetch", settlementStatus: "pending", authorizationId: nonce });
  expect(payments[0].rationale).toContain("paid article body hash does not match the selected commitment");
  expect(setCached).not.toHaveBeenCalled(); expect(attribute).not.toHaveBeenCalled();
  expect(next.value.citations).toEqual([]); expect(next.value.evidence ?? []).toEqual([]);
  expect(trace.some(step => step.message.includes("reserved, not counted as settled spend"))).toBe(true);
});
