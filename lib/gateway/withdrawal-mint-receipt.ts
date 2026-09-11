import { z } from "zod";
import { encodeAbiParameters, pad, toEventSelector, type Hex } from "viem";
import type { WithdrawalRequestRecord } from "./withdrawal-request";
import { matchWithdrawalMintTransaction, type WithdrawalMintTerms } from "./withdrawal-mint-transaction";

// Circle Mints.sol, fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8.
export const WITHDRAWAL_MINT_EVENT = [{ type: "event", name: "AttestationUsed", inputs: [
  { name: "token", type: "address", indexed: true },
  { name: "recipient", type: "address", indexed: true },
  { name: "transferSpecHash", type: "bytes32", indexed: true },
  { name: "sourceDomain", type: "uint32", indexed: false },
  { name: "sourceDepositor", type: "bytes32", indexed: false },
  { name: "sourceSigner", type: "bytes32", indexed: false },
  { name: "value", type: "uint256", indexed: false },
] }] as const;
const topic = toEventSelector(WITHDRAWAL_MINT_EVENT[0]);
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase() as Hex);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex);
const index = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const logSchema = z.object({ address, blockHash: hash, blockNumber: z.bigint().nonnegative(),
  transactionHash: hash, transactionIndex: index, logIndex: index, removed: z.literal(false),
  topics: z.array(hash).max(4),
  data: z.string().max(8194).regex(/^0x(?:[a-fA-F0-9]{2})*$/).transform(value => value.toLowerCase() as Hex),
});
const receiptSchema = z.object({ transactionHash: hash, from: address, to: address,
  blockHash: hash, blockNumber: z.bigint().nonnegative(), transactionIndex: index,
  status: z.literal("success"), gasUsed: z.bigint().positive(), effectiveGasPrice: z.bigint().nonnegative(),
  logs: z.array(logSchema).max(128),
});

/** Match a viem-normalized receipt to the original signed bytes and exact minter
 * event. This is read-only evidence matching, not proof of canonical chain inclusion,
 * finality, deployed code version, or permission to release a nonce/gas reservation. */
export async function matchWithdrawalMintReceipt(selected: WithdrawalRequestRecord, response: unknown,
  raw: unknown, terms: WithdrawalMintTerms, receiptValue: unknown) {
  try {
    const copy = structuredClone({ selected, response, terms });
    const receipt = receiptSchema.parse(receiptValue);
    const transaction = await matchWithdrawalMintTransaction(copy.selected, copy.response, raw, copy.terms);
    if (receipt.transactionHash !== transaction.transactionHash || receipt.from !== transaction.terms.relayer
      || receipt.to !== transaction.minter || receipt.gasUsed > BigInt(transaction.terms.gas)
      || receipt.blockNumber > BigInt(transaction.expirationBlock)
      || receipt.effectiveGasPrice > BigInt(transaction.terms.maxFeePerGas)) throw new Error();
    const seen = new Set<number>();
    for (const log of receipt.logs) {
      if (log.transactionHash !== receipt.transactionHash || log.blockHash !== receipt.blockHash
        || log.blockNumber !== receipt.blockNumber || log.transactionIndex !== receipt.transactionIndex
        || seen.has(log.logIndex)) throw new Error();
      seen.add(log.logIndex);
    }
    const events = receipt.logs.filter(log => log.address === transaction.minter && log.topics[0] === topic);
    if (events.length !== 1) throw new Error();
    const event = events[0];
    if (event.topics.length !== 4 || event.data.length !== 258) throw new Error();
    const spec = copy.selected.request.burnIntent.spec;
    const expectedData = encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint256" }],
    [spec.sourceDomain, spec.sourceDepositor, spec.sourceSigner, BigInt(spec.value)]);
    if (event.topics[1] !== pad(copy.selected.policy.asset, { size: 32 })
      || event.topics[2] !== pad(copy.selected.policy.recipient, { size: 32 })
      || event.topics[3] !== transaction.transferSpecHash || event.data !== expectedData) throw new Error();
    return { status: "mint-receipt-matched" as const, authority: "receipt-matched-only" as const,
      requestId: transaction.requestId, transactionHash: transaction.transactionHash,
      transferSpecHash: transaction.transferSpecHash, chainId: 5042002 as const,
      blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex, logIndex: event.logIndex,
      recipient: copy.selected.policy.recipient, amountMicros: spec.value,
      gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), chainFinalityVerified: false as const };
  } catch { throw new Error("Withdrawal mint receipt unavailable"); }
}
