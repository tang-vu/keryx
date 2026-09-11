import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublicClient, custom, toHex } from "viem";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { createBackedWithdrawalAdmission } from "./withdrawal-backed-admission";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });
async function fixture() {
  const f = await creatorMintFixture(), directory = mkdtempSync(join(tmpdir(), "keryx-backed-admission-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, "mint.sqlite")); cleanups.push(() => db.close());
  const journal = createWithdrawalMintJournal(db, { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: f.terms.relayer, initialNonce: 0, lifetimeGasBudgetWei: "1800000000000000", maxSlots: 3 }, { initialize: true });
  const state = { balance: BigInt(f.terms.gasBudgetWei), chain: 5042002, timestamp: Math.floor(Date.now() / 1000),
    hash: `0x${"ab".repeat(32)}`, balanceHook: undefined as (() => Promise<void>) | undefined, calls: [] as string[] };
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    state.calls.push(method);
    if (method === "eth_chainId") return toHex(state.chain);
    if (method === "eth_getBlockByNumber") return { hash: state.hash, number: toHex(10000), timestamp: toHex(state.timestamp), transactions: [] };
    if (method === "eth_getBalance") {
      expect(String(params?.[0]).toLowerCase()).toBe(f.terms.relayer.toLowerCase()); expect(params?.[1]).toBe(toHex(10000));
      if (state.balanceHook) await state.balanceHook(); return toHex(state.balance);
    }
    throw new Error("Unexpected synthetic RPC");
  } }, { retryCount: 0 }) });
  const admit = createBackedWithdrawalAdmission(directory, journal, f.terms.gasBudgetWei, () => client);
  return { ...f, directory, journal, state, admit, signal: new AbortController().signal };
}

it("requires backing for all unresolved requests and does not charge a duplicate hold twice", async () => {
  const f = await fixture(); await f.admit(f.record, f.signal); await f.admit(f.record, f.signal);
  const next = await creatorMintFixture();
  await expect(f.admit(next.record, f.signal)).rejects.toThrow();
  expect(await f.journal.getGasAdmission(next.record.id)).toBeNull();
  f.state.balance *= BigInt(2); await f.admit(next.record, f.signal);
  expect(await f.journal.gasBackingSnapshot()).toMatchObject({ committedRequests: 2,
    committedGasWei: "1200000000000000", outstandingGasWei: "1200000000000000" });
});

it("rejects the wrong chain, stale block and changed block without admitting gas", async () => {
  const f = await fixture(); f.state.chain = 1;
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  f.state.chain = 5042002; f.state.timestamp -= 61;
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  f.state.timestamp += 61; f.state.balanceHook = async () => { f.state.hash = `0x${"cd".repeat(32)}`; };
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  expect(await f.journal.getGasAdmission(f.record.id)).toBeNull();
});

it("rejects a competing journal change between observing balance and committing admission", async () => {
  const f = await fixture(), other = await creatorMintFixture();
  f.state.balanceHook = async () => { await f.journal.admitGas(other.record, f.terms.gasBudgetWei, f.signal); };
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  expect(await f.journal.getGasAdmission(f.record.id)).toBeNull();
  expect(await f.journal.getGasAdmission(other.record.id)).not.toBeNull();
});

it("retains the lock through a cancelled RPC wait and commits no new hold", async () => {
  const f = await fixture(), stop = new AbortController(); let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.state.balanceHook = async () => { reached(); await gate; };
  const pending = f.admit(f.record, stop.signal).then(() => false, () => true);
  await entered; stop.abort(); expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(true);
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  release(); expect(await pending).toBe(true);
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(false);
  expect(await f.journal.getGasAdmission(f.record.id)).toBeNull();
});

it("does not authorize pre-transfer admission for an original already present in the mint queue", async () => {
  const f = await fixture(); await f.admit(f.record, f.signal);
  await f.journal.reserve(f.record, f.response, f.terms);
  const calls = f.state.calls.length;
  await expect(f.admit(f.record, f.signal)).rejects.toThrow();
  expect(f.state.calls).toHaveLength(calls);
  expect(await f.journal.getSlot(f.record.id)).not.toBeNull();
});
