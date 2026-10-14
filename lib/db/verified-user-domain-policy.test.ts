import { afterAll, beforeAll, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { createSqliteStorage } from "./storage-identity-provision";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteForeignKeys, assertVerifiedSqliteWritePolicy,
  openVerifiedSqliteStorage } from "./storage-identity-connection";

let folder: string, file: string, identity: StorageIdentity;
const connections: ReturnType<typeof openVerifiedSqliteStorage>[] = [];
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-native-policy-")); file = join(folder, "synthetic.sqlite");
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  await createSqliteStorage(file, identity);
});
afterAll(() => { for (const connection of connections) connection.close(); if (folder) rmSync(folder, { recursive: true, force: true }); });
function open(readOnly = false, runtimeGuard?: () => void) {
  const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard }); connections.push(connection); return connection;
}

it("raw connections and invented fields cannot acquire either private connection policy", () => {
  const raw = new DatabaseSync(":memory:");
  try {
    Object.assign(raw, { foreignKeys: true, readOnly: false });
    expect(() => assertVerifiedSqliteForeignKeys(raw)).toThrow();
    expect(() => assertVerifiedSqliteWritePolicy(raw)).toThrow();
  } finally { raw.close(); }
});

it("a genuine readonly connection retains positive FK policy and healthy reads after write-policy refusal", () => {
  const connection = open(true), before = readFileSync(file);
  expect(() => assertVerifiedSqliteForeignKeys(connection.db)).not.toThrow();
  expect(() => assertVerifiedSqliteWritePolicy(connection.db)).toThrow();
  expect(() => assertVerifiedSqliteConnection(connection.db)).not.toThrow();
  expect(() => connection.db.exec("PRAGMA foreign_keys=OFF")).toThrow();
  expect(() => assertVerifiedSqliteForeignKeys(connection.db)).not.toThrow();
  expect(readFileSync(file)).toEqual(before);
});

it("the FK assertion performs no native guard or SQL and refuses additional arguments", () => {
  let guards = 0; const connection = open(false, () => { guards++; }), before = guards;
  for (let index = 0; index < 3; index++) assertVerifiedSqliteForeignKeys(connection.db);
  expect(guards).toBe(before);
  expect(() => Reflect.apply(assertVerifiedSqliteForeignKeys, undefined, [connection.db, true])).toThrow();
  expect(() => assertVerifiedSqliteWritePolicy(connection.db)).not.toThrow();
});

it("the captured FK policy becomes unavailable when its genuine connection closes", () => {
  const connection = open(); assertVerifiedSqliteForeignKeys(connection.db); connection.close();
  expect(() => assertVerifiedSqliteForeignKeys(connection.db)).toThrow();
  expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
});
