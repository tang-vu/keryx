import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { storageIdentityDigest } from "./storage-identity";
import { SupabaseAuthority } from "./supabase-authority";
import { SupabaseGatewayFundingTerminalObserverStore } from "./gateway-funding-supabase-observer";
import type { GatewayFundingLedger, VerifiedFundingTerminalObservation } from "./gateway-funding-ledger-types";
import { validateGatewayFundingOperation } from "../payments/gateway-funding-policy";
import { prepareGatewayFundingTransaction, validateSignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "../payments/gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import { fundingAggregate } from "./gateway-funding-ledger-validation";

async function fixture() {
  const identity = syntheticStorageIdentity("testnet-real"), funder = privateKeyToAccount(generatePrivateKey()), spend = privateKeyToAccount(generatePrivateKey());
  const operation = validateGatewayFundingOperation({ format: "gateway-funding-operation-v1", policy: {
    format: "gateway-funding-policy-v1", identity, policyId: randomUUID(), funder: funder.address.toLowerCase(), spend: spend.address.toLowerCase(),
    lifetimeLimits: { nativeWei: "100", usdcMicros: "100", depositMicros: "100", gasWei: "10000000" }, maxTransactionGas: "120000", maxFeePerGasWei: "10" },
    operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "a".repeat(64), minimumAvailableMicros: "100", initialAvailableMicros: "0",
    nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100", gasLimits: {
      nativeTransfer: "21000", usdcTransfer: "60000", approval: "60000", deposit: "120000" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" });
  const transaction = prepareGatewayFundingTransaction(operation, "nativeTransfer", "0");
  const rawTransaction = await funder.signTransaction(parseTransaction(transaction.serializedUnsigned));
  const prepared = await validateSignedGatewayFundingTransaction(operation, "nativeTransfer", "0", { rawTransaction, transactionHash: keccak256(rawTransaction) }, () => {});
  const cryptoClaimId = randomUUID(), broadcastClaimId = randomUUID();
  const request = { operation, prepared, cryptoClaimId, broadcastClaimId, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST };
  const limits = { nativeWei: "100", usdcMicros: "100", depositMicros: "0", gasWei: "1000000" };
  const namespace = (sender: string) => { const isFunder = sender === operation.policy.funder;
    const exposure = isFunder ? limits : { nativeWei: "0", usdcMicros: "0", depositMicros: "100", gasWei: "2000000" };
    return { identityDigest: storageIdentityDigest(identity), chainId: "5042002", sender, peer: isFunder ? operation.policy.spend : operation.policy.funder,
      role: isFunder ? "funder" : "spend", historyDocumentDigest: "a".repeat(64), backendBindingDigest: "b".repeat(64), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
      initialNonce: "0", nextNonce: "1", nextCryptoNonce: "0", limits: exposure, used: { nativeWei: "0", usdcMicros: "0", depositMicros: "0", gasWei: "0" },
      nativeAggregateLimitWei: fundingAggregate(exposure), nativeAggregateUsedWei: "0" }; };
  let enabled = true;
  const ledger = { getStorageIdentity: () => { if (!enabled) throw new Error("closed"); return identity; },
    inspectReservation: async () => ({ operation, transaction, state: "broadcast-claimed", prepared, cryptoClaimId, broadcastClaimId }),
    inspectNamespace: async (sender: string) => namespace(sender) } as unknown as GatewayFundingLedger;
  const calls = vi.fn((name: string, args?: Record<string, unknown>) => name === "read_storage_identity" ? Promise.resolve({ data: identity, error: null }) : {
    throwOnError: () => Promise.resolve({ data: null, error: null }), args });
  const authority = new SupabaseAuthority({ rpc: calls } as unknown as SupabaseClient, identity); await authority.init();
  const store = new SupabaseGatewayFundingTerminalObserverStore(ledger, authority);
  const now = 1800000000000, inclusionHash = `0x${"c".repeat(64)}`, anchorHash = `0x${"d".repeat(64)}`;
  const q = (value: string | number) => `0x${BigInt(value).toString(16)}`, signature = parseTransaction(rawTransaction);
  const fetchRead: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string); let result: unknown;
    if (body.method === "eth_chainId") result = q(5042002);
    else if (body.method === "eth_getTransactionByHash") result = { hash: prepared.transactionHash, from: transaction.sender, to: transaction.to, input: transaction.data,
      type: "0x2", chainId: q(transaction.chainId), nonce: "0x0", value: q(transaction.valueWei), gas: q(transaction.gas), maxFeePerGas: q(transaction.maxFeePerGasWei),
      maxPriorityFeePerGas: q(transaction.maxPriorityFeePerGasWei), accessList: [], r: signature.r, s: signature.s, yParity: q(signature.yParity!), blockNumber: "0xa", blockHash: inclusionHash, transactionIndex: "0x0" };
    else if (body.method === "eth_getTransactionReceipt") result = { transactionHash: prepared.transactionHash, from: transaction.sender, to: transaction.to,
      type: "0x2", status: "0x1", gasUsed: "0x100", effectiveGasPrice: "0x1", blockNumber: "0xa", blockHash: inclusionHash, transactionIndex: "0x0" };
    else if (body.method === "eth_getBlockByNumber") result = body.params[0] === "0xa" ? { number: "0xa", hash: inclusionHash, timestamp: q(now / 1000 - 2), transactions: [prepared.transactionHash] }
      : { number: "0xb", hash: anchorHash, timestamp: q(now / 1000 - 1), transactions: [] };
    else throw new Error("unexpected synthetic method");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "Content-Type": "application/json" } });
  };
  const token = await createGatewayFundingReceiptObserverForTrustedComposition(fetchRead, () => now)(request, () => {});
  if (!token) throw new Error("synthetic issuer fixture refused");
  return { store, calls, token, operation, setEnabled: (value: boolean) => { enabled = value; } };
}

describe("protected Supabase funding observer capability", () => {
  it("unseals actual opaque issuer provenance against saved originals and uses only the separate observer client", async () => {
    const f = await fixture(); await f.store.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", f.token);
    expect(f.calls.mock.calls.at(-1)?.[0]).toBe("storage_funding_finalize");
    expect(f.calls.mock.calls.at(-1)?.[1]?.p_expected_identity).toEqual(f.operation.policy.identity);
    const evidence = f.calls.mock.calls.at(-1)?.[1]?.p_evidence as { finalityPolicyDigest: string; receiptStatus: string };
    expect(evidence.finalityPolicyDigest).toBe(GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST); expect(evidence.receiptStatus).toBe("success");
  });
  it("refuses fabricated token or foreign locator before any finalize call", async () => {
    const f = await fixture();
    await expect(f.store.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", {} as VerifiedFundingTerminalObservation)).rejects.toThrow();
    await expect(f.store.appendVerifiedTerminalObservation(randomUUID(), "nativeTransfer", f.token)).rejects.toThrow();
    expect(f.calls.mock.calls.some(([name]) => name === "storage_funding_finalize")).toBe(false);
  });
  it("refuses retained capabilities after close or app authority retirement", async () => {
    const f = await fixture(); f.setEnabled(false);
    await expect(f.store.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", f.token)).rejects.toThrow();
    const g = await fixture(); g.store.close();
    await expect(g.store.appendVerifiedTerminalObservation(g.operation.operationId, "nativeTransfer", g.token)).rejects.toThrow();
  });
});
