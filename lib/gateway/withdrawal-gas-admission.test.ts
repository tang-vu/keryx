import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal, type WithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { submitWithdrawalTransfer } from "./withdrawal-transfer-service";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });
async function fixture(maxSlots = 3) {
  const f = await creatorMintFixture(), directory = mkdtempSync(join(tmpdir(), "keryx-gas-admission-"));
  const cost = BigInt(f.terms.gas) * BigInt(f.terms.maxFeePerGas);
  const policy: WithdrawalMintJournalPolicy = { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: f.terms.relayer, initialNonce: f.terms.nonce, lifetimeGasBudgetWei: (cost * BigInt(2)).toString(), maxSlots };
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const connect = (initialize = false) => {
    const db = new DatabaseSync(join(directory, "mint.sqlite")); cleanups.push(() => db.close());
    return { db, journal: createWithdrawalMintJournal(db, policy, { initialize }) };
  };
  return { ...f, cost, policy, directory, connect, ...connect(true), signal: new AbortController().signal };
}

it("retains one gas ceiling across duplicate admission, attestation attachment and reopening", async () => {
  const f = await fixture(), other = f.connect().journal;
  const held = await Promise.all([f.journal, other].map(journal => journal.admitGas(f.record, f.cost.toString(), f.signal)));
  expect(held[0]).toEqual(held[1]);
  await other.reserve(f.record, f.response, f.terms);
  const second = await creatorMintFixture();
  await f.journal.admitGas(second.record, f.cost.toString(), f.signal);
  expect(other.gasAdmissionSummary()).toEqual({ committedRequests: 2, awaitingSlot: 1,
    committedGasWei: f.policy.lifetimeGasBudgetWei, remainingGasBudgetWei: "0" });
  expect(await f.connect().journal.getGasAdmission(f.record.id)).toEqual(held[0]);
  const third = await creatorMintFixture();
  await expect(other.admitGas(third.record, "1", f.signal)).rejects.toThrow("gas budget");
  expect(() => f.db.exec("DELETE FROM mint_journal_admissions")).toThrow("immutable");
  expect(() => f.db.exec("UPDATE mint_journal_admissions SET max_gas_cost_wei='1'")).toThrow("immutable");
});

it("serializes competing admissions against the same lifetime budget", async () => {
  const f = await fixture(), other = await creatorMintFixture();
  const ceiling = f.policy.lifetimeGasBudgetWei;
  const results = await Promise.allSettled([f.journal.admitGas(f.record, ceiling, f.signal),
    f.connect().journal.admitGas(other.record, ceiling, f.signal)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_admissions").get()?.n).toBe(1);
});

it("binds the original ceiling and denies an oversized mint or new slots consuming held capacity", async () => {
  const f = await fixture(1);
  await f.journal.admitGas(f.record, (f.cost - BigInt(1)).toString(), f.signal);
  await expect(f.journal.admitGas(f.record, f.cost.toString(), f.signal)).rejects.toThrow("conflict");
  await expect(f.journal.reserve(f.record, f.response, f.terms)).rejects.toThrow("conflict");
  const second = await creatorMintFixture();
  await expect(f.journal.reserve(second.record, second.response, { ...f.terms })).rejects.toThrow("capacity");
  expect(await f.journal.getSlot(f.record.id)).toBeNull();
});

it("does not reserve after cancellation and recovers a committed hold after lost readback", async () => {
  const f = await fixture(), stop = new AbortController(); stop.abort();
  await expect(f.journal.admitGas(f.record, f.cost.toString(), stop.signal)).rejects.toThrow();
  expect(await f.journal.getGasAdmission(f.record.id)).toBeNull();
  const prepare = f.db.prepare.bind(f.db);
  vi.spyOn(f.db, "prepare").mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql === "SELECT * FROM mint_journal_admissions WHERE id=?")
      vi.spyOn(statement, "get").mockImplementationOnce(() => { throw new Error("Synthetic readback lost"); });
    return statement;
  });
  await expect(f.journal.admitGas(f.record, f.cost.toString(), f.signal)).rejects.toThrow("readback lost");
  vi.restoreAllMocks();
  expect(await f.connect().journal.admitGas(f.record, f.cost.toString(), f.signal)).toMatchObject({ maxGasCostWei: f.cost.toString() });
  expect(f.db.prepare("SELECT count(*) n FROM mint_journal_admissions").get()?.n).toBe(1);
});

it("upgrades version one explicitly and continues charging its original slots", async () => {
  const f = await fixture();
  await f.journal.reserve(f.record, f.response, f.terms);
  f.db.exec("DROP TABLE mint_journal_admissions; PRAGMA user_version=1;");
  expect(() => createWithdrawalMintJournal(f.db, f.policy)).toThrow("structure");
  const upgraded = createWithdrawalMintJournal(f.db, f.policy, { upgrade: true });
  await upgraded.admitGas(f.record, f.cost.toString(), f.signal);
  const second = await creatorMintFixture(); await upgraded.admitGas(second.record, f.cost.toString(), f.signal);
  const third = await creatorMintFixture(); await expect(upgraded.admitGas(third.record, "1", f.signal)).rejects.toThrow("gas budget");
  expect(await upgraded.getSlot(f.record.id)).toMatchObject({ terms: { ...f.terms, relayer: f.terms.relayer.toLowerCase() } });
  f.db.exec("DROP TABLE mint_journal_admissions");
  expect(() => createWithdrawalMintJournal(f.db, f.policy, { upgrade: true })).toThrow("initialization");
});

it("holds gas before the coordinator POST and retains it through unknown transfer recovery", async () => {
  const f = await fixture();
  const store = new SqliteAdapter(join(f.directory, "app.sqlite")); cleanups.push(() => store.close()); await store.init();
  const admission = async (record: typeof f.record, signal: AbortSignal) => { await f.journal.admitGas(record, f.policy.lifetimeGasBudgetWei, signal); };
  const transfer = vi.fn(async () => {
    expect(await f.connect().journal.getGasAdmission(f.record.id)).not.toBeNull();
    throw new Error("Synthetic lost vendor response");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await submitWithdrawalTransfer(store, f.record, f.record.owner, admission, transfer, f.signal))
      .toMatchObject({ status: "awaiting-transfer-evidence" });
  }
  expect(transfer).toHaveBeenCalledTimes(1);
  const second = await creatorMintFixture();
  await expect(f.connect().journal.admitGas(second.record, "1", f.signal)).rejects.toThrow("gas budget");
}, 60000);

it("retains unused ceiling after attaching a cheaper mint and refuses a foreign spec under the same hold", async () => {
  const f = await fixture();
  await f.journal.admitGas(f.record, f.policy.lifetimeGasBudgetWei, f.signal);
  await f.journal.reserve(f.record, f.response, f.terms);
  const second = await creatorMintFixture();
  await expect(f.journal.admitGas(second.record, "1", f.signal)).rejects.toThrow("gas budget");
  await expect(f.journal.reserve({ ...second.record, id: f.record.id }, second.response, f.terms)).rejects.toThrow("request unavailable");
  expect(await f.journal.getGasAdmission(f.record.id)).toMatchObject({ maxGasCostWei: f.policy.lifetimeGasBudgetWei });
});
