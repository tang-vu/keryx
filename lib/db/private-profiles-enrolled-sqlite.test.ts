import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { KeryxDB } from "./keryx-db";
import { createProfileRoutes } from "../profiles/profile-route";
import { requirePrivateProfiles } from "../profiles/private-profile";
import { createEnrolledSqlitePrivateProfiles } from "./private-profiles-enrolled-sqlite";
import { createSqlitePrivateProfiles, PRIVATE_PROFILE_ACTIVITY_SQL } from "./private-profiles-sqlite";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { migratePrivateProfilesStorage, privateProfilesMigrationProfiles, snapshotPrivateProfilesStorage } from "./private-profiles-storage-migration";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { openVerifiedSqliteStorage, assertVerifiedSqliteConnection } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, creator = `0x${"c".repeat(40)}`;
const network = "eip155:5042", input = { displayName: "<script>plain text</script>", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [] };
const directories: string[] = [], connections: { close(): void }[] = [], workers: Worker[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workers.splice(0).map(worker => worker.terminate()));
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(migrated = true, archive = false, initialProfiles: readonly { wallet: string; handle: string }[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-enrolled-profile-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive });
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(alice, "asker", "0x…", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    const run = db.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)");
    for (let n = 0; n < 1201; n++) run.run(`mine-${n}`, alice.toUpperCase().replace("0X", "0x"), "web", "{}");
    run.run("foreign", bob, "mcp", "{}"); run.run("anonymous", null, "web", "{}");
    db.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run("mine-0", "{}", "[]", '["biology","papers"]', "2026-10-01T00:00:00.000Z");
    // Historical synthetic rows seeded BEFORE enrollment. They are test input,
    // never a real settlement or an ability to insert simulated/mainnet history.
    const payment = db.prepare("INSERT INTO payment_events(id,query_id,payee,kind,network,settled,settlement_status,tx_hash,amount_usdc) VALUES(?,?,?,?,?,?,?,?,?)");
    payment.run("settled", "mine-0", creator, "citation", network, 1, "settled", "recorded-circle-id", 0.005);
    payment.run("same-creator", "mine-1", creator.toUpperCase(), "fetch", network, 1, "settled", "recorded-transfer-id", 0.003);
    for (const [id, state, settled, tx, kind, selected, runId, amount] of [
      ["prepared", "prepared", 0, "prepared-reference", "fetch", network, "mine-0", 0.02],
      ["pending", "pending", 0, null, "citation", network, "mine-0", 0.02],
      ["simulated", "simulated", 1, "simulation", "citation", network, "mine-0", 0.02],
      ["flag-missing", "settled", 0, "proof", "citation", network, "mine-0", 0.02],
      ["no-reference", "settled", 1, "  ", "citation", network, "mine-0", 0.02],
      ["fee", "settled", 1, "proof", "operating-fee", network, "mine-0", 0.02],
      ["other-network", "settled", 1, "proof", "citation", "eip155:5042002", "mine-0", 0.02],
      ["other-owner", "settled", 1, "proof", "citation", network, "foreign", 0.02],
      ["anonymous", "settled", 1, "proof", "citation", network, "anonymous", 0.02],
      ["nonpositive", "settled", 1, "proof", "citation", network, "mine-0", 0],
    ] as const) payment.run(id, runId, bob, kind, selected, settled, state, tx, amount);
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  if (migrated) migratePrivateProfilesStorage(file, identity, () => {});
  // Fixed synthetic profile input is installed before a genuine application connection opens.
  // Existing cases retain the empty default; no production or ordinary port is bypassed.
  if (initialProfiles.length) {
    const seed = new DatabaseSync(file);
    try {
      registerStorageCapability(seed, identity, () => true);
      seed.exec("BEGIN IMMEDIATE");
      const insert = seed.prepare("INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      for (const row of initialProfiles) insert.run(row.wallet, row.handle, input.displayName, input.bio, input.purpose, JSON.stringify(input.links),
        "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
      seed.exec("COMMIT");
    } finally { seed.close(); }
  }
  const pinned = canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest }));
  const open = (readOnly = false) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly, applicationProfiles: supportedSqliteApplicationProfiles(true),
      runtimeGuard() { if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest })) !== pinned) throw new Error("Manifest drift"); } });
    connections.push(connection); return connection;
  };
  return { file, directory, manifest, identity, open };
}
function originals(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(f.file, { readOnly: true });
  try { const snapshot = snapshotPrivateProfilesStorage(db, f.identity, privateProfilesMigrationProfiles().flat());
    const tables = { ...snapshot.tables }; delete tables.private_profiles; return canonicalJson(tables);
  } finally { db.close(); }
}

describe("verified same-store private profiles", () => {
  it.each(["update", "delete"] as const)("genuine native write contention refuses %s without retiring shared readers", async operation => {
    const f = fixture(true, false, [{ wallet: alice, handle: input.handle }]), connection = f.open();
    const port = createEnrolledSqlitePrivateProfiles(connection.db)!, before = originals(f), blocker = new DatabaseSync(f.file);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      if (operation === "update") await expect(port.update(alice, { ...input, bio: "Blocked" })).rejects.toThrow("profile_unavailable");
      else await expect(port.delete(alice)).rejects.toThrow("profile_unavailable");
      blocker.exec("ROLLBACK");
    } finally { blocker.close(); }
    expect(assertVerifiedSqliteConnection(connection.db)).toEqual(f.identity);
    expect((await port.get(alice, network)).profile?.bio).toBe(input.bio);
    expect(originals(f)).toBe(before);
  });

  it("genuine native read-guard contention refuses without retiring the shared connection", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    const before = originals(f), blocker = new DatabaseSync(f.file);
    try {
      blocker.exec("BEGIN EXCLUSIVE");
      await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
      blocker.exec("ROLLBACK");
    } finally { blocker.close(); }
    expect(assertVerifiedSqliteConnection(connection.db)).toEqual(f.identity);
    expect((await port.get(alice, network)).profile).toBeNull();
    expect(originals(f)).toBe(before);
  });

  it.each([false, true])("migrated native CRUD/activity and absent-owner isolation retain originals (archive=%s)", async archive => {
    const f = fixture(true, archive), connection = f.open(), before = originals(f);
    const port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    expect(Object.isFrozen(port)).toBe(true);
    expect((await port.get(alice, network)).profile).toBeNull();
    const created = await port.update(alice.toUpperCase().replace("0X", "0x"), input);
    expect(created.wallet).toBe(alice); expect(created.displayName).toBe(input.displayName);
    const edited = await port.update(alice, { ...input, bio: "Updated" }); expect(edited.createdAt).toBe(created.createdAt);
    const mine = await port.get(alice, network);
    expect(mine.activity).toEqual({ firstSeenAt: "2026-10-01T00:00:00.000Z", questions: 1201, surfacesUsed: ["web"],
      topics: ["biology", "papers"], creatorsPaid: 1, scope: "attributed-current-store", network });
    expect((await port.get(bob, network)).profile).toBeNull();
    expect(originals(f)).toBe(before);
    await expect(port.get(alice, "eip155:5042002")).rejects.toThrow("profile_unavailable");
  });

  it.each([false, true])("native deletion is idempotent and retains other owners and originals (archive=%s)", async archive => {
    const f = fixture(true, archive, [{ wallet: alice, handle: input.handle }, { wallet: bob, handle: "bob_reader" }]);
    const before = originals(f), port = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    await port.delete(alice); await port.delete(alice);
    expect((await port.get(alice, network)).profile).toBeNull(); expect((await port.get(bob, network)).profile?.handle).toBe("bob_reader");
    expect(originals(f)).toBe(before);
  });

  it("actual readonly update/delete refuse before all native SQL, including an absent owner", async () => {
    const f = fixture(), writer = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    await writer.update(alice, input);
    const readonly = f.open(true), port = createEnrolledSqlitePrivateProfiles(readonly.db)!;
    const before = readFileSync(f.file), prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      await expect(port.update(alice, input)).rejects.toThrow("profile_unavailable");
      await expect(port.delete(bob)).rejects.toThrow("profile_unavailable");
      expect(() => assertVerifiedSqliteConnection(readonly.db, "write")).toThrow();
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    expect((await port.get(alice, network)).profile?.handle).toBe(input.handle); expect(readFileSync(f.file)).toEqual(before);
  });

  it("missing domain stays absent without DDL; ordinary/raw/fake connections cannot issue the enrolled port", () => {
    const f = fixture(false), connection = f.open(), before = readFileSync(f.file);
    expect(createEnrolledSqlitePrivateProfiles(connection.db)).toBeUndefined();
    expect(() => requirePrivateProfiles({})).toThrow("profile_unavailable");
    const raw = new DatabaseSync(f.file);
    try {
      expect(() => createEnrolledSqlitePrivateProfiles(raw)).toThrow();
      expect(() => createSqlitePrivateProfiles(raw)).toThrow("unavailable in enrolled storage");
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='private_profiles'").get()).toBeUndefined();
    } finally { raw.close(); }
    expect(() => createEnrolledSqlitePrivateProfiles({} as DatabaseSync)).toThrow();
    expect(() => Reflect.apply(createEnrolledSqlitePrivateProfiles, null, [connection.db, () => {}])).toThrow();
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("two native ports preserve a collision loser's existing fields and release the deleted handle", async () => {
    const f = fixture(), a = createEnrolledSqlitePrivateProfiles(f.open().db)!, b = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    await b.update(bob, { ...input, handle: "previous" });
    const results = await Promise.allSettled([a.update(alice, { ...input, handle: "Shared" }), b.update(bob, { ...input, handle: "SHARED" })]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.code).toBe("handle_conflict");
    expect((await b.get(bob, network)).profile?.handle).toBe("previous");
    await a.delete(alice); expect((await b.update(bob, { ...input, handle: "SHARED" })).handle).toBe("shared");
  });

  it("separate native worker connections contend for the same unique handle atomically", async () => {
    const f = fixture(), before = originals(f);
    const contenders = [alice, bob].map(wallet => {
      const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
        const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(workerData.file,{allowExtension:false});
        db.exec('PRAGMA busy_timeout=5000');
        db.function('keryx_storage_capability',(digest,mode)=>digest===workerData.digest&&mode==='mainnet-real'?1:0);
        parentPort.once('message',()=>{let result;
          try { db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(workerData.wallet,'contended','Reader','','','[]',workerData.now,workerData.now); db.exec('COMMIT'); result='won'; }
          catch(error) {try {db.exec('ROLLBACK')}catch{} result=String(error.message);}
          finally {db.close();} parentPort.postMessage(result);parentPort.close();}); parentPort.postMessage('ready');`,
      { eval: true, workerData: { file: f.file, wallet, digest: storageIdentityDigest(f.identity), now: new Date().toISOString() } });
      workers.push(worker); return worker;
    });
    await Promise.all(contenders.map(worker => new Promise<void>((resolve, reject) => { worker.once("message", message => message === "ready" ? resolve() : reject(new Error(String(message)))); worker.once("error", reject); })));
    const finished = contenders.map(worker => new Promise<string>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
    contenders.forEach(worker => worker.postMessage("go"));
    const results = await Promise.all(finished);
    expect(results.filter(result => result === "won")).toHaveLength(1);
    expect(results.find(result => result !== "won")).toContain("UNIQUE constraint failed: private_profiles.handle");
    expect(originals(f)).toBe(before);
  });

  it.each([
    "CREATE INDEX unreviewed_profile_index ON private_profiles(bio)",
    "CREATE TRIGGER unreviewed_profile_delete AFTER DELETE ON private_profiles BEGIN UPDATE query_runs SET question='rewritten'; END",
    "DROP TRIGGER storage_identity_no_update",
    `DROP TRIGGER storage_fence_${createHash("sha256").update("private_profiles").digest("hex").slice(0, 16)}_update`,
    "DROP TABLE private_profiles",
  ])("old port refuses full schema/fence drift without repair: %s", async sql => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    await port.update(alice, input);
    const raw = new DatabaseSync(f.file); try { raw.exec(sql); } finally { raw.close(); }
    const before = readFileSync(f.file);
    await expect(port.delete(alice)).rejects.toThrow("profile_unavailable");
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
    if (sql === "DROP TABLE private_profiles") {
      const fresh = f.open();
      expect(createEnrolledSqlitePrivateProfiles(fresh.db)).toBeUndefined();
      const absent = {} as KeryxDB;
      const routes = createProfileRoutes({ session: async () => ({ db: absent, wallet: alice }),
        db: async () => absent, key: async () => null, network });
      const response = await routes.GET(new Request("https://keryx.example/api/me/profile"));
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: "profile_unavailable" });
      expect(readFileSync(f.file)).toEqual(before);
    } else expect(() => f.open()).toThrow();
  });

  it.each(["update", "delete"] as const)("write-first %s manifest drift permanently revokes its port after restoration", async operation => {
      const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
      await port.update(alice, input);
      const manifest = readFileSync(f.manifest), before = readFileSync(f.file);
      writeFileSync(f.manifest, "{}");
      // No preceding GET: the mutation itself must detect drift and revoke the connection.
      if (operation === "update") await expect(port.update(alice, input)).rejects.toThrow("profile_unavailable");
      else await expect(port.delete(alice)).rejects.toThrow("profile_unavailable");
      writeFileSync(f.manifest, manifest);
      await expect(port.update(alice, input)).rejects.toThrow("profile_unavailable");
      await expect(port.delete(alice)).rejects.toThrow("profile_unavailable");
      await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
      expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
      // A fresh connection accepts the restored guard and the original row is intact.
      const fresh = createEnrolledSqlitePrivateProfiles(f.open().db)!;
      expect((await fresh.get(alice, network)).profile?.handle).toBe(input.handle);
      expect(readFileSync(f.file)).toEqual(before);
  });

  it("manifest drift and explicit close revoke held ports", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    await port.update(alice, input); const before = readFileSync(f.file);
    writeFileSync(f.manifest, "{}");
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
    await expect(port.update(alice, { ...input, bio: "Changed" })).rejects.toThrow("profile_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
    const g = fixture(), closed = g.open(), oldPort = createEnrolledSqlitePrivateProfiles(closed.db)!; closed.close();
    await expect(oldPort.get(alice, network)).rejects.toThrow("profile_unavailable");
    await expect(oldPort.delete(alice)).rejects.toThrow("profile_unavailable");
  });

  it("a substituted identity marker refuses even when its exact immutability trigger is restored", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    const raw = new DatabaseSync(f.file);
    try {
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name='storage_identity_no_update'").get()!.sql);
      raw.exec("DROP TRIGGER storage_identity_no_update");
      raw.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1")
        .run(JSON.stringify({ ...f.identity, storageId: "00000000-0000-4000-8000-000000000001" }));
      raw.exec(trigger);
    } finally { raw.close(); }
    const before = readFileSync(f.file);
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
    await expect(port.update(alice, input)).rejects.toThrow("profile_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("held-file replacement is refused or prevented by the OS, and no substitute profile is accepted", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    if (process.platform === "win32") {
      expect(() => renameSync(f.file, f.file + ".old")).toThrow();
      expect((await port.get(alice, network)).profile).toBeNull();
    } else {
      renameSync(f.file, f.file + ".old"); copyFileSync(f.file + ".old", f.file);
      await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
    }
  });

  it("manifest failure after native row mutation rolls back before acknowledgement", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    const original = StatementSync.prototype.run;
    const spy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (this: StatementSync, ...args) {
      const value = Reflect.apply(original, this, args); writeFileSync(f.manifest, "{}"); return value;
    });
    try { await expect(port.update(alice, input)).rejects.toThrow("profile_unavailable"); }
    finally { spy.mockRestore(); }
    const raw = new DatabaseSync(f.file, { readOnly: true });
    try { expect(raw.prepare("SELECT count(*) AS n FROM private_profiles").get()!.n).toBe(0); } finally { raw.close(); }
  });

  it.each([
    "UPDATE users SET first_seen_at='malformed'",
    "UPDATE query_runs SET origin='bad surface' WHERE id='mine-0'",
    "UPDATE query_memories SET topics='not-json'",
    "UPDATE query_memories SET topics='[123]'",
    "UPDATE query_memories SET topics='[\"bad\\ncontrol\"]'",
    "UPDATE query_memories SET topics='[\"'||printf('%.*c',65537,'x')||'\"]'",
  ])("malformed or oversized activity refuses instead of returning invented values: %s", async sql => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    connection.db.exec(sql);
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
  });

  it("an actual activity SQL failure returns unavailable and preserves the stored profile", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    await port.update(alice, input);
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === PRIVATE_PROFILE_ACTIVITY_SQL.creators) throw new Error("Native projection failure");
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable"); }
    finally { spy.mockRestore(); }
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    const fresh = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    expect((await fresh.get(alice, network)).profile?.handle).toBe(input.handle);
  });

  it("17 distinct attributed surfaces refuse rather than truncate to an accepted 16", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateProfiles(connection.db)!;
    connection.db.exec("BEGIN IMMEDIATE");
    for (let n = 0; n < 17; n++) connection.db.prepare("UPDATE query_runs SET origin=? WHERE id=?").run(`surface-${n}`, `mine-${n}`);
    connection.db.exec("COMMIT");
    await expect(port.get(alice, network)).rejects.toThrow("profile_unavailable");
  });

  it("native application scope still denies schema/attach/extension changes and unfenced raw profile DML", async () => {
    const f = fixture(), connection = f.open();
    await createEnrolledSqlitePrivateProfiles(connection.db)!.update(alice, input);
    for (const sql of ["CREATE TABLE bypass(x)", "DROP TABLE private_profiles", "ATTACH DATABASE ':memory:' AS bypass", "SELECT load_extension('bypass')"])
      expect(() => connection.db.exec(sql)).toThrow();
    const raw = new DatabaseSync(f.file);
    try {
      for (const sql of ["INSERT INTO private_profiles VALUES('invalid',NULL,'','','','[]','','')", "UPDATE private_profiles SET bio='x'", "DELETE FROM private_profiles"])
        expect(() => raw.exec(sql)).toThrow();
    } finally { raw.close(); }
  });

  it("owner API cookie CRUD preserves cache, owner preconditions and genuine deletion", async () => {
    const f = fixture(), port = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    const db = { privateProfiles: port } as KeryxDB;
    const routes = createProfileRoutes({ session: async () => ({ db, wallet: alice }), db: async () => db, network, key: async () => null });
    const request = (method: string, wallet = alice) => new Request("https://keryx.example/api/me/profile", { method,
      headers: { "content-type": "application/json", origin: "https://keryx.example", "x-keryx-expected-wallet": wallet },
      ...(method === "PUT" ? { body: JSON.stringify(input) } : {}) });
    expect((await routes.GET(request("GET"))).status).toBe(200);
    expect((await routes.PUT(request("PUT"))).status).toBe(200);
    expect((await routes.GET(request("GET"))).headers.get("cache-control")).toContain("no-store");
    expect((await routes.PUT(request("PUT", bob))).status).toBe(409);
    expect((await routes.DELETE(request("DELETE"))).status).toBe(200);
    expect((await port.get(alice, network)).profile).toBeNull();
  });

  it("scoped keys preserve real owner binding, read/write scopes and revoked-key refusal", async () => {
    const f = fixture(true, false, [{ wallet: alice, handle: input.handle }]), port = createEnrolledSqlitePrivateProfiles(f.open().db)!;
    const db = { privateProfiles: port } as KeryxDB, session = vi.fn(async () => ({ db, wallet: alice }));
    const rawKey = `kx_live_${"d".repeat(96)}`;
    let scopes = "profile:write", revoked = false;
    const routes = createProfileRoutes({ session, db: async () => db, network,
      key: async raw => raw === rawKey && !revoked ? { walletAddress: bob, scopes } : null });
    const request = (method: string, key = false, wallet = alice) => new Request("https://keryx.example/api/me/profile", { method,
      headers: { "content-type": "application/json", origin: "https://keryx.example", "x-keryx-expected-wallet": wallet,
        ...(key ? { authorization: `Bearer ${rawKey}` } : {}) }, ...(method === "PUT" ? { body: JSON.stringify({ ...input, handle: key ? "key_reader" : input.handle }) } : {}) });
    const write = await routes.PUT(request("PUT", true, bob)); expect(write.status).toBe(200);
    expect(await write.json()).toEqual({ profile: expect.objectContaining({ wallet: bob, handle: "key_reader" }) });
    expect((await routes.GET(request("GET", true, bob))).status).toBe(403);
    scopes = "profile:read"; const read = await routes.GET(request("GET", true, bob)); expect(read.status).toBe(200);
    expect((await read.json()).profile.wallet).toBe(bob);
    expect((await routes.PUT(request("PUT", true, bob))).status).toBe(403);
    session.mockClear(); revoked = true;
    expect((await routes.GET(request("GET", true, bob))).status).toBe(401); expect(session).not.toHaveBeenCalled();
    expect((await routes.DELETE(request("DELETE"))).status).toBe(200);
    expect((await port.get(alice, network)).profile).toBeNull(); expect((await port.get(bob, network)).profile).not.toBeNull();
  });
});
