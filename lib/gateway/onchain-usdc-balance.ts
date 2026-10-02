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

import { createPublicClient, erc20Abi, type Address } from "viem";
import { chainForProfile } from "../chains";
import { paymentRuntimeConfig } from "../payment-runtime-config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { attestedArcHttp, attestedArcAuthorityHttp } from "../arc-rpc-attestation";

export async function getOnchainUsdcBalances(
  addresses: string[], profile:ArcNetworkProfile=paymentRuntimeConfig().profile,
): Promise<Map<string, number | null>> {
  if(profile!==ARC_MAINNET_PROFILE && profile!==ARC_TESTNET_PROFILE) throw new Error("Untrusted payout read profile");
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, number | null>(unique.map((a) => [a, null]));
  if (unique.length === 0) return out;

  const selected=paymentRuntimeConfig();
  const rpc=profile===selected.profile?selected.rpcUrl:profile.rpcUrl;
  const transport = profile===ARC_MAINNET_PROFILE ? attestedArcAuthorityHttp(rpc,{retryCount:0,timeout:4000},profile) : attestedArcHttp(rpc,undefined,profile);
  const client = createPublicClient({ chain: chainForProfile(profile), transport });

  // Sequential on purpose: this only ever runs for the handful of wallets that came up short,
  // and a public RPC is happier with a trickle than with a burst.
  for (const address of unique) {
    try {
      const raw = await client.readContract({
        address: profile.usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Address],
      });
      if(raw < BigInt(0) || raw > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Payout balance cannot be represented exactly");
      out.set(address, Number(raw) / 1e6); // ERC-20 USDC on Arc is 6 decimals
    } catch {
      /* leave null — unknown, not zero */
    }
  }
  return out;
}
