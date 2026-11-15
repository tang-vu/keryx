import { afterEach, expect, it } from "vitest";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, STORAGE_TESTNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "../../lib/db/storage-identity";
import { insertStorageIdentity } from "../../lib/db/storage-identity-sqlite";
import { nativeMaterializationProfile } from "../../lib/db/postgres/runtime-profile";
import { snapshotRowDigest, snapshotRows, snapshotTables } from "./typed-snapshot.mts";
import { inspectTypedDeltaSnapshot, streamTypedSnapshotDelta, TYPED_SNAPSHOT_DELTA_LIMITS, type TypedDeltaRequest, type TypedDeltaSnapshot } from "./typed-snapshot-delta.mts";
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) { for (const leaf of readdirSync(folder)) unlinkSync(join(folder, leaf)); rmdirSync(folder); } });
const hash = (wire: string | Buffer) => createHash("sha256").update(wire).digest("hex");
const identity = (): StorageIdentity => ({ format: "keryx-storage-identity-v1", authorityMode: "testnet-offline", network: "eip155:5042002",
  profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) });
function fixture(schema = "CREATE TABLE sample(k PRIMARY KEY,v)", before = (_db: DatabaseSync) => {}, after = before,
  other: StorageIdentity | ((selected: StorageIdentity) => StorageIdentity) | undefined = undefined, afterSchema = schema) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-typed-delta-")); folders.push(folder); const selected = identity();
  const make = (name: string, sql: string, id: StorageIdentity, seed: (db: DatabaseSync) => void): TypedDeltaSnapshot => {
    const path = join(folder, name), db = new DatabaseSync(path);
    try { db.exec("PRAGMA journal_mode=DELETE;"); insertStorageIdentity(db, validateStorageIdentity(id)); db.exec(sql); seed(db); } finally { db.close(); }
    chmodSync(path, 0o600); return { path, sha256: hash(readFileSync(path)) };
  };
  return { before: make("before.sqlite", schema, selected, before), after: make("after.sqlite", afterSchema, typeof other === "function" ? other(selected) : other ?? selected, after), selected };
}
async function request(f: ReturnType<typeof fixture>): Promise<TypedDeltaRequest> {
  const inventory = await inspectTypedDeltaSnapshot(f.before);
  const prior = { format: "keryx-native-held-data-baseline-metadata-v1", profileMode: "development-current510-data-only",
    catalogSha256: nativeMaterializationProfile("development-current510-data-only").catalogSha256, targetState: "held", sequence: 3,
    snapshotSha256: inventory.snapshotSha256, schemaSha256: inventory.schemaSha256, identityDigest: inventory.identityDigest, dataDigest: inventory.dataDigest };
  const wire = canonicalJson(prior); return { before: f.before, after: f.after, priorTarget: { wire, expectedSha256: hash(wire) } };
}
async function collect(stream: ReturnType<typeof streamTypedSnapshotDelta>) {
  const batches = [];
  for (;;) { const part = await stream.next(); if (part.done) return { batches, summary: part.value, changes: batches.flatMap(b => b.changes) }; batches.push(part.value); }
}
function alterPrior(r: TypedDeltaRequest, values: Record<string, unknown>) { const wire = canonicalJson({ ...JSON.parse(r.priorTarget.wire), ...values }); return { ...r, priorTarget: { wire, expectedSha256: hash(wire) } }; }
it("merges exact typed PK order and retains raw JSON, NUL/invalid UTF8, integer/REAL and BLOB payload bytes", async () => {
  const f = fixture("CREATE TABLE sample(k PRIMARY KEY,v,x)", db => db.exec(`INSERT INTO sample VALUES
    (-9223372036854775808,1,CAST(x'00c3ff' AS TEXT)),(9223372036854775807,1.0,x'00ff'),
    ('a',NULL,' {"z":1,"z":2} '),(CAST(x'610062' AS TEXT),'old',x''),('?','same',NULL),(x'00','delete',NULL);`),
  db => db.exec(`INSERT INTO sample VALUES
    (-9223372036854775808,1.0,CAST(x'00c3ff' AS TEXT)),(9223372036854775807,1.0,x'00ff'),
    ('a',NULL,'{"z":2}'),(CAST(x'610062' AS TEXT),'new',x''),('?','same',NULL),(x'ff','insert',NULL);`));
  const oldHash = hash(readFileSync(f.before.path)), newHash = hash(readFileSync(f.after.path));
  const result = await collect(streamTypedSnapshotDelta({ ...await request(f), limits: { batchRows: 2 } }));
  expect(result.summary).toMatchObject({ changes: 5, inserts: 1, updates: 3, deletes: 1, batches: 3,
    targetVerified: false, applicationAuthority: false, nativeFactoryQualified: false, targetWrites: 0 });
  expect(result.changes.map(c => c.key)).toEqual([[["integer", "-9223372036854775808"]], [["text", "61"]], [["text", "610062"]], [["blob", "00"]], [["blob", "ff"]]]);
  const first = result.changes[0]; expect(first.before?.[1]).toEqual(["integer", "1"]); expect(first.after?.[1]).toEqual(["real", "3ff0000000000000"]);
  expect(first.after?.[2]).toEqual(["text", "00c3ff"]);
  for (const c of result.changes) { if (c.before) expect(c.beforeSha256).toBe(snapshotRowDigest(c.before)); if (c.after) expect(c.afterSha256).toBe(snapshotRowDigest(c.after)); }
  expect(result.batches.every(b => b.provisional && Object.isFrozen(b) && Object.isFrozen(b.changes))).toBe(true);
  expect(hash(readFileSync(f.before.path))).toBe(oldHash); expect(hash(readFileSync(f.after.path))).toBe(newHash);
  expect(result.summary.deltaBytes).toBe(result.batches.reduce((sum, b) => sum + Buffer.byteLength(JSON.stringify(b)) + 1, 0));
  expect(result.summary.afterDataDigest).toBe((await inspectTypedDeltaSnapshot(f.after)).dataDigest);
});
it("uses declared composite PK column order and UTF8 BINARY bytes without date parsing", async () => {
  const f = fixture("CREATE TABLE sample(a,b,v,PRIMARY KEY(b,a)) WITHOUT ROWID", db => db.exec("INSERT INTO sample VALUES('z',2,'2026-01-01T00:00:00.000Z'),('a',1,'2026-01-01T01:00:00.0000001+01:00');"),
    db => db.exec("INSERT INTO sample VALUES('z',2,'changed'),('a',1,'2026-01-01T00:00:00.000Z');"));
  const result = await collect(streamTypedSnapshotDelta(await request(f)));
  expect(result.changes.map(c => c.key)).toEqual([[["integer", "1"], ["text", "61"]], [["integer", "2"], ["text", "7a"]]]);
  expect(result.changes[0].before?.[2]).not.toEqual(result.changes[0].after?.[2]);
});
it("unchanged snapshots produce no batch and preserve independent input hashes and schema/identity metadata", async () => {
  const f = fixture("CREATE TABLE sample(k INTEGER PRIMARY KEY,v)", db => db.prepare("INSERT INTO sample VALUES(1,?)").run("\0??\ud800"));
  const r = await request(f), result = await collect(streamTypedSnapshotDelta(r));
  expect(result.batches).toEqual([]); expect(result.summary.changes).toBe(0); expect(result.summary.beforeDataDigest).toBe(result.summary.afterDataDigest);
  expect(result.summary).toMatchObject({ beforeSnapshotSha256: f.before.sha256, afterSnapshotSha256: f.after.sha256,
    priorTargetReceiptSha256: r.priorTarget.expectedSha256, priorSequence: 3 });
});
it.each(["INTEGER", "TEXT", "BLOB"])("matches supported %s PK values with SQLite's actual BINARY ordered cursor", async type => {
  const f = fixture(`CREATE TABLE sample(k ${type} PRIMARY KEY,v)`, db => db.exec(type === "INTEGER" ? "INSERT INTO sample VALUES(-2,1),(10,1);" : "INSERT INTO sample VALUES('a',1),('aa',1),(x'00',1),(x'ff',1);"));
  expect((await collect(streamTypedSnapshotDelta(await request(f)))).summary.changes).toBe(0);
});
it.each(["CREATE TABLE sample(k TEXT PRIMARY KEY COLLATE NOCASE,v)", "CREATE TABLE sample(k TEXT PRIMARY KEY COLLATE RTRIM,v)",
  "CREATE TABLE sample(k TEXT PRIMARY KEY DESC,v)", "CREATE TABLE sample(k,v)"])("refuses unsupported declared PK/collation instead of rowid fallback: %s", async sql => {
  const f = fixture(sql, db => db.exec("INSERT INTO sample VALUES('a',1)"));
  await expect(inspectTypedDeltaSnapshot(f.before)).rejects.toMatchObject({ code: "unsupported_primary_key" });
});
it.each(["INSERT INTO sample VALUES(NULL,1),(NULL,2)", "INSERT INTO sample VALUES(1.5,1)"])("refuses duplicate nullable or REAL key cells: %s", async sql => {
  const f = fixture(undefined, db => db.exec(sql)); await expect(inspectTypedDeltaSnapshot(f.before)).rejects.toMatchObject({ code: "unsupported_key_cell" });
});
it("refuses a nonempty unkeyed internal sequence; permits a genuinely empty unkeyed table", async () => {
  const empty = fixture("CREATE TABLE sample(k,v)"); expect((await collect(streamTypedSnapshotDelta(await request(empty)))).summary.changes).toBe(0);
  const seq = fixture("CREATE TABLE sample(k INTEGER PRIMARY KEY AUTOINCREMENT,v)", db => db.exec("INSERT INTO sample(v) VALUES(1)"));
  await expect(inspectTypedDeltaSnapshot(seq.before)).rejects.toMatchObject({ code: "unsupported_primary_key" });
});
it("binds every actual raw schema object and rejects stale snapshot and prior receipt SHA", async () => {
  const f = fixture(undefined, db => db.exec("INSERT INTO sample VALUES(1,1)"), db => db.exec("INSERT INTO sample VALUES(1,2)")); const r = await request(f);
  await expect(collect(streamTypedSnapshotDelta({ ...r, after: { ...r.after, sha256: "b".repeat(64) } }))).rejects.toMatchObject({ code: "snapshot_hash" });
  expect(() => streamTypedSnapshotDelta({ ...r, priorTarget: { ...r.priorTarget, expectedSha256: "b".repeat(64) } })).toThrow("prior_receipt_hash");
  const changed = fixture(undefined, () => {}, () => {}, undefined, "CREATE TABLE sample(k PRIMARY KEY,v);CREATE INDEX extra ON sample(v)");
  await expect(collect(streamTypedSnapshotDelta(await request(changed)))).rejects.toMatchObject({ code: "schema_changed" });
});
it.each(["deploymentId", "storageId", "enrollmentId", "enrolledAt", "provenanceDigest", "profile"])("refuses changed Source identity field %s", async field => {
  const f = fixture(undefined, () => {}, () => {}, selected => {
    const next = { ...selected };
    if (field === "deploymentId" || field === "storageId" || field === "enrollmentId") next[field] = randomUUID();
    if (field === "enrolledAt") next.enrolledAt = "2026-10-02T00:00:00.000Z";
    if (field === "provenanceDigest") next.provenanceDigest = "b".repeat(64);
    if (field === "profile") Object.assign(next, { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST });
    return next;
  });
  await expect(collect(streamTypedSnapshotDelta(await request(f)))).rejects.toMatchObject({ code: "identity_changed" });
});
it.each(["snapshotSha256", "schemaSha256", "identityDigest"])("refuses prior metadata bound to another %s", async field => {
  const f = fixture(), r = await request(f);
  await expect(collect(streamTypedSnapshotDelta(alterPrior(r, { [field]: "b".repeat(64) })))).rejects.toMatchObject({ code: "prior_baseline" });
});
it("never adopts supplied target catalog, extra proof fields, noncanonical receipt or stale DATA digest", async () => {
  const r = await request(fixture());
  expect(() => streamTypedSnapshotDelta(alterPrior(r, { catalogSha256: "b".repeat(64) }))).toThrow("prior_profile");
  expect(() => streamTypedSnapshotDelta(alterPrior(r, { profileMode: "arbitrary" }))).toThrow("prior_profile");
  expect(() => streamTypedSnapshotDelta(alterPrior(r, { targetVerified: true }))).toThrow("prior_receipt");
  const wire = " " + r.priorTarget.wire; expect(() => streamTypedSnapshotDelta({ ...r, priorTarget: { wire, expectedSha256: hash(wire) } })).toThrow("prior_receipt");
  await expect(collect(streamTypedSnapshotDelta(alterPrior(r, { dataDigest: "b".repeat(64) })))).rejects.toMatchObject({ code: "prior_data" });
});
it("refuses whole-collection input/change/byte bounds and never returns truncated completion", async () => {
  const f = fixture(undefined, db => db.exec("INSERT INTO sample VALUES(1,1),(2,1)"), db => db.exec("INSERT INTO sample VALUES(1,2),(2,2)")); const r = await request(f);
  for (const narrowed of [{ inputRows: 1 }, { changes: 1 }, { deltaBytes: 1 }, { batchBytes: 1 }, { keyBytes: 1 }])
    await expect(collect(streamTypedSnapshotDelta({ ...r, limits: narrowed }))).rejects.toThrow("Typed snapshot delta refused");
  for (const key of Object.keys(TYPED_SNAPSHOT_DELTA_LIMITS)) expect(() => streamTypedSnapshotDelta({ ...r, limits: { [key]: TYPED_SNAPSHOT_DELTA_LIMITS[key as keyof typeof TYPED_SNAPSHOT_DELTA_LIMITS] + 1 } })).toThrow("invalid_limits");
});
it("preserves rows near8MiB and refuses an oversized raw row before serializing it", async () => {
  const body = "x".repeat(4 * 1048576 - 1024), f = fixture(undefined, db => db.prepare("INSERT INTO sample VALUES(1,?)").run(body), db => db.prepare("INSERT INTO sample VALUES(1,?)").run(body.slice(1) + "y"));
  const result = await collect(streamTypedSnapshotDelta(await request(f))); expect(result.summary.updates).toBe(1); expect(result.summary.deltaBytes).toBeLessThan(24 * 1048576);
  const big = fixture(undefined, db => db.prepare("INSERT INTO sample VALUES(1,?)").run(body + "x".repeat(2048)));
  await expect(inspectTypedDeltaSnapshot(big.before)).rejects.toMatchObject({ code: "row_bound" });
});
it("keeps batches provisional on late source drift/elapsed refusal and closes early-return readers", async () => {
  const f = fixture(undefined, db => db.exec("INSERT INTO sample VALUES(1,1),(2,1)"), db => db.exec("INSERT INTO sample VALUES(1,2),(2,2)")); const r = await request(f);
  const interrupted = streamTypedSnapshotDelta({ ...r, limits: { batchRows: 1 } }); expect((await interrupted.next()).done).toBe(false); await interrupted.return(undefined as never);
  const owner = new DatabaseSync(f.before.path); try { owner.exec("BEGIN EXCLUSIVE;ROLLBACK"); } finally { owner.close(); }
  const drift = streamTypedSnapshotDelta({ ...r, limits: { batchRows: 1 } }); expect((await drift.next()).done).toBe(false);
  appendFileSync(f.before.path, Buffer.from([0])); await expect(drift.next()).rejects.toMatchObject({ code: "snapshot_changed" });
  const clean = fixture(undefined, () => {}, db => db.exec("INSERT INTO sample VALUES(1,1),(2,1)"));
  const timed = streamTypedSnapshotDelta({ ...await request(clean), limits: { batchRows: 1, elapsedMs: 1000 } });
  expect((await timed.next()).done).toBe(false); await new Promise(resolve => setTimeout(resolve, 1100));
  await expect(timed.next()).rejects.toMatchObject({ code: "elapsed_bound" });
});
it("captures immutable closed inputs before first generator next and refuses getter/proof injections", async () => {
  const f = fixture(), r = await request(f), mutable = structuredClone(r); const stream = streamTypedSnapshotDelta(mutable);
  Object.assign(mutable.after, { sha256: "b".repeat(64) }); expect((await collect(stream)).summary.changes).toBe(0);
  let getter = 0; expect(() => streamTypedSnapshotDelta({ ...r, before: { get path() { getter++; return r.before.path; }, sha256: r.before.sha256 } })).toThrow("invalid_request"); expect(getter).toBe(0);
  expect(() => streamTypedSnapshotDelta({ ...r, targetVerified: true } as never)).toThrow("invalid_request");
});

it("refuses non-UTF8 database ordering and detached WAL inputs without opening an alternate mode", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-typed-delta-")); folders.push(folder); const path = join(folder, "utf16.sqlite"), db = new DatabaseSync(path);
  try { db.exec("PRAGMA encoding='UTF-16le';PRAGMA journal_mode=DELETE"); insertStorageIdentity(db, validateStorageIdentity(identity())); db.exec("CREATE TABLE sample(k TEXT PRIMARY KEY,v)"); } finally { db.close(); }
  chmodSync(path, 0o600);
  await expect(inspectTypedDeltaSnapshot({ path, sha256: hash(readFileSync(path)) })).rejects.toMatchObject({ code: "unsupported_encoding" });
  const f = fixture(); appendFileSync(f.before.path + "-wal", "synthetic sidecar");
  await expect(inspectTypedDeltaSnapshot(f.before)).rejects.toThrow();
});

it("does not relabel an earlier materializer report or silently complete after a late stale data binding", async () => {
  const f = fixture(undefined, db => db.exec("INSERT INTO sample VALUES(1,1),(2,1),(3,1)"), db => db.exec("INSERT INTO sample VALUES(1,2),(2,2),(3,2)"));
  const r = await request(f);
  expect(() => streamTypedSnapshotDelta(alterPrior(r, { format: "keryx-native-public-materialization-v1" }))).toThrow("prior_receipt");
  const stream = streamTypedSnapshotDelta({ ...alterPrior(r, { dataDigest: "b".repeat(64) }), limits: { batchRows: 1 } });
  const batch = await stream.next(); expect(batch.done).toBe(false); if (!batch.done) expect(batch.value.provisional).toBe(true);
  await stream.next(); await expect(stream.next()).rejects.toMatchObject({ code: "prior_data" });
});
