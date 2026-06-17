/**
 * Custom chain definitions for Keryx. Arc Testnet is registered here so wagmi
 * can prompt wallets to add it via wallet_addEthereumChain automatically.
 *
 * Native currency is USDC (18 decimals on Arc Testnet) — this differs from most
 * EVM chains where ETH is native. Payments settle in this denomination.
 */

import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
