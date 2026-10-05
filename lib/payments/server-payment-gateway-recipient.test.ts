import { afterEach, expect, it, vi } from "vitest";
import { config } from "../config";
import type { Source } from "../types";
import * as fetchAuthority from "../registry/source-fetch-payto";
import { ServerPaymentGateway } from "./server-payment-gateway";
import type { BatchPayloadSigner } from "./server-x402-client";

const asker = `0x${"ab".repeat(20)}`, recipient = `0x${"12".repeat(20)}`, payer = `0x${"34".repeat(20)}`;
const source: Source = { id: "independent", name: "Independent", url: "https://synthetic.invalid/source", description: "Original",
  walletAddress: recipient, authors: [], fetchPrice: 0.002, tags: [], createdAt: "2026-10-05T00:00:00.000Z" };
class SyntheticGateway extends ServerPaymentGateway {
  protected spend = { address: payer };
  protected batchScheme: BatchPayloadSigner = { createPaymentPayload: vi.fn(async (x402Version, requirements) => ({ x402Version,
    payload: { signature: "synthetic-only", authorization: { from: payer, to: requirements.payTo, value: requirements.amount,
      nonce: `0x${"56".repeat(32)}`, validBefore: "2000000000" } } })) };
  get signer() { return this.batchScheme.createPaymentPayload; }
  async ensureFunded() { return { address: payer }; }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function challenge(payTo = recipient) {
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2,
    accepts: [{ scheme: "exact", network: config.networkId, asset: config.usdcAddress, amount: "2000", payTo,
      maxTimeoutSeconds: config.maxTimeoutSeconds, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } }] })).toString("base64") } });
}
function paid() { return Response.json({ content: "Synthetic original content.", ok: true }, { headers: { "PAYMENT-RESPONSE":
  Buffer.from(JSON.stringify({ success: true, transaction: "synthetic-reference", payer, network: config.networkId })).toString("base64") } }); }

it("refuses a fresh registry self-toll despite an independent stale DB wallet before any HTTP or signature", async () => {
  vi.spyOn(fetchAuthority, "sourceFetchPayTo").mockResolvedValue(asker.toUpperCase());
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  const gateway = new SyntheticGateway();
  await expect(gateway.payFetch({ source, queryId: "q", deniedRecipient: asker })).rejects.toThrow(/recipient is excluded/);
  expect(http).not.toHaveBeenCalled(); expect(gateway.signer).not.toHaveBeenCalled();
});

it("refuses a changed citation recipient before any HTTP or signature", async () => {
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  const gateway = new SyntheticGateway();
  await expect(gateway.payCitation({ source, author: { name: "Changed", walletAddress: asker, splitWeight: 1 }, amount: 0.002,
    weight: 1, queryId: "q", rationale: "Qualified", deniedRecipient: asker })).rejects.toThrow(/recipient is excluded/);
  expect(http).not.toHaveBeenCalled(); expect(gateway.signer).not.toHaveBeenCalled();
});

it("refuses a recipient change in the final 402 challenge before creating authorization", async () => {
  vi.spyOn(fetchAuthority, "sourceFetchPayTo").mockResolvedValue(recipient);
  const http = vi.fn().mockResolvedValue(challenge(asker)); vi.stubGlobal("fetch", http);
  const gateway = new SyntheticGateway();
  await expect(gateway.payFetch({ source, queryId: "q", deniedRecipient: asker })).rejects.toThrow(/recipient is excluded/);
  expect(http).toHaveBeenCalledOnce(); expect(gateway.signer).not.toHaveBeenCalled();
  expect(http.mock.calls[0][1].headers).not.toHaveProperty("Payment-Signature");
});

it("keeps independent exact-price source tolls and citation legs working", async () => {
  vi.spyOn(fetchAuthority, "sourceFetchPayTo").mockResolvedValue(recipient);
  const http = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paid())
    .mockResolvedValueOnce(challenge()).mockResolvedValueOnce(paid()); vi.stubGlobal("fetch", http);
  const gateway = new SyntheticGateway();
  const fetched = await gateway.payFetch({ source, queryId: "q", deniedRecipient: asker });
  const cited = await gateway.payCitation({ source, author: { name: "Independent", walletAddress: recipient, splitWeight: 1 },
    amount: 0.002, weight: 1, queryId: "q", rationale: "Qualified", deniedRecipient: asker });
  expect([fetched.payment, cited]).toEqual([expect.objectContaining({ payee: recipient, amountUsdc: 0.002, settled: true }),
    expect.objectContaining({ payee: recipient, amountUsdc: 0.002, settled: true })]);
  expect(http).toHaveBeenCalledTimes(4); expect(gateway.signer).toHaveBeenCalledTimes(2);
});
