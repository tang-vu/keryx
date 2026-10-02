import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { createSqliteStorage, enrollSqliteStorage } from "./storage-identity-provision";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.unstubAllEnvs(); });
async function fixture() {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-storage-")), file = join(folder, "fresh.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(),
    provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const manifestPath = join(folder, "storage.json");
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const adapter = await (await import("./index")).getDb();
  cleanup.push(() => { if ("close" in adapter) (adapter.close as () => void)(); });
  return { adapter, file, identity, manifestPath };
}
it("uses a fresh native mainnet namespace and atomically retains its own nonce/cap history", async () => {
  const { adapter, file } = await fixture();
  await adapter.activateBrowserJournal();
  const owner = "0x1111111111111111111111111111111111111111", signer = "0x2222222222222222222222222222222222222222";
  const payee = "0x3333333333333333333333333333333333333333", grantEpoch = randomUUID();
  await adapter.upsertSessionGrant({ sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch,
    cap: 0.001, expiry: Date.now() + 60_000, txHash: "synthetic-test-no-funds" });
  const input: BrowserJournalAdmission = { sessionId: owner, signer, grantEpoch, requestId: randomUUID(), queryId: randomUUID(),
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1000,
    network: ARC_MAINNET_PROFILE.networkId, token: ARC_MAINNET_PROFILE.usdcAddress, gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet,
    requirements: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      payTo: payee, amount: "1000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1",
        verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    payment: { kind: "fetch", queryId: "", sourceId: "synthetic-source", sourceName: "Synthetic source",
      payer: signer, payee, amountUsdc: 0.001, network: ARC_MAINNET_PROFILE.networkId, grantEpoch } };
  input.payment.queryId = input.queryId;
  const admitted = await adapter.admitBrowserJournal(input);
  expect(admitted.status).toBe("admitted");
  await expect(adapter.admitBrowserJournal({ ...input, requestId: randomUUID(), network: ARC_TESTNET_PROFILE.networkId,
    gatewayContract: ARC_TESTNET_PROFILE.gatewayWallet })).rejects.toThrow();
  expect((await adapter.admitBrowserJournal({ ...input, requestId: randomUUID() })).status).toBe("grant_or_cap_refused");
  expect((await adapter.getSessionGrant(owner))!.spent).toBe(0.001);
  const native = new DatabaseSync(file);
  try {
    expect(native.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()?.n).toBe(1);
    expect(native.prepare("SELECT network FROM browser_authorization_intents").get()?.network).toBe(ARC_MAINNET_PROFILE.networkId);
    expect(native.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer)?.spent_micro).toBe(1000);
  } finally { native.close(); }
}, 30000);
it("refuses adopting, reusing or relabelling mainnet storage as testnet", async () => {
  const { file, identity } = await fixture();
  await expect(createSqliteStorage(file, identity)).rejects.toThrow();
  await expect(enrollSqliteStorage(file, identity, {} as never)).rejects.toThrow();
  for (const mutation of [{ format: "keryx-storage-identity-v1" }, { authorityMode: "testnet-real" },
    { network: ARC_TESTNET_PROFILE.networkId }, { profileDigest: "22".repeat(32) }])
    expect(() => validateStorageIdentity({ ...identity, ...mutation })).toThrow();
}, 30000);
it("refuses mainnet without a sealed manifest before creating a legacy database", async () => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-no-fallback-")), file = join(folder, "legacy.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", undefined); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const { getDb } = await import("./index");
  await expect(getDb()).rejects.toThrow("Storage deployment configuration unavailable");
  expect(existsSync(file)).toBe(false);
});
it("closes the initialized application facade when its pinned manifest changes", async () => {
  const { adapter, manifestPath, identity, file } = await fixture();
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1",
    identity: { ...identity, storageId: randomUUID() }, backend: { kind: "sqlite", databasePath: file } }));
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
it("refuses forcing sealed real mainnet storage offline before application writes", async () => {
  const { adapter, file } = await fixture();
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  const { readRuntimeStorageDeployment } = await import("./runtime-storage-config");
  expect(() => readRuntimeStorageDeployment()).toThrow("Storage deployment configuration unavailable");
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
