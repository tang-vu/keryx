import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { provisionSyntheticStorage, syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { withWithdrawalApplicationStore, withWithdrawalCashOutStore } from "./withdrawal-application-store";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true }); });
async function fixture(mode: "testnet-real" | "testnet-offline" = "testnet-real") {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const directory = mkdtempSync(join(tmpdir(), "keryx-raw-authority-")); directories.push(directory);
  const file = join(directory, "application.sqlite"), identity = await provisionSyntheticStorage(file, mode);
  const adapter = new SqliteAdapter(file, { expectedIdentity: identity }); await adapter.init(); adapter.close();
  return { file, identity };
}
it.runIf(process.platform === "linux")("reads an explicitly identified actual application store without initializing or changing the main file", async () => {
  const f = await fixture(), before = readFileSync(f.file);
  vi.stubEnv("CONTENT_MASTER_KEY", "");
  const init = vi.spyOn(SqliteAdapter.prototype, "init");
  await expect(withWithdrawalApplicationStore(f.file, async store => store.getCreatorWithdrawalAttestation("missing", "missing"), f.identity)).resolves.toBeNull();
  expect(init).not.toHaveBeenCalled(); expect(readFileSync(f.file)).toEqual(before); init.mockRestore();
});
it("refuses foreign identity and offline mode before exposing read or write callbacks", async () => {
  const real = await fixture(), offline = await fixture("testnet-offline"), operation = vi.fn();
  await expect(withWithdrawalApplicationStore(real.file, operation, syntheticStorageIdentity("testnet-real"))).rejects.toThrow();
  await expect(withWithdrawalCashOutStore(real.file, operation, syntheticStorageIdentity("testnet-real"))).rejects.toThrow();
  await expect(withWithdrawalApplicationStore(offline.file, operation, offline.identity)).rejects.toThrow();
  await expect(withWithdrawalCashOutStore(offline.file, operation, offline.identity)).rejects.toThrow();
  expect(operation).not.toHaveBeenCalled();
});
