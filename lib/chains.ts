/**
 * Custom chain definitions for Keryx. Arc Testnet is registered here so wagmi
 * can prompt wallets to add it via wallet_addEthereumChain automatically.
 *
 * Native currency is USDC (18 decimals on Arc Testnet) — this differs from most
 * EVM chains where ETH is native. Payments settle in this denomination.
 */

import { defineChain } from "viem";
import { ARC_TESTNET_PROFILE } from "./arc-network-profile";

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
