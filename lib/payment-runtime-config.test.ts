import { expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "./arc-network-profile";
import { assertPaymentRuntimeConfiguration, paymentRuntimeConfig } from "./payment-runtime-config";
it("pins payment-only mainnet callers without requiring a content registry", () => {
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  try { expect(paymentRuntimeConfig().profile).toBe(ARC_MAINNET_PROFILE);
    expect(paymentRuntimeConfig().gatewayBalanceApi).toBe("https://gateway-api.circle.com/v1/balances"); }
  finally { vi.unstubAllEnvs(); }
  expect(assertPaymentRuntimeConfiguration({})).toBe(ARC_TESTNET_PROFILE);
  expect(() => assertPaymentRuntimeConfiguration({KERYX_NETWORK:"arc"})).toThrow("must match");
  expect(() => assertPaymentRuntimeConfiguration({KERYX_NETWORK:"arc",NEXT_PUBLIC_KERYX_NETWORK:"arc",KERYX_GATEWAY_WALLET:ARC_TESTNET_PROFILE.gatewayWallet})).toThrow("must match");
});
