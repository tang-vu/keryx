import { z } from "zod";
import { keccak256, parseTransaction, recoverTransactionAddress, zeroAddress, type Hex, type TransactionSerializedEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CREATOR_CASHOUT_FUNDER = "0x384462d9d8e2645a017e4ef34a0cdfd91b4b97cd" as Hex;
export const CREATOR_CASHOUT_FUNDING_VALUE = BigInt("210000000000000000");
export const CREATOR_CASHOUT_FUNDING_GAS = BigInt(21000);
export const CREATOR_CASHOUT_FUNDING_MAX_FEE = BigInt(30000000000);
export const CREATOR_CASHOUT_FUNDING_PRIORITY_FEE = BigInt(5000000000);
export const fundingAddress = z.string().regex(/^0x[a-f0-9]{40}$/).refine(value => value !== zeroAddress);
export const fundingReviewSchema = z.object({ owner: fundingAddress, recipient: fundingAddress,
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const originalSchema = fundingReviewSchema.extend({
  transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  serializedTransaction: z.string().regex(/^0x02(?:[a-f0-9]{2})+$/).max(8194),
}).strict();

export function creatorCashoutFundingTransaction(recipient: Hex, nonce: number) {
  return { type: "eip1559" as const, chainId: 5042002, nonce, to: recipient,
    value: CREATOR_CASHOUT_FUNDING_VALUE, gas: CREATOR_CASHOUT_FUNDING_GAS,
    maxFeePerGas: CREATOR_CASHOUT_FUNDING_MAX_FEE,
    maxPriorityFeePerGas: CREATOR_CASHOUT_FUNDING_PRIORITY_FEE, data: "0x" as Hex };
}

/** Expected owner is an explicit verification dependency for synthetic tests;
 * the live CLI always supplies the fixed reviewed treasury. No terms are tunable. */
export async function verifyCreatorCashoutFundingOriginal(value: unknown, expectedOwner: string = CREATOR_CASHOUT_FUNDER) {
  const original = originalSchema.parse(value), owner = fundingAddress.parse(expectedOwner);
  const serializedTransaction = original.serializedTransaction as TransactionSerializedEIP1559;
  const transaction = parseTransaction(serializedTransaction);
  if (original.owner !== owner || original.owner === original.recipient || transaction.chainId !== 5042002
    || transaction.type !== "eip1559" || transaction.to?.toLowerCase() !== original.recipient
    || transaction.value !== CREATOR_CASHOUT_FUNDING_VALUE || transaction.nonce !== original.nonce
    || transaction.gas !== CREATOR_CASHOUT_FUNDING_GAS || (transaction.accessList?.length ?? 0) !== 0
    || transaction.maxFeePerGas !== CREATOR_CASHOUT_FUNDING_MAX_FEE
    || transaction.maxPriorityFeePerGas !== CREATOR_CASHOUT_FUNDING_PRIORITY_FEE
    || transaction.data !== undefined && transaction.data !== "0x"
    || keccak256(serializedTransaction) !== original.transactionHash
    || (await recoverTransactionAddress({ serializedTransaction })).toLowerCase() !== owner)
    throw new Error("Creator cash-out funding original terms mismatch");
  return { ...original, owner: original.owner as Hex, recipient: original.recipient as Hex,
    transactionHash: original.transactionHash as Hex, serializedTransaction, transaction };
}

/** One selected field only; never evaluate other keys, endpoints or env syntax. */
export function creatorCashoutFunderKey(text: string, expectedOwner: string = CREATOR_CASHOUT_FUNDER): Hex {
  const lines = text.split(/\r?\n/).filter(line => /^\s*AGENT_FUNDER_PRIVATE_KEY\s*=/.test(line));
  if (lines.length !== 1) throw new Error("Exact creator cash-out funder field unavailable");
  const match = lines[0].match(/^\s*AGENT_FUNDER_PRIVATE_KEY\s*=\s*(['"]?)(0x[a-fA-F0-9]{64})\1\s*(?:#.*)?$/);
  if (!match || privateKeyToAccount(match[2] as Hex).address.toLowerCase() !== fundingAddress.parse(expectedOwner))
    throw new Error("Creator cash-out funder field unavailable");
  return match[2] as Hex;
}
