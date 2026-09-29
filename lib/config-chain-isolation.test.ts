import { afterEach, describe, expect, it, vi } from "vitest";
import { assertArcTestnetConfiguration, config } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("Arc testnet configuration isolation", () => {
  it("accepts the deployed testnet profile with case-insensitive addresses", () => {
    expect(() => assertArcTestnetConfiguration({})).not.toThrow();
    expect(() => assertArcTestnetConfiguration({
      KERYX_NETWORK: "arcTestnet",
      KERYX_USDC_ADDRESS: config.usdcAddress.toUpperCase(),
      KERYX_GATEWAY_WALLET: config.gatewayWallet.toLowerCase(),
      KERYX_GATEWAY_MINTER: config.gatewayMinter.toLowerCase(),
    })).not.toThrow();
  });

  it.each([
    [{ KERYX_NETWORK: "arc" }, "KERYX_NETWORK"],
    [{ KERYX_USDC_ADDRESS: "0x0000000000000000000000000000000000000001" }, "KERYX_USDC_ADDRESS"],
    [{ KERYX_GATEWAY_WALLET: "0x0000000000000000000000000000000000000002" }, "KERYX_GATEWAY_WALLET"],
    [{ KERYX_GATEWAY_MINTER: "0x0000000000000000000000000000000000000003" }, "KERYX_GATEWAY_MINTER"],
  ])("rejects a conflicting network setting %o", (env, name) => {
    expect(() => assertArcTestnetConfiguration(env)).toThrow(`${name} must`);
  });

  it("fails module initialization for a conflicting deployment override", async () => {
    vi.stubEnv("KERYX_GATEWAY_WALLET", "0x0000000000000000000000000000000000000002");
    vi.resetModules();
    await expect(import("./config")).rejects.toThrow("KERYX_GATEWAY_WALLET must");
  });
});
