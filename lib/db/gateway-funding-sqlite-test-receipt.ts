import { parseTransaction } from "viem";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "../payments/gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import type { FundingReservationSnapshot } from "./gateway-funding-ledger-types";

/** Synthetic read-provider fixture. No real chain evidence, keys or send API. */
export async function syntheticFundingTerminal(snapshot: Readonly<FundingReservationSnapshot>) {
  if (!snapshot.prepared || !snapshot.cryptoClaimId || !snapshot.broadcastClaimId) throw new Error("Incomplete synthetic original");
  const prepared = snapshot.prepared, tx = prepared.transaction, signature = parseTransaction(prepared.rawTransaction), now = 1800000000000;
  const q = (value: string | number) => `0x${BigInt(value).toString(16)}`;
  const blockHash = `0x${"a".repeat(64)}`, anchorHash = `0x${"b".repeat(64)}`;
  const fetchRead = async (_: RequestInfo | URL, options?: RequestInit) => {
    const { method, params, id } = JSON.parse(options!.body as string); let result: unknown;
    if (method === "eth_chainId") result = q(5042002);
    else if (method === "eth_getTransactionByHash") result = { hash: prepared.transactionHash, from: tx.sender, to: tx.to, input: tx.data, type: "0x2", chainId: q(tx.chainId), nonce: q(tx.nonce), value: q(tx.valueWei), gas: q(tx.gas), maxFeePerGas: q(tx.maxFeePerGasWei), maxPriorityFeePerGas: q(tx.maxPriorityFeePerGasWei), accessList: [], r: signature.r, s: signature.s, yParity: q(signature.yParity!), blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
    else if (method === "eth_getTransactionReceipt") result = { transactionHash: prepared.transactionHash, from: tx.sender, to: tx.to, type: "0x2", status: "0x1", gasUsed: "0x2", effectiveGasPrice: "0x2", blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
    else if (method === "eth_getBlockByNumber") result = params[0] === "0xa" ? { number: "0xa", hash: blockHash, timestamp: q(now / 1000 - 2), transactions: [prepared.transactionHash] } : { number: "0xb", hash: anchorHash, timestamp: q(now / 1000 - 1), transactions: [] };
    else throw new Error("No write RPC supported");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  };
  const token = await createGatewayFundingReceiptObserverForTrustedComposition(fetchRead, () => now)({ operation: snapshot.operation,
    prepared, cryptoClaimId: snapshot.cryptoClaimId, broadcastClaimId: snapshot.broadcastClaimId, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST }, () => {});
  if (!token) throw new Error("Synthetic issuer refused"); return token;
}
