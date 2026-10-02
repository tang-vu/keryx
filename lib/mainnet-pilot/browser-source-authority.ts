import { createPublicClient, defineChain, http, type Address, type Hex, type Transport } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { REGISTRY_ABI } from "../registry/registry-abi";
import type { VerifiedPublicMainnetEnrollment } from "./public-enrollment";

const profile = ARC_MAINNET_PROFILE;
const chain = defineChain({ id: profile.chainId, name: profile.label,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: profile.nativeDecimals },
  rpcUrls: { default: { http: [profile.rpcUrl] } } });
const refuse = (): never => { throw new Error("mainnet browser source authority unavailable"); };

/** Every authority read is independently attested before and after its response. */
function attested(base: Transport): Transport {
  return parameters => {
    const transport = base(parameters);
    return { ...transport, request: (async (args, options) => {
      if (!["eth_chainId", "eth_getBlockByNumber", "eth_call"].includes(args.method)) refuse();
      const check = async () => { if (await transport.request({ method: "eth_chainId" }) !== profile.chainIdHex) refuse(); };
      await check(); const result = await transport.request(args, options); await check(); return result;
    }) as typeof transport.request };
  };
}

/** Caller holds verified build pins. No server source cache, stale result or unregistered fallback.
 * Mainnet RPC origin is a static profile pin; requests cannot choose a transport or registry.
 */
export function createMainnetBrowserSourceAuthority(verified: VerifiedPublicMainnetEnrollment) {
  const e = verified.enrollment;
  return Object.freeze({
    async read(sourceId: string) {
      if (!e.approvedSourceIds.includes(sourceId)) refuse();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const client = createPublicClient({ chain, transport: attested(http(profile.rpcUrl, { timeout: 4000, retryCount: 0,
          fetchOptions: { signal: controller.signal, credentials: "omit", redirect: "error" } })) });
        const block = await client.getBlock({ blockTag: "latest" });
        if (block.number === null || block.hash === null) refuse();
        const record = await client.readContract({ address: e.registryAddress as Address, abi: REGISTRY_ABI,
          functionName: "get", args: [sourceId as Hex], blockNumber: block.number });
        const recheck = await client.getBlock({ blockNumber: block.number });
        const creator = record.creator.toLowerCase(), payout = record.payoutWallet.toLowerCase();
        if (controller.signal.aborted || recheck.hash !== block.hash || !record.active ||
          !e.approvedCreatorAddresses.includes(creator) || !e.approvedPayoutAddresses.includes(payout) ||
          record.fetchPriceUsdc6 <= BigInt(0) || record.fetchPriceUsdc6 > BigInt(e.limits.perPaymentMicros) ||
          record.authors.length < 1 || record.authors.length > 5 ||
          new Set(record.authors.map(a => a.wallet.toLowerCase())).size !== record.authors.length ||
          record.authors.reduce((sum, a) => sum + a.basisPoints, 0) !== 10000 ||
          record.authors.some(a => a.basisPoints <= 0 || !e.approvedPayoutAddresses.includes(a.wallet.toLowerCase()))) refuse();
        return Object.freeze({ sourceId, creator, payout, fetchPriceMicroUsdc: record.fetchPriceUsdc6,
          payees: Object.freeze([payout, ...record.authors.map(a => a.wallet.toLowerCase())]) });
      } catch { return refuse(); }
      finally { clearTimeout(timeout); controller.abort(); }
    },
  });
}
