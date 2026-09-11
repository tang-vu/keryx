import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type PublicClient } from "viem";
import { inspectPastGatewayDeposit } from "./funding-activity";
import { GATEWAY_DEPOSIT_ABI } from "./funding-policy";
import { BUYER_GATEWAY, BUYER_USDC } from "./protocol";
const payer = `0x${"a".repeat(40)}`, hash = `0x${"1".repeat(64)}`, blockHash = `0x${"2".repeat(64)}`;
function setup() {
  const tx = { hash, from: payer, to: BUYER_GATEWAY as string, input: encodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [BUYER_USDC, BigInt(2_000_000)] }),
    value: BigInt(0), nonce: 70, blockHash, blockNumber: BigInt(101) };
  const receipt = { transactionHash: hash, blockHash, blockNumber: BigInt(101), status: "success" };
  const chain = { getChainId: vi.fn(async () => 5042002), getTransaction: vi.fn(async () => tx), getTransactionReceipt: vi.fn(async () => receipt),
    getBlock: vi.fn(async () => ({ hash: blockHash, number: BigInt(101) })) };
  return { tx, receipt, chain, inspect: (signal?: AbortSignal) => inspectPastGatewayDeposit(payer, hash, chain as unknown as PublicClient, signal) };
}
describe("past Gateway deposits without local originals", () => {
  it("observes an old deposit without a journal or today's new-deposit amount cap", async () => {
    const { inspect } = setup();
    expect(await inspect()).toEqual({ payer, hash, amountMicros: "2000000", blockHash, blockNumber: "101", status: "success", basis: "configured-rpc-finalized" });
  });
  it("reports a reverted call separately", async () => {
    const { inspect, receipt } = setup(); receipt.status = "reverted";
    expect((await inspect()).status).toBe("reverted");
  });
  it.each(["sender", "target", "value", "token", "zero", "trailing", "hash", "receipt", "canonical", "finality", "network"])("refuses %s mismatch", async kind => {
    const { inspect, tx, receipt, chain } = setup();
    if (kind === "sender") tx.from = `0x${"b".repeat(40)}`;
    if (kind === "target") tx.to = BUYER_USDC;
    if (kind === "value") tx.value = BigInt(1);
    if (kind === "token" || kind === "zero") tx.input = encodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [kind === "token" ? BUYER_GATEWAY : BUYER_USDC, BigInt(kind === "zero" ? 0 : 2_000_000)] });
    if (kind === "trailing") tx.input = `${tx.input}00`;
    if (kind === "hash") tx.hash = `0x${"3".repeat(64)}`;
    if (kind === "receipt") receipt.blockHash = `0x${"3".repeat(64)}`;
    if (kind === "canonical") chain.getBlock.mockResolvedValueOnce({ hash: `0x${"3".repeat(64)}`, number: BigInt(101) });
    if (kind === "finality") chain.getBlock.mockResolvedValueOnce({ hash: blockHash, number: BigInt(101) }).mockResolvedValueOnce({ hash: blockHash, number: BigInt(100) });
    if (kind === "network") chain.getChainId.mockResolvedValueOnce(5042002).mockResolvedValueOnce(1);
    await expect(inspect()).rejects.toThrow();
  });
  it("withholds completed observations after an account-change abort", async () => {
    const { inspect, chain } = setup(), abort = new AbortController();
    chain.getChainId.mockResolvedValueOnce(5042002).mockImplementationOnce(async () => { abort.abort(); return 5042002; });
    await expect(inspect(abort.signal)).rejects.toThrow();
  });
  it("bounds a hanging lookup without returning a late observation", async () => {
    vi.useFakeTimers();
    try {
      const { inspect, chain } = setup(); chain.getTransaction.mockImplementation(() => new Promise(() => {}));
      const assertion = expect(inspect()).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_001); await assertion;
    } finally { vi.useRealTimers(); }
  });
});
