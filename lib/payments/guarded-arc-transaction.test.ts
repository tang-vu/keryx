import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError, sendGuardedArcTransaction, type IntendedArcTransaction } from "./guarded-arc-transaction";

const USDC = "0x3600000000000000000000000000000000000000" as const;
const GATEWAY = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const PAYEE = `0x${"22".repeat(20)}` as const;
const ATTACKER = `0x${"33".repeat(20)}` as const;
const operations: [string, IntendedArcTransaction][] = [
  ["native funding", { to: PAYEE, value: BigInt(50), gas: BigInt(21_000) }],
  ["USDC funding", { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [PAYEE, BigInt(2_000)] }) }],
  ["approval", { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GATEWAY, BigInt(2_000)] }) }],
  ["deposit", { to: GATEWAY, data: encodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [USDC, BigInt(2_000)] }), gas: BigInt(120_000) }],
];

function fixture(mutateFill?: (tx: Record<string, unknown>) => void, chain?: () => string) {
  const original = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const sign = vi.fn(original.signTransaction.bind(original));
  const account = { ...original, signTransaction: sign };
  const submitted: Hex[] = [];
  const methods: string[] = [];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params?: unknown[]; id: number };
    methods.push(request.method);
    let result: unknown;
    if (request.method === "eth_chainId") result = chain?.() ?? "0x4cef52";
    else if (request.method === "eth_fillTransaction") {
      const requested = request.params![0] as Record<string, unknown>;
      const tx = { ...requested, from: original.address, chainId: "0x4cef52", type: "0x2", nonce: "0x0",
        gas: requested.gas ?? "0x1d4c0", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x3b9aca00",
        input: requested.data ?? "0x", value: requested.value ?? "0x0", accessList: [] };
      mutateFill?.(tx);
      result = { raw: "0x", tx };
    } else if (request.method === "eth_sendRawTransaction") {
      const raw = request.params![0] as Hex;
      submitted.push(raw);
      result = keccak256(raw);
    } else throw new Error(`Unexpected hermetic RPC method ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  vi.stubGlobal("fetch", fetcher);
  return { account, sign, submitted, methods, fetcher };
}

afterEach(() => vi.unstubAllGlobals());

describe("caller-bound local Arc transactions", () => {
  it("signs and submits only the exact mainnet transaction under an independently selected profile", async () => {
    const f = fixture(tx => { tx.chainId = "0x13b2"; }, () => "0x13b2");
    const transaction = { to: ARC_MAINNET_PROFILE.gatewayWallet, value: BigInt(1), gas: BigInt(21000) };
    await sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction, profile: ARC_MAINNET_PROFILE });
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submitted).toHaveLength(1);
    expect(parseTransaction(f.submitted[0])).toMatchObject({ chainId: 5042, to: transaction.to.toLowerCase(), value: BigInt(1) });
  });
  it.each(operations)("signs and submits the exact %s with the installed viem preparation path", async (_name, transaction) => {
    const f = fixture();
    const hash = await sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction });
    expect(f.sign).toHaveBeenCalledOnce();
    expect(f.submitted).toHaveLength(1);
    const parsed = parseTransaction(f.submitted[0]);
    expect(parsed).toMatchObject({ chainId: 5042002, to: transaction.to.toLowerCase() });
    expect(parsed.value ?? BigInt(0)).toBe(transaction.value ?? BigInt(0));
    expect(parsed.data ?? "0x").toBe(transaction.data ?? "0x");
    if (transaction.gas) expect(parsed.gas).toBe(transaction.gas);
    expect(await recoverTransactionAddress({ serializedTransaction: f.submitted[0] as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] })).toBe(f.account.address);
    expect(hash).toBe(keccak256(f.submitted[0]));
    expect(f.methods.at(-2)).toBe("eth_chainId");
    expect(f.methods.at(-1)).toBe("eth_sendRawTransaction");
  });

  it.each([
    ["mainnet prepared chain", (tx: Record<string, unknown>) => { tx.chainId = "0x13b2"; }],
    ["wrong payee", (tx: Record<string, unknown>) => { tx.to = ATTACKER; }],
    ["inflated native value", (tx: Record<string, unknown>) => { tx.value = "0x33"; }],
    ["wrong sender", (tx: Record<string, unknown>) => { tx.from = ATTACKER; }],
    ["changed calldata", (tx: Record<string, unknown>) => { tx.input = "0xdeadbeef"; }],
    ["authorization list", (tx: Record<string, unknown>) => { tx.authorizationList = []; }],
    ["access list", (tx: Record<string, unknown>) => { tx.accessList = [{ address: ATTACKER, storageKeys: [] }]; }],
  ] as const)("fences %s before signing and blocks viem's fallback", async (_name, mutateFill) => {
    const f = fixture(mutateFill);
    await expect(sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid?token=synthetic-secret",
      transaction: operations[0][1] })).rejects.toThrow("local signing policy");
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.submitted).toEqual([]);
  });

  it.each(operations.slice(1))("refuses changed %s calldata before any signature", async (_name, transaction) => {
    const f = fixture(tx => { tx.input = `${transaction.data}00`; delete tx.data; });
    await expect(sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction })).rejects.toThrow("refused");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submitted).toEqual([]);
  });

  it("refuses a live chain switch before the key is invoked", async () => {
    let reads = 0;
    const f = fixture(undefined, () => ++reads === 1 ? "0x4cef52" : "0x13b2");
    await expect(sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction: operations[0][1] })).rejects.toThrow("refused");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submitted).toEqual([]);
  });

  it("refuses a chain switch at raw submission after a valid signature", async () => {
    let reads = 0;
    const f = fixture(undefined, () => ++reads < 3 ? "0x4cef52" : "0x13b2");
    await expect(sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction: operations[0][1] })).rejects.toThrow("refused");
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submitted).toEqual([]);
  });

  it("rejects a mutated signature tuple before raw submission", async () => {
    const f = fixture();
    const badSigner = privateKeyToAccount(`0x${"44".repeat(32)}`);
    f.sign.mockImplementation(tx => badSigner.signTransaction(tx));
    await expect(sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid", transaction: operations[0][1] })).rejects.toThrow("refused");
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submitted).toEqual([]);
  });

  it("preserves the original hash and uncertainty after response loss, without retry or bearer diagnostics", async () => {
    const f = fixture();
    const fetcher = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      const response = await fetcher(url, init);
      if (request.method === "eth_sendRawTransaction") throw new Error("synthetic response loss with secret URL and bearer body");
      return response;
    });
    let observed: unknown;
    try { await sendGuardedArcTransaction({ account: f.account, rpcUrl: "https://synthetic.invalid?token=synthetic-secret", transaction: operations[0][1] }); }
    catch (error) { observed = error; }
    expect(observed).toBeInstanceOf(GuardedArcSubmissionUnknownError);
    expect((observed as GuardedArcSubmissionUnknownError).transactionHash).toBe(keccak256(f.submitted[0]));
    expect((observed as Error).message).not.toMatch(/secret|bearer|synthetic.invalid/);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submitted).toHaveLength(1);
    expect(f.methods.filter(method => method === "eth_sendRawTransaction")).toHaveLength(1);
  });
});
