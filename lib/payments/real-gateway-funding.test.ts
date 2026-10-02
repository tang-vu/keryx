import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const state = vi.hoisted(() => ({
  spendKey: `0x${"11".repeat(32)}` as `0x${string}`, funderKey: `0x${"22".repeat(32)}` as `0x${string}`,
  available: vi.fn(), native: vi.fn(), read: vi.fn(), receipt: vi.fn(), send: vi.fn(), sdk: vi.fn(), wallet: vi.fn(),
  deposit: "1",
  minimum: 0.1,
}));
vi.mock("../config", () => ({ config: { funderKey: state.funderKey, rpcUrl: "https://synthetic.invalid", network: "arcTestnet",
  usdcAddress: "0x3600000000000000000000000000000000000000", gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  get gatewayMinAvailableUsdc() { return state.minimum; }, get gatewayDepositUsdc() { return state.deposit; } } }));
vi.mock("./persistent-treasury-wallet", () => ({ loadPersistentTreasuryWallet: () => ({ privateKey: state.spendKey }) }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.available }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ getBalance: state.native, readContract: state.read, waitForTransactionReceipt: state.receipt }),
  createWalletClient: state.wallet,
}));
vi.mock("@circle-fin/x402-batching/client", () => ({ BatchEvmScheme: class {},
  GatewayClient: class { constructor() { state.sdk(); } },
}));
vi.mock("./guarded-arc-transaction", async importOriginal => ({
  ...await importOriginal<typeof import("./guarded-arc-transaction")>(), sendGuardedArcTransaction: state.send,
}));
import { RealGateway } from "./real-gateway";
import { ARC_GATEWAY_DEPOSIT_ABI } from "./guarded-arc-transaction";
import { GuardedArcSubmissionUnknownError } from "./guarded-arc-transaction";

beforeEach(() => {
  vi.resetAllMocks(); state.deposit = "1"; state.minimum = 0.1;
  state.native.mockResolvedValue(parseEther("1"));
  state.read.mockResolvedValue(BigInt(0));
  state.receipt.mockImplementation(async ({ hash }) => ({ status: "success", transactionHash: hash }));
  state.send.mockImplementation(async () => `0x${String(state.send.mock.calls.length).padStart(64, "0")}`);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves already funded treasury behavior without an SDK key/client or transaction", async () => {
  state.available.mockResolvedValue(BigInt(1000000));
  const gateway = new RealGateway();
  expect(await gateway.ensureFunded(0.1)).toEqual({ address: gateway.agentAddress() });
  expect(state.send).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
  expect(state.sdk).not.toHaveBeenCalled(); expect(state.wallet).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(await gateway.ensureFunded(0.1)).toEqual({ address: gateway.agentAddress() });
  expect(state.available).toHaveBeenCalledOnce();
  await expect(gateway.ensureFunded(0.2)).rejects.toThrow("budget changed");
});

it("routes native funding, USDC transfer, exact approval and deposit through the local guard", async () => {
  state.native.mockResolvedValue(BigInt(0));
  state.available.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(1000000));
  const gateway = new RealGateway();
  expect(await gateway.ensureFunded(0.1)).toEqual({ address: gateway.agentAddress(), depositTx: `0x${"4".padStart(64, "0")}` });
  const calls = state.send.mock.calls.map(([call]) => call);
  expect(calls).toHaveLength(4);
  expect(calls.map(call => call.account.address)).toEqual([
    privateKeyToAccount(state.funderKey).address, privateKeyToAccount(state.funderKey).address,
    gateway.agentAddress(), gateway.agentAddress(),
  ]);
  expect(calls.every(call => call.rpcUrl === "https://synthetic.invalid")).toBe(true);
  expect(calls[0].transaction).toEqual({ to: gateway.agentAddress(), value: parseEther("0.05") });
  expect(calls[1].transaction.to).toBe("0x3600000000000000000000000000000000000000");
  expect(decodeFunctionData({ abi: erc20Abi, data: calls[1].transaction.data })).toEqual({ functionName: "transfer", args: [gateway.agentAddress(), BigInt(1000000)] });
  expect(decodeFunctionData({ abi: erc20Abi, data: calls[2].transaction.data })).toEqual({ functionName: "approve", args: ["0x0077777d7EBA4688BDeF3E311b846F25870A19B9", BigInt(1000000)] });
  expect(calls[3].transaction.to).toBe("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
  expect(calls[3].transaction.gas).toBe(BigInt(120000));
  expect(decodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, data: calls[3].transaction.data })).toEqual({ functionName: "deposit", args: ["0x3600000000000000000000000000000000000000", BigInt(1000000)] });
  expect(state.receipt).toHaveBeenCalledTimes(4); expect(state.sdk).not.toHaveBeenCalled(); expect(state.wallet).not.toHaveBeenCalled();
});

it("keeps an existing sufficient allowance and confirms the deposit before accepting credit", async () => {
  state.read.mockResolvedValue(BigInt(1000000));
  state.available.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(1000000));
  await new RealGateway().ensureFunded(0.1);
  expect(state.send).toHaveBeenCalledOnce(); expect(state.receipt).toHaveBeenCalledOnce();
  expect(state.read.mock.calls.map(([call]) => call.functionName)).toEqual(["balanceOf", "allowance"]);
});

it("shares one in-flight funding outcome across concurrent same-budget callers", async () => {
  let release!: (value: bigint) => void;
  state.native.mockImplementation(() => new Promise<bigint>(resolve => { release = resolve; }));
  state.available.mockResolvedValue(BigInt(1000000));
  const gateway = new RealGateway();
  const first = gateway.ensureFunded(0.1), second = gateway.ensureFunded(0.1);
  expect(state.native).toHaveBeenCalledOnce();
  release(parseEther("1"));
  expect(await Promise.all([first, second])).toEqual(Array(2).fill({ address: gateway.agentAddress() }));
  expect(state.available).toHaveBeenCalledOnce(); expect(state.send).not.toHaveBeenCalled();
});

it("does not treat unknown Gateway credit as zero or initiate token funding", async () => {
  state.available.mockResolvedValue(null);
  const gateway = new RealGateway();
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("funding outcome unknown");
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("funding outcome unknown");
  expect(state.available).toHaveBeenCalledOnce();
  expect(state.send).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, Number.MAX_SAFE_INTEGER, 0.0000001, 0.1000001, 0.1 + 0.2])("refuses invalid budget %s before funding effects", async budget => {
  await expect(new RealGateway().ensureFunded(budget)).rejects.toThrow("budget is invalid");
  expect(state.native).not.toHaveBeenCalled(); expect(state.available).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, Number.MAX_SAFE_INTEGER, 0.0000001, 0.1000001])("refuses invalid availability minimum %s without rounding", async minimum => {
  state.minimum = minimum;
  await expect(new RealGateway().ensureFunded(0.1)).rejects.toThrow("configuration is invalid");
  expect(state.native).not.toHaveBeenCalled(); expect(state.available).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});

it("accepts an exact one-micro-USDC budget and minimum", async () => {
  state.minimum = 0.000001; state.available.mockResolvedValue(BigInt(1));
  const gateway = new RealGateway();
  expect(await gateway.ensureFunded(0.000001)).toEqual({ address: gateway.agentAddress() });
  expect(state.send).not.toHaveBeenCalled();
});

it.each(["0", "1.0000001", "-1", "1e2", "99999999999999999"])("refuses invalid deposit %s before funding effects", async deposit => {
  state.deposit = deposit;
  await expect(new RealGateway().ensureFunded(0.1)).rejects.toThrow("configuration is invalid");
  expect(state.native).not.toHaveBeenCalled(); expect(state.available).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});

it("retains original post-submit uncertainty without another funding attempt", async () => {
  const hash = `0x${"ab".repeat(32)}` as const;
  const unknown = new GuardedArcSubmissionUnknownError(hash);
  state.native.mockResolvedValue(BigInt(0)); state.send.mockRejectedValue(unknown);
  const gateway = new RealGateway();
  await expect(gateway.ensureFunded(0.1)).rejects.toBe(unknown);
  await expect(gateway.ensureFunded(0.1)).rejects.toMatchObject({ transactionHash: hash });
  expect(state.send).toHaveBeenCalledOnce(); expect(state.available).not.toHaveBeenCalled();
});

it.each(["timeout", "mismatched-hash", "unknown-status"])("keeps the original hash after %s receipt uncertainty", async fault => {
  state.read.mockResolvedValue(BigInt(1000000)); state.available.mockResolvedValue(BigInt(0));
  if (fault === "timeout") state.receipt.mockRejectedValue(new Error("raw credential marker"));
  else state.receipt.mockResolvedValue({ status: fault === "unknown-status" ? "unknown" : "success", transactionHash: fault === "unknown-status" ? `0x${"1".padStart(64, "0")}` : `0x${"ab".repeat(32)}` });
  const gateway = new RealGateway();
  const pending = gateway.ensureFunded(0.1);
  await expect(pending).rejects.toMatchObject({ name: "GuardedArcSubmissionUnknownError", transactionHash: `0x${"1".padStart(64, "0")}` });
  await expect(gateway.ensureFunded(0.1)).rejects.not.toThrow("raw credential marker");
  expect(state.send).toHaveBeenCalledOnce(); expect(state.available).toHaveBeenCalledOnce();
});

it("stops after local signing-policy rejection without attempting a later funding leg", async () => {
  state.native.mockResolvedValue(BigInt(0)); state.send.mockRejectedValue(new Error("local signing refused"));
  await expect(new RealGateway().ensureFunded(0.1)).rejects.toThrow("local signing refused");
  expect(state.send).toHaveBeenCalledOnce(); expect(state.receipt).not.toHaveBeenCalled(); expect(state.available).not.toHaveBeenCalled();
});

it("stops after a reverted approval and never submits the deposit", async () => {
  state.read.mockResolvedValueOnce(BigInt(1000000)).mockResolvedValueOnce(BigInt(0));
  state.available.mockResolvedValue(BigInt(0)); state.receipt.mockImplementation(async ({ hash }) => ({ status: "reverted", transactionHash: hash }));
  await expect(new RealGateway().ensureFunded(0.1)).rejects.toThrow("reverted");
  expect(state.send).toHaveBeenCalledOnce(); expect(state.available).toHaveBeenCalledOnce();
});

it("does not use deposit tolerance to accept credit below the requested minimum", async () => {
  vi.useFakeTimers(); state.read.mockResolvedValue(BigInt(1000000));
  state.available.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(990000)).mockResolvedValueOnce(BigInt(1000000));
  const funded = new RealGateway().ensureFunded(1);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(funded).resolves.toHaveProperty("depositTx");
  expect(state.available).toHaveBeenCalledTimes(3);
});

it("refuses credit timeout instead of reporting a funded result", async () => {
  vi.useFakeTimers(); state.read.mockResolvedValue(BigInt(1000000)); state.available.mockResolvedValue(BigInt(0));
  const funded = new RealGateway().ensureFunded(0.1);
  const rejection = expect(funded).rejects.toMatchObject({ name: "TreasuryGatewayCreditUnknownError", transactionHash: `0x${"1".padStart(64, "0")}` });
  await vi.advanceTimersByTimeAsync(90000); await rejection;
  expect(state.send).toHaveBeenCalledOnce();
});
