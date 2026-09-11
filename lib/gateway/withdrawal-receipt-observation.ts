import { z } from "zod";
import { createPublicClient, type Hex, type PublicClient } from "viem";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import type { WithdrawalRequestRecord } from "./withdrawal-request";
import { matchWithdrawalMintTransaction, type WithdrawalMintTerms } from "./withdrawal-mint-transaction";
import { matchWithdrawalMintReceipt } from "./withdrawal-mint-receipt";

type ReadClient = Pick<PublicClient, "getChainId" | "getTransactionReceipt" | "getBlock">;
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase() as Hex);
const blockSchema = z.object({ number: z.bigint().nonnegative(), hash,
  timestamp: z.bigint().nonnegative(), transactions: z.array(hash).max(50000) });
const DEADLINE_MS = 5000;

/** Arc documents committed blocks as final, with finalized resolving to latest.
 * This verifies RPC-reported inclusion/finality; it does not independently verify
 * validator signatures or establish deployed-minter implementation identity. */
export function createWithdrawalReceiptObserver(makeClient: (signal: AbortSignal) => ReadClient, nowMs = Date.now) {
  return async (record: WithdrawalRequestRecord, response: unknown, raw: unknown,
    terms: WithdrawalMintTerms, signal: AbortSignal) => {
    if (signal.aborted) return null;
    let copy: { record: WithdrawalRequestRecord; response: unknown; raw: unknown; terms: WithdrawalMintTerms };
    try { copy = structuredClone({ record, response, raw, terms }); } catch { return null; }
    const stop = new AbortController();
    let cancel!: () => void;
    const cancelled = new Promise<null>(resolve => { cancel = () => { stop.abort(); resolve(null); }; });
    const timer = setTimeout(cancel, DEADLINE_MS);
    signal.addEventListener("abort", cancel, { once: true });
    const live = () => { if (signal.aborted || stop.signal.aborted) throw new Error(); };
    const fresh = (timestamp: bigint) => {
      const now = nowMs();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error();
      const age = BigInt(now) - timestamp * BigInt(1000);
      if (age > BigInt(60000) || age < BigInt(-5000)) throw new Error();
      return new Date(now).toISOString();
    };
    const inspect = async () => {
      live();
      const prepared = await matchWithdrawalMintTransaction(copy.record, copy.response, copy.raw, copy.terms); live();
      const client = makeClient(stop.signal);
      if (await client.getChainId() !== 5042002) throw new Error(); live();
      const receipt = await client.getTransactionReceipt({ hash: prepared.transactionHash }); live();
      const matched = await matchWithdrawalMintReceipt(copy.record, copy.response, copy.raw, copy.terms, receipt); live();
      const height = BigInt(matched.blockNumber);
      const included = blockSchema.parse(await client.getBlock({ blockNumber: height, includeTransactions: false })); live();
      const includes = (block: z.infer<typeof blockSchema>) => {
        if (block.number !== height || block.hash !== matched.blockHash
          || block.transactions[matched.transactionIndex] !== matched.transactionHash
          || block.transactions.filter(value => value === matched.transactionHash).length !== 1) throw new Error();
      };
      includes(included);
      const finalized = blockSchema.parse(await client.getBlock({ blockTag: "finalized", includeTransactions: false })); live();
      fresh(finalized.timestamp);
      if (finalized.number < height || finalized.timestamp < included.timestamp
        || finalized.number === height && finalized.hash !== included.hash) throw new Error();
      const secondReceipt = await client.getTransactionReceipt({ hash: prepared.transactionHash }); live();
      const secondMatch = await matchWithdrawalMintReceipt(copy.record, copy.response, copy.raw, copy.terms, secondReceipt); live();
      if (JSON.stringify(secondMatch) !== JSON.stringify(matched)) throw new Error();
      const secondBlock = blockSchema.parse(await client.getBlock({ blockNumber: height, includeTransactions: false })); live();
      includes(secondBlock);
      if (secondBlock.timestamp !== included.timestamp) throw new Error();
      const anchor = blockSchema.parse(await client.getBlock({ blockNumber: finalized.number, includeTransactions: false })); live();
      if (anchor.number !== finalized.number || anchor.hash !== finalized.hash || anchor.timestamp !== finalized.timestamp
        || await client.getChainId() !== 5042002) throw new Error(); live();
      return { ...matched, status: "mint-finalized-observed" as const, authority: "arc-testnet-rpc-finality" as const,
        chainFinalityVerified: true as const, finalityBasis: "operator-selected-rpc" as const,
        finalizedBlockNumber: finalized.number.toString(), finalizedBlockHash: finalized.hash,
        observedAt: fresh(finalized.timestamp) };
    };
    try {
      if (signal.aborted) { cancel(); return null; }
      return await Promise.race([inspect().catch(() => null), cancelled]);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); stop.abort(); }
  };
}

export function withdrawalReceiptObserverForRpc(rpcUrl: string) {
  try {
    const url = new URL(rpcUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const endpoint = url.toString();
    return createWithdrawalReceiptObserver(signal => createPublicClient({ transport: withdrawalRpcTransport(endpoint, signal) }));
  } catch { throw new Error("Withdrawal RPC unavailable"); }
}
