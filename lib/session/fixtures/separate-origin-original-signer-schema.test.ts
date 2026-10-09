import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertEmptySignerFixtureSchema,
  createSignerFixtureSchemaSeed,
  type SignerFixtureSchemaSeed,
} from "./separate-origin-original-signer-schema";
import type { SqliteAdapter } from "../../db/sqlite-adapter";

let seed: SignerFixtureSchemaSeed;
const folders: string[] = [];
const handles: { close(): void }[] = [];
beforeAll(async () => { seed = await createSignerFixtureSchemaSeed(); }, 120000);
afterEach(() => {
  for (const handle of handles.splice(0).reverse()) handle.close();
  for (const folder of folders.splice(0)) {
    if (fs.realpathSync(path.dirname(folder)) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(folder).startsWith("keryx-signer-schema-test-")) throw new Error("Test cleanup target refused");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
afterAll(() => {
  if (!seed) return;
  seed.close();
  seed.close();
  expect(fs.existsSync(path.dirname(seed.file))).toBe(false);
  expect(() => seed.clone(path.join(os.tmpdir(), "closed-signer-seed.sqlite"))).toThrow("seed closed");
});
function target(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-signer-schema-test-"));
  folders.push(folder);
  return path.join(folder, "journal.sqlite");
}
async function clone(): Promise<{ db: SqliteAdapter; native: DatabaseSync; file: string }> {
  const file = target(), db = seed.clone(file);
  handles.push(db);
  await db.init();
  const native = new DatabaseSync(file);
  handles.push(native);
  return { db, native, file };
}

it("clones a complete empty actual schema with unchanged WAL/FULL durability", async () => {
  const { native } = await clone();
  expect(() => assertEmptySignerFixtureSchema(native)).not.toThrow();
  expect(native.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
  expect(native.prepare("PRAGMA synchronous").get()?.synchronous).toBe(2);
  for (const suffix of ["-wal", "-shm", "-journal"]) expect(fs.existsSync(seed.file + suffix)).toBe(false);
  expect(fs.existsSync(seed.file)).toBe(true);
});

it("keeps peer clones and the immutable seed separate from business and grant writes", async () => {
  const first = await clone(), second = await clone();
  first.native.prepare("INSERT INTO cache_items(source_id,text) VALUES(?,?)").run("synthetic", "fixture body");
  first.native.prepare("INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch) VALUES(?,?,?,?,?,?,?,?)")
    .run("session", "signer", "owner", 1, 0, 1, "synthetic", "epoch");
  expect(() => assertEmptySignerFixtureSchema(first.native)).toThrow("business rows");
  expect(() => assertEmptySignerFixtureSchema(second.native)).not.toThrow();
  const third = await clone();
  expect(() => assertEmptySignerFixtureSchema(third.native)).not.toThrow();
});

it("refuses original rows and activated retained authority in candidate seeds", async () => {
  const original = await clone();
  // A contaminated historical snapshot may have bypassed FK checks; the seed census must still refuse it.
  original.native.exec("PRAGMA foreign_keys=OFF");
  original.native.prepare("INSERT INTO browser_signing_originals(nonce,query_id,original,input) VALUES(?,?,?,?)")
    .run("synthetic", "synthetic", "{}", "{}");
  expect(() => assertEmptySignerFixtureSchema(original.native)).toThrow("business rows");
  const active = await clone();
  active.native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
  expect(() => assertEmptySignerFixtureSchema(active.native)).toThrow("active authority");
});

it("never overwrites an existing destination or copies beside a retained journal", () => {
  const existing = target();
  fs.writeFileSync(existing, "synthetic retained file");
  expect(() => seed.clone(existing)).toThrow();
  expect(fs.readFileSync(existing, "utf8")).toBe("synthetic retained file");
  const journal = target();
  fs.writeFileSync(journal + "-wal", "synthetic retained journal");
  expect(() => seed.clone(journal)).toThrow("unclosed journal");
  expect(fs.existsSync(journal)).toBe(false);
});

it("recognizes only the exact singleton installation UUID, refusing missing, malformed and widened rows", async () => {
  const validId = "12345678-1234-4234-8234-123456789abc";
  for (const rows of [[], [{ singleton: 1, id: "not-a-uuid" }], [{ singleton: 1, id: validId + "\n" }], [{ singleton: 2, id: validId }],
    [{ singleton: 1, id: validId }, { singleton: 1, id: validId }]]) {
    const { native } = await clone();
    native.exec("DROP TABLE deliverable_acceptance_store; CREATE TABLE deliverable_acceptance_store(singleton INTEGER,id TEXT)");
    for (const row of rows) native.prepare("INSERT INTO deliverable_acceptance_store VALUES(?,?)").run(row.singleton, row.id);
    expect(() => assertEmptySignerFixtureSchema(native)).toThrow("invalid installation identity");
  }
  const { native } = await clone();
  native.exec("ALTER TABLE deliverable_acceptance_store ADD COLUMN authority TEXT");
  expect(() => assertEmptySignerFixtureSchema(native)).toThrow("invalid installation identity");
});

it("still refuses acceptance journal entries and unknown populated tables as business authority", async () => {
  const accepted = await clone();
  accepted.native.prepare("INSERT INTO deliverable_acceptance_entries(owner,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,data) VALUES(?,?,?,?,?,?,?,?)")
    .run("synthetic-owner", "eip155:5042002", "synthetic-original", 1, "synthetic-key", "synthetic-fingerprint", "synthetic-digest", "{}");
  expect(() => assertEmptySignerFixtureSchema(accepted.native)).toThrow("business rows");
  const unknown = await clone();
  unknown.native.exec("CREATE TABLE unknown_authority(id INTEGER); INSERT INTO unknown_authority VALUES(1)");
  expect(() => assertEmptySignerFixtureSchema(unknown.native)).toThrow("business rows");
});

it("refuses a changed seed before creating a clone", () => {
  const destination = target();
  const original = fs.readFileSync(seed.file);
  fs.chmodSync(seed.file, 0o600);
  try {
    fs.appendFileSync(seed.file, "synthetic mutation");
    expect(() => seed.clone(destination)).toThrow("seed changed");
    expect(fs.existsSync(destination)).toBe(false);
  } finally {
    fs.writeFileSync(seed.file, original);
    fs.chmodSync(seed.file, 0o400);
  }
});

it("refuses an incomplete schema", () => {
  const native = new DatabaseSync(":memory:");
  try { expect(() => assertEmptySignerFixtureSchema(native)).toThrow("Incomplete"); }
  finally { native.close(); }
});
