import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, custom, toHex } from "viem";
import { readFreshWithdrawalRelay } from "./withdrawal-relay-preflight";

afterEach(() => vi.useRealTimers());
function fixture() {
  const state = { chain: 5042002, nonce: 0, code: "0x", balance: 100, pendingBalance: 100,
    timestamp: Math.floor(Date.now() / 1000), reorg: false, blockReads: 0, nonceReads: 0, lateNonce: false };
  const methods: string[] = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    methods.push(method);
    if (method === "eth_chainId") return toHex(state.chain);
    if (method === "eth_getBlockByNumber") return { number: "0x64", timestamp: toHex(state.timestamp),
      hash: `0x${(state.reorg && ++state.blockReads > 1 ? "bb" : "aa").repeat(32)}`, transactions: [] };
    if (method === "eth_getBalance") return toHex(params?.[1] === "pending" ? state.pendingBalance : state.balance);
    if (method === "eth_getTransactionCount") return toHex(state.lateNonce && ++state.nonceReads > 2 ? 1 : state.nonce);
    if (method === "eth_getCode") return state.code;
    throw new Error("Unexpected RPC");
  } }, { retryCount: 0 }) });
  const read = (signal = new AbortController().signal) => readFreshWithdrawalRelay(() => client, `0x${"ab".repeat(20)}`, "100", signal);
  return { state, methods, client, read };
}
it("checks native gas backing and returns explicit underfunding without signing", async () => {
  const f = fixture();
  expect(await f.read()).toMatchObject({ state: "funded", balanceWei: "100", observedBlockNumber: "100" });
  f.state.pendingBalance = 99;
  expect(await f.read()).toMatchObject({ state: "underfunded", pendingBalanceWei: "99" });
  f.state.pendingBalance = 100; f.state.balance = 99;
  expect(await f.read()).toMatchObject({ state: "underfunded" });
  expect(f.methods.every(method => ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode"].includes(method))).toBe(true);
});
it("rejects used/delegated accounts, stale blocks, reorgs and wrong networks", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state.chain = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.nonce = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.lateNonce = true; },
    (f: ReturnType<typeof fixture>) => { f.state.code = "0xef0100"; },
    (f: ReturnType<typeof fixture>) => { f.state.timestamp -= 61; },
    (f: ReturnType<typeof fixture>) => { f.state.timestamp += 10; },
    (f: ReturnType<typeof fixture>) => { f.state.reorg = true; },
  ]) { const f = fixture(); mutate(f); await expect(f.read()).rejects.toThrow("inspect before provisioning"); }
});
it("rejects invalid policy before RPC and bounds stalled reads", async () => {
  const f = fixture();
  await expect(readFreshWithdrawalRelay(() => f.client, `0x${"ab".repeat(20)}`, "0", new AbortController().signal)).rejects.toThrow("policy");
  expect(f.methods).toEqual([]);
  const stop = new AbortController(); stop.abort(); await expect(f.read(stop.signal)).rejects.toThrow();
  vi.useFakeTimers();
  const pending = readFreshWithdrawalRelay(() => ({ ...f.client, getChainId: () => new Promise(() => {}) }),
    `0x${"ab".repeat(20)}`, "100", new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(10001); expect(await pending).toBe(true);
});
