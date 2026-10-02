import { afterEach, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each([ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE])("pins caller requirements and signatures to $name before reading a challenge", async profile => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", profile.name);
  const protocol = await import("./protocol");
  const payee = "0x1111111111111111111111111111111111111111";
  const requirement = { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress, amount: "50000", payTo: payee,
    maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } };
  expect(protocol.requirementSchema.parse(requirement)).toEqual(requirement);
  const other = profile === ARC_MAINNET_PROFILE ? ARC_TESTNET_PROFILE : ARC_MAINNET_PROFILE;
  expect(() => protocol.requirementSchema.parse({ ...requirement, network: other.networkId,
    extra: { ...requirement.extra, verifyingContract: other.gatewayWallet } })).toThrow();
  const authorization = protocol.authorizationWithNonce(payee, protocol.requirementSchema.parse(requirement), `0x${"11".repeat(32)}`);
  const typed = protocol.buyerTypedData(authorization);
  expect(typed.domain.chainId).toBe(profile.chainId); expect(typed.domain.verifyingContract).toBe(profile.gatewayWallet);
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", other.name);
  expect(protocol.buyerTypedData(authorization).domain.chainId).toBe(profile.chainId);
});
it("validates retained journals against their original rail without changing current signing authority", async () => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  const { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } = await import("../arc-network-profile");
  const { buyerIntentSchemaForProfile } = await import("./journal");
  const { a2aOrderId } = await import("../a2a/order");
  const protocol = await import("./protocol");
  const payer = `0x${"11".repeat(20)}`, payee = `0x${"22".repeat(20)}`, nonce = `0x${"33".repeat(32)}`;
  const intent = { schema: "keryx-buyer-intent-v1", request: { question: "What evidence supports this claim?", budget: 0.01,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_TESTNET_PROFILE.networkId, asset: ARC_TESTNET_PROFILE.usdcAddress,
      amount: "20000", payTo: payee, maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1",
        verifyingContract: ARC_TESTNET_PROFILE.gatewayWallet } },
    authorization: { from: payer, to: payee, value: "20000", validAfter: "1", validBefore: "604861", nonce },
    queryId: a2aOrderId({ network: ARC_TESTNET_PROFILE.networkId, payer, payee, authorizationId: nonce }) };
  expect(buyerIntentSchemaForProfile(ARC_TESTNET_PROFILE).parse(intent)).toEqual(intent);
  expect(() => buyerIntentSchemaForProfile(ARC_MAINNET_PROFILE).parse(intent)).toThrow();
  expect(() => buyerIntentSchemaForProfile({ ...ARC_TESTNET_PROFILE }).parse(intent)).toThrow();
  expect(protocol.BUYER_PROFILE).toBe(ARC_MAINNET_PROFILE);
});
