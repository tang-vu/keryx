import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import { fundingRecordSchema, fundingTransaction, type FundingRecord } from "./funding-policy";
const storage = vi.hoisted(() => ({ readFundingRecord: vi.fn(), claimFundingStep: vi.fn(), saveFundingHash: vi.fn(), rejectFundingPrompt: vi.fn(), confirmFundingStep: vi.fn() }));
const credit = vi.hoisted(() => vi.fn());
vi.mock("./funding-journal", () => storage);
vi.mock("../gateway/read-credit", () => ({ readGatewayCredit: credit }));
import { recoverFundingStep, submitFundingStep } from "./funding-client";

const payer = `0x${"a".repeat(40)}`;
const hash = `0x${"1".repeat(64)}`;
let row: FundingRecord;
beforeEach(() => {
  vi.resetAllMocks();
  row = fundingRecordSchema.parse({ schema: "keryx-gateway-funding-v1", id: "d612c6b6-f8c0-4e90-9ab7-63f037567d21", payer, activePayer: payer,
    amount: "50000", network: "eip155:5042002", approval: { status: "ready" }, deposit: { status: "ready" },
    createdAt: "2026-09-09T08:00:00.000Z", updatedAt: "2026-09-09T08:00:00.000Z" });
  credit.mockResolvedValue(BigInt(0));
  storage.readFundingRecord.mockImplementation(async () => structuredClone(row));
  storage.claimFundingStep.mockImplementation(async (_id, step, nonce, beforeBlock) => {
    if (row[step as "approval" | "deposit"].status !== "ready") return false;
    row[step as "approval" | "deposit"] = { status: "possible", nonce, beforeBlock }; return true;
  });
  storage.saveFundingHash.mockImplementation(async (_id, step, value) => {
    row[step as "approval" | "deposit"] = { ...row[step as "approval" | "deposit"], status: "submitted", hash: value };
  });
  storage.rejectFundingPrompt.mockResolvedValue(true);
});
function setup() {
  const send = vi.fn(async (request: unknown) => { if (!request) throw new Error("Missing transaction"); return hash; });
  const wallet = { getAddresses: vi.fn(async () => [payer]), getChainId: vi.fn(async () => 5042002), sendTransaction: send };
  const chain = { getChainId: vi.fn(async () => 5042002), readContract: vi.fn(async () => BigInt(50000)), getBalance: vi.fn(async () => BigInt("1000000000000000000")),
    estimateGas: vi.fn(async () => BigInt(21000)), estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: BigInt(1000000), maxPriorityFeePerGas: BigInt(1000000) })),
    getTransactionCount: vi.fn(async () => 7), getBlockNumber: vi.fn(async () => BigInt(100)), getTransaction: vi.fn(), getTransactionReceipt: vi.fn(),
  };
  const input = { id: row.id, step: "approval" as const, wallet: wallet as unknown as WalletClient, chain: chain as unknown as PublicClient };
  return { input, wallet, chain, send };
}

describe("explicit one-step funding", () => {
  it("commits the nonce/boundary before exactly one bounded wallet transaction", async () => {
    const { input, send } = setup();
    send.mockImplementation(async () => { expect(row.approval).toEqual({ status: "possible", nonce: 7, beforeBlock: "100" }); return hash; });
    expect(await submitFundingStep(input)).toEqual({ state: "submitted", hash });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ nonce: 7, value: BigInt(0), gas: BigInt(25201), maxFeePerGas: BigInt(1000000) });
    expect(row.deposit.status).toBe("ready");
    await expect(submitFundingStep(input)).rejects.toThrow("recovery");
    expect(send).toHaveBeenCalledOnce();
  });
  it.each(["wallet", "chain", "credit", "tokens", "gas", "storage"])("stops before the wallet prompt on %s failure", async failure => {
    const { input, wallet, chain, send } = setup();
    if (failure === "wallet") wallet.getAddresses.mockResolvedValue([]);
    if (failure === "chain") chain.getChainId.mockResolvedValue(1);
    if (failure === "credit") credit.mockRejectedValue(new Error("unavailable"));
    if (failure === "tokens") chain.readContract.mockResolvedValue(BigInt(49999));
    if (failure === "gas") chain.getBalance.mockResolvedValue(BigInt(0));
    if (failure === "storage") storage.claimFundingStep.mockRejectedValue(new Error("disk full"));
    await expect(submitFundingStep(input)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it("keeps unknown wallet responses locked and only reopens a wallet-reported rejection", async () => {
    const { input, send } = setup();
    send.mockRejectedValueOnce(new Error("response lost"));
    expect(await submitFundingStep(input)).toEqual({ state: "uncertain" });
    expect(storage.rejectFundingPrompt).not.toHaveBeenCalled();
    row.approval = { status: "ready" };
    send.mockRejectedValueOnce({ cause: { code: 4001 } });
    expect(await submitFundingStep(input)).toEqual({ state: "rejected" });
    expect(storage.rejectFundingPrompt).toHaveBeenCalledOnce();
  });
  it("returns the transaction hash when persisting it fails, without sending another transaction", async () => {
    const { input, send } = setup(); storage.saveFundingHash.mockRejectedValue(new Error("quota"));
    expect(await submitFundingStep(input)).toEqual({ state: "uncertain", hash }); expect(send).toHaveBeenCalledOnce();
  });
  it("allows only one racing caller to open the same step", async () => {
    const { input, send } = setup();
    const results = await Promise.allSettled([submitFundingStep(input), submitFundingStep(input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(send).toHaveBeenCalledOnce();
  });
  it("requires mined transaction evidence before attaching a manually recovered hash", async () => {
    const { input, chain, send } = setup(); row.approval = { status: "possible", nonce: 7, beforeBlock: "100" };
    const expected = fundingTransaction(row, "approval");
    const tx = { hash, from: payer, to: expected.to, input: expected.data, value: BigInt(0), nonce: 6, blockHash: `0x${"2".repeat(64)}`, blockNumber: BigInt(101) };
    chain.getTransaction.mockResolvedValue(tx);
    chain.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash: tx.blockHash, blockNumber: BigInt(101), status: "success" });
    chain.getBlockNumber.mockResolvedValue(BigInt(102));
    await expect(recoverFundingStep(row.id, "approval", input.chain, hash)).rejects.toThrow("match");
    expect(storage.saveFundingHash).not.toHaveBeenCalled(); expect(storage.confirmFundingStep).not.toHaveBeenCalled();
    chain.getTransaction.mockResolvedValue({ ...tx, nonce: 7 });
    await recoverFundingStep(row.id, "approval", input.chain, hash);
    expect(storage.confirmFundingStep).toHaveBeenCalledWith(row.id, "approval", hash, "confirmed"); expect(send).not.toHaveBeenCalled();
  });
});
