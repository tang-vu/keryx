import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { assertGuardedEvmWallet } from "./guarded-evm-authority";

const state = vi.hoisted(() => ({
  config: { funderKey: "", rpcUrl: "https://synthetic.invalid", usdcAddress: "0x3600000000000000000000000000000000000000",
    gatewayMinAvailableUsdc: 1, gatewayDepositUsdc: "1.00" },
  key: "", balance: vi.fn(), native: vi.fn(), read: vi.fn(), receipt: vi.fn(), chain: vi.fn(), deposit: vi.fn(),
}));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("./persistent-treasury-wallet", () => ({ loadPersistentTreasuryWallet: () => ({ privateKey: state.key, address: privateKeyToAccount(state.key as `0x${string}`).address }) }));
vi.mock("../db/runtime-storage-config", () => ({ requireRuntimeStorageMode: vi.fn() }));
vi.mock("../arc-rpc-attestation", async importOriginal => {
  const actual = await importOriginal<typeof import("../arc-rpc-attestation")>();
  return { ...actual, assertArcRpcChain: state.chain };
});
vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({ getBalance: state.native, readContract: state.read,
    waitForTransactionReceipt: state.receipt }) };
});
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
vi.mock("./gateway-deposit-funding", () => ({ createGatewayDepositAttempt: state.deposit }));
import { RealGateway } from "./real-gateway";

beforeEach(() => {
  state.key = generatePrivateKey(); state.config.funderKey = generatePrivateKey();
  state.native.mockResolvedValue(BigInt("1000000000000000000"));
  state.read.mockResolvedValue(BigInt(1000000)); state.chain.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request"); }));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains the funded result and never constructs an SDK deposit attempt", async () => {
  state.balance.mockResolvedValue(BigInt(1000000));
  const gateway = new RealGateway(() => {});
  expect(await gateway.ensureFunded(0.1)).toEqual({ address: gateway.agentAddress() });
  await gateway.ensureFunded(0.1);
  await expect(gateway.ensureFunded(2)).rejects.toThrow("Funding terms changed");
  expect(state.balance).toHaveBeenCalledTimes(1); expect(state.deposit).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("retains unknown Circle availability without a new automatic funding attempt", async () => {
  state.balance.mockResolvedValue(null);
  const gateway = new RealGateway(() => {});
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("credit unavailable");
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("credit unavailable");
  expect(state.balance).toHaveBeenCalledTimes(1); expect(state.deposit).not.toHaveBeenCalled();
});

it("refuses a retained gateway after authority changes during the native balance read", async () => {
  let valid = true, resolve!: (value: bigint) => void;
  state.balance.mockResolvedValue(BigInt(0));
  state.native.mockImplementation(() => new Promise<bigint>(r => { resolve = r; }));
  const gateway = new RealGateway(() => { if (!valid) throw new Error("Storage binding changed"); });
  const pending = gateway.ensureFunded(0.1);
  await vi.waitFor(() => expect(state.native).toHaveBeenCalled());
  valid = false; resolve(BigInt(0));
  await expect(pending).rejects.toThrow("Storage binding changed");
  expect(fetch).not.toHaveBeenCalled(); expect(state.balance).toHaveBeenCalledTimes(1);
});

it("refuses insufficient bounded prefunding before sending any transaction", async () => {
  state.balance.mockResolvedValue(BigInt(0));
  const gateway = new RealGateway(() => {});
  await expect(gateway.ensureFunded(2)).rejects.toThrow("prefunding amount insufficient");
  expect(state.native).not.toHaveBeenCalled(); expect(state.deposit).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("passes the same guarded account/transport binding to deposit and requires Circle credit", async () => {
  state.balance.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(null);
  let run!: ReturnType<typeof vi.fn>;
  state.deposit.mockImplementation(options => {
    assertGuardedEvmWallet(options.walletClient, options.guard);
    expect(options.amountMicros).toBe(BigInt(1000000));
    expect(options.maxAmountMicros).toBe(options.amountMicros);
    run = vi.fn(async () => ({ stage: "confirmed", depositTxHash: `0x${"ab".repeat(32)}` }));
    return { run, snapshot: () => ({ stage: "confirmed" }) };
  });
  const gateway = new RealGateway(() => {});
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("credit unavailable");
  await expect(gateway.ensureFunded(0.1)).rejects.toThrow("credit unavailable");
  expect(state.deposit).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledTimes(1);
});

it("does not accept the deposit tolerance below the requested funding minimum", async () => {
  vi.useFakeTimers();
  state.balance.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(990000)).mockResolvedValueOnce(BigInt(1000000));
  state.deposit.mockImplementation(options => {
    assertGuardedEvmWallet(options.walletClient, options.guard);
    return { run: async () => ({ stage: "confirmed", depositTxHash: `0x${"ab".repeat(32)}` }), snapshot: () => ({ stage: "confirmed" }) };
  });
  const gateway = new RealGateway(() => {});
  const funded = gateway.ensureFunded(1);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(funded).resolves.toMatchObject({ address: gateway.agentAddress() });
  expect(state.balance).toHaveBeenCalledTimes(3);
});
