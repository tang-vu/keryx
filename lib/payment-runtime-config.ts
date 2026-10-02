import { configuredPaymentProfile } from "./arc-network-profile";
import { browserPaymentProfile } from "./browser-payment-profile";

export type PaymentRuntimeEnvironment = {
  KERYX_NETWORK?: string; NEXT_PUBLIC_KERYX_NETWORK?: string;
  KERYX_USDC_ADDRESS?: string; KERYX_GATEWAY_WALLET?: string; KERYX_GATEWAY_MINTER?: string;
  KERYX_FORCE_OFFLINE?: string;
};
/** Payment-only callers need no content registry. Startup rail and contract pins still apply. */
export function assertPaymentRuntimeConfiguration(env: PaymentRuntimeEnvironment) {
  const profile = configuredPaymentProfile(env.KERYX_NETWORK, env.NEXT_PUBLIC_KERYX_NETWORK);
  if (!profile.testnet && env.KERYX_FORCE_OFFLINE === "1") throw new Error("mainnet profile cannot enable offline payment bypass");
  for (const [name, actual, expected] of [
    ["KERYX_USDC_ADDRESS", env.KERYX_USDC_ADDRESS, profile.usdcAddress],
    ["KERYX_GATEWAY_WALLET", env.KERYX_GATEWAY_WALLET, profile.gatewayWallet],
    ["KERYX_GATEWAY_MINTER", env.KERYX_GATEWAY_MINTER, profile.gatewayMinter],
  ] as const) if (actual !== undefined && actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${name} must match the ${profile.label} profile`);
  return profile;
}
/** No private values or registry startup dependency in browser builds. Node strictly checks
 * matching public/server rails; endpoints and contracts come from immutable canonical pins.
 */
export function paymentRuntimeConfig() {
  const profile = typeof process !== "undefined" && process.release?.name === "node" ? assertPaymentRuntimeConfiguration({
    KERYX_NETWORK: process.env.KERYX_NETWORK, NEXT_PUBLIC_KERYX_NETWORK: process.env.NEXT_PUBLIC_KERYX_NETWORK,
    KERYX_USDC_ADDRESS: process.env.KERYX_USDC_ADDRESS, KERYX_GATEWAY_WALLET: process.env.KERYX_GATEWAY_WALLET,
    KERYX_GATEWAY_MINTER: process.env.KERYX_GATEWAY_MINTER, KERYX_FORCE_OFFLINE: process.env.KERYX_FORCE_OFFLINE,
  }) : browserPaymentProfile();
  return Object.freeze({ profile, network: profile.name, networkId: profile.networkId, chainId: profile.chainId,
    rpcUrl: profile.rpcUrl, gatewayBalanceApi: `${profile.gatewayApiUrl}/v1/balances`, gatewayApiUrl: profile.gatewayApiUrl,
    usdcAddress: profile.usdcAddress, gatewayWallet: profile.gatewayWallet, gatewayMinter: profile.gatewayMinter,
    cctpDomain: profile.cctpDomain, explorerUrl: profile.explorerUrl });
}
