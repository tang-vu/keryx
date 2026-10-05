import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { createSqliteStorage } from "./storage-identity-provision";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import type { SqliteAdapter } from "./sqlite-adapter";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.unstubAllEnvs();
});

it("shares exact indexed-account metrics with the sealed mainnet readonly SQLite surface", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-account-metrics-"));
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "synthetic.sqlite"), manifestPath = join(folder, "deployment.json");
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: "2026-10-05T00:00:00.000Z", provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath);
  vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  const { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter, ENROLLED_SQLITE_METHOD_ACCESS } =
    await import("./enrolled-sqlite-adapter");
  const writer = await createEnrolledSqliteAdapter();
  cleanup.push(() => writer.close());
  const wallet = `0x${"aB".repeat(20)}`;
  await writer.upsertUser(wallet, "reader");
  await writer.upsertUser(wallet.toLowerCase(), "creator");
  const reader: SqliteAdapter = await createReadonlyEnrolledSqliteAdapter();
  cleanup.push(() => reader.close());
  expect(ENROLLED_SQLITE_METHOD_ACCESS.metrics).toBe("read");
  const before = readFileSync(file);
  const metrics = await reader.metrics();
  expect(metrics.recordedAccounts).toBe(1);
  expect(metrics.totalQueries).toBe(0);
  expect(JSON.stringify(metrics)).not.toContain(wallet.toLowerCase());
  expect(readFileSync(file)).toEqual(before);
}, 30_000);
