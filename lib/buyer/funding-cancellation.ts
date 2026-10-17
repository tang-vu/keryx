import { keccak256, serializeTransaction, stringToHex, type Hex, type PublicClient, type WalletClient } from "viem";
import { arcChain } from "../chains";
import { browserPaymentProfile } from "../browser-payment-profile";
import { verifyCircleSignedTransaction } from "../circle-wallet-transaction";
import { advanceFundingCancellation, claimFundingCancellation, readFundingRecord } from "./funding-journal";
import { fundingCancellationQuoteSchema, fundingRecordSchema, type FundingCancellationQuote, type FundingRecord } from "./funding-policy";

export const fundingRecordDigest = (record: FundingRecord) => keccak256(stringToHex(JSON.stringify(fundingRecordSchema.parse(record))));

function eligible(record: FundingRecord) {
  fundingRecordSchema.parse(record);
  if (!record.activePayer || record.deposit.status !== "ready" || !["possible", "submitted"].includes(record.approval.status)
    || record.approval.nonce === undefined || record.approval.beforeBlock === undefined) throw new Error("Original approval needs nonce recovery");
}

async function identity(wallet: WalletClient, chain: PublicClient, record: FundingRecord, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const [addresses, walletChain, rpcChain, code, nonce] = await Promise.all([
    wallet.getAddresses(), wallet.getChainId(), chain.getChainId(),
    chain.getCode({ address: record.payer as Hex }), chain.getTransactionCount({ address: record.payer as Hex, blockTag: "latest" }),
  ]);
  signal?.throwIfAborted();
  if (addresses[0]?.toLowerCase() !== record.payer || walletChain !== browserPaymentProfile().chainId
    || rpcChain !== browserPaymentProfile().chainId || (code && code !== "0x") || nonce !== record.approval.nonce)
    throw new Error("Owner, network or original nonce changed; inspect existing transactions");
}

/** Read-only fee review. A zero-value self-transfer consumes exactly the old approval nonce.
 * Absence of an original transaction never releases the original funding hold. */
export async function reviewFundingCancellation(id: string, wallet: WalletClient, chain: PublicClient, signal?: AbortSignal): Promise<FundingCancellationQuote> {
  const record = await readFundingRecord(id); eligible(record);
  await identity(wallet, chain, record, signal);
  const [estimate, fees, native] = await Promise.all([
    chain.estimateGas({ account: record.payer as Hex, to: record.payer as Hex, value: BigInt(0), data: "0x" }),
    chain.estimateFeesPerGas(), chain.getBalance({ address: record.payer as Hex }),
  ]);
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error("Cancellation fees are unavailable");
  const gas = estimate * BigInt(120) / BigInt(100) + BigInt(1);
  const maxFeePerGas = fees.maxFeePerGas * BigInt(120) / BigInt(100) + BigInt(1);
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas * BigInt(120) / BigInt(100);
  if (native < gas * maxFeePerGas) throw new Error("Wallet needs native USDC for cancellation gas");
  await identity(wallet, chain, record, signal);
  if (fundingRecordDigest(await readFundingRecord(id)) !== fundingRecordDigest(record)) throw new Error("Funding record changed; review again");
  return fundingCancellationQuoteSchema.parse({ attemptId: crypto.randomUUID(), recordId: record.id, recordDigest: fundingRecordDigest(record),
    payer: record.payer, chainId: browserPaymentProfile().chainId, nonce: record.approval.nonce,
    gas: gas.toString(), maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString(), expiresAt: Date.now() + 60_000 });
}

function fresh(quote: FundingCancellationQuote, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (Date.now() >= quote.expiresAt) throw new Error("Cancellation review expired; review the fee again");
}

/** One owner-requested signature and one raw send. Never retries, deposits, renews a budget,
 * clears the hold, or mistakes a send response for finalized nonce consumption. */
export async function submitFundingCancellation(quote: FundingCancellationQuote, wallet: WalletClient, chain: PublicClient, signal?: AbortSignal) {
  fundingCancellationQuoteSchema.parse(quote); fresh(quote, signal);
  // Locate the exact retained record rather than accepting a new payer/nonce from a form.
  const snapshot = await readFundingRecord(quote.recordId);
  if (fundingRecordDigest(snapshot) !== quote.recordDigest) throw new Error("Funding record changed; review cancellation again");
  eligible(snapshot); await identity(wallet, chain, snapshot, signal); fresh(quote, signal);
  if (!await claimFundingCancellation(snapshot, quote)) throw new Error("Another tab changed the cancellation review");
  await identity(wallet, chain, snapshot, signal); fresh(quote, signal);
  const tx = { type: "eip1559" as const, chainId: quote.chainId, nonce: quote.nonce, to: quote.payer as Hex,
    value: BigInt(0), data: "0x" as Hex, gas: BigInt(quote.gas), maxFeePerGas: BigInt(quote.maxFeePerGas), maxPriorityFeePerGas: BigInt(quote.maxPriorityFeePerGas) };
  const unsigned = serializeTransaction(tx);
  // eth_signTransaction returns raw signed bytes. Using sendTransaction here could lose
  // the only lookup hash if the provider broadcasts and its callback is interrupted.
  const signed = await wallet.signTransaction({ ...tx, account: quote.payer as Hex, chain: arcChain });
  await verifyCircleSignedTransaction(unsigned, signed, quote.payer, quote.chainId);
  const hash = keccak256(signed);
  // Save a verified hash even if the review expired while the owner was signing.
  // An expired result is never broadcast by this flow, but remains identifiable.
  if (!await advanceFundingCancellation(snapshot.id, quote.attemptId, "signed", hash))
    throw new Error("Cancellation signature is stale; the original remains held");
  await identity(wallet, chain, snapshot, signal); fresh(quote, signal);
  if (!await advanceFundingCancellation(snapshot.id, quote.attemptId, "broadcast-possible", hash))
    throw new Error("Cancellation was superseded; the original remains held");
  fresh(quote, signal);
  const sent = await chain.sendRawTransaction({ serializedTransaction: signed });
  if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error("Cancellation response differs; inspect the retained hash");
  return hash;
}
