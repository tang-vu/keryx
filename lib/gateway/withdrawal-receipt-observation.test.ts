import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, custom, encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { WITHDRAWAL_MINT_EVENT } from "./withdrawal-mint-receipt";
import { createWithdrawalReceiptObserver, withdrawalReceiptObserverForRpc } from "./withdrawal-receipt-observation";

afterEach(() => vi.useRealTimers());
const NOW = Date.UTC(2026, 8, 11, 3, 0, 0), blockHash = `0x${"ab".repeat(32)}`, headHash = `0x${"cd".repeat(32)}`;
async function fixture() {
  const f = await creatorMintFixture(), matched = await matchWithdrawalAttestation(f.record, f.response);
  const spec = f.record.request.burnIntent.spec, txHash = keccak256(f.raw);
  const log = { transactionHash: txHash, blockHash, blockNumber: "0x270f", transactionIndex: "0x0",
    logIndex: "0x0", address: f.record.policy.gatewayMinter, removed: false,
    topics: encodeEventTopics({ abi: WITHDRAWAL_MINT_EVENT, eventName: "AttestationUsed",
      args: { token: f.record.policy.asset, recipient: f.record.policy.recipient, transferSpecHash: matched.transferSpecHash } }),
    data: encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [spec.sourceDomain, spec.sourceDepositor, spec.sourceSigner, BigInt(spec.value)]) };
  const receipt = { transactionHash: txHash, blockHash, blockNumber: "0x270f", transactionIndex: "0x0",
    from: f.terms.relayer, to: f.record.policy.gatewayMinter, contractAddress: null, status: "0x1", type: "0x2",
    gasUsed: toHex(150000), cumulativeGasUsed: toHex(150000), effectiveGasPrice: toHex(1500000000), logs: [log] };
  const state = { wrongChain: false, chainChanges: false, missingReceipt: false, receiptChanges: false,
    blockChanges: false, anchorChanges: false, missingTransaction: false, headBehind: false,
    ageSeconds: 0, unsupportedFinalized: false, sameHeight: false, duplicateTransaction: false, wrongPosition: false };
  const calls: string[] = [];
  let receipts = 0, blocks = 0, chains = 0, transportSignal: AbortSignal | undefined;
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    calls.push(method);
    if (method === "eth_chainId") {
      chains++; return toHex(state.wrongChain || state.chainChanges && chains > 1 ? 1 : 5042002);
    }
    if (method === "eth_getTransactionReceipt") {
      expect(params).toEqual([txHash]); receipts++;
      if (state.missingReceipt) return null;
      return { ...receipt, gasUsed: state.receiptChanges && receipts > 1 ? toHex(150001) : receipt.gasUsed };
    }
    if (method === "eth_getBlockByNumber") {
      const [tag, full] = params as [string, boolean]; expect(full).toBe(false);
      if (tag === "finalized") {
        if (state.unsupportedFinalized) throw new Error("Unsupported tag");
        return { number: toHex(state.headBehind ? 9998 : state.sameHeight ? 9999 : 10000), hash: state.sameHeight ? blockHash : headHash,
          timestamp: toHex(NOW / 1000 - state.ageSeconds), transactions: state.sameHeight ? [txHash] : [] };
      }
      if (tag === "0x2710") return { number: "0x2710", hash: state.anchorChanges ? blockHash : headHash,
        timestamp: toHex(NOW / 1000 - state.ageSeconds), transactions: [] };
      expect(tag).toBe("0x270f"); blocks++;
      return { number: "0x270f", hash: state.blockChanges && blocks > 1 ? headHash : blockHash,
        timestamp: toHex(NOW / 1000 - (state.sameHeight ? 0 : 120)),
        transactions: state.missingTransaction ? [] : state.duplicateTransaction ? [txHash, txHash]
          : state.wrongPosition ? [headHash, txHash] : [txHash] };
    }
    throw new Error(`Forbidden RPC ${method}`);
  } }, { retryCount: 0 }) });
  const observe = createWithdrawalReceiptObserver(signal => { transportSignal = signal; return client; }, () => NOW);
  return { ...f, state, calls, client, transportSignal: () => transportSignal,
    run: (signal = new AbortController().signal) => observe(f.record, f.response, f.raw, f.terms, signal) };
}

it("observes real viem receipt/block decoding and reports explicitly RPC-based Arc finality", async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ status: "mint-finalized-observed", authority: "arc-testnet-rpc-finality",
    finalityBasis: "operator-selected-rpc", chainFinalityVerified: true, finalizedBlockNumber: "10000",
    blockNumber: "9999", amountMicros: "50000", transactionHash: keccak256(f.raw) });
  expect(f.calls).toEqual(["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber",
    "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_chainId"]);
  expect(f.transportSignal()?.aborted).toBe(true);
});

it("refuses missing receipts, absent inclusion, unsupported finality, wrong chain or stale/future heads", async () => {
  for (const changes of [{ wrongChain: true }, { missingReceipt: true }, { missingTransaction: true },
    { unsupportedFinalized: true }, { headBehind: true }, { ageSeconds: 61 }, { ageSeconds: -6 },
    { duplicateTransaction: true }, { wrongPosition: true }]) {
    const f = await fixture(); Object.assign(f.state, changes); expect(await f.run()).toBeNull();
  }
});

it("accepts finality at the receipt's own committed block without requiring extra confirmations", async () => {
  const f = await fixture(); f.state.sameHeight = true;
  expect(await f.run()).toMatchObject({ chainFinalityVerified: true, blockNumber: "9999", finalizedBlockNumber: "9999" });
});

it("refuses receipt, inclusion block, finalized anchor or chain changes during observation", async () => {
  for (const changes of [{ receiptChanges: true }, { blockChanges: true }, { anchorChanges: true }, { chainChanges: true }]) {
    const f = await fixture(); Object.assign(f.state, changes); expect(await f.run()).toBeNull();
  }
});

it("makes no pre-aborted RPC and snapshots caller-owned inputs", async () => {
  const f = await fixture(), stop = new AbortController(); stop.abort();
  expect(await f.run(stop.signal)).toBeNull(); expect(f.calls).toEqual([]);
  const pending = f.run(); f.record.request.burnIntent.spec.value = "1"; f.response.attestation = "0x00";
  expect(await pending).toMatchObject({ amountMicros: "50000" });
});

it.each(["deadline", "caller abort"])("abandons stalled RPC on %s without late continuation", async reason => {
  const f = await creatorMintFixture();
  let release!: (value: Hex) => void, reached!: () => void, signal: AbortSignal | undefined;
  const held = new Promise<Hex>(resolve => { release = resolve; });
  const called = new Promise<void>(resolve => { reached = resolve; });
  const methods: string[] = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method }) => {
    methods.push(method); reached(); return held;
  } }, { retryCount: 0 }) });
  vi.useFakeTimers();
  const observe = createWithdrawalReceiptObserver(value => { signal = value; return client; }, () => NOW);
  const stop = new AbortController(), pending = observe(f.record, f.response, f.raw, f.terms, stop.signal);
  await called;
  if (reason === "deadline") await vi.advanceTimersByTimeAsync(5001); else stop.abort();
  expect(await pending).toBeNull(); expect(signal?.aborted).toBe(true);
  release(toHex(5042002)); await vi.advanceTimersByTimeAsync(1); expect(methods).toEqual(["eth_chainId"]);
});

it("rejects unsafe RPC configuration with a generic error", () => {
  for (const url of ["private endpoint", "file:///private", "https://user:password@synthetic.invalid"])
    expect(() => withdrawalReceiptObserverForRpc(url)).toThrow("Withdrawal RPC unavailable");
});
