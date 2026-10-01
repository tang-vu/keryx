import { describe, expect, it, vi } from "vitest";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "../db/storage-identity";
import { assertFundingStepTransition, assertGatewayFundingReplay, gatewayFundingExposure,
  gatewayFundingReplayDigest, reserveFundingExposure, validateGatewayFundingOperation } from "./gateway-funding-policy";

function operation() {
  return { format: "gateway-funding-operation-v1", policy: { format: "gateway-funding-policy-v1",
    identity: { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
      storageId: "22222222-2222-4222-8222-222222222222", network: "eip155:5042002", authorityMode: "testnet-real",
      profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, enrollmentId: "33333333-3333-4333-8333-333333333333",
      enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) },
    policyId: "44444444-4444-4444-8444-444444444444", funder: `0x${"1".repeat(40)}`, spend: `0x${"2".repeat(40)}`,
    lifetimeLimits: { nativeWei: "100", usdcMicros: "200", depositMicros: "200", gasWei: "800" },
    maxTransactionGas: "10", maxFeePerGasWei: "20" },
    operationId: "55555555-5555-4555-8555-555555555555", ownerAuthorizationId: "66666666-6666-4666-8666-666666666666",
    ownerAuthorizationDigest: "b".repeat(64), minimumAvailableMicros: "100", initialAvailableMicros: "0",
    nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
    gasLimits: { nativeTransfer: "10", usdcTransfer: "10", approval: "10", deposit: "10" },
    maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" };
}
describe("proposed pure Gateway funding policy", () => {
  it("copies and freezes exact terms without trusting later caller mutation", () => {
    const input = operation(), checked = validateGatewayFundingOperation(input), digest = gatewayFundingReplayDigest(checked);
    input.policy.identity.storageId = "77777777-7777-4777-8777-777777777777"; input.gasLimits.deposit = "1";
    expect(gatewayFundingReplayDigest(checked)).toBe(digest);
    expect(Object.isFrozen(checked.policy.identity)).toBe(true); expect(Object.isFrozen(checked.gasLimits)).toBe(true);
    expect(gatewayFundingExposure(checked)).toEqual({ nativeWei: "50", usdcMicros: "100", depositMicros: "100", gasWei: "400" });
  });
  it("permits reordered JSON keys but rejects changed identity, authorization, terms or policy", () => {
    const first = operation(), reordered = Object.fromEntries(Object.entries(first).reverse());
    expect(() => assertGatewayFundingReplay(first, reordered)).not.toThrow();
    for (const mutate of [
      (v: ReturnType<typeof operation>) => { v.ownerAuthorizationDigest = "c".repeat(64); },
      (v: ReturnType<typeof operation>) => { v.operationId = "77777777-7777-4777-8777-777777777777"; },
      (v: ReturnType<typeof operation>) => { v.minimumAvailableMicros = "99"; },
      (v: ReturnType<typeof operation>) => { v.policy.identity.storageId = "77777777-7777-4777-8777-777777777777"; },
      (v: ReturnType<typeof operation>) => { v.policy.lifetimeLimits.gasWei = "900"; },
    ]) { const changed = operation(); mutate(changed); expect(() => assertGatewayFundingReplay(first, changed)).toThrow(); }
  });
  it.each([0, 100, BigInt(100), "01", "-1", "1.0", "1e2", " 100", "NaN", "Infinity", (BigInt(2) ** BigInt(256)).toString()])(
    "refuses noncanonical or overflowing amount %s", value => {
      expect(() => validateGatewayFundingOperation({ ...operation(), depositMicros: value })).toThrow();
    });
  it("rejects coercion/accessors/extra fields before reading them", () => {
    const getter = vi.fn(() => "100"), value = operation();
    Object.defineProperty(value, "depositMicros", { get: getter, enumerable: true });
    expect(() => validateGatewayFundingOperation(value)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const toString = vi.fn(() => "100"); expect(() => validateGatewayFundingOperation({ ...operation(), depositMicros: { toString } })).toThrow();
    expect(toString).not.toHaveBeenCalled(); expect(() => validateGatewayFundingOperation({ ...operation(), automatic: true })).toThrow();
    const nested = operation(); Object.defineProperty(nested.policy.lifetimeLimits, "gasWei", { get: getter, enumerable: true });
    expect(() => validateGatewayFundingOperation(nested)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it("refuses hostile delimiter keys, inherited records and coerced transition states", () => {
    const hostile = operation() as unknown as Record<string, unknown>;
    delete hostile.approvalMicros; delete hostile.depositMicros;
    hostile["approvalMicros,depositMicros"] = "100";
    expect(() => validateGatewayFundingOperation(hostile)).toThrow();
    expect(() => validateGatewayFundingOperation(Object.create(operation()))).toThrow();
    const toString = vi.fn(() => "reserved"), state = { toString };
    expect(() => assertFundingStepTransition(state as never, state as never)).toThrow();
    expect(toString).not.toHaveBeenCalled();
  });
  it("refuses offline/foreign profile and monetary/fee contradictions", () => {
    for (const mutate of [
      (v: ReturnType<typeof operation>) => { v.policy.identity.authorityMode = "testnet-offline"; },
      (v: ReturnType<typeof operation>) => { v.policy.identity.network = "eip155:1"; },
      (v: ReturnType<typeof operation>) => { v.policy.identity.profileDigest = "c".repeat(64); },
      (v: ReturnType<typeof operation>) => { v.policy.funder = v.policy.spend; },
      (v: ReturnType<typeof operation>) => { v.approvalMicros = "101"; },
      (v: ReturnType<typeof operation>) => { v.usdcTransferMicros = "101"; },
      (v: ReturnType<typeof operation>) => { v.minimumAvailableMicros = "101"; },
      (v: ReturnType<typeof operation>) => { v.maxPriorityFeePerGasWei = "11"; },
      (v: ReturnType<typeof operation>) => { v.gasLimits.deposit = "11"; },
      (v: ReturnType<typeof operation>) => { v.policy.lifetimeLimits.gasWei = "399"; },
    ]) { const changed = operation(); mutate(changed); expect(() => validateGatewayFundingOperation(changed)).toThrow(); }
  });
  it("refuses uint256 addition and gas-product overflow", () => {
    const max = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
    const limits = { nativeWei: max, usdcMicros: max, depositMicros: max, gasWei: max };
    expect(() => reserveFundingExposure(limits, { ...limits, nativeWei: max }, { ...limits, nativeWei: "1" })).toThrow();
    const changed = operation(); changed.policy.maxTransactionGas = max; changed.gasLimits.deposit = max;
    expect(() => validateGatewayFundingOperation(changed)).toThrow();
    const product = operation(); product.policy.maxTransactionGas = "1000000";
    product.gasLimits = { nativeTransfer: "1000000", usdcTransfer: "1000000", approval: "1000000", deposit: "1000000" };
    product.policy.maxFeePerGasWei = max; product.maxFeePerGasWei = max; product.policy.lifetimeLimits.gasWei = max;
    expect(() => validateGatewayFundingOperation(product)).toThrow();
  });
  it("charges lifetime exposure again after success/revert/expiry; no terminal path reopens a cap", () => {
    const terms = operation(), requested = gatewayFundingExposure(terms);
    const once = reserveFundingExposure(terms.policy.lifetimeLimits, { nativeWei: "0", usdcMicros: "0", depositMicros: "0", gasWei: "0" }, requested);
    const twice = reserveFundingExposure(terms.policy.lifetimeLimits, once, requested);
    expect(twice).toEqual(terms.policy.lifetimeLimits);
    expect(() => reserveFundingExposure(terms.policy.lifetimeLimits, twice, requested)).toThrow();
    for (const state of ["finalized-success", "finalized-reverted", "unresolved", "cancelled-unexposed"] as const) {
      expect(() => assertFundingStepTransition(state, "reserved")).toThrow();
      expect(() => assertFundingStepTransition(state, "crypto-claimed")).toThrow();
      expect(() => assertFundingStepTransition(state, "broadcast-claimed")).toThrow();
    }
  });
  it("allows forward evidence transitions without making cancellation or replay permission", () => {
    expect(() => assertFundingStepTransition("reserved", "cancelled-unexposed")).not.toThrow();
    expect(() => assertFundingStepTransition("crypto-claimed", "cancelled-unexposed")).toThrow();
    expect(() => assertFundingStepTransition("broadcast-claimed", "unresolved")).not.toThrow();
    expect(() => assertFundingStepTransition("unresolved", "finalized-reverted")).not.toThrow();
    expect(() => assertFundingStepTransition("prepared", "prepared")).not.toThrow();
  });
});
