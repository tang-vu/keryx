import { z } from "zod";
import { keccak256, parseTransaction, recoverTransactionAddress, zeroAddress, type Hex, type TransactionSerializedEIP1559 } from "viem";

const address = z.string().regex(/^0x[a-f0-9]{40}$/).refine(value => value !== zeroAddress);
const originalSchema = z.object({ owner: address, recipient: address,
  nonce: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  serializedTransaction: z.string().regex(/^0x02(?:[a-f0-9]{2})+$/).max(8194),
}).strict();

/** Funding is a single exact native testnet transfer, never arbitrary signed bytes. */
export async function verifyFundingDrillOriginal(value: unknown) {
  const original = originalSchema.parse(value);
  const serializedTransaction = original.serializedTransaction as TransactionSerializedEIP1559;
  const transaction = parseTransaction(serializedTransaction);
  if (original.owner === original.recipient || transaction.chainId !== 5042002 || transaction.type !== "eip1559"
    || transaction.to?.toLowerCase() !== original.recipient || transaction.value !== BigInt("10000000000000000")
    || transaction.nonce !== original.nonce || transaction.gas !== BigInt(21000)
    || (transaction.accessList?.length ?? 0) !== 0
    || transaction.maxFeePerGas !== BigInt(30000000000) || transaction.maxPriorityFeePerGas !== BigInt(5000000000)
    || transaction.data !== undefined && transaction.data !== "0x" || keccak256(serializedTransaction) !== original.transactionHash
    || (await recoverTransactionAddress({ serializedTransaction })).toLowerCase() !== original.owner)
    throw new Error("Funding original terms mismatch");
  return { ...original, owner: original.owner as Hex, recipient: original.recipient as Hex,
    transactionHash: original.transactionHash as Hex, serializedTransaction, transaction };
}
