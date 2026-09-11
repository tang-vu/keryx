import { z } from "zod";
import { encodeFunctionData, keccak256, maxUint256, parseTransaction, recoverTransactionAddress,
  serializeTransaction, zeroAddress, type Hex, type TransactionSerialized } from "viem";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
  .pipe(z.string().refine(value => BigInt(value) <= maxUint256));
const positive = uint.refine(value => BigInt(value) > BigInt(0));
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex)
  .refine(value => value !== zeroAddress);

/** Exact operator-selected terms, eventually supplied by the durable nonce/gas slot.
 * Parsing these terms does not reserve that slot or establish key isolation. */
export const withdrawalMintTermsSchema = z.object({
  relayer: address,
  nonce: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  gas: positive, maxFeePerGas: positive, maxPriorityFeePerGas: uint,
  gasBudgetWei: positive,
}).strict().refine(value => BigInt(value.maxPriorityFeePerGas) <= BigInt(value.maxFeePerGas)
  && BigInt(value.gas) * BigInt(value.maxFeePerGas) <= BigInt(value.gasBudgetWei));
export type WithdrawalMintTerms = z.infer<typeof withdrawalMintTermsSchema>;
const rawSchema = z.string().max(4098).regex(/^0x02(?:[a-fA-F0-9]{2})+$/)
  .transform(value => value.toLowerCase() as TransactionSerialized);
// EIP-2 transaction signatures require low-s; address recovery alone permits both.
const HALF_CURVE_ORDER = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

/** Verify signed bytes before durable storage, and again on readback. This is not
 * a broadcaster. Only canonical EIP-1559 mint transactions with no access list fit
 * this format. Gas uses native 18-decimal wei, separate from 6-decimal ERC-20 USDC. */
export async function matchWithdrawalMintTransaction(selected: WithdrawalRequestRecord,
  response: unknown, raw: unknown, selectedTerms: WithdrawalMintTerms) {
  try {
    const snapshot = structuredClone({ selected, response });
    const terms = withdrawalMintTermsSchema.parse(selectedTerms), serializedTransaction = rawSchema.parse(raw);
    const record = await validateWithdrawalRequest(snapshot.selected);
    const attestation = await matchWithdrawalAttestation(record, snapshot.response);
    const transaction = parseTransaction(serializedTransaction);
    const expectedData = encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
      args: [attestation.attestation, attestation.signature] });
    if (transaction.type !== "eip1559" || transaction.chainId !== 5042002
      || (transaction.nonce ?? 0) !== terms.nonce
      || transaction.to?.toLowerCase() !== record.policy.gatewayMinter
      || transaction.data !== expectedData || (transaction.value ?? BigInt(0)) !== BigInt(0)
      || transaction.gas !== BigInt(terms.gas) || transaction.maxFeePerGas !== BigInt(terms.maxFeePerGas)
      || (transaction.maxPriorityFeePerGas ?? BigInt(0)) !== BigInt(terms.maxPriorityFeePerGas)
      || (transaction.accessList?.length ?? 0) !== 0 || !transaction.r || !transaction.s
      || BigInt(transaction.s) > HALF_CURVE_ORDER
      || serializeTransaction(transaction) !== serializedTransaction) throw new Error();
    const sender = await recoverTransactionAddress({ serializedTransaction });
    if (sender.toLowerCase() !== terms.relayer) throw new Error();
    return { format: "creator-withdrawal-mint-transaction-v1" as const,
      authority: "signed-transaction-matched-only" as const, requestId: record.id,
      transferId: attestation.transferId, transferSpecHash: attestation.transferSpecHash,
      expirationBlock: attestation.expirationBlock,
      chainId: 5042002 as const, minter: record.policy.gatewayMinter, terms,
      transactionHash: keccak256(serializedTransaction), serializedTransaction,
      maxGasCostWei: (BigInt(terms.gas) * BigInt(terms.maxFeePerGas)).toString() };
  } catch { throw new Error("Withdrawal mint transaction unavailable"); }
}
