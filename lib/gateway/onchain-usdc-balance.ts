/**
 * Reads plain on-chain USDC balances on Arc — the other place a creator's money can be.
 *
 * The settlement check compares Keryx's payout ledger against Circle's Gateway, but a Gateway
 * balance is the creator's own account in a non-custodial product: they can move it out at any
 * time, through this app, the `circle` CLI, or anything else that can sign for their wallet. When
 * they do, the Gateway goes light and Keryx's books — which only record cash-outs Keryx itself
 * performed — read as a shortfall for money that is sitting safely in the creator's wallet.
 *
 * So a shortfall gets a second look here. Gateway + on-chain together are the whole of what a
 * payout could have become, and only a gap that survives both is worth anyone's attention.
 *
 * Returns whole USDC keyed by lowercased address; null for any address the RPC would not answer
 * for — an unreachable node must never read as an empty wallet.
 */

import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { arcTestnet } from "../chains";
import { config } from "../config";

export async function getOnchainUsdcBalances(
  addresses: string[],
): Promise<Map<string, number | null>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, number | null>(unique.map((a) => [a, null]));
  if (unique.length === 0) return out;

  const client = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });

  // Sequential on purpose: this only ever runs for the handful of wallets that came up short,
  // and a public testnet RPC is happier with a trickle than with a burst.
  for (const address of unique) {
    try {
      const raw = await client.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Address],
      });
      out.set(address, Number(raw) / 1e6); // ERC-20 USDC on Arc is 6 decimals
    } catch {
      /* leave null — unknown, not zero */
    }
  }
  return out;
}
