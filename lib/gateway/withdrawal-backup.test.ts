import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { provisionFreshWithdrawalJournal } from "./withdrawal-provision";
import { backupWithdrawalJournal } from "./withdrawal-backup";
import { inspectWithdrawalBackup } from "./withdrawal-backup-inspect";

const linux = it.skipIf(process.platform !== "linux"), directories: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "keryx-withdrawal-backup-")); directories.push(parent); chmodSync(parent, 0o700);
  const f = await creatorMintFixture(), signal = new AbortController().signal;
  const source = join(parent, "relay"), destination = join(parent, "snapshot");
  const created = await provisionFreshWithdrawalJournal(source, { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: f.terms.relayer, initialNonce: 0, lifetimeGasBudgetWei: "1200000000000000", maxSlots: 2 }, signal);
  return { ...f, source, destination, parent, signal, policy: created.policy };
}
linux("backs up WAL-resident admissions and exact signed originals, verifies reopen and refuses overwrite", async () => {
  const f = await fixture(), pending = await creatorMintFixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  const db = new DatabaseSync(join(f.source, "mint.sqlite"));
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
    const journal = createWithdrawalMintJournal(db, f.policy);
    await journal.admitGas(f.record, "600000000000000", f.signal);
    await journal.reserve(f.record, f.response, f.terms); await journal.savePrepared(f.record.id, f.raw);
    await journal.admitGas(pending.record, "600000000000000", f.signal);
    // SQLite sidecars inherit the restrictive source database mode.
    const saved = await backupWithdrawalJournal(f.source, f.destination, f.signal);
    expect(saved.state).toBe("verified-backup"); expect(saved.manifest.signingResumeAuthorized).toBe(false);
    const bytes = readFileSync(join(f.destination, "mint.sqlite"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(saved.manifest.databaseSha256);
    expect(await inspectWithdrawalBackup(f.destination, saved.manifestSha256, f.signal)).toMatchObject({
      state: "verified-backup-copy", signingResumeAuthorized: false });
    const copied = new DatabaseSync(join(f.destination, "mint.sqlite"), { readOnly: true });
    try {
      const restored = createWithdrawalMintJournal(copied, f.policy);
      expect((await restored.getPrepared(f.record.id))?.serializedTransaction).toBe(f.raw);
      expect(await restored.getGasAdmission(pending.record.id)).toEqual(await journal.getGasAdmission(pending.record.id));
      expect(restored.gasAdmissionSummary()).toEqual(journal.gasAdmissionSummary());
    } finally { copied.close(); }
    await expect(backupWithdrawalJournal(f.source, f.destination, f.signal)).rejects.toThrow();
    expect(readFileSync(join(f.destination, "mint.sqlite"))).toEqual(bytes);
    expect(existsSync(join(f.source, "private-worker.lock"))).toBe(false);
  } finally { db.close(); }
});
linux("rejects altered manifests, database bytes and policy even when a copy looks complete", async () => {
  const f = await fixture(), saved = await backupWithdrawalJournal(f.source, f.destination, f.signal);
  const manifestPath = join(f.destination, "manifest.json"), databasePath = join(f.destination, "mint.sqlite");
  const manifest = readFileSync(manifestPath), database = readFileSync(databasePath);
  await expect(inspectWithdrawalBackup(f.destination, "0".repeat(64), f.signal)).rejects.toThrow();
  writeFileSync(manifestPath, JSON.stringify({ ...saved.manifest, capturedAt: "2025-01-01T00:00:00.000Z" }));
  await expect(inspectWithdrawalBackup(f.destination, saved.manifestSha256, f.signal)).rejects.toThrow();
  writeFileSync(manifestPath, manifest);
  const altered = Buffer.from(database); altered[altered.length - 1] ^= 1; writeFileSync(databasePath, altered);
  await expect(inspectWithdrawalBackup(f.destination, saved.manifestSha256, f.signal)).rejects.toThrow();
  writeFileSync(databasePath, database);
  const badFingerprint = JSON.stringify({ ...saved.manifest, journalFingerprint: "0".repeat(64) });
  writeFileSync(manifestPath, badFingerprint);
  await expect(inspectWithdrawalBackup(f.destination, createHash("sha256").update(badFingerprint).digest("hex"), f.signal)).rejects.toThrow();
  writeFileSync(manifestPath, manifest);
  writeFileSync(join(f.destination, "policy.json"), JSON.stringify({ ...saved.manifest.policy, maxSlots: 1 }));
  await expect(inspectWithdrawalBackup(f.destination, saved.manifestSha256, f.signal)).rejects.toThrow();
  writeFileSync(join(f.destination, "policy.json"), JSON.stringify(saved.manifest.policy));
  const stop = new AbortController(); stop.abort();
  await expect(inspectWithdrawalBackup(f.destination, saved.manifestSha256, stop.signal)).rejects.toThrow();
  chmodSync(manifestPath, 0o644);
  await expect(inspectWithdrawalBackup(f.destination, saved.manifestSha256, f.signal)).rejects.toThrow();
});
linux("preserves an existing lock and refuses cancelled or unsafe destinations", async () => {
  const f = await fixture();
  writeFileSync(join(f.source, "private-worker.lock"), "retained operator lock", { mode: 0o600 });
  await expect(backupWithdrawalJournal(f.source, f.destination, f.signal)).rejects.toThrow();
  expect(readFileSync(join(f.source, "private-worker.lock"), "utf8")).toBe("retained operator lock");
  expect(existsSync(f.destination)).toBe(false);
  const stop = new AbortController(); stop.abort();
  await expect(backupWithdrawalJournal(f.source, f.destination, stop.signal)).rejects.toThrow();
  await expect(backupWithdrawalJournal(f.source, join(f.source, "nested"), f.signal)).rejects.toThrow();
  expect(existsSync(join(f.source, "nested"))).toBe(false);
});
