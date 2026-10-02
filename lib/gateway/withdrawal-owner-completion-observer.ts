import { createPublicClient, serializeTransaction, type Hex } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { WithdrawalRequestRecord } from "./withdrawal-request";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import { withdrawalMintTermsSchema } from "./withdrawal-mint-transaction";
import { withdrawalReceiptObserverForRpc } from "./withdrawal-receipt-observation";

/** Public hash is only a selector. Exact signed transaction bytes and canonical
 * receipt/finality come from the selected server-owned RPC, never an HTTP body. */
export async function observeWithdrawalOwnerCompletion(record: WithdrawalRequestRecord, attestation: unknown, owner: string,
  transactionHash: Hex, rpcUrl: string, signal: AbortSignal) {
  if (record.network !== ARC_MAINNET_PROFILE.networkId || record.policy.recipient !== owner) throw new Error("Owner mint rail refused");
  const client = createPublicClient({ transport: withdrawalRpcTransport(rpcUrl, signal) });
  if (await client.getChainId() !== ARC_MAINNET_PROFILE.chainId) throw new Error("Mint network refused");
  const t = await client.getTransaction({ hash: transactionHash }); signal.throwIfAborted();
  if (t.type !== "eip1559" || t.hash !== transactionHash || t.chainId !== ARC_MAINNET_PROFILE.chainId ||
    t.from.toLowerCase() !== owner || !t.r || !t.s || t.yParity === undefined) throw new Error("Owner mint transaction refused");
  const raw = serializeTransaction({ type: "eip1559", chainId: t.chainId, nonce: t.nonce, gas: t.gas,
    maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas, to: t.to, data: t.input,
    value: t.value, accessList: t.accessList, r: t.r, s: t.s, yParity: t.yParity });
  const terms = withdrawalMintTermsSchema.parse({ relayer: owner, nonce: t.nonce, gas: String(t.gas), maxFeePerGas: String(t.maxFeePerGas),
    maxPriorityFeePerGas: String(t.maxPriorityFeePerGas), gasBudgetWei: String(t.gas * t.maxFeePerGas) });
  const observation = await withdrawalReceiptObserverForRpc(rpcUrl)(record, attestation, raw, terms, signal);
  signal.throwIfAborted(); if (!observation || observation.transactionHash !== transactionHash) throw new Error("Original finalized mint evidence unavailable");
  return { record, attestation, serializedTransaction: raw, terms, observation };
}
