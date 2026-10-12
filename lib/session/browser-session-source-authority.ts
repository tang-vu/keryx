import { createPublicClient, http, keccak256, type Address, type Hex, type Transport } from "viem";
import { z } from "zod";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { browserRegistryReadAddress } from "../browser-payment-profile";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "../registry/registry-abi";
import type { SourcePaymentAuthority } from "../payments/client-payto-allowlist";
import { sourceRegistryAuthoritySchema } from "../registry/source-registry-authority-schema";
import { browserSourceRegistryAuthorityForSource } from "../registry/browser-source-registry-authority";
import { sessionJson } from "./browser-session-http";

const refuse = (): never => { throw new Error("Mainnet source authority unavailable"); };
function attested(base: Transport): Transport {
  return parameters => {
    const transport = base(parameters);
    return { ...transport, request: (async (args, options) => {
      if (!["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(args.method)) refuse();
      const check = async () => { if (await transport.request({ method: "eth_chainId" }) !== profile.chainIdHex) refuse(); };
      await check(); const result = await transport.request(args, options); await check(); return result;
    }) as typeof transport.request };
  };
}
const sourceIndex = z.array(z.object({ id: z.string().min(1).max(256),
  onchainId: z.string().regex(/^0x[0-9a-f]{64}$/).optional(), registryAuthority: sourceRegistryAuthoritySchema.optional() })).max(1000);
/** Build-pinned mainnet origin, independently chain-attested fresh snapshot; no DB payTo
 * fallback, stale cache, request-selected RPC or participant whitelist.
 */
export async function readBrowserMainnetSource(registryId: string): Promise<SourcePaymentAuthority> {
  return createMainnetSourceAuthorityReader(sessionJson)(registryId);
}
/** The hosted catalog selects a bound origin; an ID or API response cannot enroll a registry.
 * CLI composition supplies its authenticated catalog transport and reviewed configured RPC.
 */
export function createMainnetSourceAuthorityReader(
  json: (path: string) => Promise<unknown>, rpcUrl: string = profile.rpcUrl
): (registryId: string) => Promise<SourcePaymentAuthority> {
  return registryId => readMainnetSource(registryId, json, rpcUrl);
}
async function readMainnetSource(registryId: string, json: (path: string) => Promise<unknown>, rpcUrl: string): Promise<SourcePaymentAuthority> {
  if (!/^0x[0-9a-f]{64}$/.test(registryId)) refuse();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  let onAbort: () => void = () => {};
  try {
    const body = await Promise.race([json("/api/sources"), new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Mainnet source authority unavailable"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    })]);
    const sources = sourceIndex.parse(Array.isArray(body) ? body : (body as { sources?: unknown })?.sources);
    const matches = sources.filter(source => source.onchainId === registryId);
    if (matches.length !== 1 || controller.signal.aborted) refuse();
    const origin = browserSourceRegistryAuthorityForSource(matches[0], profile);
    if (origin && origin.network !== profile.networkId) refuse();
    const registry = origin?.address ?? browserRegistryReadAddress();
    const client = createPublicClient({ chain: chainForProfile(profile), transport: attested(http(rpcUrl,
      { timeout: 4000, retryCount: 0, fetchOptions: { signal: controller.signal, credentials: "omit", redirect: "error" } })) });
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.hash === null) refuse();
    if (origin) {
      if (block.number < BigInt(origin.deployBlock)) refuse();
      const code = await client.getCode({ address: origin.address, blockNumber: block.number });
      if (!code || code === "0x" || keccak256(code) !== origin.codeHash) refuse();
      if (origin.version !== 1 && await client.readContract({ address: origin.address, abi: REVISIONED_REGISTRY_ABI,
        functionName: "registryVersion", blockNumber: block.number }) !== origin.version) refuse();
    }
    const record = await client.readContract({ address: registry as Address, abi: REGISTRY_ABI,
      functionName: "get", args: [registryId as Hex], blockNumber: block.number });
    const recheck = await client.getBlock({ blockNumber: block.number });
    const creator = record.creator.toLowerCase(), payout = record.payoutWallet.toLowerCase();
    const nonzero = (a: string) => /^0x[0-9a-f]{40}$/.test(a) && !/^0x0{40}$/.test(a);
    if (controller.signal.aborted || recheck.hash !== block.hash || !record.active || !nonzero(creator) || !nonzero(payout) ||
      record.fetchPriceUsdc6 > BigInt(Number.MAX_SAFE_INTEGER) || record.authors.length < 1 || record.authors.length > 20 ||
      new Set(record.authors.map(a => a.wallet.toLowerCase())).size !== record.authors.length ||
      record.authors.reduce((sum, a) => sum + a.basisPoints, 0) !== 10000 ||
      record.authors.some(a => a.basisPoints <= 0 || !nonzero(a.wallet.toLowerCase()))) refuse();
    return Object.freeze({ ...(origin ? { registryAuthority: origin } : {}), creator, fetchPayTo: payout, listPriceUsdc: Number(record.fetchPriceUsdc6) / 1e6,
      wallets: new Set([payout, ...record.authors.map(a => a.wallet.toLowerCase())]), onchain: true, active: true });
  } catch { return refuse(); }
  finally { clearTimeout(timeout); controller.signal.removeEventListener("abort", onAbort); controller.abort(); }
}
