import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withNewWithdrawalDrillStore } from "./creator-withdrawal-drill-store";
import { withdrawalDrillBuyerKey } from "./withdrawal-drill-buyer-key";
import { creatorWithdrawalFixture } from "./test-fixtures/creator-withdrawal";
import { submitWithdrawalTransfer, withdrawalTransferProgress } from "../lib/gateway/withdrawal-transfer-service";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { saveWithdrawalDrillExclusive } from "./withdrawal-drill-files";

import { syntheticStorageIdentity } from "../lib/db/storage-identity-fixture";
const identity = syntheticStorageIdentity("testnet-real");
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory).startsWith("keryx-withdrawal-smoke-")).toBe(true);
    fs.rmSync(directory, { recursive: true });
  }
});
it("initializes actual SQLite before admission/POST and recovers a retained original in a new keyless connection", async () => {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-withdrawal-smoke-")); directories.push(directory);
  const database = path.join(directory, "application.sqlite"), fixture = await creatorWithdrawalFixture();
  let admitted = 0, posted = 0;
  await withNewWithdrawalDrillStore(database, async store => {
    await submitWithdrawalTransfer(store, fixture.record, fixture.record.owner, async original => {
      expect(await store.getCreatorWithdrawal(original.id, original.owner)).toEqual(original);
      expect(await store.getCreatorWithdrawalTransferClaim(original.id, original.owner)).toBeNull();
      admitted++;
    }, async original => {
      expect(await store.getCreatorWithdrawalTransferClaim(original.id, original.owner)).not.toBeNull();
      posted++; return fixture.response;
    }, new AbortController().signal);
  }, identity);
  expect([admitted, posted]).toEqual([1, 1]);
  const reopened = new SqliteAdapter(database, { readOnly: true, expectedIdentity: identity });
  try {
    expect(await reopened.getCreatorWithdrawal(fixture.record.id, fixture.record.owner)).toEqual(fixture.record);
    expect(await withdrawalTransferProgress(reopened, fixture.record.id, fixture.record.owner)).toMatchObject({ status: "attestation-stored" });
    expect((await reopened.listPayments(10)).length).toBe(0);
  } finally { reopened.close(); }
  const duplicate = vi.fn();
  await expect(withNewWithdrawalDrillStore(database, duplicate, identity)).rejects.toThrow();
  expect(duplicate).not.toHaveBeenCalled();
  expect([admitted, posted]).toEqual([1, 1]);
});
it("uses the existing original buyer env name and rejects conflicting loaded signers", () => {
  const key = `0x${"11".repeat(32)}`;
  expect(withdrawalDrillBuyerKey({ KERYX_BUYER_PRIVATE_KEY: key })).toBe(key);
  expect(withdrawalDrillBuyerKey({ BUYER_PRIVATE_KEY: key })).toBe(key);
  expect(withdrawalDrillBuyerKey({ KERYX_BUYER_PRIVATE_KEY: key, BUYER_PRIVATE_KEY: key })).toBe(key);
  expect(() => withdrawalDrillBuyerKey({ KERYX_BUYER_PRIVATE_KEY: key, BUYER_PRIVATE_KEY: `0x${"22".repeat(32)}` })).toThrow("Conflicting");
  expect(() => withdrawalDrillBuyerKey({})).toThrow("unavailable");
});
it("withholds the operation after schema failure and retains exclusive signing/broadcast markers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-withdrawal-smoke-")); directories.push(directory);
  const operation = vi.fn(), database = path.join(directory, "application.sqlite");
  vi.spyOn(SqliteAdapter.prototype, "init").mockRejectedValueOnce(new Error("Schema unavailable"));
  await expect(withNewWithdrawalDrillStore(database, operation, identity)).rejects.toThrow("Schema unavailable");
  expect(operation).not.toHaveBeenCalled();
  await expect(withNewWithdrawalDrillStore(database, operation, identity)).rejects.toThrow();
  for (const name of ["signing-attempt.json", "broadcast-attempt.json"]) {
    const file = path.join(directory, name);
    saveWithdrawalDrillExclusive(file, { original: "first" });
    expect(() => saveWithdrawalDrillExclusive(file, { original: "replacement" })).toThrow();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ original: "first" });
  }
});
