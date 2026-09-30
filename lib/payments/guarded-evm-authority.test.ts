import { createWalletClient, custom, type LocalAccount } from "viem";
import { arcTestnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { guardedEvmTransport, guardedLocalAccount } from "./guarded-evm-authority";

const address = "0x1111111111111111111111111111111111111111";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  let enabled = true;
  const sign = vi.fn(async () => "0xabcdef" as const);
  const account = { address, publicKey: "0x00", type: "local", source: "custom", sign,
    signAuthorization: sign, signTypedData: sign, signMessage: sign, signTransaction: sign } as unknown as LocalAccount;
  const guard = { assertAuthority: () => { if (!enabled) throw new Error("binding changed"); }, attestChain: vi.fn(async () => {}) };
  return { account, sign, guard, refuse: () => { enabled = false; } };
}

describe("guarded EVM authority", () => {
  it.each(["sign", "signAuthorization", "signMessage", "signTransaction", "signTypedData"] as const)("guards %s immediately before delegation", async method => {
    const f = fixture(), gate = deferred<void>(); f.guard.attestChain.mockReturnValue(gate.promise);
    const wrapped = guardedLocalAccount(f.account, f.guard);
    const result = (wrapped[method] as (value: never) => Promise<unknown>)({} as never);
    f.refuse(); gate.resolve(); await expect(result).rejects.toThrow("binding changed"); expect(f.sign).not.toHaveBeenCalled();
  });
  it("allows delegated signing and refuses failed chain attestation", async () => {
    const f = fixture(), wrapped = guardedLocalAccount(f.account, f.guard);
    await expect(wrapped.signMessage({ message: "synthetic" })).resolves.toBe("0xabcdef");
    f.guard.attestChain.mockRejectedValue(new Error("wrong chain"));
    await expect(wrapped.signMessage({ message: "synthetic" })).rejects.toThrow("wrong chain"); expect(f.sign).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(wrapped)).toBe(true);
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
    const f = fixture(); f.sign.mockImplementation(async () => { f.refuse(); return "0xabcdef"; });
    const request = vi.fn(async () => `0x${"ab".repeat(32)}`);
    const wallet = createWalletClient({ account: guardedLocalAccount(f.account, f.guard), chain: arcTestnet,
      transport: guardedEvmTransport(custom({ request }), f.guard) });
    await expect(wallet.sendTransaction({ to: address, value: BigInt(0), nonce: 1, gas: BigInt(21000), gasPrice: BigInt(1) })).rejects.toThrow();
    expect(f.sign).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
  });
  it.each(["eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice"])("refuses before signing after deferred %s", async method => {
    const f = fixture(), gate = deferred<string>();
    const request = vi.fn(async ({ method: observed }: { method: string }) => observed === method ? gate.promise : "0x1");
    const wallet = createWalletClient({ account: guardedLocalAccount(f.account, f.guard), chain: arcTestnet,
      transport: guardedEvmTransport(custom({ request }), f.guard) });
    const result = wallet.sendTransaction({ to: address, value: BigInt(0), type: "legacy",
      ...(method !== "eth_gasPrice" ? { gasPrice: BigInt(1) } : { nonce: 1 }),
      ...(method === "eth_estimateGas" ? { nonce: 1 } : { gas: BigInt(21000) }) });
    await vi.waitFor(() => expect(request.mock.calls.some(([args]) => args.method === method)).toBe(true));
    f.refuse(); gate.resolve("0x5208"); await expect(result).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([args]) => args.method === "eth_sendRawTransaction")).toBe(false);
  });
});
