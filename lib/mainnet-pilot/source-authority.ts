import { createPublicClient, defineChain, http, type Address, type Hex, type Transport } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { sourceId } from "../registry/registry-client";
import type { Source } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import { PUBLIC_RPC_ENDPOINTS } from "../readiness/arc-mainnet-probe";
import { pinPilotPolicy, type PilotPolicy } from "./policy";

const chain = defineChain({ id: ARC_MAINNET_PROFILE.chainId, name: ARC_MAINNET_PROFILE.label,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: ARC_MAINNET_PROFILE.nativeDecimals },
  rpcUrls: { default: { http: [ARC_MAINNET_PROFILE.rpcUrl] } } });
const refused = (): never => { throw new Error("Pilot source authority unavailable"); };

/** Chain identity is checked on every read, before and after the returned authority. */
function attested(base: Transport): Transport {
  return parameters => {
    const transport = base(parameters);
    return { ...transport, request: (async (args, options) => {
      const check = async () => {
        if (await transport.request({ method: "eth_chainId" }) !== ARC_MAINNET_PROFILE.chainIdHex) refused();
      };
      await check(); const result = await transport.request(args, options); await check(); return result;
    }) as typeof transport.request };
  };
}

export function createPilotSourceAuthority(input: PilotPolicy, rpcUrl: string, synthetic = false) {
  const { policy } = pinPilotPolicy(input);
  const url = new URL(rpcUrl);
  if (synthetic ? process.env.NODE_ENV !== "test" || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password
    : !PUBLIC_RPC_ENDPOINTS.includes(rpcUrl)) refused();
  const client = createPublicClient({ chain, transport: attested(http(rpcUrl, { timeout: 4000, retryCount: 0 })) });

  async function resolve(source: Source): Promise<{ source: Source; terms: SourceFetchTerms }> {
    const snapshot = structuredClone(source);
    if (!policy.approvedSourceIds.includes(snapshot.id) || snapshot.onchainId?.toLowerCase() !== snapshot.id ||
        snapshot.verified !== true || snapshot.active === false || !snapshot.url) refused();
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.hash === null) refused();
    const record = await client.readContract({ address: policy.registryAddress as Address, abi: REGISTRY_ABI,
      functionName: "get", args: [snapshot.id as Hex], blockNumber: block.number });
    const recheck = await client.getBlock({ blockNumber: block.number });
    const creator = record.creator.toLowerCase(), payout = record.payoutWallet.toLowerCase();
    if (!record.active || recheck.hash !== block.hash ||
        sourceId(record.creator, snapshot.url).toLowerCase() !== snapshot.id ||
        !policy.approvedCreatorAddresses.includes(creator) || !policy.approvedPayoutAddresses.includes(payout) ||
        record.fetchPriceUsdc6 <= BigInt(0) || record.fetchPriceUsdc6 > BigInt(policy.limits.perPaymentMicros) ||
        record.authors.length < 1 || record.authors.length > 5 ||
        new Set(record.authors.map(a => a.wallet.toLowerCase())).size !== record.authors.length ||
        record.authors.reduce((sum, a) => sum + a.basisPoints, 0) !== 10000 ||
        record.authors.some(a => a.basisPoints <= 0 || !policy.approvedPayoutAddresses.includes(a.wallet.toLowerCase()))) refused();
    const authoritative: Source = { ...snapshot, walletAddress: payout, fetchPrice: Number(record.fetchPriceUsdc6) / 1e6,
      authors: record.authors.map((a, index) => ({ name: snapshot.authors.find(old => old.walletAddress.toLowerCase() === a.wallet.toLowerCase())?.name ?? `Creator ${index + 1}`,
        walletAddress: a.wallet.toLowerCase(), splitWeight: a.basisPoints / 10000 })) };
    return { source: authoritative, terms: { payTo: payout, listPriceUsdc: authoritative.fetchPrice,
      creator, active: true, authority: "onchain", stale: false } };
  }
  async function terms(source: Source) { return (await resolve(source)).terms; }
  async function citation(source: Source, payee: string) {
    const resolved = await resolve(source);
    if (resolved.source.walletAddress !== payee.toLowerCase() &&
        !resolved.source.authors.some(a => a.walletAddress === payee.toLowerCase())) refused();
  }
  return Object.freeze({ resolve, terms, citation });
}
