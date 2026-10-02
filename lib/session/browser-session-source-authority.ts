import { createPublicClient, http, type Address, type Hex, type Transport } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { browserRegistryReadAddress } from "../browser-payment-profile";
import { REGISTRY_ABI } from "../registry/registry-abi";
import type { SourcePaymentAuthority } from "../payments/client-payto-allowlist";

const refuse = (): never => { throw new Error("Mainnet source authority unavailable"); };
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
/** Build-pinned mainnet registry, independently chain-attested fresh snapshot; no DB payTo
 * fallback, stale cache, request-selected RPC or participant whitelist.
 */
export async function readBrowserMainnetSource(registryId: string): Promise<SourcePaymentAuthority> {
  if (!/^0x[0-9a-f]{64}$/.test(registryId)) refuse();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const client = createPublicClient({ chain: chainForProfile(profile), transport: attested(http(profile.rpcUrl,
      { timeout: 4000, retryCount: 0, fetchOptions: { signal: controller.signal, credentials: "omit", redirect: "error" } })) });
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.hash === null) refuse();
    const record = await client.readContract({ address: browserRegistryReadAddress() as Address, abi: REGISTRY_ABI,
      functionName: "get", args: [registryId as Hex], blockNumber: block.number });
    const recheck = await client.getBlock({ blockNumber: block.number });
    const creator = record.creator.toLowerCase(), payout = record.payoutWallet.toLowerCase();
    const nonzero = (a: string) => /^0x[0-9a-f]{40}$/.test(a) && !/^0x0{40}$/.test(a);
    if (controller.signal.aborted || recheck.hash !== block.hash || !record.active || !nonzero(creator) || !nonzero(payout) ||
      record.fetchPriceUsdc6 > BigInt(Number.MAX_SAFE_INTEGER) || record.authors.length < 1 || record.authors.length > 5 ||
      new Set(record.authors.map(a => a.wallet.toLowerCase())).size !== record.authors.length ||
      record.authors.reduce((sum, a) => sum + a.basisPoints, 0) !== 10000 ||
      record.authors.some(a => a.basisPoints <= 0 || !nonzero(a.wallet.toLowerCase()))) refuse();
    return Object.freeze({ creator, fetchPayTo: payout, listPriceUsdc: Number(record.fetchPriceUsdc6) / 1e6,
      wallets: new Set([payout, ...record.authors.map(a => a.wallet.toLowerCase())]), onchain: true, active: true });
  } catch { return refuse(); }
  finally { clearTimeout(timeout); controller.abort(); }
}
