import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { z } from "zod";
import { addressSchema, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "./protocol";

export const fundingAmountSchema = z.string().regex(/^[1-9]\d{0,6}$/).refine(value => Number(value) <= 1_000_000);
export const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const fundingResolutionSchema = z.object({
  hash: transactionHashSchema, blockHash: transactionHashSchema, blockNumber: z.string().regex(/^\d{1,24}$/),
  status: z.enum(["confirmed", "reverted", "replaced"]), basis: z.literal("configured-rpc-finalized"),
}).strict();
const legSchema = z.object({ status: z.enum(["ready", "possible", "submitted", "confirmed", "reverted", "rejected", "replaced"]), hash: transactionHashSchema.optional(),
  originalHash: transactionHashSchema.optional(), resolution: fundingResolutionSchema.optional(),
  nonce: z.number().int().nonnegative().safe().optional(), beforeBlock: z.string().regex(/^\d{1,24}$/).optional(),
}).strict()
  .refine(value => !["submitted", "confirmed", "reverted", "replaced"].includes(value.status) || !!value.hash, "Mined/submitted transaction needs a hash")
  .refine(value => value.status !== "replaced" || !!value.resolution, "Replacement needs finalized evidence")
  .refine(value => !value.resolution || (value.resolution.status === value.status && value.resolution.hash.toLowerCase() === value.hash?.toLowerCase()), "Resolution must match the terminal transaction")
  .refine(value => !value.originalHash || (!!value.resolution && value.originalHash.toLowerCase() !== value.hash?.toLowerCase()), "Original hash requires a distinct resolved transaction")
  .refine(value => !["ready", "possible", "rejected"].includes(value.status) || !value.hash, "Unsubmitted leg cannot contain a hash")
  .refine(value => ["ready", "rejected"].includes(value.status) || (value.nonce !== undefined && value.beforeBlock !== undefined), "Attempt needs a nonce and observed block");
export const fundingRecordSchema = z.object({
  schema: z.literal("keryx-gateway-funding-v1"), id: z.string().uuid(), payer: addressSchema,
  activePayer: addressSchema.optional(), network: z.literal(BUYER_NETWORK), amount: fundingAmountSchema,
  approval: legSchema, deposit: legSchema, cancelled: z.boolean().default(false), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().superRefine((row, ctx) => {
  if (row.payer !== row.payer.toLowerCase() || (row.activePayer && row.activePayer !== row.payer)) ctx.addIssue({ code: "custom", message: "Funding wallet key mismatch" });
  const terminal = row.cancelled || row.deposit.status === "confirmed" || row.deposit.status === "reverted" || row.approval.status === "reverted" || row.deposit.status === "replaced" || row.approval.status === "replaced";
  if (terminal === !!row.activePayer) ctx.addIssue({ code: "custom", message: "Funding lock does not match terminal state" });
  if (row.deposit.status !== "ready" && row.approval.status !== "confirmed") ctx.addIssue({ code: "custom", message: "Deposit requires confirmed approval" });
  if (row.cancelled && (!["ready", "rejected"].includes(row.deposit.status) || !["ready", "rejected", "confirmed"].includes(row.approval.status))) ctx.addIssue({ code: "custom", message: "Cannot cancel an uncertain funding transaction" });
});
export type FundingRecord = z.infer<typeof fundingRecordSchema>;
export type FundingStep = "approval" | "deposit";
export const GATEWAY_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;

export function fundingTransaction(record: FundingRecord, step: FundingStep) {
  fundingRecordSchema.parse(record);
  const amount = BigInt(record.amount);
  return { from: record.payer as Hex, to: (step === "approval" ? BUYER_USDC : BUYER_GATEWAY) as Hex, value: BigInt(0),
    data: step === "approval" ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [BUYER_GATEWAY, amount] })
      : encodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [BUYER_USDC, amount] }) };
}

/** A hash is only a lookup key: match the mined sender, target, exact calldata and zero value. */
export function verifyFundingTransaction(record: FundingRecord, step: FundingStep, hash: string, tx: {
  hash: string; from: string; to: string | null; input: string; value: bigint; nonce: number; blockHash: string | null; blockNumber: bigint | null;
}, receipt: { transactionHash: string; blockHash: string; blockNumber: bigint; status: "success" | "reverted" }, head: bigint) {
  transactionHashSchema.parse(hash);
  const expected = fundingTransaction(record, step);
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
  if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || !same(tx.from, expected.from) || !same(tx.to, expected.to)
    || !same(tx.input, expected.data) || tx.value !== BigInt(0) || !same(tx.blockHash, receipt.blockHash)
    || tx.nonce !== record[step].nonce || record[step].beforeBlock === undefined || receipt.blockNumber <= BigInt(record[step].beforeBlock!)
    || tx.blockNumber !== receipt.blockNumber || head < receipt.blockNumber + BigInt(1)) throw new Error("Funding transaction is unconfirmed or does not match this deposit");
  return receipt.status === "success" ? "confirmed" as const : "reverted" as const;
}
