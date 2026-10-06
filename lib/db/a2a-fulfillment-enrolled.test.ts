import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { createSqliteStorage } from "./storage-identity-provision";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { seedSyntheticA2aOriginal } from "./a2a-original-fixture";
import { syntheticFailedOriginal, syntheticFulfilledRun } from "./a2a-fulfillment-fixture";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it("keeps fulfillment within the sealed mainnet writer and exposes exact delivered proof to its readonly facade", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-06T10:00:05.000Z");
  const folder = mkdtempSync(join(tmpdir(), "keryx-fulfillment-enrolled-")), file = join(folder, "synthetic.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const manifestPath = join(folder, "manifest.json");
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "99".repeat(32));
  const writer = await createEnrolledSqliteAdapter(); cleanup.push(() => writer.close());
  const reader = await createReadonlyEnrolledSqliteAdapter(); cleanup.push(() => reader.close());
  const fixture = syntheticFailedOriginal(1, ARC_MAINNET_PROFILE); await seedSyntheticA2aOriginal(writer, fixture);
  expect(await reader.getA2aFailedOriginalFulfillment(fixture.order.id)).toBeNull();
  expect(() => reader.claimA2aFailedOriginalFulfillment(fixture.input)).toThrow(/Readonly/);
  const claim = await writer.claimA2aFailedOriginalFulfillment(fixture.input); expect(claim).not.toBeNull();
  expect(await reader.getA2aFailedOriginalFulfillment(fixture.order.id)).toEqual({ claim, completion: null });
  const result = syntheticFulfilledRun(claim!);
  expect(() => reader.completeA2aFailedOriginalFulfillment(result)).toThrow(/Readonly/);
  expect(await writer.completeA2aFailedOriginalFulfillment(result)).toBe(true);
  expect(await reader.hasA2aFailedOriginalFulfillment(fixture.authority)).toBe(true);
  const raw = new DatabaseSync(file); cleanup.push(() => raw.close());
  expect(() => raw.prepare("DELETE FROM a2a_fulfillment_completions").run()).toThrow();
  expect(() => raw.prepare("INSERT INTO a2a_failed_original_fulfillments VALUES(?,?,?,?,?)")
    .run(fixture.order.id, "foreign", "{}", "{}", new Date().toISOString())).toThrow();
  expect(await reader.hasA2aFailedOriginalFulfillment({ ...fixture.authority, failedClosureSha256: "cc".repeat(32) })).toBe(false);
  expect(await reader.hasA2aOriginalSettlement(fixture.binding)).toBe(true);
}, 30000);
