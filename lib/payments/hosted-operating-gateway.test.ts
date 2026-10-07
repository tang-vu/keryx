import { beforeEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { operatingFeeEndpointPath, operatingFeePolicyDigest, type OperatingFeeContext } from "./operating-fee-policy";
import { pendingPaymentFrom, settledPaymentFrom } from "./payment-state";
import type { KeryxDB } from "../db/keryx-db";

const state = vi.hoisted(() => ({ transport: vi.fn(), configured: vi.fn(), policy: vi.fn(), available: vi.fn() }));
vi.mock("../config", async () => ({ config: { profile: (await import("../arc-network-profile")).ARC_MAINNET_PROFILE,
  networkId: "eip155:5042", baseUrl: "https://keryx.cc", rpcUrl: "https://rpc.invalid", maxTimeoutSeconds: 604900 } }));
vi.mock("../db/application-storage", () => ({ applicationSqliteIdentity: () => ({}) }));
vi.mock("./hosted-treasury-policy", async original => ({ ...await original<object>(), configuredHostedTreasuryPolicy: state.policy }));
vi.mock("./operating-fee-policy", async original => ({ ...await original<object>(), configuredOperatingFeePolicy: state.configured }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.available }));
vi.mock("./server-x402-client", () => ({ payWithServerSigner: state.transport }));
import { createMainnetHostedGateway } from "./mainnet-hosted-gateway";

const key = `0x${"11".repeat(32)}` as const, signer = privateKeyToAccount(key).address.toLowerCase();
const feePolicy = { format: "keryx-operating-fee-policy-v1" as const, network: "eip155:5042" as const,
  origin: "https://keryx.cc", beneficiary: `0x${"22".repeat(20)}`, storageIdentityDigest: "a".repeat(64), expiresAtSeconds: 2_000_000_000 };
const hostedPolicy = { format: "keryx-hosted-treasury-policy-v1", network: ARC_MAINNET_PROFILE.networkId, origin: "https://keryx.cc",
  signer, queryCapMicroUsdc: "50000", lifetimeCapMicroUsdc: "100000", expiresAtSeconds: 2_000_000_000, storageIdentityDigest: "a".repeat(64) };
const fee: OperatingFeeContext = { policyDigest: operatingFeePolicyDigest(feePolicy), allocationDigest: "b".repeat(64), amountMicroUsdc: "25000",
  sourceUrls: ["https://publisher.test/article"] };
beforeEach(() => {
  vi.clearAllMocks(); state.policy.mockReturnValue(hostedPolicy); state.configured.mockReturnValue(feePolicy); state.available.mockResolvedValue(BigInt(100000));
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY", key);
});
it.each(["settled", "pending", "settled-undelivered"] as const)("retains the actual %s original without reclassifying the fee as creator payment", async status => {
  const db = { admitHostedTreasuryPolicy: vi.fn(), hostedTreasuryAccounting: vi.fn(async () => ({ retainedMicroUsdc: "0", confirmedMicroUsdc: "0" })),
    submitHostedAuthorization: vi.fn(), confirmHostedAuthorization: vi.fn() };
  const nonce = `0x${"33".repeat(32)}`, expires = "2030-01-01T00:00:00.000Z";
  state.transport.mockImplementationOnce(async input => {
    await input.beforeSignedSubmit({ authorizationId: nonce }, `0x${"44".repeat(32)}`);
    return { delivered: status === "settled", settlementStatus: status === "pending" ? "pending" : "settled",
      transaction: status === "pending" ? null : "synthetic-circle-reference", authorizationId: nonce,
      authorizationExpiresAt: expires, amountUsdc: 0.025 };
  });
  const gateway = await createMainnetHostedGateway(db as unknown as KeryxDB);
  await gateway.ensureFunded(0.05);
  let payment;
  try { payment = await gateway.payOperatingFee({ queryId: "query", operatingFee: fee }); }
  catch (error) { payment = settledPaymentFrom(error) ?? pendingPaymentFrom(error); if (!payment) throw error; }
  expect(payment).toMatchObject({ kind: "operating-fee", sourceId: "keryx:operating-fee", queryId: "query", payee: feePolicy.beneficiary,
    payer: signer, amountUsdc: 0.025, settlementStatus: status === "pending" ? "pending" : "settled", authorizationId: nonce });
  expect(state.transport).toHaveBeenCalledOnce();
  expect(state.transport.mock.lastCall?.[0].url).toBe(`https://keryx.cc${operatingFeeEndpointPath("query", fee)}`);
  expect(db.submitHostedAuthorization).toHaveBeenCalledOnce();
  expect(db.confirmHostedAuthorization).toHaveBeenCalledTimes(status === "pending" ? 0 : 1);
});
it("refuses changed fee terms before any payment transport", async () => {
  const gateway = await createMainnetHostedGateway({ admitHostedTreasuryPolicy: vi.fn() } as unknown as KeryxDB);
  await expect(gateway.payOperatingFee({ queryId: "query", operatingFee: { ...fee, policyDigest: "c".repeat(64) } })).rejects.toThrow("policy changed");
  expect(state.transport).not.toHaveBeenCalled();
});
it("retains real receipt evidence and marks durable confirmation recovery after a failed journal write", async () => {
  const db = { admitHostedTreasuryPolicy: vi.fn(), hostedTreasuryAccounting: vi.fn(async () => ({ retainedMicroUsdc: "0", confirmedMicroUsdc: "0" })),
    submitHostedAuthorization: vi.fn(), confirmHostedAuthorization: vi.fn().mockRejectedValue(new Error("write unavailable")) };
  const nonce = `0x${"33".repeat(32)}`;
  state.transport.mockImplementationOnce(async input => {
    await input.beforeSignedSubmit({ authorizationId: nonce }, `0x${"44".repeat(32)}`);
    return { delivered: true, settlementStatus: "settled", transaction: "synthetic-circle-reference",
      authorizationId: nonce, authorizationExpiresAt: "2030-01-01T00:00:00.000Z", amountUsdc: 0.025 };
  });
  const gateway = await createMainnetHostedGateway(db as unknown as KeryxDB);
  await gateway.ensureFunded(0.05);
  const payment = await gateway.payOperatingFee({ queryId: "query", operatingFee: fee });
  expect(payment).toMatchObject({ settled: true, txHash: "synthetic-circle-reference", authorizationId: nonce });
  expect(payment.rationale).toContain("Durable confirmation requires recovery");
  expect(state.transport).toHaveBeenCalledOnce();
});
