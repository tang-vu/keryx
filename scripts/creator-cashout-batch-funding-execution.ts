import assert from "node:assert/strict";
import { existsSync, mkdirSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { keccak256, type Hex, type PublicClient } from "viem";
import { inspectWithdrawalRelayDirectory } from "../lib/gateway/withdrawal-relay-files";
import { readCreatorBatchJson } from "./creator-cashout-batch-files";
import { saveWithdrawalDrillExclusive } from "./withdrawal-drill-files";
import { CREATOR_CASHOUT_FUNDER, CREATOR_CASHOUT_FUNDING_GAS, CREATOR_CASHOUT_FUNDING_MAX_FEE,
  CREATOR_CASHOUT_FUNDING_VALUE, creatorCashoutFundingTransaction,
  fundingReviewSchema, verifyCreatorCashoutFundingOriginal } from "./creator-cashout-batch-funding-original";

export type FundingPreflightRpc = Pick<PublicClient, "getChainId" | "getBlock" | "getBalance" | "getTransactionCount" | "getCode">;
export type FundingSendRpc = FundingPreflightRpc & Pick<PublicClient, "sendRawTransaction">;
export type FundingRecoveryRpc = Pick<PublicClient, "getChainId" | "getBlock" | "getTransactionReceipt" | "getTransaction">;
type FundingSigner = { address: string; signTransaction: (transaction: ReturnType<typeof creatorCashoutFundingTransaction>) => Promise<Hex> };
export type FundingReview = { owner: string; recipient: string; nonce: number };
const requiredBalance = CREATOR_CASHOUT_FUNDING_VALUE + CREATOR_CASHOUT_FUNDING_GAS * CREATOR_CASHOUT_FUNDING_MAX_FEE;

function fresh(timestamp: bigint, now: number) {
  assert.ok(Number.isSafeInteger(now) && now >= 0);
  const age = BigInt(now) - timestamp * BigInt(1000);
  assert.ok(age >= BigInt(-5000) && age <= BigInt(60000));
}
async function preflight(review: FundingReview, rpc: FundingPreflightRpc, signal: AbortSignal, now = Date.now) {
  signal.throwIfAborted(); assert.equal(await rpc.getChainId(), 5042002);
  const block = await rpc.getBlock({ blockTag: "latest" });
  assert.ok(block.number !== null && block.hash !== null);
  fresh(block.timestamp, now()); assert.ok(block.baseFeePerGas !== null && block.baseFeePerGas !== undefined
    && block.baseFeePerGas <= CREATOR_CASHOUT_FUNDING_MAX_FEE);
  for (const blockTag of ["latest", "pending"] as const) {
    assert.equal(await rpc.getTransactionCount({ address: review.owner as Hex, blockTag }), review.nonce);
    assert.ok([undefined, "0x"].includes(await rpc.getCode({ address: review.owner as Hex, blockTag })));
    assert.equal(await rpc.getTransactionCount({ address: review.recipient as Hex, blockTag }), 0);
    assert.ok([undefined, "0x"].includes(await rpc.getCode({ address: review.recipient as Hex, blockTag })));
    assert.equal(await rpc.getBalance({ address: review.recipient as Hex, blockTag }), BigInt(0));
  }
  const rechecked = await rpc.getBlock({ blockNumber: block.number! });
  assert.equal(rechecked.hash, block.hash); assert.equal(rechecked.timestamp, block.timestamp);
  assert.equal(await rpc.getChainId(), 5042002);
  for (const blockTag of ["latest", "pending"] as const)
    assert.equal(await rpc.getTransactionCount({ address: review.owner as Hex, blockTag }), review.nonce);
  assert.ok(await rpc.getBalance({ address: review.owner as Hex, blockTag: "pending" }) >= requiredBalance);
  signal.throwIfAborted();
}
async function original(directory: string, expectedOwner: string) {
  await inspectWithdrawalRelayDirectory(directory);
  const review = fundingReviewSchema.parse(await readCreatorBatchJson(join(directory, "review.json"), 4096));
  assert.equal(review.owner, expectedOwner); assert.notEqual(review.owner, review.recipient);
  assert.deepEqual(await readCreatorBatchJson(join(directory, "signing-attempt.json"), 4096), review);
  const retained = await verifyCreatorCashoutFundingOriginal(await readCreatorBatchJson(join(directory, "original.json"), 16384), expectedOwner);
  assert.deepEqual({ owner: retained.owner, recipient: retained.recipient, nonce: retained.nonce }, review);
  return retained;
}

/** New protected directory only. Any error after creation preserves the history,
 * including a consumed signing marker with missing original bytes. */
export async function prepareCreatorCashoutFunding(directory: string, selected: FundingReview, signer: FundingSigner,
  rpc: FundingPreflightRpc, signal: AbortSignal, expectedOwner: string = CREATOR_CASHOUT_FUNDER) {
  const review = fundingReviewSchema.parse(selected);
  assert.equal(review.owner, expectedOwner); assert.equal(signer.address.toLowerCase(), expectedOwner);
  assert.notEqual(review.owner, review.recipient);
  assert.ok(isAbsolute(directory) && resolve(directory) === directory);
  await inspectWithdrawalRelayDirectory(dirname(directory));
  await preflight(review, rpc, signal);
  mkdirSync(directory, { mode: 0o700 });
  const parent = openSync(dirname(directory), "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
  await inspectWithdrawalRelayDirectory(directory);
  saveWithdrawalDrillExclusive(join(directory, "review.json"), review);
  await preflight(review, rpc, signal);
  saveWithdrawalDrillExclusive(join(directory, "signing-attempt.json"), review);
  signal.throwIfAborted();
  const serializedTransaction = await signer.signTransaction(creatorCashoutFundingTransaction(review.recipient as Hex, review.nonce));
  const selectedOriginal = { ...review, serializedTransaction, transactionHash: keccak256(serializedTransaction) };
  await verifyCreatorCashoutFundingOriginal(selectedOriginal, expectedOwner);
  // An abort after signing must still attempt to retain the one original.
  saveWithdrawalDrillExclusive(join(directory, "original.json"), selectedOriginal);
  const retained = await original(directory, expectedOwner);
  assert.equal(retained.serializedTransaction, serializedTransaction);
  assert.equal(retained.transactionHash, selectedOriginal.transactionHash);
  return { state: "funding-original-retained" as const, owner: retained.owner, recipient: retained.recipient,
    nonce: retained.nonce, transactionHash: retained.transactionHash, amountWei: CREATOR_CASHOUT_FUNDING_VALUE.toString(),
    maxGasCostWei: (requiredBalance - CREATOR_CASHOUT_FUNDING_VALUE).toString(), broadcasts: 0 };
}

/** Keyless one-attempt broadcast. Lost RPC response permanently consumes send;
 * later invocations must observe the retained hash through recovery. */
export async function sendCreatorCashoutFunding(directory: string, rpc: FundingSendRpc, signal: AbortSignal,
  expectedOwner: string = CREATOR_CASHOUT_FUNDER) {
  const retained = await original(directory, expectedOwner);
  assert.ok(!existsSync(join(directory, "broadcast-attempt.json")));
  await preflight(retained, rpc, signal);
  saveWithdrawalDrillExclusive(join(directory, "broadcast-attempt.json"), { transactionHash: retained.transactionHash });
  signal.throwIfAborted();
  assert.equal((await rpc.sendRawTransaction({ serializedTransaction: retained.serializedTransaction })).toLowerCase(), retained.transactionHash);
  return { state: "funding-original-submitted" as const, transactionHash: retained.transactionHash, signatures: 0, broadcasts: 1 };
}

/** Exact retained original, canonical inclusion and sampled finality. No signer,
 * send RPC or writes are reached, even when receipt/transaction reads are absent. */
export async function recoverCreatorCashoutFunding(directory: string, rpc: FundingRecoveryRpc, signal: AbortSignal,
  expectedOwner: string = CREATOR_CASHOUT_FUNDER, now = Date.now) {
  const retained = await original(directory, expectedOwner); signal.throwIfAborted();
  assert.equal(await rpc.getChainId(), 5042002);
  const receipt = await rpc.getTransactionReceipt({ hash: retained.transactionHash });
  assert.equal(receipt.transactionHash.toLowerCase(), retained.transactionHash); assert.equal(receipt.status, "success");
  assert.equal(receipt.from.toLowerCase(), retained.owner); assert.equal(receipt.to?.toLowerCase(), retained.recipient);
  assert.ok(receipt.gasUsed > BigInt(0) && receipt.gasUsed <= CREATOR_CASHOUT_FUNDING_GAS);
  assert.ok(receipt.effectiveGasPrice >= BigInt(0) && receipt.effectiveGasPrice <= CREATOR_CASHOUT_FUNDING_MAX_FEE);
  const transaction = await rpc.getTransaction({ hash: retained.transactionHash });
  assert.equal(transaction.hash.toLowerCase(), retained.transactionHash); assert.equal(transaction.type, "eip1559");
  assert.equal(transaction.chainId, 5042002); assert.equal(transaction.from.toLowerCase(), retained.owner);
  assert.equal(transaction.to?.toLowerCase(), retained.recipient); assert.equal(transaction.value, CREATOR_CASHOUT_FUNDING_VALUE);
  assert.equal(transaction.nonce, retained.nonce); assert.equal(transaction.gas, CREATOR_CASHOUT_FUNDING_GAS);
  assert.equal(transaction.maxFeePerGas, retained.transaction.maxFeePerGas);
  assert.equal(transaction.maxPriorityFeePerGas, retained.transaction.maxPriorityFeePerGas);
  assert.equal(transaction.input, "0x"); assert.equal(transaction.blockHash, receipt.blockHash);
  assert.equal(transaction.blockNumber, receipt.blockNumber); assert.equal(transaction.transactionIndex, receipt.transactionIndex);
  assert.equal(transaction.accessList?.length ?? 0, 0);
  const included = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(included.number, receipt.blockNumber); assert.equal(included.hash, receipt.blockHash);
  assert.equal(included.transactions[receipt.transactionIndex], retained.transactionHash);
  assert.equal(included.transactions.filter(hash => hash === retained.transactionHash).length, 1);
  const finalized = await rpc.getBlock({ blockTag: "finalized" }); fresh(finalized.timestamp, now());
  assert.ok(finalized.number !== null && finalized.hash !== null);
  assert.ok(finalized.number! >= receipt.blockNumber && finalized.timestamp >= included.timestamp);
  if (finalized.number === receipt.blockNumber) assert.equal(finalized.hash, included.hash);
  assert.deepEqual(await rpc.getTransactionReceipt({ hash: retained.transactionHash }), receipt);
  assert.deepEqual(await rpc.getBlock({ blockNumber: receipt.blockNumber }), included);
  const anchor = await rpc.getBlock({ blockNumber: finalized.number! });
  assert.equal(anchor.hash, finalized.hash); assert.equal(anchor.number, finalized.number); assert.equal(anchor.timestamp, finalized.timestamp);
  assert.equal(await rpc.getChainId(), 5042002); signal.throwIfAborted();
  // Read back protected original storage after observations; never a fresh signature.
  assert.equal((await original(directory, expectedOwner)).serializedTransaction, retained.serializedTransaction);
  return { state: "funding-original-finalized-observed" as const, owner: retained.owner, recipient: retained.recipient,
    transactionHash: retained.transactionHash, amountWei: CREATOR_CASHOUT_FUNDING_VALUE.toString(),
    gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), blockNumber: receipt.blockNumber.toString(),
    finalityBasis: "operator-selected-rpc" as const, signatures: 0, broadcasts: 0 };
}
