/**
 * Custom chain definitions for Keryx. Arc Testnet is registered here so wagmi
 * can prompt wallets to add it via wallet_addEthereumChain automatically.
 *
 * Native currency is USDC (18 decimals on Arc Testnet) — this differs from most
 * EVM chains where ETH is native. Payments settle in this denomination.
 */

import { defineChain } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "./arc-network-profile";
import { browserPaymentProfile } from "./browser-payment-profile";

export const arcTestnet = defineChain({
  id: ARC_TESTNET_PROFILE.chainId,
  name: ARC_TESTNET_PROFILE.label,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: ARC_TESTNET_PROFILE.nativeDecimals },
  rpcUrls: {
    default: { http: [ARC_TESTNET_PROFILE.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: ARC_TESTNET_PROFILE.explorerUrl },
  },
  testnet: ARC_TESTNET_PROFILE.testnet,
});

export const arc = defineChain({ id: ARC_MAINNET_PROFILE.chainId, name: ARC_MAINNET_PROFILE.label,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: ARC_MAINNET_PROFILE.nativeDecimals },
  rpcUrls: { default: { http: [ARC_MAINNET_PROFILE.rpcUrl] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_MAINNET_PROFILE.explorerUrl } }, testnet: false });

/** Canonical local profiles only; never pass a payment challenge or request dictionary. */
export function chainForProfile(profile: ArcNetworkProfile) {
  if (profile === ARC_TESTNET_PROFILE) return arcTestnet;
  if (profile === ARC_MAINNET_PROFILE) return arc;
  throw new Error("untrusted Arc chain profile");
}
export const arcChain = chainForProfile(browserPaymentProfile());
