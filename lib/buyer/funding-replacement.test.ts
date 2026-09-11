import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { inspectFundingReplacement } from "./funding-replacement";
import { fundingRecordSchema, fundingTransaction } from "./funding-policy";
const payer = `0x${"a".repeat(40)}`, hash = `0x${"2".repeat(64)}`, blockHash = `0x${"3".repeat(64)}`;
function setup() {
  const row = fundingRecordSchema.parse({ schema: "keryx-gateway-funding-v1", id: "d612c6b6-f8c0-4e90-9ab7-63f037567d21", payer, activePayer: payer,
    amount: "50000", network: "eip155:5042002", approval: { status: "submitted", hash: `0x${"1".repeat(64)}`, nonce: 7, beforeBlock: "100" }, deposit: { status: "ready" },
    createdAt: "2026-09-09T08:00:00.000Z", updatedAt: "2026-09-09T08:00:00.000Z" });
  const expected = fundingTransaction(row, "approval");
  const tx = { hash, from: payer, to: expected.to, input: expected.data, value: BigInt(0), nonce: 7, blockHash, blockNumber: BigInt(101) };
  const receipt = { transactionHash: hash, blockHash, blockNumber: BigInt(101), status: "success" };
  const chain = { getChainId: vi.fn(async () => 5042002), getTransaction: vi.fn(async () => tx), getTransactionReceipt: vi.fn(async () => receipt),
    getBlock: vi.fn(async () => ({ hash: blockHash, number: BigInt(101) })) };
  return { row, tx, receipt, chain, inspect: () => inspectFundingReplacement(row, "approval", hash, chain as unknown as PublicClient) };
}
describe("finalized funding replacement evidence", () => {
  it("accepts an exact-call speedup without needing the dropped original", async () => {
    const { inspect, chain } = setup();
    expect(await inspect()).toMatchObject({ hash, status: "confirmed", blockNumber: "101", basis: "configured-rpc-finalized" });
    expect(chain.getTransaction).toHaveBeenCalledExactlyOnceWith({ hash });
    expect(chain.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
  });
  it("distinguishes a reverted matching call from any different replacement", async () => {
    const { inspect, tx, receipt } = setup(); receipt.status = "reverted";
    expect((await inspect()).status).toBe("reverted");
    tx.to = payer as typeof tx.to; tx.input = "0x" as typeof tx.input;
    expect((await inspect()).status).toBe("replaced");
    receipt.status = "success";
    expect((await inspect()).status).toBe("replaced");
  });
  it.each(["sender", "nonce", "hash", "receipt", "block", "canonical", "not-finalized", "finalized-hash", "old", "network"])("withholds resolution for %s mismatch", async kind => {
    const { inspect, tx, receipt, chain } = setup();
    if (kind === "sender") tx.from = `0x${"b".repeat(40)}`;
    if (kind === "nonce") tx.nonce++;
    if (kind === "hash") tx.hash = `0x${"4".repeat(64)}`;
    if (kind === "receipt") receipt.transactionHash = `0x${"4".repeat(64)}`;
    if (kind === "block") tx.blockNumber = BigInt(102);
    if (kind === "old") receipt.blockNumber = tx.blockNumber = BigInt(100);
    if (kind === "canonical") chain.getBlock.mockResolvedValueOnce({ hash: `0x${"4".repeat(64)}`, number: BigInt(101) });
    if (kind === "not-finalized") chain.getBlock.mockResolvedValueOnce({ hash: blockHash, number: BigInt(101) }).mockResolvedValueOnce({ hash: blockHash, number: BigInt(100) });
    if (kind === "finalized-hash") chain.getBlock.mockResolvedValueOnce({ hash: blockHash, number: BigInt(101) }).mockResolvedValueOnce({ hash: `0x${"4".repeat(64)}`, number: BigInt(101) });
    if (kind === "network") chain.getChainId.mockResolvedValueOnce(5042002).mockResolvedValueOnce(1);
    await expect(inspect()).rejects.toThrow();
  });
});
