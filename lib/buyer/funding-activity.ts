import { decodeFunctionData, encodeFunctionData, type Hex, type PublicClient } from "viem";
import { addressSchema, BUYER_GATEWAY, BUYER_USDC } from "./protocol";
import { GATEWAY_DEPOSIT_ABI, transactionHashSchema } from "./funding-policy";

/** Historical on-chain observation only. It neither reconstructs a lost original
 * intent nor authorizes a wallet request or modifies the funding journal. */
export async function inspectPastGatewayDeposit(payer: string, hash: string, chain: PublicClient, signal?: AbortSignal) {
  addressSchema.parse(payer); transactionHashSchema.parse(hash); signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function inspect() {
    if (await chain.getChainId() !== 5042002) throw new Error("Choose Arc testnet RPC");
    const [tx, receipt] = await Promise.all([chain.getTransaction({ hash: hash as Hex }), chain.getTransactionReceipt({ hash: hash as Hex })]);
    const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
    if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || !same(tx.from, payer)
      || !same(tx.to, BUYER_GATEWAY) || tx.value !== BigInt(0) || tx.input.length !== 138) throw new Error("Not this wallet's Gateway deposit");
    const decoded = decodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, data: tx.input });
    const [token, amount] = decoded.args;
    if (!same(token, BUYER_USDC) || amount <= BigInt(0)
      || !same(tx.input, encodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [token, amount] }))) throw new Error("Not an exact USDC deposit call");
    const [canonical, finalized] = await Promise.all([chain.getBlock({ blockNumber: receipt.blockNumber }), chain.getBlock({ blockTag: "finalized" })]);
    if (tx.blockNumber !== receipt.blockNumber || !same(tx.blockHash, receipt.blockHash)
      || canonical.number !== receipt.blockNumber || !same(canonical.hash, receipt.blockHash)
      || typeof finalized.number !== "bigint" || finalized.number < receipt.blockNumber || !finalized.hash
      || (finalized.number === receipt.blockNumber && !same(finalized.hash, receipt.blockHash))
      || !["success", "reverted"].includes(receipt.status)) throw new Error("Finalized deposit evidence is unavailable");
    transactionHashSchema.parse(receipt.blockHash);
    if (await chain.getChainId() !== 5042002) throw new Error("RPC network changed during inspection");
    return { payer: payer.toLowerCase(), hash, amountMicros: amount.toString(), blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash, status: receipt.status, basis: "configured-rpc-finalized" as const };
  }
  try {
    const observation = await Promise.race([inspect(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Deposit lookup timed out")), 10_000);
    })]);
    signal?.throwIfAborted(); return observation;
  } finally { clearTimeout(timer); }
}
export type PastGatewayDeposit = Awaited<ReturnType<typeof inspectPastGatewayDeposit>>;
