import { parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerializableEIP1559, type TransactionSerialized } from "viem";
import { z } from "zod";

const quantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][a-fA-F0-9]*)$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const data = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/).max(32768);
const rpcTransaction = z.object({ from: address, to: address, data: data.optional(), value: quantity.optional(),
  chainId: quantity.optional(), type: z.literal("0x2").optional(), nonce: quantity, gas: quantity,
  maxFeePerGas: quantity, maxPriorityFeePerGas: quantity }).strict();

/** Existing funding/cashout journals supply exact nonce and gas bounds before a wallet prompt.
 * Never invent missing terms, estimate a replacement, or change the reviewed call. */
export function circleUnsignedTransaction(value: unknown, owner: string, chainId: number): Hex {
  const tx = rpcTransaction.parse(value);
  if (tx.from.toLowerCase() !== owner.toLowerCase() || (tx.chainId !== undefined && BigInt(tx.chainId) !== BigInt(chainId))) throw new Error("Circle wallet transaction identity differs");
  const nonce = Number(BigInt(tx.nonce));
  if (!Number.isSafeInteger(nonce) || nonce < 0 || BigInt(tx.gas) <= BigInt(0)
    || BigInt(tx.maxFeePerGas) <= BigInt(0) || BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas)) throw new Error("Circle wallet transaction bounds are invalid");
  return serializeTransaction({ type: "eip1559", chainId, nonce, to: tx.to as Hex, data: (tx.data ?? "0x") as Hex,
    value: BigInt(tx.value ?? "0x0"), gas: BigInt(tx.gas), maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) });
}

export function validateCircleUnsignedTransaction(raw: Hex, chainId: number) {
  const tx = parseTransaction(raw);
  if (tx.type !== "eip1559" || tx.chainId !== chainId || !tx.to || tx.nonce === undefined
    || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0 || !tx.gas || !tx.maxFeePerGas
    || tx.maxPriorityFeePerGas === undefined || tx.maxPriorityFeePerGas > tx.maxFeePerGas
    || tx.r !== undefined || tx.s !== undefined || tx.yParity !== undefined) throw new Error("Unsigned Circle transaction is invalid");
  if (serializeTransaction(tx as TransactionSerializableEIP1559).toLowerCase() !== raw.toLowerCase()) throw new Error("Circle transaction must be canonical");
  return tx;
}

/** Vendor output is checked independently before the single broadcast attempt. */
export async function verifyCircleSignedTransaction(unsigned: Hex, signed: Hex, owner: string, chainId: number) {
  const original = validateCircleUnsignedTransaction(unsigned, chainId), result = parseTransaction(signed);
  if (result.type !== "eip1559" || result.chainId !== chainId || result.to?.toLowerCase() !== original.to?.toLowerCase()
    || result.nonce !== original.nonce || result.gas !== original.gas || result.value !== original.value
    || (result.data ?? "0x").toLowerCase() !== (original.data ?? "0x").toLowerCase()
    || result.maxFeePerGas !== original.maxFeePerGas || result.maxPriorityFeePerGas !== original.maxPriorityFeePerGas
    || JSON.stringify(result.accessList ?? []) !== JSON.stringify(original.accessList ?? [])
    || (await recoverTransactionAddress({ serializedTransaction: signed as TransactionSerialized })).toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Circle signed transaction differs from the reviewed original");
  }
}
