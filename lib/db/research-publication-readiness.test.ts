/** Genuine synthetic SQLite connections; no provider, payment or remote database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { createEnrolledSqliteRunPrivacy, createSqliteRunPrivacy, isEnrolledSqlitePrivacyContention, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";

const wallet = `0x${"a".repeat(40)}`;
const actor = { wallet, binding: { network: "eip155:5042" as const, origin: "https://synthetic-ready.example" } };
const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
  network: actor.binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
let folder: string, template: string, sequence = 0;
const opened: Array<{ close(): void }> = [];
function snapshot(db: DatabaseSync) {
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  return canonicalJson({ schema, rows: db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all().map(canonicalJson).sort()]) });
}
function ordinary(file = ":memory:", readOnly = false) {
  const db = new DatabaseSync(file, { readOnly }); opened.push(db);
  if (file === ":memory:") { installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL); }
  return { db, store: createSqliteRunPrivacy(db) };
}
function native(readOnly = false, runtimeGuard?: () => void) {
  const file = join(folder, `native-${++sequence}.sqlite`); copyFileSync(template, file);
  const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(connection);
  const observer = new DatabaseSync(file, { readOnly: true }); opened.push(observer);
  return { file, connection, observer, store: createEnrolledSqliteRunPrivacy(connection.db) };
}
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-publication-ready-")); template = join(folder, "full20.sqlite");
  const db = new DatabaseSync(template);
  try { db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db); installNativeUserDomainSchema(db);
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT"); }
  finally { db.close(); }
});
afterEach(() => { for (const connection of opened.splice(0).reverse()) connection.close(); });
afterAll(() => { if (folder) { if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes("keryx-publication-ready-")) throw Error("Unsafe fixture cleanup");
  rmSync(folder, { recursive: true, force: true }); } });

describe("actual SQLite creation write readiness", () => {
  it("accepts an admitted ordinary writer without changing schema or any row", async () => {
    const f = ordinary(); f.db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet, "private");
    const before = snapshot(f.db); await f.store.creationReady(); expect(snapshot(f.db)).toBe(before); expect(await f.store.defaults(actor)).toBe("private");
  });
  it("rejects query_only while leaving preferences readable and unchanged", async () => {
    const f = ordinary(), before = snapshot(f.db); f.db.exec("PRAGMA query_only=ON");
    await expect(f.store.creationReady()).rejects.toMatchObject({ code: "privacy_unavailable" });
    expect(await f.store.defaults(actor)).toBe("public"); expect(snapshot(f.db)).toBe(before);
  });
  it("rejects an actual ordinary read-only connection without adopting its schema", async () => {
    const file = join(folder, `ordinary-${++sequence}.sqlite`), seed = new DatabaseSync(file);
    try { installSqliteApplicationSchema(seed); seed.exec(RUN_PRIVACY_SQL); } finally { seed.close(); }
    const f = ordinary(file, true), before = snapshot(f.db);
    await expect(f.store.creationReady()).rejects.toMatchObject({ code: "privacy_unavailable" }); expect(snapshot(f.db)).toBe(before);
  });
  it("rejects source schema drift before a write-readiness result", async () => {
    const f = ordinary(); f.db.exec("DROP TRIGGER run_privacy_new"); const before = snapshot(f.db);
    await expect(f.store.creationReady()).rejects.toMatchObject({ code: "privacy_unavailable" }); expect(snapshot(f.db)).toBe(before);
  });
  it.each([false, true])("retains genuine native full20 readOnly=%s authority", async readOnly => {
    const f = native(readOnly), before = snapshot(f.observer);
    if (readOnly) await expect(f.store.creationReady()).rejects.toMatchObject({ code: "privacy_unavailable" }); else await f.store.creationReady();
    expect(snapshot(f.observer)).toBe(before);
  });
  it("rechecks the real native runtime fence and rejects raw connections", async () => {
    let admitted = true;
    const f = native(false, () => { if (!admitted) throw Error("Synthetic retired deployment"); });
    await f.store.creationReady(); const before = snapshot(f.observer); admitted = false;
    await expect(f.store.creationReady()).rejects.toThrow(); expect(snapshot(f.observer)).toBe(before);
    const raw = new DatabaseSync(f.file); opened.push(raw);
    expect(() => createEnrolledSqliteRunPrivacy(raw)).toThrow(); expect(() => createSqliteRunPrivacy(raw)).toThrow();
  });
  it("retains native contention classification and accepts only after the real writer lock releases", async () => {
    const f = native(), locker = new DatabaseSync(f.file); opened.push(locker);
    locker.exec("BEGIN IMMEDIATE");
    try { await expect(f.store.creationReady()).rejects.toSatisfy(isEnrolledSqlitePrivacyContention); }
    finally { locker.exec("ROLLBACK"); }
    await f.store.creationReady();
  });
});
