import { createPublicClient, maxUint256, type PublicClient } from "viem";
import { z } from "zod";
import { readBoundedJson } from "../read-bounded-json";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import type { WithdrawPolicy } from "./withdraw-protocol";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < maxUint256);
const contract = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), supportedTokens: z.array(z.string()).max(32) });
const domainSchema = z.object({ domain: z.literal(26), chain: z.literal("ARC"), network: z.literal("Testnet"),
  processedHeight: uint, burnIntentExpirationHeight: uint, walletContract: contract, minterContract: contract });
type Limits = { maxAheadBlocks: string; maxProcessingLagBlocks: string };
type Client = Pick<PublicClient, "getBlock" | "getChainId">;

/** Fresh server-owned RPC and Circle metadata, not a caller-provided expiry claim.
 * No signer, balance transfer or journal mutation. Heights are source-chain blocks. */
export async function readWithdrawalHeightWindow(clientForSignal: (signal: AbortSignal) => Client,
  selected: Pick<WithdrawPolicy, "domain" | "gatewayWallet" | "gatewayMinter">, selectedLimits: Limits, signal: AbortSignal) {
  const policy = { ...selected }, limits = { maxAheadBlocks: uint.parse(selectedLimits.maxAheadBlocks),
    maxProcessingLagBlocks: uint.parse(selectedLimits.maxProcessingLagBlocks) };
  if (policy.domain !== 26 || BigInt(limits.maxAheadBlocks) === BigInt(0)) throw new Error("Withdrawal height policy unavailable");
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
  const combined = AbortSignal.any([signal, stop.signal]);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Height lookup aborted")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    combined.throwIfAborted();
    return await Promise.race([aborted, (async () => {
      const client = clientForSignal(combined);
      if (await client.getChainId() !== 5042002) throw new Error(); combined.throwIfAborted();
      const response = await fetch("https://gateway-api-testnet.circle.com/v1/info", { cache: "no-store", redirect: "error", signal: combined });
      const info = z.object({ domains: z.array(z.unknown()).max(64) }).parse(await readBoundedJson(response, 32768));
      combined.throwIfAborted(); if (!response.ok) throw new Error();
      const matches = info.domains.filter(value => value && typeof value === "object" && "domain" in value && value.domain === 26);
      if (matches.length !== 1) throw new Error();
      const domain = domainSchema.parse(matches[0]);
      if (domain.walletContract.address.toLowerCase() !== policy.gatewayWallet.toLowerCase()
        || domain.minterContract.address.toLowerCase() !== policy.gatewayMinter.toLowerCase()
        || !domain.walletContract.supportedTokens.includes("USDC") || !domain.minterContract.supportedTokens.includes("USDC")) throw new Error();
      const block = await client.getBlock({ blockTag: "latest" }); combined.throwIfAborted();
      const fresh = () => { const age = Date.now() - Number(block.timestamp) * 1000;
        if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new Error(); };
      fresh(); if (block.number === null || !block.hash) throw new Error();
      const processed = BigInt(domain.processedHeight), minimum = BigInt(domain.burnIntentExpirationHeight);
      const maximum = block.number + BigInt(limits.maxAheadBlocks);
      if (processed > block.number || block.number - processed > BigInt(limits.maxProcessingLagBlocks)
        || minimum <= block.number || minimum > maximum || maximum >= maxUint256) throw new Error();
      const again = await client.getBlock({ blockNumber: block.number }); combined.throwIfAborted(); fresh();
      if (again.hash !== block.hash || again.number !== block.number || again.timestamp !== block.timestamp
        || await client.getChainId() !== 5042002) throw new Error(); combined.throwIfAborted();
      return { minimumBlockHeight: minimum.toString(), maximumBlockHeight: maximum.toString(),
        observedBlockNumber: block.number.toString(), observedBlockHash: block.hash, observedAt: new Date().toISOString() };
    })()]);
  } catch { throw new Error("Withdrawal height window unavailable; obtain fresh terms before signing"); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
export function withdrawalHeightWindowForRpc(rpcUrl: string, policy: Parameters<typeof readWithdrawalHeightWindow>[1], limits: Limits, signal: AbortSignal) {
  return readWithdrawalHeightWindow(current => createPublicClient({ transport: withdrawalRpcTransport(rpcUrl, current) }), policy, limits, signal);
}
