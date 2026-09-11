import { afterEach, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { provisionFreshWithdrawalJournal } from "./withdrawal-provision";
const linux = it.skipIf(process.platform !== "linux"), directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "keryx-provision-")); directories.push(parent); chmodSync(parent, 0o700);
  return { parent, directory: join(parent, "relay"), policy: { format: "creator-mint-journal-v1", chainId: 5042002,
    relayer: privateKeyToAccount(generatePrivateKey()).address, initialNonce: 0, lifetimeGasBudgetWei: "600000000000000", maxSlots: 1 } };
}
linux("creates and reopens a private empty journal, refusing duplicate or corrupt history replacement", async () => {
  const f = fixture(), signal = new AbortController().signal;
  const attempts = await Promise.allSettled([provisionFreshWithdrawalJournal(f.directory, f.policy, signal),
    provisionFreshWithdrawalJournal(f.directory, f.policy, signal)]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const path = join(f.directory, "mint.sqlite"), before = readFileSync(path);
  await expect(provisionFreshWithdrawalJournal(f.directory, f.policy, signal)).rejects.toThrow("Retain any existing files");
  expect(readFileSync(path)).toEqual(before);
  writeFileSync(path, "retained corrupt history");
  await expect(provisionFreshWithdrawalJournal(f.directory, f.policy, signal)).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toBe("retained corrupt history");
});
linux("rejects invalid policy, nonzero initial nonce, cancellation and unsafe parent before creating files", async () => {
  const f = fixture(), signal = new AbortController().signal;
  for (const delta of [{ initialNonce: 1 }, { chainId: 1 }, { maxSlots: 1001 }, { lifetimeGasBudgetWei: "0" }]) {
    await expect(provisionFreshWithdrawalJournal(f.directory, { ...f.policy, ...delta }, signal)).rejects.toThrow();
    expect(existsSync(f.directory)).toBe(false);
  }
  const stop = new AbortController(); stop.abort();
  await expect(provisionFreshWithdrawalJournal(f.directory, f.policy, stop.signal)).rejects.toThrow();
  expect(existsSync(f.directory)).toBe(false);
  chmodSync(f.parent, 0o755);
  await expect(provisionFreshWithdrawalJournal(f.directory, f.policy, signal)).rejects.toThrow();
  expect(existsSync(f.directory)).toBe(false);
});
