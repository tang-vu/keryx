import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import { provisionSyntheticStorage } from "../db/storage-identity-fixture";
import { SqliteAdapter } from "../db/sqlite-adapter";
const { grant } = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock("./session-grants", () => ({ getGrant: grant }));
const folders: string[] = [], adapters: SqliteAdapter[] = [];
afterEach(() => { for (const db of adapters.splice(0)) db.close(); vi.unstubAllEnvs();
  for (const path of folders.splice(0)) rmSync(path, { force: true, recursive: true }); });
it.each(["testnet-real", "testnet-offline"] as const)("rejects individually verified foreign %s adapter before grant/signing", async mode => {
  vi.resetModules(); grant.mockReset(); vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "33".repeat(32));
  const folder = mkdtempSync(join(tmpdir(), "keryx-storage-binding-")); folders.push(folder);
  const selectedPath = join(folder, "selected.sqlite"), foreignPath = join(folder, "foreign.sqlite"), manifest = join(folder, "manifest.json");
  const selected = await provisionSyntheticStorage(selectedPath, "testnet-real");
  const foreign = await provisionSyntheticStorage(foreignPath, mode);
  const a = new SqliteAdapter(selectedPath, { expectedIdentity: selected }), b = new SqliteAdapter(foreignPath, { expectedIdentity: foreign });
  adapters.push(a, b); await a.init(); await b.init();
  expect(b.getStorageIdentity()).toEqual(foreign);
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity: selected,
    backend: { kind: "sqlite", databasePath: selectedPath } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", selectedPath);
  const reads = vi.spyOn(b, "listPayments"), cache = vi.spyOn(b, "getCached"), payments = vi.spyOn(b, "recordPayment");
  const { getPaymentGateway } = await import("./payment-gateway");
  await expect(getPaymentGateway(b, { sessionId: "selected-owner", requestSignature: vi.fn() })).rejects.toThrow(/storage identity does not match/);
  expect(grant).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled(); expect(cache).not.toHaveBeenCalled(); expect(payments).not.toHaveBeenCalled();
  // Matching real storage without a treasury key refuses treasury fallback, independently of the foreign-store tests.
  await expect(getPaymentGateway(a)).rejects.toThrow(/treasury signer/);
  vi.stubEnv("KERYX_PRIVATE_WORKER_ENABLED", "1");
  const { privateWorkerBootstrap } = await import("../a2a/private-worker-bootstrap");
  const identityRead = vi.spyOn(b, "getStorageIdentity");
  expect(() => privateWorkerBootstrap(b, { save: vi.fn(), read: vi.fn(), restore: vi.fn(), entries: vi.fn() })).toThrow("configuration unavailable");
  expect(identityRead).toHaveBeenCalledOnce();
  expect(reads).not.toHaveBeenCalled(); expect(cache).not.toHaveBeenCalled(); expect(payments).not.toHaveBeenCalled();
});
