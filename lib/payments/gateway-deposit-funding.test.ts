import { createWalletClient, custom, type LocalAccount, type PublicClient, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { expect, it, vi } from "vitest";
import { guardedEvmTransport, guardedLocalAccount } from "./guarded-evm-authority";
import { createGatewayDepositAttempt, GATEWAY_DEPOSIT_USDC, GATEWAY_DEPOSIT_WALLET } from "./gateway-deposit-funding";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}` as const;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(initialAllowance = BigInt(0)) {
  let enabled = true, allowance = initialAllowance;
  const sign = vi.fn(async () => "0xabcdef" as const);
  const account = { address, publicKey: "0x00", type: "local", source: "custom", signTransaction: sign,
    signMessage: sign, signTypedData: sign } as unknown as LocalAccount;
  const guard = { assertAuthority: () => { if (!enabled) throw new Error("binding changed"); }, attestChain: vi.fn(async () => {}) };
  const send = vi.fn(async () => hash);
  const wallet = createWalletClient({ account: guardedLocalAccount(account, guard), chain: arcTestnet,
    transport: guardedEvmTransport(custom({ request: send }), guard) });
  const write = vi.fn(async (parameters: Parameters<typeof wallet.writeContract>[0]) =>
    wallet.writeContract({ ...parameters, gas: parameters.gas ?? BigInt(120000), gasPrice: BigInt(1), nonce: 1, type: "legacy" } as Parameters<typeof wallet.writeContract>[0]));
  const read = vi.fn(async ({ functionName }: { functionName: string }) => functionName === "balanceOf" ? BigInt(100) : allowance);
  const receipt = vi.fn(async () => { allowance = BigInt(100); return { transactionHash: hash, status: "success" as const }; });
  const publicClient = { readContract: read, waitForTransactionReceipt: receipt } as unknown as Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
  const options = { address, amountMicros: BigInt(50), maxAmountMicros: BigInt(100), publicClient,
    walletClient: { ...wallet, writeContract: write as unknown as WalletClient["writeContract"] }, guard } satisfies Parameters<typeof createGatewayDepositAttempt>[0];
  return { options, sign, send, write, read, receipt, refuse: () => { enabled = false; } };
}

it("uses actual viem approve/deposit signing and exact pinned ABI terms, deduplicating an attempt", async () => {
  const f = fixture(), attempt = createGatewayDepositAttempt(f.options);
  const first = attempt.run(); expect(attempt.run()).toBe(first); await first;
  expect(f.write).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: GATEWAY_DEPOSIT_USDC,
    functionName: "approve", args: [GATEWAY_DEPOSIT_WALLET, BigInt(50)] }));
  expect(f.write).toHaveBeenNthCalledWith(2, expect.objectContaining({ address: GATEWAY_DEPOSIT_WALLET,
    functionName: "deposit", args: [GATEWAY_DEPOSIT_USDC, BigInt(50)], gas: BigInt(120000) }));
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.send).toHaveBeenCalledTimes(2);
  expect(attempt.snapshot()).toMatchObject({ stage: "confirmed", approvalTxHash: hash, depositTxHash: hash });
});
it("skips approval only when actual allowance suffices", async () => {
  const f = fixture(BigInt(50)); await createGatewayDepositAttempt(f.options).run();
  expect(f.write).toHaveBeenCalledTimes(1); expect(f.write.mock.calls[0][0].functionName).toBe("deposit");
});
it.each(["balanceOf", "allowance"])("refuses after deferred %s without obtaining signatures", async blocked => {
  const f = fixture(), gate = deferred<bigint>();
  f.read.mockImplementation(async ({ functionName }) => functionName === blocked ? gate.promise : BigInt(100));
  const attempt = createGatewayDepositAttempt(f.options), result = attempt.run();
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ functionName: blocked })));
  f.refuse(); gate.resolve(BigInt(100)); await expect(result).rejects.toThrow("refused"); expect(f.sign).not.toHaveBeenCalled();
});
it("retains the approval hash and refuses deposit after drift during receipt wait", async () => {
  const f = fixture(), gate = deferred<{transactionHash: typeof hash; status: "success"}>();
  f.receipt.mockReturnValue(gate.promise); const attempt = createGatewayDepositAttempt(f.options), result = attempt.run();
  await vi.waitFor(() => expect(f.receipt).toHaveBeenCalled()); f.refuse(); gate.resolve({ transactionHash: hash, status: "success" });
  await expect(result).rejects.toThrow("unresolved"); expect(f.write).toHaveBeenCalledTimes(1);
  expect(attempt.snapshot()).toMatchObject({ stage: "uncertain", approvalTxHash: hash }); expect(attempt.run()).toBe(result);
});
it("preserves uncertain lost send acknowledgement without automatic replay", async () => {
  const f = fixture(BigInt(100)); f.send.mockRejectedValue(new Error("sensitive endpoint failure"));
  const attempt = createGatewayDepositAttempt(f.options), result = attempt.run();
  await expect(result).rejects.toThrow("unresolved"); await expect(attempt.run()).rejects.not.toThrow("sensitive");
  expect(f.send).toHaveBeenCalledTimes(1); expect(attempt.snapshot()).toMatchObject({ stage: "uncertain" });
});
it("retains deposit hash after receipt timeout and refuses fresh retry", async () => {
  const f = fixture(BigInt(100)); f.receipt.mockRejectedValue(new Error("private timeout details"));
  const attempt = createGatewayDepositAttempt(f.options), first = attempt.run();
  await expect(first).rejects.toThrow("unresolved"); expect(attempt.run()).toBe(first);
  expect(attempt.snapshot()).toMatchObject({ stage: "uncertain", depositTxHash: hash }); expect(f.send).toHaveBeenCalledTimes(1);
});
it("requires observed allowance after successful approval receipt", async () => {
  const f = fixture(); f.receipt.mockResolvedValue({ transactionHash: hash, status: "success" });
  const attempt = createGatewayDepositAttempt(f.options); await expect(attempt.run()).rejects.toThrow();
  expect(f.write).toHaveBeenCalledTimes(1); expect(attempt.snapshot()).toMatchObject({ stage: "uncertain", approvalTxHash: hash });
});
it("stops on an actual reverted receipt and never automatically retries", async () => {
  const f = fixture(BigInt(100)); f.receipt.mockResolvedValue({ transactionHash: hash, status: "reverted" } as never);
  const attempt = createGatewayDepositAttempt(f.options); await expect(attempt.run()).rejects.toThrow();
  expect(attempt.snapshot()).toMatchObject({ stage: "failed", depositTxHash: hash }); expect(f.write).toHaveBeenCalledTimes(1);
});
it("refuses unguarded accounts/transports, overbudget and wrong-chain requests", () => {
  const f = fixture();
  expect(() => createGatewayDepositAttempt({ ...f.options, amountMicros: BigInt(101) })).toThrow();
  expect(() => createGatewayDepositAttempt({ ...f.options, amountMicros: BigInt(0) })).toThrow();
  expect(() => createGatewayDepositAttempt({ ...f.options, guard: { ...f.options.guard } })).toThrow("Guarded");
  expect(() => createGatewayDepositAttempt({ ...f.options, walletClient: { ...f.options.walletClient, chain: { ...arcTestnet, id: 1 } } })).toThrow();
  expect(() => createGatewayDepositAttempt({ ...f.options, walletClient: { ...f.options.walletClient, account: { ...f.options.walletClient.account! } } })).toThrow("Guarded");
});
