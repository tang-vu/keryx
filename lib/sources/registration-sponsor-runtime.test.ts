import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, recoverTransactionAddress, type Hex, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { RegistrationSponsorPolicy } from "./registration-sponsor-protocol";
import { registrationSponsorReadChain, registrationSponsorRuntime } from "./registration-sponsor-runtime";

const mocked = vi.hoisted(() => ({
  config: { networkId: "eip155:5042", baseUrl: "https://keryx.example", registryAddress: "", registryReadAddress: "", rpcUrl: "https://rpc.invalid" },
  getDb: vi.fn(), createClient: vi.fn(), transport: vi.fn(),
  db: { admitRegistrationSponsor: vi.fn(), getRegistrationSponsor: vi.fn(), transitionRegistrationSponsor: vi.fn() },
  rpc: { getCode: vi.fn(), readContract: vi.fn(), getTransactionCount: vi.fn(), estimateGas: vi.fn(), sendRawTransaction: vi.fn(), getTransactionReceipt: vi.fn() },
}));
vi.mock("../config", () => ({ config: mocked.config }));
vi.mock("../db", () => ({ getDb: mocked.getDb }));
vi.mock("../chains", () => ({ chainForProfile: (profile: { chainId: number }) => ({ id: profile.chainId }) }));
vi.mock("../arc-rpc-attestation", () => ({ attestedArcAuthorityHttp: mocked.transport }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: mocked.createClient }));

// Public deterministic fixtures for local cryptographic checks; never funded or read from environment files.
const TEST_KEY = `0x${"11".repeat(32)}` as Hex;
const OTHER_TEST_KEY = `0x${"22".repeat(32)}` as Hex;
const sponsor = privateKeyToAccount(TEST_KEY);
const registry = `0x${"33".repeat(20)}` as Hex;
const wrongRegistry = `0x${"44".repeat(20)}` as Hex;
const hash = `0x${"55".repeat(32)}` as Hex;
const code = "0x6000" as Hex;
const NOW = Date.UTC(2026, 9, 9, 12);
function policy(overrides: Partial<RegistrationSponsorPolicy> = {}): RegistrationSponsorPolicy {
  return { protocol: "keryx-registration-sponsor-v1", network: "eip155:5042", deploymentOrigin: "https://keryx.example",
    registryAddress: registry, registryCodeHash: keccak256(code), sponsorAddress: sponsor.address.toLowerCase() as Hex,
    expiresAt: NOW + 3600_000, maxTransactionWei: "20000000000000000", maxDailyWei: "40000000000000000",
    maxLifetimeWei: "100000000000000000", maxGas: 400000, maxFeePerGasWei: "50000000000",
    maxRegistrationsPerWallet: 3, maxRegistrationsPerDay: 5, maxRegistrationsTotal: 10,
    allowlistedCreators: [wrongRegistry], ...overrides };
}
function original() {
  return { chainId: 5042 as const, registryAddress: registry, registryCodeHash: keccak256(code), relayer: sponsor.address.toLowerCase() as Hex };
}
function transaction(): TransactionSerializableEIP1559 {
  return { type: "eip1559", chainId: 5042, nonce: 7, to: registry, data: "0x1234", value: BigInt(0), gas: BigInt(400000),
    maxFeePerGas: BigInt(50000000000), maxPriorityFeePerGas: BigInt(1) };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  Object.assign(mocked.config, { networkId: "eip155:5042", baseUrl: "https://keryx.example", registryAddress: registry,
    registryReadAddress: registry, rpcUrl: "https://rpc.invalid" });
  vi.stubEnv("KERYX_REGISTRATION_SPONSOR_POLICY", JSON.stringify(policy()));
  vi.stubEnv("KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY", TEST_KEY);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("KERYX_REGISTRY_VERSION", "3"); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "3");
  mocked.getDb.mockResolvedValue(mocked.db); mocked.createClient.mockReturnValue(mocked.rpc);
  mocked.transport.mockReturnValue({ mocked: true }); mocked.rpc.getCode.mockResolvedValue(code);
  mocked.rpc.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "registryVersion" ? 3 : BigInt(0));
  mocked.rpc.getTransactionCount.mockResolvedValue(7); mocked.rpc.sendRawTransaction.mockResolvedValue(hash);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("registration sponsor runtime custody boundary", () => {
  it("stays disabled without a policy and never opens storage or an RPC client", async () => {
    vi.stubEnv("KERYX_REGISTRATION_SPONSOR_POLICY", undefined);
    expect(await registrationSponsorRuntime()).toBeNull();
    expect(mocked.getDb).not.toHaveBeenCalled(); expect(mocked.createClient).not.toHaveBeenCalled();
  });

  it.each(["offline", "V1", "version mismatch"])("refuses %s before creating sponsor authority", async reason => {
    if (reason === "offline") vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
    if (reason === "V1") { vi.stubEnv("KERYX_REGISTRY_VERSION", "1"); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "1"); }
    if (reason === "version mismatch") vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "1");
    await expect(registrationSponsorRuntime()).rejects.toThrow("Registration sponsorship configuration is unavailable");
    expect(mocked.getDb).not.toHaveBeenCalled(); expect(mocked.createClient).not.toHaveBeenCalled();
  });

  it.each(["network", "origin", "write registry", "read registry"])("rejects a policy outside the configured %s", async mismatch => {
    if (mismatch === "network") mocked.config.networkId = "eip155:5042002";
    if (mismatch === "origin") mocked.config.baseUrl = "https://other.example";
    if (mismatch === "write registry") mocked.config.registryAddress = wrongRegistry;
    if (mismatch === "read registry") mocked.config.registryReadAddress = wrongRegistry;
    await expect(registrationSponsorRuntime()).rejects.toThrow("Registration sponsorship configuration is unavailable");
    expect(mocked.createClient).not.toHaveBeenCalled(); expect(mocked.getDb).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid", OTHER_TEST_KEY])("refuses missing, malformed or foreign sponsor custody", async key => {
    vi.stubEnv("KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY", key);
    await expect(registrationSponsorRuntime()).rejects.toThrow("Registration sponsorship configuration is unavailable");
    expect(mocked.createClient).not.toHaveBeenCalled(); expect(mocked.getDb).not.toHaveBeenCalled();
  });

  it("requires atomic storage and an unexpired allowance, without a backend fallback", async () => {
    mocked.getDb.mockResolvedValue({});
    await expect(registrationSponsorRuntime()).rejects.toThrow("Registration sponsorship configuration is unavailable");
    mocked.getDb.mockResolvedValue(mocked.db); vi.stubEnv("KERYX_REGISTRATION_SPONSOR_POLICY", JSON.stringify(policy({ expiresAt: NOW })));
    mocked.getDb.mockClear();
    await expect(registrationSponsorRuntime()).rejects.toThrow("Registration sponsorship configuration is unavailable");
    expect(mocked.getDb).not.toHaveBeenCalled(); expect(mocked.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("signs only a bounded zero-value transaction through the policy's local sponsor fixture", async () => {
    const context = (await registrationSponsorRuntime())!;
    const raw = await context.chain.sign(transaction());
    expect((await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] })).toLowerCase()).toBe(context.policy.sponsorAddress);
    await expect(context.chain.sign({ ...transaction(), to: wrongRegistry })).rejects.toThrow();
    await expect(context.chain.sign({ ...transaction(), value: BigInt(1) })).rejects.toThrow();
    await expect(context.chain.sign({ ...transaction(), maxFeePerGas: BigInt(50000000001) })).rejects.toThrow();
    expect(mocked.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each(["policy", "custody", "expiry"])("freezes an existing runtime when %s changes before sign or broadcast", async changed => {
    const context = (await registrationSponsorRuntime())!;
    if (changed === "policy") vi.stubEnv("KERYX_REGISTRATION_SPONSOR_POLICY", JSON.stringify(policy({ maxRegistrationsTotal: 11 })));
    if (changed === "custody") vi.stubEnv("KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY", OTHER_TEST_KEY);
    if (changed === "expiry") vi.setSystemTime(context.policy.expiresAt);
    expect(() => context.assertPolicy()).toThrow("Registration sponsor policy unavailable");
    await expect(context.chain.sign(transaction())).rejects.toThrow("Registration sponsor policy unavailable");
    await expect(context.chain.broadcast(hash)).rejects.toThrow("Registration sponsor policy unavailable");
    expect(mocked.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("original registration receipt runtime", () => {
  it("needs no policy or sponsor key, retains original authority, and cannot sign or broadcast", async () => {
    vi.stubEnv("KERYX_REGISTRATION_SPONSOR_POLICY", undefined); vi.stubEnv("KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY", undefined);
    const reader = registrationSponsorReadChain(original());
    await reader.assertRegistry(); expect(await reader.transactionNonce()).toBe(7);
    expect(mocked.transport).toHaveBeenCalledWith("https://rpc.invalid", { timeout: 4000, retryCount: 0 }, ARC_MAINNET_PROFILE);
    await expect(reader.sign(transaction())).rejects.toThrow("Original receipt reader cannot sign");
    await expect(reader.broadcast(hash)).rejects.toThrow("Original receipt reader cannot broadcast");
    expect(mocked.getDb).not.toHaveBeenCalled(); expect(mocked.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each(["code", "version"])("rejects changed original registry %s before trusting receipt authority", async changed => {
    if (changed === "code") mocked.rpc.getCode.mockResolvedValue("0x6001");
    if (changed === "version") mocked.rpc.readContract.mockResolvedValue(2);
    await expect(registrationSponsorReadChain(original()).assertRegistry()).rejects.toThrow("Reviewed sponsored registry is unavailable");
  });

  it("refuses a pending sponsor nonce difference and another original network", async () => {
    mocked.rpc.getTransactionCount.mockImplementation(async ({ blockTag }: { blockTag: string }) => blockTag === "pending" ? 8 : 7);
    await expect(registrationSponsorReadChain(original()).transactionNonce()).rejects.toThrow("another unresolved transaction");
    mocked.createClient.mockClear();
    expect(() => registrationSponsorReadChain({ ...original(), chainId: 5042002 })).toThrow("Original registration belongs to another network");
    expect(mocked.createClient).not.toHaveBeenCalled();
  });

  it("keeps an absent receipt pending and exposes only a safe error for transport failures", async () => {
    const reader = registrationSponsorReadChain(original());
    mocked.rpc.getTransactionReceipt.mockRejectedValue({ name: "TransactionReceiptNotFoundError" });
    expect(await reader.receipt(hash)).toBeNull();
    mocked.rpc.getTransactionReceipt.mockRejectedValue(new Error("synthetic provider diagnostic"));
    await expect(reader.receipt(hash)).rejects.toThrow("Original registration receipt unavailable");
    expect(mocked.rpc.getTransactionReceipt).toHaveBeenLastCalledWith({ hash });
  });
});
