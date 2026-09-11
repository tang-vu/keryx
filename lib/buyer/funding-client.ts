import { erc20Abi, type PublicClient, type WalletClient, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { BUYER_USDC } from "./protocol";
import { readGatewayCredit } from "../gateway/read-credit";
import { fundingTransaction, transactionHashSchema, verifyFundingTransaction, type FundingRecord, type FundingStep } from "./funding-policy";
import { claimFundingStep, readFundingRecord, saveFundingHash, rejectFundingPrompt, confirmFundingStep, resolveFundingReplacement } from "./funding-journal";
import { inspectFundingReplacement } from "./funding-replacement";

function userRejected(error: unknown): boolean {
  let value = error;
  for (let i = 0; i < 8 && value && typeof value === "object"; i++) {
    if ("code" in value && value.code === 4001) return true;
    value = "cause" in value ? value.cause : null;
  }
  return false;
}

async function checkIdentity(wallet: WalletClient, chain: PublicClient, payer: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const [addresses, walletChain, rpcChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId(), chain.getChainId()]);
  signal?.throwIfAborted();
  if (addresses[0]?.toLowerCase() !== payer.toLowerCase() || walletChain !== 5042002 || rpcChain !== 5042002) throw new Error("Funding requires the selected wallet and RPC on Arc testnet");
}

/** Exactly one explicit approval OR deposit prompt. Never automatically starts the next step. */
export async function submitFundingStep(input: { id: string; step: FundingStep; wallet: WalletClient; chain: PublicClient; signal?: AbortSignal }) {
  const { id, step, wallet, chain, signal } = input;
  const record = await readFundingRecord(id);
  if (!record.activePayer || !["ready", "rejected"].includes(record[step].status)
    || (step === "deposit" && record.approval.status !== "confirmed")) throw new Error("This funding step needs recovery, not another wallet request");
  const tx = fundingTransaction(record, step);
  await checkIdentity(wallet, chain, record.payer, signal);
  // Unknown Gateway credit must not encourage additional deposits.
  await readGatewayCredit(record.payer, signal);
  const [tokens, native, estimate, fees, nonce, head] = await Promise.all([
    chain.readContract({ address: BUYER_USDC, abi: erc20Abi, functionName: "balanceOf", args: [tx.from] }),
    chain.getBalance({ address: tx.from }), chain.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value: tx.value }),
    chain.estimateFeesPerGas(), chain.getTransactionCount({ address: tx.from, blockTag: "pending" }), chain.getBlockNumber(),
  ]);
  const gas = estimate * BigInt(120) / BigInt(100) + BigInt(1);
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error("Could not bound funding transaction fees");
  const gasReserve = (gas + (step === "approval" ? BigInt(120_000) : BigInt(0))) * fees.maxFeePerGas;
  if (tokens < BigInt(record.amount) || native < BigInt(record.amount) * BigInt(1_000_000_000_000) + gasReserve) throw new Error("Wallet needs enough USDC for the deposit and transaction gas");
  await checkIdentity(wallet, chain, record.payer, signal);
  if (!await claimFundingStep(id, step, nonce, head.toString())) throw new Error("Another tab already started this funding step");
  let hash: Hex;
  try {
    signal?.throwIfAborted();
    hash = await wallet.sendTransaction({ account: tx.from, chain: arcTestnet, to: tx.to, data: tx.data, value: tx.value, nonce, gas,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    transactionHashSchema.parse(hash);
  } catch (error) {
    if (userRejected(error)) {
      try { if (await rejectFundingPrompt(id, step)) return { state: "rejected" as const }; } catch { /* keep uncertain if state could not be saved */ }
    }
    return { state: "uncertain" as const };
  }
  try { await saveFundingHash(id, step, hash); return { state: "submitted" as const, hash }; }
  catch { return { state: "uncertain" as const, hash }; }
}

/** Signer-free RPC lookup. A user-supplied hash must prove the original nonce/calldata tuple. */
export async function recoverFundingStep(id: string, step: FundingStep, chain: PublicClient, suppliedHash?: string): Promise<FundingRecord> {
  const record = await readFundingRecord(id);
  if (!["possible", "submitted"].includes(record[step].status)) return record;
  const hash = transactionHashSchema.parse(suppliedHash ?? record[step].hash) as Hex;
  if (record[step].hash && record[step].hash?.toLowerCase() !== hash.toLowerCase()) throw new Error("Recovery hash differs from the saved transaction");
  if (await chain.getChainId() !== 5042002) throw new Error("Funding recovery requires Arc testnet RPC");
  const [tx, receipt, head] = await Promise.all([chain.getTransaction({ hash }), chain.getTransactionReceipt({ hash }), chain.getBlockNumber()]);
  const status = verifyFundingTransaction(record, step, hash, tx, receipt, head);
  if (await chain.getChainId() !== 5042002) throw new Error("Funding RPC network changed during recovery");
  if (record[step].status === "possible") await saveFundingHash(id, step, hash);
  await confirmFundingStep(id, step, hash, status);
  return readFundingRecord(id);
}

/** Explicit replacement lookup only; no wallet signing, nonce search or rebroadcast. */
export async function recoverFundingReplacement(id: string, step: FundingStep, chain: PublicClient, hash: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const snapshot = await readFundingRecord(id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const evidence = await Promise.race([inspectFundingReplacement(snapshot, step, hash, chain),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Replacement lookup timed out; the original remains unresolved")), 10_000); })]);
    signal?.throwIfAborted();
    await resolveFundingReplacement(snapshot, step, evidence);
    return readFundingRecord(id);
  } finally { clearTimeout(timer); }
}
