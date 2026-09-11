import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { encodeFunctionData, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal, type WithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";
import { WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";
import type { WithdrawalMintTerms } from "./withdrawal-mint-transaction";

const resources: { databases: DatabaseSync[]; directory: string }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const resource of resources.splice(0)) {
    for (const db of resource.databases) db.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-mint-journal-")), path = join(directory, "journal.sqlite");
  const databases: DatabaseSync[] = [], signer = privateKeyToAccount(generatePrivateKey());
  resources.push({ directory, databases });
  const policy: WithdrawalMintJournalPolicy = { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: signer.address, initialNonce: 0, lifetimeGasBudgetWei: "1200000000000000", maxSlots: 5 };
  const connect = (initialize = false) => {
    const db = new DatabaseSync(path); databases.push(db);
    return { db, journal: createWithdrawalMintJournal(db, policy, { initialize }) };
  };
  async function request(nonce = 0) {
    const f = await creatorWithdrawalFixture();
    const terms: WithdrawalMintTerms = { relayer: signer.address, nonce, gas: "300000",
      maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000", gasBudgetWei: "600000000000000" };
    const raw = await signer.signTransaction({ type: "eip1559", chainId: 5042002, nonce,
      gas: BigInt(terms.gas), maxFeePerGas: BigInt(terms.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(terms.maxPriorityFeePerGas), value: BigInt(0), to: f.record.policy.gatewayMinter,
      data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
        args: [f.response.attestation, f.response.signature] }) });
    return { ...f, terms, raw };
  }
  const close = () => { for (const db of databases.splice(0)) db.close(); };
  return { path, policy, connect, request, close, ...connect(true) };
}

function child(path: string, input: unknown) {
  return new Promise<string>((resolve, reject) => {
    const process = execFile(globalThis.process.execPath, ["--import", "tsx", "scripts/test-fixtures/withdrawal-mint-journal-process.mts", path],
      { timeout: 25000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    process.stdin!.end(JSON.stringify(input));
  });
}

it("serializes separate OS processes and recovers the winner's original prepared transaction", async () => {
  const f = await fixture(), a = await f.request(), b = await f.request();
  f.close();
  const outcomes = await Promise.all([a, b].map(r => child(f.path, { ...r, policy: f.policy })));
  expect([...outcomes].sort()).toEqual(["nonce-denied", "saved"]);
  const winner = outcomes[0] === "saved" ? a : b;
  const reopened = f.connect().journal;
  expect(await reopened.getPrepared(winner.record.id)).toMatchObject({ transactionHash: keccak256(winner.raw) });
  expect(await child(f.path, { ...winner, policy: f.policy })).toBe("saved");
  expect(await reopened.getPrepared(winner.record.id)).toMatchObject({ transactionHash: keccak256(winner.raw) });
}, 30000);

it("persists the original nonce/gas slot and exact signed bytes across connections and restart", async () => {
  const f = await fixture(), request = await f.request(), second = f.connect();
  const [a, b] = await Promise.all([f.journal, second.journal].map(journal => journal.reserve(request.record, request.response, request.terms)));
  expect(a).toEqual(b);
  const [first, duplicate] = await Promise.all([f.journal, second.journal].map(journal => journal.savePrepared(request.record.id, request.raw)));
  expect(first).toEqual(duplicate); expect(first.transactionHash).toBe(keccak256(request.raw));
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_slots").get()?.n).toBe(1);
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_prepared").get()?.n).toBe(1);
  f.close();
  const reopened = f.connect().journal;
  expect(reopened.listRequestIds()).toEqual([request.record.id]);
  expect(await reopened.getPrepared(request.record.id)).toEqual(first);
});

it("admits one competing nonce and preserves its reservation even without signed bytes", async () => {
  const f = await fixture(), first = await f.request(), second = await f.request();
  const results = await Promise.allSettled([f.journal.reserve(first.record, first.response, first.terms),
    f.connect().journal.reserve(second.record, second.response, second.terms)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? first : second;
  expect(await f.connect().journal.getSlot(winner.record.id)).toMatchObject({ terms: { nonce: 0 } });
  expect(await f.journal.getPrepared(winner.record.id)).toBeNull();
});

it("reserves lifetime gas for every slot and refuses exceeding the exact ceiling after reopening", async () => {
  const f = await fixture();
  for (let nonce = 0; nonce < 2; nonce++) {
    const r = await f.request(nonce); await f.journal.reserve(r.record, r.response, r.terms);
  }
  const third = await f.request(2), reopened = f.connect().journal;
  await expect(reopened.reserve(third.record, third.response, third.terms)).rejects.toThrow("gas budget");
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_slots").get()?.n).toBe(2);
});

it("rejects changed terms, skipped nonce, policy resets and replacing/deleting journal data", async () => {
  const f = await fixture(), r = await f.request();
  await f.journal.reserve(r.record, r.response, r.terms);
  await expect(f.journal.reserve(r.record, r.response, { ...r.terms, gas: "299999" })).rejects.toThrow("conflict");
  const skipped = await f.request(2);
  await expect(f.journal.reserve(skipped.record, skipped.response, skipped.terms)).rejects.toThrow("nonce");
  expect(() => createWithdrawalMintJournal(f.db, { ...f.policy, lifetimeGasBudgetWei: "9999999999999999" }, { initialize: true })).toThrow("policy");
  for (const table of ["mint_journal_policy", "mint_journal_slots"])
    expect(() => f.db.exec(`DELETE FROM ${table}`)).toThrow("immutable");
});

it("requires explicit initialization and refuses prepared bytes without their original slot", async () => {
  const empty = new DatabaseSync(":memory:");
  const f = await fixture(), r = await f.request();
  try { expect(() => createWithdrawalMintJournal(empty, f.policy)).toThrow(); } finally { empty.close(); }
  await expect(f.journal.savePrepared(r.record.id, r.raw)).rejects.toThrow("slot");
  await f.journal.reserve(r.record, r.response, r.terms);
  const unrelated = await f.request();
  await expect(f.journal.savePrepared(r.record.id, unrelated.raw)).rejects.toThrow("unavailable");
  expect(await f.journal.getPrepared(r.record.id)).toBeNull();
});

it("recovers a committed prepared transaction after readback failure without another reservation", async () => {
  const f = await fixture(), r = await f.request();
  await f.journal.reserve(r.record, r.response, r.terms);
  const prepare = f.db.prepare.bind(f.db);
  const fault = vi.spyOn(f.db, "prepare").mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql.startsWith("SELECT transaction_hash,raw"))
      vi.spyOn(statement, "get").mockImplementationOnce(() => { throw new Error("Synthetic readback lost"); });
    return statement;
  });
  await expect(f.journal.savePrepared(r.record.id, r.raw)).rejects.toThrow("readback lost");
  fault.mockRestore();
  expect(await f.connect().journal.getPrepared(r.record.id)).toMatchObject({ transactionHash: keccak256(r.raw) });
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_slots").get()?.n).toBe(1);
});

it("keeps prepared data immutable and rejects corrupted hash readback", async () => {
  const f = await fixture(), r = await f.request();
  await f.journal.reserve(r.record, r.response, r.terms); await f.journal.savePrepared(r.record.id, r.raw);
  expect(() => f.db.exec("DELETE FROM mint_journal_prepared")).toThrow("immutable");
  expect(() => f.db.exec("UPDATE mint_journal_prepared SET raw=raw")).toThrow("immutable");
  // Deliberate administrator-level corruption, outside the journal API.
  f.db.exec("DROP TRIGGER mint_journal_prepared_no_update");
  f.db.prepare("UPDATE mint_journal_prepared SET transaction_hash=?").run(`0x${"00".repeat(32)}`);
  f.db.exec("CREATE TRIGGER mint_journal_prepared_no_update BEFORE UPDATE ON mint_journal_prepared BEGIN SELECT RAISE(ABORT,'Mint journal is immutable'); END;");
  await expect(f.journal.getPrepared(r.record.id)).rejects.toThrow("readback unavailable");
  expect(await f.journal.getSlot(r.record.id)).toMatchObject({ maxGasCostWei: "600000000000000" });
});

it("does not recreate a missing history table even with initialization requested", async () => {
  const f = await fixture();
  f.db.exec("DROP TABLE mint_journal_prepared");
  expect(() => createWithdrawalMintJournal(f.db, f.policy, { initialize: true })).toThrow("initialization unavailable");
  expect(() => createWithdrawalMintJournal(f.db, f.policy)).toThrow("structure unavailable");
  expect(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='mint_journal_prepared'").get()?.n).toBe(0);
});

it("enforces the slot count even when gas remains and restores full SQLite synchronization", async () => {
  const f = await fixture(), db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA synchronous=OFF");
    const journal = createWithdrawalMintJournal(db, { ...f.policy, maxSlots: 1 }, { initialize: true });
    expect(db.prepare("PRAGMA synchronous").get()?.synchronous).toBe(2);
    const first = await f.request(), second = await f.request(1);
    await journal.reserve(first.record, first.response, first.terms);
    await expect(journal.reserve(second.record, second.response, second.terms)).rejects.toThrow("nonce unavailable");
    expect(journal.listRequestIds()).toEqual([first.record.id]);
  } finally { db.close(); }
});
