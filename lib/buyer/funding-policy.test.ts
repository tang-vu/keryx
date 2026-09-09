import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { fundingRecordSchema, fundingTransaction, verifyFundingTransaction, GATEWAY_DEPOSIT_ABI } from "./funding-policy";
import { BUYER_GATEWAY, BUYER_USDC } from "./protocol";

const payer = `0x${"a".repeat(40)}`;
const hash = `0x${"1".repeat(64)}`;
const record = fundingRecordSchema.parse({ schema: "keryx-gateway-funding-v1", id: "d612c6b6-f8c0-4e90-9ab7-63f037567d21", payer, activePayer: payer,
  amount: "50000", network: "eip155:5042002", approval: { status: "submitted", hash, nonce: 7, beforeBlock: "100" }, deposit: { status: "ready" },
  createdAt: "2026-09-09T08:00:00.000Z", updatedAt: "2026-09-09T08:00:00.000Z" });
const plan = fundingTransaction(record, "approval");
const tx = { hash, from: payer, to: plan.to, input: plan.data, value: BigInt(0), nonce: 7, blockHash: `0x${"2".repeat(64)}`, blockNumber: BigInt(101) };
const receipt = { transactionHash: hash, blockHash: tx.blockHash, blockNumber: BigInt(101), status: "success" as const };

describe("funding proof and bounds", () => {
  it("approves only the exact amount and deposits to the sender's own Gateway account", () => {
    expect(plan.to).toBe(BUYER_USDC);
    expect(decodeFunctionData({ abi: erc20Abi, data: plan.data })).toMatchObject({ functionName: "approve", args: [BUYER_GATEWAY, BigInt(50000)] });
    const deposit = fundingTransaction(record, "deposit");
    expect(deposit.to).toBe(BUYER_GATEWAY); expect(deposit.value).toBe(BigInt(0));
    expect(decodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, data: deposit.data })).toMatchObject({ functionName: "deposit", args: [BUYER_USDC, BigInt(50000)] });
  });
  it.each(["0", "-1", "0.05", "1000001"])("refuses invalid funding amount %s", amount => {
    expect(fundingRecordSchema.safeParse({ ...record, amount }).success).toBe(false);
  });
  it("requires matched mined evidence and two block confirmations", () => {
    expect(verifyFundingTransaction(record, "approval", hash, tx, receipt, BigInt(102))).toBe("confirmed");
    expect(verifyFundingTransaction(record, "approval", hash, tx, { ...receipt, status: "reverted" }, BigInt(102))).toBe("reverted");
    expect(() => verifyFundingTransaction(record, "approval", hash, tx, receipt, BigInt(101))).toThrow();
  });
  it.each([{ nonce: 6 }, { value: BigInt(1) }, { from: BUYER_GATEWAY }, { to: BUYER_GATEWAY }, { input: "0x" },
    { blockHash: null }, { blockNumber: BigInt(100) }, { hash: `0x${"3".repeat(64)}` }])("refuses another transaction or pre-intent evidence %#", patch => {
    expect(() => verifyFundingTransaction(record, "approval", hash, { ...tx, ...patch }, receipt, BigInt(102))).toThrow();
  });
  it("does not let a cancelled or unapproved deposit masquerade as an active record", () => {
    expect(fundingRecordSchema.safeParse({ ...record, cancelled: true }).success).toBe(false);
    expect(fundingRecordSchema.safeParse({ ...record, deposit: record.approval }).success).toBe(false);
    expect(fundingRecordSchema.safeParse({ ...record, activePayer: undefined }).success).toBe(false);
  });
});
