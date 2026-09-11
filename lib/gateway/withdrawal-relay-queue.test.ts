import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { queueWithdrawalRelayPage } from "./withdrawal-relay-queue";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { submitWithdrawalTransfer } from "./withdrawal-transfer-service";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });
async function fixture() {
  const f = await creatorMintFixture(), directory = mkdtempSync(join(tmpdir(), "keryx-relay-queue-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const policy = { format: "creator-mint-journal-v1" as const, chainId: 5042002 as const,
    relayer: f.terms.relayer, initialNonce: 0, lifetimeGasBudgetWei: "3000000000000000", maxSlots: 5 };
  const connect = (initialize = false) => {
    const db = new DatabaseSync(join(directory, "mint.sqlite")); cleanups.push(() => db.close());
    return { db, journal: createWithdrawalMintJournal(db, policy, { initialize }) };
  };
  const { nonce: _nonce, ...terms } = f.terms; void _nonce;
  const signal = new AbortController().signal;
  const response = { ...await matchWithdrawalAttestation(f.record, f.response), savedAt: new Date().toISOString() };
  return { ...f, directory, connect, ...connect(true), terms, signal, savedResponse: response };
}

it("recovers a stored coordinator response into one original nonce after reopening", async () => {
  const f = await fixture(), store = new SqliteAdapter(join(f.directory, "app.sqlite"));
  cleanups.push(() => store.close()); await store.init();
  const admission = async (record: typeof f.record, signal: AbortSignal) => { await f.journal.admitGas(record, f.terms.gasBudgetWei, signal); };
  const transfer = vi.fn(async () => f.response);
  await submitWithdrawalTransfer(store, f.record, f.record.owner, admission, transfer, f.signal);
  const reopened = f.connect().journal;
  expect(await queueWithdrawalRelayPage(f.directory, reopened, store, f.terms, f.signal))
    .toMatchObject({ state: "scanned", attached: 1, scanned: 1, unavailable: 0 });
  expect(await queueWithdrawalRelayPage(f.directory, reopened, store, f.terms, f.signal)).toMatchObject({ attached: 0, scanned: 0 });
  expect((await reopened.getSlot(f.record.id))?.terms.nonce).toBe(0);
  expect(await reopened.getPrepared(f.record.id)).toBeNull();
  expect(transfer).toHaveBeenCalledTimes(1);
  expect(reopened.gasAdmissionSummary()).toMatchObject({ committedRequests: 1, committedGasWei: f.terms.gasBudgetWei });
}, 60000);

it("pages past missing evidence without allocating a nonce or starving a later ready request", async () => {
  const f = await fixture(), second = await creatorMintFixture();
  const ordered = [f, second].sort((a, b) => a.record.id.localeCompare(b.record.id));
  for (const r of ordered) await f.journal.admitGas(r.record, f.terms.gasBudgetWei, f.signal);
  const ready = { ...await matchWithdrawalAttestation(ordered[1].record, ordered[1].response), savedAt: new Date().toISOString() };
  const store = { getCreatorWithdrawalAttestation: vi.fn(async (id: string, owner: string) => {
    const selected = ordered.find(r => r.record.id === id)!; expect(owner).toBe(selected.record.owner);
    return id === ordered[1].record.id ? ready : null;
  }) };
  const first = await queueWithdrawalRelayPage(f.directory, f.journal, store, f.terms, f.signal, { limit: 1 });
  expect(first).toMatchObject({ state: "limited", awaitingEvidence: 1, attached: 0, nextCursor: ordered[0].record.id });
  const next = await queueWithdrawalRelayPage(f.directory, f.journal, store, f.terms, f.signal, { limit: 1, afterId: first.nextCursor! });
  expect(next).toMatchObject({ state: "scanned", attached: 1, nextCursor: null });
  expect((await f.journal.getSlot(ordered[1].record.id))?.terms.nonce).toBe(0);
  expect(await f.journal.getSlot(ordered[0].record.id)).toBeNull();
});

it("contains mismatched evidence and fee overflow without changing the original hold", async () => {
  const f = await fixture(), foreign = await creatorMintFixture();
  await f.journal.admitGas(f.record, f.terms.gasBudgetWei, f.signal);
  const wrong = { ...await matchWithdrawalAttestation(foreign.record, foreign.response), savedAt: new Date().toISOString() };
  const store = { getCreatorWithdrawalAttestation: vi.fn(async () => wrong) };
  expect(await queueWithdrawalRelayPage(f.directory, f.journal, store, f.terms, f.signal)).toMatchObject({ unavailable: 1, attached: 0 });
  const correct = { getCreatorWithdrawalAttestation: async () => f.savedResponse };
  expect(await queueWithdrawalRelayPage(f.directory, f.journal, correct,
    { ...f.terms, gas: "600000", gasBudgetWei: "1200000000000000" }, f.signal)).toMatchObject({ unavailable: 1, attached: 0 });
  expect(f.journal.listRequestIds()).toEqual([]);
  expect(f.journal.gasAdmissionSummary()).toMatchObject({ committedRequests: 1, awaitingSlot: 1 });
});

it("holds the worker lock until a cancelled store read settles and then attaches nothing", async () => {
  const f = await fixture(), stop = new AbortController();
  await f.journal.admitGas(f.record, f.terms.gasBudgetWei, f.signal);
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const store = { getCreatorWithdrawalAttestation: async () => { reached(); await gate; return f.savedResponse; } };
  const pending = queueWithdrawalRelayPage(f.directory, f.journal, store, f.terms, stop.signal);
  await entered; stop.abort(); expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(true);
  await expect(queueWithdrawalRelayPage(f.directory, f.connect().journal, store, f.terms, f.signal)).rejects.toThrow();
  release(); expect(await pending).toMatchObject({ state: "aborted", attached: 0, nextCursor: null });
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(false);
  expect(f.journal.listRequestIds()).toEqual([]);
});

it("recovers a committed slot after readback loss without assigning another nonce", async () => {
  const f = await fixture(); await f.journal.admitGas(f.record, f.terms.gasBudgetWei, f.signal);
  const reserve = f.journal.reserveAdmitted.bind(f.journal);
  vi.spyOn(f.journal, "reserveAdmitted").mockImplementationOnce(async (...args) => {
    await reserve(...args); throw new Error("Synthetic committed readback lost");
  });
  const store = { getCreatorWithdrawalAttestation: async () => f.savedResponse };
  expect(await queueWithdrawalRelayPage(f.directory, f.journal, store, f.terms, f.signal)).toMatchObject({ unavailable: 1 });
  expect(await queueWithdrawalRelayPage(f.directory, f.connect().journal, store, f.terms, f.signal)).toMatchObject({ scanned: 0 });
  expect(f.journal.listRequestIds()).toEqual([f.record.id]);
  const original = await f.connect().journal.reserveAdmitted(f.record.id, f.response,
    { ...f.terms, maxPriorityFeePerGas: "0" }, f.signal);
  expect(original.terms).toMatchObject({ nonce: 0, maxPriorityFeePerGas: f.terms.maxPriorityFeePerGas });
});
