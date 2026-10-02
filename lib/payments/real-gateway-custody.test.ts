import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const effects = vi.hoisted(() => ({ batch: vi.fn(), gateway: vi.fn(), public: vi.fn(), wallet: vi.fn(), account: vi.fn(), chain: vi.fn() }));
vi.mock("@circle-fin/x402-batching/client", () => ({
  BatchEvmScheme: class { constructor() { effects.batch(); } },
  GatewayClient: class { constructor() { effects.gateway(); } },
}));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: effects.public, createWalletClient: effects.wallet,
}));
vi.mock("viem/accounts", async importOriginal => {
  const actual = await importOriginal<typeof import("viem/accounts")>();
  return { ...actual, privateKeyToAccount: (...args: Parameters<typeof actual.privateKeyToAccount>) => {
    effects.account(); return actual.privateKeyToAccount(...args);
  } };
});
vi.mock("../arc-rpc-attestation", () => ({ assertArcRpcChain: effects.chain, attestedArcHttp: vi.fn() }));
vi.mock("../config", async () => ({ config: { funderKey: `0x${"22".repeat(32)}`, network: "arcTestnet",
  profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE } }));

let directory: string;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-custody-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); fs.rmSync(directory, { recursive: true, force: true }); });

it.each(["missing", "corrupt", "mismatched"])("actual RealGateway refuses %s custody before creating accounts, SDK clients or funding effects", async state => {
  const file = path.join(directory, "data", "spend-wallet.json");
  const key = generatePrivateKey();
  const bytes = state === "corrupt" ? `{\"privateKey\":\"${key}\",broken`
    : JSON.stringify({ privateKey: key, address: `0x${"11".repeat(20)}` });
  if (state !== "missing") { fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, bytes); }
  const { RealGateway } = await import("./real-gateway");
  // Key/address validation may derive the existing identity; SDK/funder account
  // construction must still be impossible after that mismatch.
  effects.account.mockClear();
  let error: unknown;
  try { new RealGateway(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Persistent treasury wallet unavailable; owner recovery required");
  expect(effects.account).toHaveBeenCalledTimes(state === "mismatched" ? 1 : 0);
  for (const effect of [effects.batch, effects.gateway, effects.public, effects.wallet, effects.chain, fetch]) expect(effect).not.toHaveBeenCalled();
  if (state === "missing") expect(fs.readdirSync(directory)).toEqual([]);
  else {
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["spend-wallet.json"]);
  }
});

it("actual RealGateway retains the existing valid legacy address without rewriting custody", async () => {
  const key = generatePrivateKey(), address = privateKeyToAccount(key).address;
  const file = path.join(directory, "data", "spend-wallet.json");
  const bytes = JSON.stringify({ privateKey: key, address }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, bytes);
  const { RealGateway } = await import("./real-gateway");
  expect(new RealGateway().agentAddress()).toBe(address);
  expect(fs.readFileSync(file, "utf8")).toBe(bytes);
  expect(effects.batch).not.toHaveBeenCalled(); expect(effects.gateway).not.toHaveBeenCalled();
  expect(effects.chain).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
