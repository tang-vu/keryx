import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, custom, toHex } from "viem";
import { readWithdrawalHeightWindow } from "./withdrawal-height-window";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  const policy: Parameters<typeof readWithdrawalHeightWindow>[1] = { domain: 26, gatewayWallet: `0x${"ab".repeat(20)}`, gatewayMinter: `0x${"cd".repeat(20)}` };
  const domain = { domain: 26, chain: "ARC", network: "Testnet", processedHeight: "9995", burnIntentExpirationHeight: "11000",
    walletContract: { address: policy.gatewayWallet, supportedTokens: ["USDC"] }, minterContract: { address: policy.gatewayMinter, supportedTokens: ["USDC"] } };
  const state = { chain: 5042002, timestamp: Math.floor(Date.now() / 1000), hash: `0x${"ef".repeat(32)}`, reads: 0, changeBlock: false };
  const client = createPublicClient({ transport: custom({ request: async ({ method }) => {
    if (method === "eth_chainId") return toHex(state.chain);
    if (method === "eth_getBlockByNumber") { state.reads++;
      return { number: toHex(10000), timestamp: toHex(state.timestamp), hash: state.changeBlock && state.reads > 1 ? `0x${"aa".repeat(32)}` : state.hash, transactions: [] }; }
    throw new Error("Unexpected RPC");
  } }, { retryCount: 0 }) });
  const info = { domains: [domain] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    expect(url).toBe("https://gateway-api-testnet.circle.com/v1/info"); expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
    return Response.json(info);
  }));
  const read = () => readWithdrawalHeightWindow(() => client, policy, { maxAheadBlocks: "2000", maxProcessingLagBlocks: "10" }, new AbortController().signal);
  return { read, state, info, domain, policy, client };
}
it("bounds the Circle minimum against a fresh consistent source-chain block", async () => {
  const f = fixture(); expect(await f.read()).toMatchObject({ minimumBlockHeight: "11000", maximumBlockHeight: "12000", observedBlockNumber: "10000" });
  expect(f.state.reads).toBe(2);
});
it("rejects stale/conflicting RPC, vendor lag, excessive expiry and mismatched contract/domain metadata", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state.chain = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.timestamp -= 61; },
    (f: ReturnType<typeof fixture>) => { f.state.changeBlock = true; },
    (f: ReturnType<typeof fixture>) => { f.domain.processedHeight = "9989"; },
    (f: ReturnType<typeof fixture>) => { f.domain.processedHeight = "10001"; },
    (f: ReturnType<typeof fixture>) => { f.domain.burnIntentExpirationHeight = "12001"; },
    (f: ReturnType<typeof fixture>) => { f.domain.walletContract.address = f.policy.gatewayMinter; },
    (f: ReturnType<typeof fixture>) => { f.info.domains.push(f.domain); },
  ]) { const f = fixture(); mutate(f); await expect(f.read()).rejects.toThrow("obtain fresh terms"); }
});
it("bounds a stalled metadata response and rejects aborted reads", async () => {
  const f = fixture(); vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const pending = f.read().then(() => false, () => true); await vi.advanceTimersByTimeAsync(10001); expect(await pending).toBe(true);
  const stop = new AbortController(); stop.abort();
  await expect(readWithdrawalHeightWindow(() => f.client, f.policy, { maxAheadBlocks: "2000", maxProcessingLagBlocks: "10" }, stop.signal)).rejects.toThrow();
});
