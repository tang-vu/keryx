import { afterEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, paymentRuntimeProfile, configuredPaymentProfile, configuredRegistryAddress } from "./arc-network-profile";
import { assertArcTestnetConfiguration, config } from "./config";
import { arcTestnet } from "./chains";
import { SESSION_CHAIN_ID, SESSION_GATEWAY, SESSION_USDC } from "./session/session-signing-policy";

afterEach(() => vi.unstubAllEnvs());

describe("trusted Arc profiles and payment release gate", () => {
  it("pins distinct network and contract identities despite shared USDC and domain", () => {
    expect(ARC_MAINNET_PROFILE.chainId).toBe(5042);
    expect(ARC_TESTNET_PROFILE.chainId).toBe(5042002);
    expect(ARC_MAINNET_PROFILE.networkId).not.toBe(ARC_TESTNET_PROFILE.networkId);
    expect(ARC_MAINNET_PROFILE.gatewayWallet).not.toBe(ARC_TESTNET_PROFILE.gatewayWallet);
    expect(ARC_MAINNET_PROFILE.gatewayMinter).not.toBe(ARC_TESTNET_PROFILE.gatewayMinter);
    expect(ARC_MAINNET_PROFILE.gatewayApiUrl).not.toBe(ARC_TESTNET_PROFILE.gatewayApiUrl);
    expect(ARC_MAINNET_PROFILE.usdcAddress).toBe(ARC_TESTNET_PROFILE.usdcAddress);
    expect(ARC_MAINNET_PROFILE.cctpDomain).toBe(26);
    expect(ARC_MAINNET_PROFILE.erc20Decimals).toBe(6);
    expect(ARC_MAINNET_PROFILE.nativeDecimals).toBe(18);
  });

  it("prevents mutation of the profile shared by workers and server verifiers", () => {
    for (const profile of [ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE]) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(() => { Object.assign(profile, { gatewayWallet: ARC_MAINNET_PROFILE.usdcAddress }); }).toThrow();
    }
    expect(SESSION_GATEWAY).toBe("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
  });

  it.each(["arcMainnet", "eip155:5042", "5042", "", "arcTestnet ", "ARCTESTNET"])(
    "refuses unsupported payment runtime selection %j", network => {
      expect(() => paymentRuntimeProfile(network)).toThrow("KERYX_NETWORK must be arc or arcTestnet");
    },
  );

  it("retains the deployed testnet runtime and independently pinned browser policy", () => {
    expect(paymentRuntimeProfile()).toBe(ARC_TESTNET_PROFILE);
    expect(paymentRuntimeProfile("arcTestnet")).toBe(ARC_TESTNET_PROFILE);
    expect(config.networkId).toBe(ARC_TESTNET_PROFILE.networkId);
    expect(config.gatewayWallet).toBe(ARC_TESTNET_PROFILE.gatewayWallet);
    expect(config.gatewayBalanceApi).toBe(`${ARC_TESTNET_PROFILE.gatewayApiUrl}/v1/balances`);
    expect(arcTestnet.id).toBe(SESSION_CHAIN_ID);
    expect(SESSION_USDC).toBe(config.usdcAddress);
  });

  it("refuses a mixed mainnet contract even when the token and chain alias remain testnet", () => {
    expect(() => assertArcTestnetConfiguration({ KERYX_GATEWAY_WALLET: ARC_MAINNET_PROFILE.gatewayWallet }))
      .toThrow("KERYX_GATEWAY_WALLET must match the Arc Testnet profile");
    expect(() => assertArcTestnetConfiguration({ KERYX_GATEWAY_MINTER: ARC_MAINNET_PROFILE.gatewayMinter }))
      .toThrow("KERYX_GATEWAY_MINTER must match the Arc Testnet profile");
  });

  it("does not let server environment choose a browser or worker signing domain", async () => {
    vi.stubEnv("KERYX_NETWORK", "arc");
    vi.resetModules();
    const browser = await import("./browser-payment-profile");
    expect(browser.browserPaymentProfile().chainId).toBe(5042002);
    await expect(import("./config")).rejects.toThrow("must match");
  });

  it("selects canonical mainnet only when the trusted server/public twins agree", () => {
    expect(paymentRuntimeProfile("arc")).toBe(ARC_MAINNET_PROFILE);
    expect(configuredPaymentProfile()).toBe(ARC_TESTNET_PROFILE);
    expect(configuredPaymentProfile("arc", "arc")).toBe(ARC_MAINNET_PROFILE);
    for (const [server, browser] of [["arc",undefined],[undefined,"arc"],["arc","arcTestnet"],["arcTestnet","arc"]])
      expect(() => configuredPaymentProfile(server,browser)).toThrow("must match");
  });

  it("requires mainnet registry twins and refuses zero, missing or mixed authority", () => {
    const registry=`0x${"ab".repeat(20)}`;
    expect(configuredRegistryAddress(ARC_MAINNET_PROFILE,registry,registry)).toBe(registry);
    for(const pair of [[registry,undefined],[undefined,registry],[registry,`0x${"cd".repeat(20)}`],["0x"+"0".repeat(40),"0x"+"0".repeat(40)]])
      expect(()=>configuredRegistryAddress(ARC_MAINNET_PROFILE,...pair as [string|undefined,string|undefined])).toThrow("registry pins");
  });

  it("captures public profile once and selects all mainnet pins with HTTP indexer fallback", async () => {
    vi.stubEnv("KERYX_NETWORK","arc");vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK","arc");
    vi.stubEnv("KERYX_REGISTRY_ADDRESS",`0x${"ab".repeat(20)}`);vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS",`0x${"ab".repeat(20)}`);
    vi.resetModules();const {config:selected}=await import("./config"),browser=await import("./browser-payment-profile"),chains=await import("./chains");
    expect(selected.profile.name).toBe("arc");expect(selected.chainId).toBe(5042);expect(selected.gatewayWallet).toBe(ARC_MAINNET_PROFILE.gatewayWallet);
    expect(selected.gatewayBalanceApi).toBe(`${ARC_MAINNET_PROFILE.gatewayApiUrl}/v1/balances`);expect(selected.rpcWsUrl).toBe("");
    expect(chains.arcChain.id).toBe(5042);vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK","arcTestnet");expect(browser.browserPaymentProfile().chainId).toBe(5042);
  });
});
