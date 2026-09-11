import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublicClient, custom, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import type { createWithdrawalMintObserver } from "./withdrawal-mint-observation";
import type { createWithdrawalReceiptObserver } from "./withdrawal-receipt-observation";
import { runWithdrawalRelayWorker } from "./withdrawal-relay-worker";

const resources: { directory: string; db: DatabaseSync }[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const { directory, db } of resources.splice(0)) {
  db.close(); rmSync(directory, { recursive: true, force: true });
} });
async function fixture() {
  const f = await creatorWithdrawalFixture(), signer = privateKeyToAccount(generatePrivateKey());
  const directory = mkdtempSync(join(tmpdir(), "keryx-relay-worker-")), db = new DatabaseSync(join(directory, "mint.sqlite"));
  resources.push({ directory, db });
  const journal = createWithdrawalMintJournal(db, { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: signer.address, initialNonce: 0, lifetimeGasBudgetWei: "1200000000000000", maxSlots: 4 }, { initialize: true });
  const terms = { relayer: signer.address, nonce: 0, gas: "300000", maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000", gasBudgetWei: "600000000000000" };
  await journal.reserve(f.record, f.response, terms);
  const state = { nonce: 0, pendingNonce: 0, balance: BigInt("1200000000000000"),
    lostResponse: false, confirm: true, wrongHash: false, calls: [] as string[], sent: [] as Hex[],
    callGate: undefined as Promise<void> | undefined, onCall: undefined as (() => void) | undefined };
  const blockHash = `0x${"ab".repeat(32)}` as Hex;
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    state.calls.push(method);
    if (method === "eth_chainId") return toHex(5042002);
    if (method === "eth_getTransactionCount") return toHex(params?.[1] === "pending" ? state.pendingNonce : state.nonce);
    if (method === "eth_getBalance") return toHex(state.balance);
    if (method === "eth_getBlockByNumber") return { hash: blockHash, number: toHex(10000),
      timestamp: toHex(Math.floor(Date.now() / 1000)), gasLimit: toHex(1000000), baseFeePerGas: toHex(1000000000), transactions: [] };
    if (method === "eth_call") {
      state.onCall?.(); if (state.callGate) await state.callGate;
      const call = params?.[0] as { gas: string; maxFeePerGas: string };
      expect(call.gas).toBe(toHex(300000)); expect(call.maxFeePerGas).toBe(toHex(2000000000)); return "0x";
    }
    if (method === "eth_sendRawTransaction") {
      const raw = params?.[0] as Hex;
      // Assert durable readback exists before the simulated network sees bytes.
      const saved = db.prepare("SELECT id FROM mint_journal_prepared WHERE transaction_hash=?").get(keccak256(raw));
      expect(saved).toBeDefined();
      expect((await journal.getPrepared(String(saved!.id)))?.serializedTransaction).toBe(raw);
      state.sent.push(raw);
      if (state.lostResponse) throw new Error("Synthetic response lost after submission");
      return state.wrongHash ? `0x${"00".repeat(32)}` : keccak256(raw);
    }
    throw new Error(`Unexpected synthetic RPC ${method}`);
  } }, { retryCount: 0 }) });
  const observeMint: ReturnType<typeof createWithdrawalMintObserver> = async (record, response, relayer) => {
    const matched = await matchWithdrawalAttestation(record, response);
    return { status: "eligible-at-observed-block", authority: "read-only-observation", requestId: record.id,
      transferSpecHash: matched.transferSpecHash, chainId: 5042002, relayer: relayer.toLowerCase() as Hex,
      minter: record.policy.gatewayMinter, attester: f.attester, blockNumber: "10000", blockHash,
      minterCodeHash: blockHash, observedAt: new Date().toISOString(), chainFinalityVerified: false };
  };
  // Synthetic finality adapter. Real RPC decoding/receipt matching has its own suite.
  const observeReceipt: ReturnType<typeof createWithdrawalReceiptObserver> = async record => {
    const prepared = await journal.getPrepared(record.id);
    if (!state.confirm || !prepared || !state.sent.includes(prepared.serializedTransaction)) return null;
    return { status: "mint-finalized-observed", authority: "arc-testnet-rpc-finality", requestId: record.id,
      transactionHash: prepared.transactionHash, transferSpecHash: prepared.transferSpecHash, chainId: 5042002,
      blockNumber: "10000", blockHash, transactionIndex: 0, logIndex: 0, recipient: record.policy.recipient,
      amountMicros: record.request.burnIntent.spec.value, gasUsed: "150000", effectiveGasPriceWei: "1500000000",
      gasCostWei: "225000000000000", chainFinalityVerified: true, finalityBasis: "operator-selected-rpc",
      finalizedBlockNumber: "10000", finalizedBlockHash: blockHash, observedAt: new Date().toISOString() };
  };
  const dependencies = { client, observeMint, observeReceipt }, sign = vi.spyOn(signer, "signTransaction");
  return { ...f, directory, db, journal, terms, signer, state, dependencies, sign,
    run: (signal = new AbortController().signal) => runWithdrawalRelayWorker(directory, journal, signer,
      [f.record.owner], dependencies, signal) };
}

it("runs sign, durable prepare, exact-byte broadcast and recorded reconciliation under a lock", async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ state: "idle", signed: 1, broadcastAttempts: 1, observed: 1 });
  expect(f.sign).toHaveBeenCalledTimes(1); expect(f.state.sent).toHaveLength(1);
  expect(await f.journal.getObserved(f.record.id)).toMatchObject({ transactionHash: keccak256(f.state.sent[0]) });
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(false);
  expect(await f.run()).toMatchObject({ state: "idle", signed: 0, broadcastAttempts: 0 });
});

it("recovers a lost submission response without signing or submitting again when receipt appears", async () => {
  const f = await fixture(); f.state.lostResponse = true;
  expect(await f.run()).toMatchObject({ state: "waiting", broadcastAttempts: 1 });
  const original = await f.journal.getPrepared(f.record.id);
  expect(await f.run()).toMatchObject({ state: "idle", signed: 0, broadcastAttempts: 0, observed: 1 });
  expect(await f.journal.getPrepared(f.record.id)).toEqual(original); expect(f.sign).toHaveBeenCalledTimes(1);
});

it("never broadcasts a signed candidate whose durable save/readback failed", async () => {
  const f = await fixture(), save = f.journal.savePrepared.bind(f.journal);
  const fault = vi.spyOn(f.journal, "savePrepared").mockImplementationOnce(async (...args) => {
    await save(...args); throw new Error("Synthetic readback lost");
  });
  expect(await f.run()).toMatchObject({ state: "waiting", signed: 1, broadcastAttempts: 0 });
  expect(f.state.sent).toHaveLength(0); fault.mockRestore();
  expect(await f.run()).toMatchObject({ state: "idle", signed: 0, broadcastAttempts: 1 });
  expect(f.sign).toHaveBeenCalledTimes(1);
});

it("stops for consumed, skipped or occupied nonces and insufficient native gas funding", async () => {
  for (const changes of [{ nonce: 1 }, { pendingNonce: 1 }, { balance: BigInt(1) }]) {
    const f = await fixture(); Object.assign(f.state, changes);
    expect(await f.run()).toMatchObject({ state: "waiting", signed: 0, broadcastAttempts: 0 });
    expect(f.sign).not.toHaveBeenCalled();
  }
});

it("requires a separate signer and stops cleanly on cancellation", async () => {
  const f = await fixture();
  await expect(runWithdrawalRelayWorker(f.directory, f.journal, f.signer, [f.signer.address], f.dependencies,
    new AbortController().signal)).rejects.toThrow("Dedicated mint signer unavailable");
  const stop = new AbortController(); stop.abort();
  expect(await f.run(stop.signal)).toMatchObject({ state: "aborted", signed: 0, broadcastAttempts: 0 });
});

it("retains an unconfirmed original and only retries its exact bytes", async () => {
  const f = await fixture(); f.state.confirm = false;
  expect(await f.run()).toMatchObject({ state: "waiting", signed: 1, broadcastAttempts: 1 });
  expect(await f.run()).toMatchObject({ state: "waiting", signed: 0, broadcastAttempts: 1 });
  expect(f.state.sent).toHaveLength(2); expect(f.state.sent[0]).toBe(f.state.sent[1]);
  expect(f.sign).toHaveBeenCalledTimes(1);
});

it("keeps the lock until a stalled RPC returns and does not sign after cancellation", async () => {
  const f = await fixture(), stop = new AbortController();
  let release!: () => void, reached!: () => void;
  f.state.callGate = new Promise(resolve => { release = resolve; });
  const called = new Promise<void>(resolve => { reached = resolve; }); f.state.onCall = reached;
  const pending = f.run(stop.signal); await called; stop.abort();
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(true);
  await expect(f.run()).rejects.toThrow("lock or operation unavailable");
  release();
  expect(await pending).toMatchObject({ state: "aborted", signed: 0, broadcastAttempts: 0 });
  expect(f.sign).not.toHaveBeenCalled(); expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(false);
});

it("does not let completed earlier requests consume the active-step limit", async () => {
  const f = await fixture(); await f.run();
  const next = await creatorWithdrawalFixture();
  await f.journal.reserve(next.record, next.response, { ...f.terms, nonce: 1 });
  f.state.nonce = f.state.pendingNonce = 1;
  expect(await runWithdrawalRelayWorker(f.directory, f.journal, f.signer, [f.record.owner], f.dependencies,
    new AbortController().signal, 1)).toMatchObject({ state: "idle", signed: 1, broadcastAttempts: 1, observed: 2 });
});

it("retains original identity when broadcast returns an unexpected hash", async () => {
  const f = await fixture(); f.state.wrongHash = true;
  expect(await f.run()).toMatchObject({ state: "waiting", reason: "submission-needs-reconciliation", broadcastAttempts: 1 });
  expect(await f.journal.getPrepared(f.record.id)).toMatchObject({ transactionHash: keccak256(f.state.sent[0]) });
  expect(await f.run()).toMatchObject({ state: "idle", signed: 0, broadcastAttempts: 0 });
});
