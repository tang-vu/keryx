import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { SupabaseAuthority } from "./supabase-authority";
import { SupabaseGatewayFundingLedger, SupabaseGatewayFundingTerminalObserverStore } from "./gateway-funding-supabase";
import type { GatewayFundingLedger, VerifiedFundingTerminalObservation } from "./gateway-funding-ledger-types";
import { prepareGatewayFundingTransaction, type SignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { validateGatewayFundingOperation } from "../payments/gateway-funding-policy";

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
  const prepared: SignedGatewayFundingTransaction = { format: "gateway-funding-signed-transaction-v1", transaction, rawTransaction, transactionHash: keccak256(rawTransaction) };
  const cryptoClaimId = randomUUID(), broadcastClaimId = randomUUID();
  let snapshot: unknown = { operation, transaction, state: "prepared", cryptoClaimId, prepared };
  const calls = vi.fn((name: string, args?: Record<string, unknown>) => ({ throwOnError: () => Promise.resolve({ data:
    name === "read_storage_identity" ? identity : name === "storage_funding_claim_broadcast" ? { fresh: false, claimId: broadcastClaimId,
      reservation: { ...(snapshot as object), broadcastClaimId, state: "broadcast-claimed" } } : name === "storage_funding_inspect_operation" ? operation : snapshot,
    error: null }), then: (resolve: (v: unknown) => void) => Promise.resolve({ data: identity, error: null }).then(resolve), args }));
  const authority = new SupabaseAuthority({ rpc: calls } as unknown as SupabaseClient, identity);
  await authority.init();
  const ledger = new SupabaseGatewayFundingLedger(authority);
  return { ledger, authority, calls, operation, transaction, prepared, cryptoClaimId, broadcastClaimId, spend, setSnapshot: (value: unknown) => { snapshot = value; } };
}

describe("Supabase funding original readback", () => {
  it("validates actual signed bytes on inspection and non-fresh broadcast replay", async () => {
    const f = await fixture();
    expect((await f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer"))?.prepared).toEqual(f.prepared);
    const claim = await f.ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", f.broadcastClaimId);
    expect(claim.fresh).toBe(false); expect(claim.reservation.prepared?.rawTransaction).toBe(f.prepared.rawTransaction);
    expect(f.calls.mock.calls.at(-1)?.[1]?.p_expected_identity).toEqual(f.operation.policy.identity);
  });
  it.each(["hash", "bytes", "foreign-sender"])("refuses structurally shaped %s readback before publishing claim or snapshot", async kind => {
    const f = await fixture(); let raw = f.prepared.rawTransaction;
    if (kind === "bytes") raw = `0x${raw.slice(2, -2)}${raw.endsWith("00") ? "01" : "00"}`;
    if (kind === "foreign-sender") raw = await f.spend.signTransaction(parseTransaction(f.transaction.serializedUnsigned));
    const prepared = { ...f.prepared, rawTransaction: raw, transactionHash: kind === "hash" ? `0x${"0".repeat(64)}` : keccak256(raw) };
    f.setSnapshot({ operation: f.operation, transaction: f.transaction, state: "prepared", cryptoClaimId: f.cryptoClaimId, prepared });
    await expect(f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer")).rejects.toThrow();
    await expect(f.ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", f.broadcastClaimId)).rejects.toThrow();
  });
  it("refuses wrong full identity and unknown/accessor snapshot fields without invoking getters", async () => {
    const f = await fixture(), getter = vi.fn();
    f.setSnapshot({ operation: { ...f.operation, policy: { ...f.operation.policy, identity: { ...f.operation.policy.identity, storageId: randomUUID() } } }, transaction: f.transaction, state: "reserved" });
    await expect(f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer")).rejects.toThrow();
    const value = { operation: f.operation, transaction: f.transaction, state: "reserved" };
    Object.defineProperty(value, "prepared", { enumerable: true, get: getter }); f.setSnapshot(value);
    await expect(f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer")).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
    f.setSnapshot({ ...value, extraAuthority: true });
    await expect(f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer")).rejects.toThrow();
  });
  it("retained helper refuses work after close", async () => {
    const f = await fixture(); f.ledger.close(); const before = f.calls.mock.calls.length;
    await expect(f.ledger.inspectReservation(f.operation.operationId, "nativeTransfer")).rejects.toThrow("Gateway funding ledger refused");
    expect(f.calls).toHaveBeenCalledTimes(before);
  });
  it("protected terminal store refuses a fabricated TypeScript token before any finalization RPC", async () => {
    const f = await fixture();
    const ledger = { getStorageIdentity: () => f.operation.policy.identity,
      inspectReservation: async () => ({ operation: f.operation, transaction: f.transaction, state: "broadcast-claimed", prepared: f.prepared,
        cryptoClaimId: f.cryptoClaimId, broadcastClaimId: f.broadcastClaimId }),
      inspectNamespace: async () => ({ finalityPolicyDigest: "e".repeat(64) }) } as unknown as GatewayFundingLedger;
    const store = new SupabaseGatewayFundingTerminalObserverStore(ledger, f.authority);
    await expect(store.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", {} as VerifiedFundingTerminalObservation)).rejects.toThrow("Funding receipt observation refused");
    expect(f.calls.mock.calls.some(([name]) => name === "storage_funding_finalize")).toBe(false);
    store.close();
    await expect(store.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", {} as VerifiedFundingTerminalObservation)).rejects.toThrow("Gateway funding ledger refused");
  });
});
