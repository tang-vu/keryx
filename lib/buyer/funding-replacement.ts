import type { Hex, PublicClient } from "viem";
import { fundingRecordSchema, fundingResolutionSchema, fundingTransaction, transactionHashSchema, type FundingRecord, type FundingStep } from "./funding-policy";

/** Read-only. A finalized same-sender nonce consumption resolves the original attempt,
 * but only identical calldata/target/value can establish the planned operation. */
export async function inspectFundingReplacement(record: FundingRecord, step: FundingStep, hash: string, chain: PublicClient) {
  fundingRecordSchema.parse(record); transactionHashSchema.parse(hash);
  const leg = record[step];
  if (!record.activePayer || !["possible", "submitted"].includes(leg.status)) throw new Error("Funding attempt is no longer awaiting evidence");
  if (await chain.getChainId() !== 5042002) throw new Error("Funding recovery requires Arc testnet RPC");
  const [tx, receipt] = await Promise.all([chain.getTransaction({ hash: hash as Hex }), chain.getTransactionReceipt({ hash: hash as Hex })]);
  const [canonical, finalized] = await Promise.all([chain.getBlock({ blockNumber: receipt.blockNumber }), chain.getBlock({ blockTag: "finalized" })]);
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
  if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || !same(tx.from, record.payer)
    || tx.nonce !== leg.nonce || leg.beforeBlock === undefined || receipt.blockNumber <= BigInt(leg.beforeBlock)
    || tx.blockNumber !== receipt.blockNumber || !same(tx.blockHash, receipt.blockHash)
    || canonical.number !== receipt.blockNumber || !same(canonical.hash, receipt.blockHash)
    || finalized.number === null || finalized.number < receipt.blockNumber || !finalized.hash
    || (finalized.number === receipt.blockNumber && !same(finalized.hash, receipt.blockHash))
    || !["success", "reverted"].includes(receipt.status)) throw new Error("Replacement is not finalized matching nonce evidence");
  if (await chain.getChainId() !== 5042002) throw new Error("Funding RPC changed during recovery");
  const expected = fundingTransaction(record, step);
  const matches = same(tx.to, expected.to) && same(tx.input, expected.data) && tx.value === expected.value;
  return fundingResolutionSchema.parse({ hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(),
    status: matches ? receipt.status === "success" ? "confirmed" : "reverted" : "replaced", basis: "configured-rpc-finalized" });
}
