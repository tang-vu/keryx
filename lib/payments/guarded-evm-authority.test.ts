import { createWalletClient, custom, serializeTransaction, type TransactionSerializable } from "viem";
import { arcTestnet } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount, sign as cryptoSign } from "viem/accounts";
vi.mock("viem/accounts", async importOriginal => {
  const actual = await importOriginal<typeof import("viem/accounts")>();
  return { ...actual, sign: vi.fn(actual.sign) };
});
import { guardedEvmHttp, guardedEvmTransport, guardedLocalAccount } from "./guarded-evm-authority";

const address = "0x1111111111111111111111111111111111111111";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  let enabled = true;
  vi.mocked(cryptoSign).mockReset();
  const key = generatePrivateKey();
  const sign = vi.mocked(cryptoSign);
  const guard = { assertAuthority: () => { if (!enabled) throw new Error("binding changed"); }, attestChain: vi.fn(async () => {}) };
  return { key, sign, guard, refuse: () => { enabled = false; } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("guarded EVM authority", () => {
  it.each(["sign", "signAuthorization", "signMessage", "signTransaction", "signTypedData"] as const)("guards %s immediately before delegation", async method => {
    const f = fixture(), gate = deferred<void>(); f.guard.attestChain.mockReturnValue(gate.promise);
    const wrapped = guardedLocalAccount(f.key, f.guard);
    const result = (wrapped[method] as (value: never) => Promise<unknown>)({} as never);
    f.refuse(); gate.resolve(); await expect(result).rejects.toThrow("binding changed"); expect(f.sign).not.toHaveBeenCalled();
  });
  it("allows delegated signing and refuses failed chain attestation", async () => {
    const f = fixture(), wrapped = guardedLocalAccount(f.key, f.guard);
    await expect(wrapped.signMessage({ message: "synthetic" })).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    f.guard.attestChain.mockRejectedValue(new Error("wrong chain"));
    await expect(wrapped.signMessage({ message: "synthetic" })).rejects.toThrow("wrong chain"); expect(f.sign).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(wrapped)).toBe(true);
  });
  it("refuses actual secp signing after a deferred transaction serializer", async () => {
    const f = fixture(), gate = deferred<`0x${string}`>();
    const serializer = vi.fn((_transaction: TransactionSerializable) => gate.promise);
    const account = guardedLocalAccount(f.key, f.guard);
    const pending = account.signTransaction({ chainId: 5042002, to: address, nonce: 1,
      gas: BigInt(21000), gasPrice: BigInt(1), value: BigInt(0) }, { serializer });
    await vi.waitFor(() => expect(serializer).toHaveBeenCalledTimes(1));
    f.refuse(); gate.resolve("0x01"); await expect(pending).rejects.toThrow("binding changed");
    expect(f.sign).not.toHaveBeenCalled(); expect(serializer).toHaveBeenCalledTimes(1);
  });
  it("preserves installed viem transaction signature serialization", async () => {
    const f = fixture(), account = guardedLocalAccount(f.key, f.guard);
    const transaction = { chainId: 5042002, to: address, nonce: 1, gas: BigInt(21000), gasPrice: BigInt(1), value: BigInt(0) } as const;
    const serializer = vi.fn(serializeTransaction);
    await expect(account.signTransaction(transaction, { serializer })).resolves.toMatch(/^0x[0-9a-f]+$/);
    expect(serializer).toHaveBeenCalledTimes(2); expect(f.sign).toHaveBeenCalledTimes(1);
    expect(serializer.mock.calls[1][1]).toHaveProperty("r");
  });
  it("matches installed privateKeyToAccount message, typed data and authorization semantics", async () => {
    const f = fixture(), guarded = guardedLocalAccount(f.key, f.guard), original = privateKeyToAccount(f.key);
    const typed = { domain: { name: "Synthetic", version: "1", chainId: 5042002 },
      types: { Synthetic: [{ name: "value", type: "uint256" }] }, primaryType: "Synthetic", message: { value: BigInt(1) } } as const;
    expect(await guarded.signMessage({ message: "synthetic" })).toBe(await original.signMessage({ message: "synthetic" }));
    expect(await guarded.signTypedData(typed)).toBe(await original.signTypedData(typed));
    const authorization = { chainId: 5042002, nonce: 1, address } as const;
    expect(await guarded.signAuthorization!(authorization)).toEqual(await original.signAuthorization(authorization));
  });
  it("refuses physical HTTP fetch after viem's deferred onRequest hook", async () => {
    const f = fixture(), gate = deferred<void>(), physical = vi.fn(); vi.stubGlobal("fetch", physical);
    const hook = vi.fn(async () => { await gate.promise; });
    const transport = guardedEvmHttp("https://synthetic.invalid", f.guard, { onFetchRequest: hook })({ chain: arcTestnet });
    const pending = transport.request({ method: "eth_sendRawTransaction", params: ["0xabcdef"] });
    await vi.waitFor(() => expect(hook).toHaveBeenCalled()); f.refuse(); gate.resolve();
    await expect(pending).rejects.toThrow(); expect(physical).not.toHaveBeenCalled();
  });
  it("refuses physical HTTP fetch after an onRequest microtask", async () => {
    const f = fixture(), physical = vi.fn(); vi.stubGlobal("fetch", physical);
    const transport = guardedEvmHttp("https://synthetic.invalid", f.guard,
      { onFetchRequest: () => { queueMicrotask(f.refuse); } })({ chain: arcTestnet });
    await expect(transport.request({ method: "eth_sendRawTransaction", params: ["0xabcdef"] })).rejects.toThrow();
    expect(physical).not.toHaveBeenCalled();
  });
  it("does not retry an ambiguous send or expose raw request through config", async () => {
    const f = fixture(), request = vi.fn(async () => { throw new Error("lost response"); });
    const transport = guardedEvmTransport(custom({ request }), f.guard)({ chain: arcTestnet });
    await expect(transport.request({ method: "eth_sendRawTransaction", params: ["0xabcdef"] })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1); expect(transport.config.request).toBe(transport.request);
    f.refuse(); await expect(transport.config.request({ method: "eth_sendRawTransaction", params: ["0xabcdef"] })).rejects.toThrow("binding changed");
    expect(request).toHaveBeenCalledTimes(1);
    await expect(transport.request({ method: "eth_sendTransaction", params: [] } as never)).rejects.toThrow("Unsupported");
    await expect(transport.request({ method: "personal_sign", params: [] } as never)).rejects.toThrow("Unsupported");
  });
  it("checks broadcast separately when authority changes after signing", async () => {
    const f = fixture(); const original = f.sign.getMockImplementation()!; f.sign.mockImplementation((...args) => { const result = original(...args); f.refuse(); return result; });
    const request = vi.fn(async () => `0x${"ab".repeat(32)}`);
    const wallet = createWalletClient({ account: guardedLocalAccount(f.key, f.guard), chain: arcTestnet,
      transport: guardedEvmTransport(custom({ request }), f.guard) });
    await expect(wallet.sendTransaction({ to: address, value: BigInt(0), nonce: 1, gas: BigInt(21000), gasPrice: BigInt(1) })).rejects.toThrow();
    expect(f.sign).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
  });
  it.each(["eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice"])("refuses before signing after deferred %s", async method => {
    const f = fixture(), gate = deferred<string>();
    const request = vi.fn(async ({ method: observed }: { method: string }) => observed === method ? gate.promise : "0x1");
    const wallet = createWalletClient({ account: guardedLocalAccount(f.key, f.guard), chain: arcTestnet,
      transport: guardedEvmTransport(custom({ request }), f.guard) });
    const result = wallet.sendTransaction({ to: address, value: BigInt(0), type: "legacy",
      ...(method !== "eth_gasPrice" ? { gasPrice: BigInt(1) } : { nonce: 1 }),
      ...(method === "eth_estimateGas" ? { nonce: 1 } : { gas: BigInt(21000) }) });
    await vi.waitFor(() => expect(request.mock.calls.some(([args]) => args.method === method)).toBe(true));
    f.refuse(); gate.resolve("0x5208"); await expect(result).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([args]) => args.method === "eth_sendRawTransaction")).toBe(false);
  });
});
