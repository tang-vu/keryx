import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, toHex, type Hex } from "viem";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintObserver, WITHDRAWAL_MINTER_ABI, withdrawalMintObserverForRpc } from "./withdrawal-mint-observation";

afterEach(() => vi.useRealTimers());
const NOW = Date.UTC(2026, 8, 11, 3, 0, 0), blockHash = `0x${"ab".repeat(32)}`;
async function fixture() {
  const f = await creatorWithdrawalFixture();
  const original = structuredClone({ record: f.record, response: f.response });
  const state = { wrongChain: false, changedChain: false, block: BigInt(10000), ageSeconds: 0,
    missingCode: false, unauthorized: false, revert: false, reorg: false, badReturn: false };
  const calls: string[] = [];
  let chainReads = 0, blockReads = 0, mintCalls = 0;
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    calls.push(method);
    if (method === "eth_chainId") return toHex(state.wrongChain || state.changedChain && ++chainReads > 1 ? 1 : 5042002);
    if (method === "eth_getBlockByNumber") {
      blockReads++;
      return { number: toHex(state.block), hash: state.reorg && blockReads > 1 ? `0x${"cd".repeat(32)}` : blockHash,
        timestamp: toHex(BigInt(NOW / 1000 - state.ageSeconds)), transactions: [] };
    }
    if (method === "eth_getCode") {
      expect(params).toEqual([original.record.policy.gatewayMinter, toHex(state.block)]);
      return state.missingCode ? "0x" : "0x60006000";
    }
    if (method === "eth_call") {
      const [call, tag] = params as [{ to: string; from?: string; data: Hex; value?: string }, string];
      expect(call.to).toBe(original.record.policy.gatewayMinter); expect(tag).toBe(toHex(state.block));
      const decoded = decodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, data: call.data });
      if (decoded.functionName === "isAttestationSigner") {
        return encodeAbiParameters([{ type: "bool" }], [!state.unauthorized && decoded.args[0].toLowerCase() === f.attester.toLowerCase()]);
      }
      mintCalls++;
      expect(decoded.args).toEqual([original.response.attestation, original.response.signature]);
      expect(call.from).toBe(f.relayer.toLowerCase()); expect(call.value).toBe("0x0");
      if (state.revert) throw new Error("Synthetic mint revert");
      return state.badReturn ? "0x01" : "0x";
    }
    throw new Error(`Forbidden RPC ${method}`);
  } }, { retryCount: 0 }) });
  const observe = createWithdrawalMintObserver(() => client, () => NOW);
  return { ...f, state, calls, mintCalls: () => mintCalls,
    run: (signal = new AbortController().signal) => observe(f.record, f.response, f.relayer, signal) };
}

it("checks a real local attestation signature through read-only viem RPC calls at one rechecked block", async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ status: "eligible-at-observed-block", authority: "read-only-observation",
    attester: f.attester.toLowerCase(), requestId: f.record.id, blockHash, blockNumber: "10000", chainFinalityVerified: false });
  expect(f.mintCalls()).toBe(1);
  expect(f.calls).toEqual(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_call", "eth_getBlockByNumber", "eth_chainId"]);
});

it("refuses wrong network, absent minter, expired/stale/future blocks and unauthorized signer before simulation", async () => {
  for (const changes of [{ wrongChain: true }, { missingCode: true }, { block: BigInt(10001) },
    { ageSeconds: 61 }, { ageSeconds: -6 }, { unauthorized: true }]) {
    const f = await fixture(); Object.assign(f.state, changes);
    expect(await f.run()).toBeNull(); expect(f.mintCalls()).toBe(0);
  }
});

it("refuses reverted or unexpected call output and changing block/chain observations", async () => {
  for (const changes of [{ revert: true }, { badReturn: true }, { reorg: true }, { changedChain: true }]) {
    const f = await fixture(); Object.assign(f.state, changes);
    expect(await f.run()).toBeNull(); expect(f.mintCalls()).toBe(1);
  }
});

it("snapshots request/response before awaiting and makes no call for a pre-aborted observation", async () => {
  const f = await fixture(), cancelled = new AbortController(); cancelled.abort();
  expect(await f.run(cancelled.signal)).toBeNull(); expect(f.calls).toEqual([]);
  const pending = f.run();
  f.record.request.burnIntent.spec.value = "1"; f.response.attestation = "0x00";
  expect(await pending).toMatchObject({ status: "eligible-at-observed-block", requestId: f.record.id });
});

it.each(["deadline", "caller abort"])("cancels stalled RPC on %s and prevents late completion", async reason => {
  const f = await creatorWithdrawalFixture();
  let release!: (value: string) => void, reached!: () => void, transportSignal: AbortSignal | undefined;
  const held = new Promise<string>(resolve => { release = resolve; });
  const called = new Promise<void>(resolve => { reached = resolve; });
  const methods: string[] = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method }) => {
    methods.push(method); reached(); return held;
  } }, { retryCount: 0 }) });
  vi.useFakeTimers();
  const observe = createWithdrawalMintObserver(signal => { transportSignal = signal; return client; }, () => NOW);
  const controller = new AbortController();
  const pending = observe(f.record, f.response, f.relayer, controller.signal);
  await called;
  if (reason === "deadline") await vi.advanceTimersByTimeAsync(5001);
  else controller.abort();
  expect(await pending).toBeNull(); expect(transportSignal?.aborted).toBe(true);
  release(toHex(5042002)); await vi.advanceTimersByTimeAsync(1);
  expect(methods).toEqual(["eth_chainId"]);
});

it("rejects credential-bearing or non-HTTP RPC configuration without making a request", () => {
  expect(() => withdrawalMintObserverForRpc("invalid private endpoint")).toThrow("unavailable");
  expect(() => withdrawalMintObserverForRpc("file:///private")).toThrow("unavailable");
  expect(() => withdrawalMintObserverForRpc("https://user:password@synthetic.invalid")).toThrow("unavailable");
});
