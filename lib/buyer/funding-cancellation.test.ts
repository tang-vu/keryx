import { beforeEach, expect, it, vi } from "vitest";
import { keccak256, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fundingRecordSchema, type FundingRecord } from "./funding-policy";
const journal = vi.hoisted(() => ({ readFundingRecord: vi.fn(), claimFundingCancellation: vi.fn(), advanceFundingCancellation: vi.fn() }));
vi.mock("./funding-journal", () => journal);
import { reviewFundingCancellation, submitFundingCancellation } from "./funding-cancellation";

// Public synthetic fixture key; never used on any network.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`), payer = account.address.toLowerCase();
let row: FundingRecord;
beforeEach(() => {
  vi.resetAllMocks();
  row = fundingRecordSchema.parse({ schema: "keryx-gateway-funding-v1", id: "d612c6b6-f8c0-4e90-9ab7-63f037567d21", payer, activePayer: payer,
    amount: "70000", network: "eip155:5042002", approval: { status: "possible", nonce: 0, beforeBlock: "40" }, deposit: { status: "ready" },
    createdAt: "2026-09-09T08:00:00.000Z", updatedAt: "2026-09-09T08:00:00.000Z" });
  journal.readFundingRecord.mockImplementation(async () => structuredClone(row));
  journal.claimFundingCancellation.mockResolvedValue(true);
  journal.advanceFundingCancellation.mockResolvedValue(true);
});
function setup() {
  const wallet = { getAddresses: vi.fn(async () => [payer]), getChainId: vi.fn(async () => 5042002),
    signTransaction: vi.fn(async (tx: Parameters<typeof account.signTransaction>[0]) => account.signTransaction(tx)), sendTransaction: vi.fn() };
  const chain = { getChainId: vi.fn(async () => 5042002), getCode: vi.fn(async (): Promise<string | undefined> => undefined),
    getTransactionCount: vi.fn(async () => 0), getBalance: vi.fn(async () => BigInt("1000000000000000000")),
    estimateGas: vi.fn(async () => BigInt(21000)), estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: BigInt(1000000), maxPriorityFeePerGas: BigInt(100) })),
    sendRawTransaction: vi.fn(async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => keccak256(serializedTransaction)) };
  return { wallet, chain, w: wallet as unknown as WalletClient, c: chain as unknown as PublicClient };
}

it("reviews without signing and saves the independently verified hash before a single raw send", async () => {
  const { wallet, chain, w, c } = setup();
  const quote = await reviewFundingCancellation(row.id, w, c);
  expect(quote).toMatchObject({ payer, nonce: 0, gas: "25201", maxFeePerGas: "1200001", maxPriorityFeePerGas: "120" });
  expect(wallet.signTransaction).not.toHaveBeenCalled(); expect(journal.claimFundingCancellation).not.toHaveBeenCalled();
  chain.sendRawTransaction.mockImplementationOnce(async ({ serializedTransaction }) => {
    expect(journal.advanceFundingCancellation.mock.calls).toEqual([
      [row.id, quote.attemptId, "signed", keccak256(serializedTransaction)],
      [row.id, quote.attemptId, "broadcast-possible", keccak256(serializedTransaction)],
    ]); return keccak256(serializedTransaction);
  });
  await submitFundingCancellation(quote, w, c);
  expect(wallet.signTransaction).toHaveBeenCalledOnce(); expect(chain.sendRawTransaction).toHaveBeenCalledOnce();
  expect(wallet.signTransaction.mock.calls[0][0]).toMatchObject({ to: payer, value: BigInt(0), data: "0x", nonce: 0 });
  expect(wallet.sendTransaction).not.toHaveBeenCalled(); expect(row.approval.status).toBe("possible"); expect(row.activePayer).toBe(payer);
});

it.each(["owner", "wallet-chain", "rpc-chain", "code", "nonce", "gas-balance", "fees", "changed-record", "expired", "claim"])("blocks before signing on %s", async failure => {
  const { wallet, chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c);
  if (failure === "owner") wallet.getAddresses.mockResolvedValue([]);
  if (failure === "wallet-chain") wallet.getChainId.mockResolvedValue(1);
  if (failure === "rpc-chain") chain.getChainId.mockResolvedValue(1);
  if (failure === "code") chain.getCode.mockResolvedValue("0xef0100");
  if (failure === "nonce") chain.getTransactionCount.mockResolvedValue(1);
  if (failure === "changed-record") row.amount = "50000";
  if (failure === "expired") quote.expiresAt = Date.now() - 1;
  if (failure === "claim") journal.claimFundingCancellation.mockResolvedValue(false);
  if (failure === "gas-balance" || failure === "fees") {
    if (failure === "gas-balance") chain.getBalance.mockResolvedValue(BigInt(0));
    else chain.estimateFeesPerGas.mockRejectedValue(new Error("offline"));
    await expect(reviewFundingCancellation(row.id, w, c)).rejects.toThrow();
  } else await expect(submitFundingCancellation(quote, w, c)).rejects.toThrow();
  expect(wallet.signTransaction).not.toHaveBeenCalled(); expect(chain.sendRawTransaction).not.toHaveBeenCalled(); expect(row.activePayer).toBe(payer);
});

it.each(["value", "nonce", "to", "data", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "chainId", "accessList", "sender"])("rejects a signed %s mutation before persisting or sending", async field => {
  const { wallet, chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c);
  wallet.signTransaction.mockImplementationOnce(async tx => {
    const changes = { value: BigInt(1), nonce: 1, to: `0x${"2".repeat(40)}`, data: "0x01", gas: BigInt(99999), maxFeePerGas: BigInt(9999999),
      maxPriorityFeePerGas: BigInt(999), chainId: 1, accessList: [{ address: payer, storageKeys: [] }] };
    const signer = field === "sender" ? privateKeyToAccount(`0x${"2".repeat(64)}`) : account;
    return signer.signTransaction({ ...tx, ...(field === "sender" ? {} : { [field]: changes[field as keyof typeof changes] }) } as Parameters<typeof account.signTransaction>[0]);
  });
  await expect(submitFundingCancellation(quote, w, c)).rejects.toThrow();
  expect(journal.advanceFundingCancellation).not.toHaveBeenCalled(); expect(chain.sendRawTransaction).not.toHaveBeenCalled();
});

it.each(["abort", "expiry", "account-change", "stale-signer", "broadcast-claim", "storage"])("keeps the hold and never sends after %s during signing", async failure => {
  const { wallet, chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c), abort = new AbortController();
  wallet.signTransaction.mockImplementationOnce(async tx => {
    if (failure === "abort") abort.abort();
    if (failure === "expiry") quote.expiresAt = Date.now() - 1;
    if (failure === "account-change") wallet.getAddresses.mockResolvedValue([]);
    if (failure === "stale-signer") journal.advanceFundingCancellation.mockResolvedValue(false);
    if (failure === "broadcast-claim") journal.advanceFundingCancellation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    if (failure === "storage") journal.advanceFundingCancellation.mockRejectedValue(new Error("disk full"));
    return account.signTransaction(tx);
  });
  await expect(submitFundingCancellation(quote, w, c, abort.signal)).rejects.toThrow();
  expect(chain.sendRawTransaction).not.toHaveBeenCalled(); expect(row.activePayer).toBe(payer);
});

it("retains the hash and never retries an uncertain raw send", async () => {
  const { chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c);
  chain.sendRawTransaction.mockRejectedValue(new Error("timeout"));
  await expect(submitFundingCancellation(quote, w, c)).rejects.toThrow("timeout");
  expect(chain.sendRawTransaction).toHaveBeenCalledOnce();
  expect(journal.advanceFundingCancellation.mock.calls.at(-1)?.[2]).toBe("broadcast-possible");
  expect(row.activePayer).toBe(payer); expect(row.deposit.status).toBe("ready");
});

it.each(["abort", "expiry"])("does not open a prompt when %s occurs while the IndexedDB claim commits", async failure => {
  const { wallet, chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c), abort = new AbortController();
  journal.claimFundingCancellation.mockImplementationOnce(async () => {
    if (failure === "abort") abort.abort(); else quote.expiresAt = Date.now() - 1;
    return true;
  });
  await expect(submitFundingCancellation(quote, w, c, abort.signal)).rejects.toThrow();
  expect(wallet.signTransaction).not.toHaveBeenCalled(); expect(chain.sendRawTransaction).not.toHaveBeenCalled();
});

it("does not reopen the original approval after explicit wallet rejection", async () => {
  const { wallet, chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c);
  wallet.signTransaction.mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 }));
  await expect(submitFundingCancellation(quote, w, c)).rejects.toThrow("rejected");
  expect(journal.advanceFundingCancellation).not.toHaveBeenCalled(); expect(chain.sendRawTransaction).not.toHaveBeenCalled();
  expect(row.approval.status).toBe("possible"); expect(row.activePayer).toBe(payer);
});

it("retains its locally computed hash if the RPC returns a different hash", async () => {
  const { chain, w, c } = setup(), quote = await reviewFundingCancellation(row.id, w, c);
  chain.sendRawTransaction.mockResolvedValueOnce(`0x${"a".repeat(64)}`);
  await expect(submitFundingCancellation(quote, w, c)).rejects.toThrow("response differs");
  expect(chain.sendRawTransaction).toHaveBeenCalledOnce(); expect(row.activePayer).toBe(payer);
});
