import { afterEach, expect, it, vi } from "vitest";
import { PrivateServerGateway } from "./private-server-gateway";
import { config } from "../config";
import type { Source } from "../types";
import type { PrivateCreatorConfirmation } from "../db/private-creator-confirmations";
import { settledPaymentFrom, pendingPaymentFrom } from "./payment-state";

const owner = `0x${"11".repeat(20)}`, payer = `0x${"22".repeat(20)}`, payee = `0x${"33".repeat(20)}`;
const id = `prv_${"a".repeat(64)}`, nonce = `0x${"44".repeat(32)}`;
const source: Source = { id: "source", name: "Source", walletAddress: payee, authors: [], tags: [], fetchPrice: 0.002,
  url: "https://synthetic.example", description: "Synthetic source", createdAt: "2026-09-09T00:00:00.000Z" };
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const signer = { createPaymentPayload: vi.fn(async () => ({ x402Version: 2, payload: { signature: "synthetic-unfunded-signature",
    authorization: { from: payer, to: payee, value: "2000", nonce, validBefore: "2000000000" } } })) };
  const db = { admitPrivateCreatorSubmission: vi.fn().mockResolvedValue(true), confirmPrivateCreatorSubmission: vi.fn()
    .mockImplementation(async (_id: string, _owner: string, _worker: string, confirmation: PrivateCreatorConfirmation) => ({ confirmation, settledAt: "2026-09-09T00:00:00.000Z" })) };
  const balance = vi.fn().mockResolvedValue(BigInt(30000));
  const gateway = new PrivateServerGateway({ signerAddress: payer, signer, getGatewayBalance: balance, db,
    job: { id, owner, workerId: "00000000-0000-4000-8000-000000000001" } });
  return { gateway, signer, db, balance };
}
function challenge() {
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{
    scheme: "exact", network: config.networkId, asset: config.usdcAddress, amount: "2000", payTo: payee, maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet },
  }] })).toString("base64") } });
}
function paid(status = 200) {
  return Response.json({ content: "Synthetic paid content", ok: true }, { status, headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({
    success: true, transaction: "synthetic-reference", payer, network: config.networkId,
  })).toString("base64") } });
}
const citation = { source, author: { name: "Author", walletAddress: payee, splitWeight: 1 }, amount: 0.002, weight: 1, queryId: id, rationale: "Private rationale" };

it("only checks prefunded balance and rejects another job before any HTTP or signing", async () => {
  const { gateway, balance, signer } = setup();
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  expect(await gateway.ensureFunded(0.03)).toEqual({ address: payer });
  balance.mockResolvedValueOnce(BigInt(29999));
  await expect(gateway.ensureFunded(0.03)).rejects.toThrow("prefunding");
  await expect(gateway.ensureFunded(1.1)).rejects.toThrow("budget");
  await expect(gateway.payCitation({ ...citation, queryId: "another-job" })).rejects.toThrow("another job");
  await expect(gateway.payFetch({ source, queryId: "another-job" })).rejects.toThrow("another job");
  expect(http).not.toHaveBeenCalled(); expect(signer.createPaymentPayload).not.toHaveBeenCalled();
});

it.each(["fetch", "citation"] as const)("journals %s before signed HTTP and persists its receipt", async kind => {
  const { gateway, db } = setup();
  const http = vi.fn().mockResolvedValueOnce(challenge()).mockImplementationOnce(async () => {
    expect(db.admitPrivateCreatorSubmission).toHaveBeenCalledTimes(1);
    return paid();
  }); vi.stubGlobal("fetch", http);
  const result = kind === "fetch" ? (await gateway.payFetch({ source, queryId: id })).payment : await gateway.payCitation(citation);
  expect(result).toMatchObject({ queryId: id, kind, payer, payee, settled: true, txHash: "synthetic-reference" });
  expect(db.confirmPrivateCreatorSubmission).toHaveBeenCalledTimes(1);
  expect(db.admitPrivateCreatorSubmission.mock.calls[0].slice(0, 2)).toEqual([id, owner]);
  expect(JSON.stringify(http.mock.calls)).not.toContain(id);
  expect(JSON.stringify(http.mock.calls)).not.toContain(citation.rationale);
});

it("blocks denied admission and retains ambiguous or paid-undelivered evidence on storage failure", async () => {
  const denied = setup(); denied.db.admitPrivateCreatorSubmission.mockResolvedValue(false);
  const first = vi.fn().mockResolvedValueOnce(challenge()); vi.stubGlobal("fetch", first);
  await expect(denied.gateway.payCitation(citation)).rejects.toThrow("not admitted");
  expect(first).toHaveBeenCalledTimes(1);
  for (const outcome of ["pending", "settled"] as const) {
    const { gateway, db } = setup();
    db.confirmPrivateCreatorSubmission.mockRejectedValue(new Error("synthetic DB outage"));
    const http = vi.fn().mockResolvedValueOnce(challenge());
    if (outcome === "pending") http.mockRejectedValueOnce(new Error("synthetic response lost"));
    else http.mockResolvedValueOnce(paid(500));
    vi.stubGlobal("fetch", http);
    let caught: unknown;
    try { await gateway.payCitation(citation); } catch (error) { caught = error; }
    const payment = outcome === "pending" ? pendingPaymentFrom(caught) : settledPaymentFrom(caught);
    expect(payment).toMatchObject({ queryId: id, authorizationId: nonce, settlementStatus: outcome });
    if (outcome === "settled") expect(payment?.rationale).toContain("durable confirmation requires recovery");
    expect(http).toHaveBeenCalledTimes(2);
  }
});
