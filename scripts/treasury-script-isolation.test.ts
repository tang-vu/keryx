import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError } from "../lib/payments/guarded-arc-transaction";
import { REGISTRY_ABI } from "../lib/registry/registry-client";

const state = vi.hoisted(() => ({
  key: `0x${"01".repeat(32)}` as `0x${string}`,
  funderKey: `0x${"02".repeat(32)}` as `0x${string}`,
  usdc: "0x3600000000000000000000000000000000000000",
  gateway: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  registry: `0x${"ab".repeat(20)}`,
  available: BigInt(0), receiptStatus: "success", wrongHash: false, receiptFailure: false,
  allowance: BigInt(0), native: BigInt(0), clue: 0,
  readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), balance: vi.fn(),
  send: vi.fn(), pay: vi.fn(), receipt: vi.fn(), publicClient: vi.fn(), walletClient: vi.fn(),
  loadWallet: vi.fn(), signer: vi.fn(), upsert: vi.fn(), sources: vi.fn(), sourcePayee: vi.fn(),
}));
vi.mock("node:fs", () => ({ default: { readFileSync: state.readFile, writeFileSync: state.writeFile, mkdirSync: state.mkdir },
  readFileSync: state.readFile, writeFileSync: state.writeFile, mkdirSync: state.mkdir }));
vi.mock("../lib/config", () => ({ config: {
  network: "arcTestnet", rpcUrl: "https://synthetic.invalid", usdcAddress: state.usdc,
  gatewayWallet: state.gateway, registryAddress: state.registry, funderKey: state.funderKey,
  baseUrl: "https://synthetic.invalid", networkId: "eip155:5042002", maxTimeoutSeconds: 691200,
} }));
vi.mock("../lib/arc-rpc-attestation", () => ({ attestedArcHttp: vi.fn(), assertArcRpcChain: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: state.publicClient, createWalletClient: state.walletClient }));
vi.mock("../lib/payments/guarded-arc-transaction", async (original) => ({
  ...await original<typeof import("../lib/payments/guarded-arc-transaction")>(), sendGuardedArcTransaction: state.send,
}));
vi.mock("../lib/gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
vi.mock("../lib/payments/pinned-arc-batch-signer", () => ({ createPinnedArcBatchSigner: state.signer }));
vi.mock("../lib/payments/server-x402-client", () => ({ payWithServerSigner: state.pay }));
vi.mock("../lib/payments/persistent-treasury-wallet", () => ({ loadPersistentTreasuryWallet: state.loadWallet, loadPersistentWebClientWallet: state.loadWallet }));
vi.mock("../lib/db/index", () => ({ getDb: async () => ({ listSources: state.sources, getSource: async () => (await state.sources())[0], upsertSource: state.upsert }) }));
vi.mock("../lib/registry/source-fetch-payto", () => ({ sourceFetchPayTo: state.sourcePayee }));
vi.mock("../lib/sources/wallet-store", () => ({ findWallet: () => ({ privateKey: state.key, address: privateKeyToAccount(state.key).address }) }));
vi.mock("../lib/registry/registry-client", async (original) => ({
  ...await original<typeof import("../lib/registry/registry-client")>(), getRegistrySource: async () => null,
}));

async function run(name: string, args: string[] = []) {
  process.argv = ["node", name, ...args];
  const target = `./${name}.mts`;
  await import(target);
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("KERYX_TREASURE_PAYEE", privateKeyToAccount(state.funderKey).address);
  vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", state.key);
  vi.stubEnv("KERYX_GATEWAY_DEPOSIT", "0.5");
  state.available = BigInt(0); state.allowance = BigInt(0); state.native = BigInt(0); state.clue = 0;
  state.receiptStatus = "success"; state.wrongHash = false; state.receiptFailure = false;
  state.readFile.mockImplementation(() => JSON.stringify({ privateKey: state.key, address: privateKeyToAccount(state.key).address }));
  state.loadWallet.mockReturnValue({ privateKey: state.key, address: privateKeyToAccount(state.key).address });
  state.balance.mockImplementation(async () => state.available);
  state.send.mockImplementation(async ({ transaction }) => {
    if (transaction.to === state.gateway) state.available = BigInt(1000000);
    return `0x${state.send.mock.calls.length.toString(16).padStart(64, "0")}`;
  });
  state.receipt.mockImplementation(async ({ hash }) => {
    if (state.receiptFailure) throw new Error("synthetic transport failure; bearer must not be printed");
    return { status: state.receiptStatus, transactionHash: state.wrongHash ? `0x${"ff".repeat(32)}` : hash, blockNumber: BigInt(1) };
  });
  state.publicClient.mockReturnValue({ getBalance: async () => state.native,
    readContract: async ({ functionName }: { functionName: string }) => functionName === "allowance" ? state.allowance : BigInt(2000000),
    waitForTransactionReceipt: state.receipt });
  state.walletClient.mockImplementation(({ account }) => ({ signMessage: async ({ message }: { message: string }) => account.signMessage({ message }) }));
  state.signer.mockReturnValue({ createPaymentPayload: vi.fn() });
  state.pay.mockImplementation(async () => ({ settlementStatus: "settled", delivered: true, amountUsdc: 0.03,
    transaction: "synthetic-settlement", data: { clue: "synthetic", step: ++state.clue, total_steps: 5 } }));
  state.sources.mockResolvedValue([{ id: "synthetic-source", url: "https://source.invalid/article", walletAddress: privateKeyToAccount(state.key).address,
    fetchPrice: 0.002, authors: [{ walletAddress: privateKeyToAccount(state.key).address, splitWeight: 1 }], tags: [] }]);
  state.sourcePayee.mockResolvedValue(privateKeyToAccount(state.funderKey).address);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/api/auth/nonce")) return Response.json({ nonce: "12345678" });
    if (url.endsWith("/api/auth/verify")) return Response.json({ ok: true });
    if (url.endsWith("/api/faucet")) return Response.json({ error: "already claimed" }, { status: 409 });
    if (url.endsWith("/api/session/grant")) return Response.json({ sessionId: "synthetic-session" });
    if (url.endsWith("/api/ask")) return new Response(new ReadableStream({ start(controller) { controller.close(); } }));
    throw new Error("unexpected network route");
  }));
  process.exitCode = 0;
});
afterEach(() => { process.exitCode = 0; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("manual script transaction intent", () => {
  it("test-pay binds funder gas/transfer and wallet exact approval/deposit before a source-authorized payment", async () => {
    await run("test-pay", ["synthetic-source"]);
    const intents = state.send.mock.calls.map(([input]) => input);
    expect(intents).toHaveLength(4);
    const account = privateKeyToAccount(state.key), funder = privateKeyToAccount(state.funderKey);
    expect(intents.map(i => i.account.address)).toEqual([funder.address, funder.address, account.address, account.address]);
    expect(intents[0].transaction).toEqual({ to: account.address, value: parseEther("0.05") });
    expect(decodeFunctionData({ abi: erc20Abi, data: intents[1].transaction.data }).args).toEqual([account.address, BigInt(1000000)]);
    expect(decodeFunctionData({ abi: erc20Abi, data: intents[2].transaction.data }).args).toEqual([state.gateway, BigInt(1000000)]);
    expect(intents[3].transaction.to).toBe(state.gateway);
    expect(intents[3].transaction.gas).toBe(BigInt(120000));
    expect(decodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, data: intents[3].transaction.data }).args).toEqual([state.usdc, BigInt(1000000)]);
    expect(state.pay.mock.calls[0][0]).toMatchObject({ expectedPayee: funder.address, expectedAmount: 0.002, payer: account.address });
  });
  it.each(["reverted", "unknown-status", "wrong-hash", "receipt-loss", "submission-loss"])("test-pay stops the original %s before transfer/deposit/payment", async (failure) => {
    if (failure === "reverted") state.receiptStatus = "reverted";
    if (failure === "unknown-status") state.receiptStatus = "unrecognized";
    if (failure === "wrong-hash") state.wrongHash = true;
    if (failure === "receipt-loss") state.receiptFailure = true;
    if (failure === "submission-loss") state.send.mockRejectedValue(new GuardedArcSubmissionUnknownError(`0x${"ef".repeat(32)}`));
    await run("test-pay");
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.pay).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/0x[0-9a-f]{64}.*inspect the original hash/));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("bearer");
  });
  it("rejects an invalid requested source before any funding or balance I/O", async () => {
    await run("test-pay", ["missing-source"]);
    expect(state.send).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled(); expect(state.pay).not.toHaveBeenCalled();
  });
  it("treasure demo deposits exactly 0.5 and pays only the explicit creator and 0.03 toll", async () => {
    await run("treasure-hunt");
    expect(state.send).toHaveBeenCalledTimes(2);
    const approval = state.send.mock.calls[0][0], deposit = state.send.mock.calls[1][0];
    expect(decodeFunctionData({ abi: erc20Abi, data: approval.transaction.data }).args).toEqual([state.gateway, BigInt(500000)]);
    expect(decodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, data: deposit.transaction.data }).args).toEqual([state.usdc, BigInt(500000)]);
    expect(state.pay).toHaveBeenCalledTimes(5);
    for (const [input] of state.pay.mock.calls) expect(input).toMatchObject({ expectedPayee: privateKeyToAccount(state.funderKey).address, expectedAmount: 0.03 });
  });
  it("headless web binds asker funding and session approval/deposit without giving an SDK its session key", async () => {
    state.native = parseEther("2");
    await run("web-client");
    expect(state.send).toHaveBeenCalledTimes(3);
    const [fund, approval, deposit] = state.send.mock.calls.map(([input]) => input);
    expect(fund.account.address).toBe(privateKeyToAccount(state.key).address);
    expect(fund.transaction.to).toBe(approval.account.address);
    expect(fund.transaction.gas).toBe(BigInt(21000));
    expect(decodeFunctionData({ abi: erc20Abi, data: approval.transaction.data }).args).toEqual([state.gateway, BigInt(850000)]);
    expect(deposit.account.address).toBe(approval.account.address);
    expect(decodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, data: deposit.transaction.data }).args).toEqual([state.usdc, BigInt(850000)]);
    expect(state.signer).not.toHaveBeenCalled(); expect(state.pay).not.toHaveBeenCalled();
  });
  it("an exhausted headless wallet preserves custody and refuses without rotation or funding", async () => {
    await run("web-client");
    expect(process.exitCode).toBe(1); expect(state.send).not.toHaveBeenCalled();
    expect(state.writeFile).not.toHaveBeenCalled(); expect(state.loadWallet).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Wallet identity was preserved"));
  });
  it("registration binds source creator gas and exact registry registration before confirming the DB transaction", async () => {
    await run("register-existing-source-onchain", ["synthetic-source"]);
    const [fund, register] = state.send.mock.calls.map(([input]) => input);
    expect(fund.account.address).toBe(privateKeyToAccount(state.funderKey).address);
    expect(fund.transaction).toEqual({ to: privateKeyToAccount(state.key).address, value: parseEther("0.02"), gas: BigInt(21000) });
    expect(register.account.address).toBe(privateKeyToAccount(state.key).address);
    expect(register.transaction.to).toBe(state.registry);
    expect(decodeFunctionData({ abi: REGISTRY_ABI, data: register.transaction.data }).functionName).toBe("register");
    expect(state.upsert.mock.calls[1][0].registerTx).toBe(`0x${"2".padStart(64, "0")}`);
  });
});

describe("keyless manual-operation refusal", () => {
  it.each(["test-pay", "web-client", "treasure-hunt"].flatMap(name => ["missing", "corrupt"].map(kind => [name, kind])))
  ("actual %s CLI refuses %s existing custody without creating/replacing a wallet or network effects", async (name, kind) => {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const tempParent = os.tmpdir();
    const fixture = actualFs.mkdtempSync(path.join(tempParent, "keryx-diagnostic-custody-"));
    const walletName = name === "test-pay" ? "test-wallet.json" : name === "web-client" ? "web-client-state.json" : "buyer-wallet.json";
    const walletPath = path.join(fixture, "data", walletName);
    actualFs.mkdirSync(path.dirname(walletPath));
    if (kind === "corrupt") actualFs.writeFileSync(walletPath, "{invalid synthetic custody}");
    const script = path.resolve(import.meta.dirname, `${name}.mts`);
    const cacheParent = path.resolve(import.meta.dirname, "../node_modules/.cache");
    actualFs.mkdirSync(cacheParent, { recursive: true });
    const compiledDir = actualFs.mkdtempSync(path.join(cacheParent, "keryx-diagnostic-custody-"));
    const compiled = path.join(compiledDir, `${name}.mjs`);
    const bundle = await build({ entryPoints: [script], bundle: true, packages: "external", platform: "node",
      format: "esm", write: false, tsconfig: path.resolve(import.meta.dirname, "../tsconfig.json") });
    actualFs.writeFileSync(compiled, bundle.outputFiles[0].contents);
    const blocker = 'import net from "node:net";const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(options,...args){if(typeof options==="string"||options?.path)return connect.call(this,options,...args);throw new Error("NETWORK_BLOCKED")};globalThis.fetch=async()=>{throw new Error("NETWORK_BLOCKED")};';
    try {
      const child = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(blocker)}`, compiled], {
        cwd: fixture, timeout: 10_000, encoding: "utf8", env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP,
          KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WALLET_FILE: walletPath,
          KERYX_TREASURE_PAYEE: privateKeyToAccount(state.funderKey).address },
      });
      expect(child.error).toBeUndefined(); expect(child.status).toBe(1);
      expect(child.stderr).toContain("Persistent treasury wallet unavailable; owner recovery required");
      expect(child.stderr).not.toContain("NETWORK_BLOCKED");
      if (kind === "missing") expect(actualFs.existsSync(walletPath)).toBe(false);
      else expect(actualFs.readFileSync(walletPath, "utf8")).toBe("{invalid synthetic custody}");
      expect(actualFs.readdirSync(path.dirname(walletPath))).toEqual(kind === "missing" ? [] : [walletName]);
    } finally {
      if (fixture.startsWith(path.join(tempParent, "keryx-diagnostic-custody-"))) actualFs.rmSync(fixture, { recursive: true, force: true });
      if (compiledDir.startsWith(path.join(cacheParent, "keryx-diagnostic-custody-"))) actualFs.rmSync(compiledDir, { recursive: true, force: true });
    }
  });
  it.each([["withdraw", ["--help"]], ["withdraw", ["--live"]], ["treasure-hunt", ["--help"]]])("%s %s performs no wallet or network effects", async (name, args) => {
    await run(name as string, args as string[]);
    expect(state.readFile).not.toHaveBeenCalled(); expect(state.writeFile).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(state.publicClient).not.toHaveBeenCalled(); expect(state.signer).not.toHaveBeenCalled();
  });
  it.each([undefined, "invalid", `0x${"00".repeat(20)}`])("treasure refuses missing/invalid/zero creator before wallet or funding", async (payee) => {
    vi.stubEnv("KERYX_TREASURE_PAYEE", payee);
    await run("treasure-hunt");
    expect(process.exitCode).toBe(1); expect(state.readFile).not.toHaveBeenCalled(); expect(state.writeFile).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
