import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { PAPER_CATALOG } from "../papers/catalog";
import { paperReferencesBibtex } from "../papers/reference-export";
import { requirePrivateBibliographies } from "../bibliographies/private-bibliography";
import { createBibliographyDownload, createBibliographyManagement } from "../bibliographies/bibliography-routes";
import type { KeryxDB } from "./keryx-db";
import { createEnrolledSqlitePrivateBibliographies } from "./private-bibliographies-enrolled-sqlite";
import { createSqlitePrivateBibliographies, PRIVATE_BIBLIOGRAPHIES_SQL } from "./private-bibliographies-sqlite";
import { PRIVATE_BIBLIOGRAPHIES_STORAGE_DOMAIN as domain } from "./private-bibliographies-storage-domain";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { assertVerifiedSqliteConnection, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";

// Actual ROOT-reviewed four-profile full19 family; no schema-profile mock.
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const network = "eip155:5042", now = "2026-10-01T00:00:00.000Z";
const input = { title: "Private owner title", papers: [PAPER_CATALOG[0]] };
const directories: string[] = [], connections: { close(): void }[] = [], workers: Worker[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(workers.splice(0).map(worker => worker.terminate()));
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-native-bibliography-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(present = true, archive = false) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-bibliography-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const raw = new DatabaseSync(file);
  try {
    raw.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw, { publicReferenceArchive: archive });
    // Explicit historical synthetic fixture bytes, BEFORE enrollment. Never live
    // provider activity, fabricated real settlement or application writer authority.
    raw.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(alice, "asker", "Reader", now, now);
    raw.prepare("INSERT INTO query_runs(id,asker,question,answer,data,economics_data,budget,total_spent,origin) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("original", alice, "Original question Ω", "Original answer\0retained", '{"original":"exact"}', '{"liability":0.017}', 0.125, 0.017, "web");
    raw.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run("original", '{"source":{"reward":0.017}}', '["source"]', '["papers"]', now);
    raw.prepare("INSERT INTO payment_events(id,query_id,payer,payee,amount_usdc,kind,network,settled,settlement_status,tx_hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("original-payment", "original", alice, bob, 0.017, "citation", network, 1, "settled", "synthetic-original-reference");
    raw.prepare("INSERT INTO withdrawals(tx_hash,wallet,recipient,amount_usdc,network) VALUES(?,?,?,?,?)")
      .run("synthetic-withdrawal-reference", alice, bob, 0.007, network);
    raw.prepare("INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch) VALUES(?,?,?,?,?,?,?,?)")
      .run(alice, bob, alice, 0.25, 0.017, 1_800_000_000_000, "fixture-funding", "fixture-epoch");
    raw.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run("c".repeat(64), alice, 1, 10);
    raw.prepare("INSERT INTO api_keys(id,prefix,key_hash,wallet,created_at,scopes) VALUES(?,?,?,?,?,?)")
      .run("original-key", "kx_fixture", "d".repeat(64), alice, now, "profile:read");
    raw.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
      service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at,request_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("original-order", "original", "original-authorization", "e".repeat(64), alice, bob, 0.02, 0.017, 0.003, "standard", "completed", "synthetic-a2a-reference", now, now, canonicalJson({ network }));
    // Retained historical originals precede explicit bundle installation; no privacy backfill.
    if (present) installNativeUserDomainSchema(raw);
    insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const pinned = canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest }));
  const open = (readOnly = false, enforceProfile = true) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      ...(enforceProfile ? { applicationProfiles: supportedSqliteApplicationProfiles(true) } : {}),
      runtimeGuard() {
        if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest })) !== pinned) throw new Error("Manifest drift");
      } });
    connections.push(connection); return connection;
  };
  return { file, manifest, identity, open };
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function originals(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(f.file, { readOnly: true });
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name!='private_bibliographies' ORDER BY type,name").all();
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='private_bibliographies' ORDER BY name").all();
    const rows: Record<string, unknown> = {};
    for (const { name } of tables) {
      const table = String(name), columns = db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all().filter(column => column.hidden === 0);
      // Preserve SQL types, NULL versus empty, exact text/blob bytes and integer
      // values; SQLite's 26-digit alternate real formatting preserves the double.
      const expressions = columns.flatMap((column, index) => {
        const value = quote(String(column.name));
        return [`typeof(${value}) AS ${quote(`type${index}`)}`,
          `CASE WHEN typeof(${value})='real' THEN printf('%!.26g',${value}) ELSE hex(CAST(${value} AS BLOB)) END AS ${quote(`bytes${index}`)}`];
      });
      rows[table] = db.prepare(`SELECT ${expressions.join(",")} FROM ${quote(table)}`).all().map(canonicalJson).sort();
    }
    return canonicalJson({ schema, rows });
  } finally { db.close(); }
}
function mutate(f: ReturnType<typeof fixture>, action: (db: DatabaseSync) => void) {
  const raw = new DatabaseSync(f.file); try { action(raw); } finally { raw.close(); }
}

describe("same-selected-store verified native private bibliographies", () => {
  it.each([false, true])("real CRUD, hash-only tokens, owner isolation and original-byte preservation (archive=%s)", async archive => {
    const f = fixture(true, archive), before = originals(f), connection = f.open();
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    const port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    // Constructor only validates; it never installs or repairs the target.
    expect(exec.mock.calls.every(([sql]) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))).toBe(true); exec.mockRestore();
    expect(Object.isFrozen(port)).toBe(true);
    const created = await port.create(alice.toUpperCase().replace("0X", "0x"), input);
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect((await port.read(created.token))?.content).not.toContain(input.title);
    expect(await port.list(bob)).toEqual([]); expect(await port.list(alice)).toEqual([created.bibliography]);
    expect(JSON.stringify(await port.list(alice))).not.toMatch(/token|content|wallet/);
    const persisted = connection.db.prepare("SELECT * FROM private_bibliographies").get()!;
    expect(persisted.token_hash).toBe(createHash("sha256").update(`keryx-private-bib-v1:${created.token}`).digest("hex"));
    expect(JSON.stringify(persisted)).not.toContain(created.token);
    await expect(port.replace(bob, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_not_found");
    await expect(port.revoke(bob, created.bibliography.id, 1)).rejects.toThrow("bibliography_not_found");
    const updated = await port.replace(alice, created.bibliography.id, { title: "Renamed", papers: [] }, 1);
    expect(updated).toMatchObject({ id: created.bibliography.id, createdAt: created.bibliography.createdAt, revision: 2, count: 0 });
    expect(await port.read(created.token)).toEqual({ content: "" });
    await expect(port.replace(alice, updated.id, input, 1)).rejects.toThrow("bibliography_conflict");
    await expect(port.revoke(alice, updated.id, 1)).rejects.toThrow("bibliography_conflict");
    await port.revoke(alice, updated.id, 2); expect(await port.read(created.token)).toBeNull();
    expect((await port.create(alice, input)).token).not.toBe(created.token);
    expect(await port.read("0".repeat(64))).toBeNull(); expect(originals(f)).toBe(before);
  });

  it("actual readonly mutations refuse before SQL while healthy list and bearer reads remain usable", async () => {
    const f = fixture(), created = await createEnrolledSqlitePrivateBibliographies(f.open().db)!.create(alice, input);
    const reader = f.open(true), port = createEnrolledSqlitePrivateBibliographies(reader.db)!, before = readFileSync(f.file);
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
      await expect(port.replace(alice, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_unavailable");
      await expect(port.revoke(bob, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable");
      await expect(port.replace("invalid", "invalid", {} as never, NaN)).rejects.toThrow("bibliography_unavailable");
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    expect(await port.list(alice)).toEqual([created.bibliography]);
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("present bibliography requires the complete policy captured at genuine opening", () => {
    const f = fixture(), connection = f.open(false, false), before = originals(f);
    expect(() => createEnrolledSqlitePrivateBibliographies(connection.db)).toThrow("bibliography_unavailable");
    expect(originals(f)).toBe(before);
  });

  it("an actual EXCLUSIVE reader lock refuses temporarily without retiring the healthy port", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f), blocker = new DatabaseSync(f.file);
    connections.push(blocker); blocker.exec("BEGIN EXCLUSIVE");
    const originalPrepare = DatabaseSync.prototype.prepare, originalGet = StatementSync.prototype.get;
    let nativeFailure: unknown;
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
      try { return Reflect.apply(originalPrepare, this, [sql]); } catch (error) { nativeFailure = error; throw error; }
    });
    const get = vi.spyOn(StatementSync.prototype, "get").mockImplementation(function (this: StatementSync, ...args) {
      try { return Reflect.apply(originalGet, this, args); } catch (error) { nativeFailure = error; throw error; }
    });
    try {
      await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
      expect(nativeFailure).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 });
    } finally { prepare.mockRestore(); get.mockRestore(); blocker.exec("ROLLBACK"); }
    expect(await port.list(alice)).toEqual([created.bibliography]);
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect(() => assertVerifiedSqliteConnection(connection.db)).not.toThrow();
    expect(originals(f)).toBe(before);
  });

  it("the actual frozen writable and readonly facades attach the native bibliography port", async () => {
    const f = fixture(), before = originals(f);
    vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifest); vi.stubEnv("KERYX_SQLITE_PATH", f.file);
    vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
    const writer = await createEnrolledSqliteAdapter(); connections.push(writer);
    const reader = await createReadonlyEnrolledSqliteAdapter(); connections.push(reader);
    for (const db of [writer, reader]) {
      expect(Object.isFrozen(db)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(db, "privateBibliographies")?.enumerable).toBe(false);
      expect(db.privateBibliographies).toBeDefined();
    }
    const created = await writer.privateBibliographies!.create(alice, input);
    expect(await reader.privateBibliographies!.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    await expect(reader.privateBibliographies!.create(alice, input)).rejects.toThrow("bibliography_unavailable");
    expect(await reader.privateBibliographies!.list(alice)).toEqual([created.bibliography]);
    expect(originals(f)).toBe(before);
  });

  it("absent domain stays absent without target DDL; raw, ordinary, fake and callback connections refuse pre-SQL", () => {
    const f = fixture(false), connection = f.open(), before = readFileSync(f.file);
    expect(createEnrolledSqlitePrivateBibliographies(connection.db)).toBeUndefined();
    expect(() => requirePrivateBibliographies({} as KeryxDB)).toThrow("bibliography_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
    const raw = new DatabaseSync(f.file), ordinary = new DatabaseSync(":memory:");
    try {
      createSqlitePrivateBibliographies(ordinary);
      expect(() => createSqlitePrivateBibliographies(raw)).toThrow("unavailable in enrolled storage");
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
      try {
        for (const db of [raw, ordinary, {} as DatabaseSync]) expect(() => createEnrolledSqlitePrivateBibliographies(db)).toThrow("bibliography_unavailable");
        expect(() => Reflect.apply(createEnrolledSqlitePrivateBibliographies, null, [connection.db, () => {}])).toThrow("bibliography_unavailable");
        expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
      } finally { prepare.mockRestore(); exec.mockRestore(); }
    } finally { raw.close(); ordinary.close(); }
  });

  it("malformed token, id, revision, private fields, duplicate links and oversized content preserve the snapshot", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = readFileSync(f.file);
    for (const token of ["", "A".repeat(64), "0".repeat(63), "0".repeat(65), created.token + ".bib"]) await expect(port.read(token)).rejects.toThrow();
    for (const revision of [0, -1, 1.1, NaN, 2_147_483_648, "1" as never]) {
      await expect(port.replace(alice, created.bibliography.id, input, revision)).rejects.toThrow();
      await expect(port.revoke(alice, created.bibliography.id, revision)).rejects.toThrow();
    }
    await expect(port.replace(alice, "not-an-id", input, 1)).rejects.toThrow();
    await expect(port.create("not-an-owner", input)).rejects.toThrow();
    for (const invalid of [{ ...input, notes: "private" }, { ...input, title: "private\ncontrol" },
      { ...input, papers: [{ ...input.papers[0], screening: "private" }] }, { ...input, papers: [...input.papers, ...input.papers] }])
      await expect(port.replace(alice, created.bibliography.id, invalid as never, 1)).rejects.toThrow();
    const oversized = Array.from({ length: 50 }, (_, index) => ({ ...PAPER_CATALOG[0], arxivId: `1706.03762v${index + 1}`,
      url: `https://arxiv.org/abs/1706.03762v${index + 1}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=1706.03762v${index + 1}`,
      authors: Array.from({ length: 50 }, () => "A".repeat(300)), authorCount: 50, authorsTruncated: false }));
    await expect(port.replace(alice, created.bibliography.id, { ...input, papers: oversized }, 1)).rejects.toThrow("bibliography_limit");
    expect(await port.list(alice)).toEqual([created.bibliography]); expect(readFileSync(f.file)).toEqual(before);
  });

  it("two genuine native connections admit one same-revision CAS/revoke and never overshoot an owner's cap", async () => {
    const f = fixture(), before = originals(f), a = createEnrolledSqlitePrivateBibliographies(f.open().db)!, b = createEnrolledSqlitePrivateBibliographies(f.open().db)!;
    const created = await a.create(alice, input), id = created.bibliography.id;
    const replacement = await Promise.allSettled([a.replace(alice, id, { ...input, papers: [] }, 1), b.replace(alice, id, input, 1)]);
    expect(replacement.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((replacement[1] as PromiseRejectedResult).reason.code).toBe("bibliography_conflict");
    const revocations = await Promise.allSettled([a.revoke(alice, id, 2), b.revoke(alice, id, 2)]);
    expect(revocations.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((revocations[1] as PromiseRejectedResult).reason.code).toBe("bibliography_not_found");
    expect(await a.read(created.token)).toBeNull();
    const contended = await a.create(alice, input);
    const mixed = await Promise.allSettled([a.replace(alice, contended.bibliography.id, input, 1), b.revoke(alice, contended.bibliography.id, 1)]);
    expect(mixed.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((mixed[1] as PromiseRejectedResult).reason.code).toBe("bibliography_conflict");
    const creates = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).create(alice, { ...input, papers: [] })));
    expect(creates.filter(result => result.status === "fulfilled")).toHaveLength(19);
    expect(await a.list(alice)).toHaveLength(20); await expect(b.create(bob, input)).resolves.toBeDefined();
    expect(originals(f)).toBe(before);
  });

  it.each(["replace", "revoke"] as const)("separate verified native workers contend for the actual SQLite %s lock and CAS", async operation => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f), barrier = new SharedArrayBuffer(4);
    const source = `const {parentPort,workerData}=require('node:worker_threads');
      const {fileURLToPath}=require('node:url');
      const {require:tsxRequire}=require(fileURLToPath(workerData.loader));
      const {openVerifiedSqliteStorage}=tsxRequire(fileURLToPath(workerData.connectionModule),workerData.connectionModule);
      const {inspectStorageDeploymentManifest}=tsxRequire(fileURLToPath(workerData.manifestModule),workerData.manifestModule);
      const {canonicalJson}=tsxRequire(fileURLToPath(workerData.canonicalModule),workerData.canonicalModule);
      let connection;
      try {
        connection=openVerifiedSqliteStorage(workerData.file,workerData.identity,{applicationProfiles:workerData.profiles,
          runtimeGuard(){if(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:workerData.manifest}))!==workerData.pinned)throw Error('Manifest drift');}});
        const db=connection.db,gate=new Int32Array(workerData.barrier);parentPort.postMessage({ready:true});
        Atomics.wait(gate,0,0,10000);if(Atomics.load(gate,0)!==1)throw Error('Fixture start barrier timed out');
        db.exec('BEGIN IMMEDIATE');
        try {
          // Exact owner/revision CAS on the real restricted verified wrapper.
          // This tests native lock contention; the parent cases exercise the port.
          const result=workerData.operation==='replace'
            ?db.prepare('UPDATE private_bibliographies SET title=?,content=?,reference_count=?,revision=revision+1,updated_at=? WHERE id=? AND wallet=? AND revision=?')
              .run('Contended','',0,workerData.now,workerData.id,workerData.wallet,1)
            :db.prepare('DELETE FROM private_bibliographies WHERE wallet=? AND id=? AND revision=?').run(workerData.wallet,workerData.id,1);
          db.exec('COMMIT');parentPort.postMessage({won:result.changes===1});
        }catch(error){try{db.exec('ROLLBACK')}catch{}throw error;}
      }catch(error){parentPort.postMessage({fatal:String(error)});process.exitCode=1;}
      finally{connection?.close();parentPort.close();}`;
    const contenders = [0, 1].map(() => {
      let ready!: () => void;
      const readiness = new Promise<void>(resolveReady => { ready = resolveReady; });
      const worker = new Worker(source, { eval: true, execArgv: [], workerData: {
        loader: import.meta.resolve("tsx/cjs/api"), connectionModule: new URL("./storage-identity-connection.ts", import.meta.url).href,
        manifestModule: new URL("./runtime-storage-config.ts", import.meta.url).href, canonicalModule: new URL("../canonical-json.ts", import.meta.url).href,
        file: f.file, manifest: f.manifest, identity: f.identity, profiles: supportedSqliteApplicationProfiles(true),
        pinned: canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: f.manifest })),
        barrier, operation, now, id: created.bibliography.id, wallet: alice,
      } }); workers.push(worker);
      const outcome = new Promise<boolean>((resolveOutcome, reject) => {
        let won: boolean | undefined;
        worker.on("message", message => {
          if (message.ready) ready();
          else if (message.fatal) { ready(); reject(new Error(message.fatal)); }
          else won = message.won;
        });
        worker.on("error", error => { ready(); reject(error); });
        worker.on("exit", code => {
          ready();
          if (code === 0 && won !== undefined) resolveOutcome(won);
          else reject(new Error("Native fixture worker did not close successfully"));
        });
      });
      return { readiness, outcome };
    });
    const finished = Promise.all(contenders.map(contender => contender.outcome));
    await Promise.all(contenders.map(contender => contender.readiness));
    Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0, 2);
    expect((await finished).filter(Boolean)).toHaveLength(1);
    if (operation === "replace") expect((await port.list(alice))[0].revision).toBe(2);
    else expect(await port.read(created.token)).toBeNull();
    expect(originals(f)).toBe(before);
  });

  it("the maximum revision cannot overflow and stored oversized/malformed fields are never acknowledged", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f);
    connection.db.prepare("UPDATE private_bibliographies SET revision=2147483647 WHERE id=?").run(created.bibliography.id);
    await expect(port.replace(alice, created.bibliography.id, input, 2_147_483_647)).rejects.toThrow("bibliography_limit");
    await port.revoke(alice, created.bibliography.id, 2_147_483_647);
    const next = await port.create(alice, input);
    connection.db.prepare("UPDATE private_bibliographies SET updated_at='malformed' WHERE id=?").run(next.bibliography.id);
    await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
    mutate(f, raw => {
      raw.exec("PRAGMA ignore_check_constraints=ON");
      // Drop/recreate just the update fence to inject corrupt fixture data. The
      // application never receives a registration or unfenced SQL capability.
      const name = domain.fences.find(fence => fence.operation === "UPDATE")!.name;
      const sql = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)!.sql);
      raw.exec(`DROP TRIGGER ${name}`); raw.prepare("UPDATE private_bibliographies SET content=? WHERE id=?").run("x".repeat(524_289), next.bibliography.id); raw.exec(sql);
    });
    await expect(port.read(next.token)).rejects.toThrow("bibliography_unavailable"); expect(originals(f)).toBe(before);
  });

  it.each([
    "ALTER TABLE private_bibliographies ADD COLUMN foreign_data TEXT",
    "CREATE INDEX foreign_bibliography_index ON private_bibliographies(title)",
    "CREATE INDEX foreign_original_index ON query_runs(question)",
  ])("a genuine connection without a supplied profile still refuses unsupported full/domain shape: %s", sql => {
    const f = fixture(); mutate(f, raw => raw.exec(sql)); const before = readFileSync(f.file);
    const connection = f.open(false, false);
    expect(() => createEnrolledSqlitePrivateBibliographies(connection.db)).toThrow("bibliography_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow(); expect(readFileSync(f.file)).toEqual(before);
  });

  it.each([
    ["CREATE INDEX foreign_bibliography_index ON private_bibliographies(title)", "DROP INDEX foreign_bibliography_index"],
    ["CREATE INDEX foreign_original_index ON query_runs(question)", "DROP INDEX foreign_original_index"],
    ["CREATE TRIGGER foreign_bib_delete AFTER DELETE ON private_bibliographies BEGIN UPDATE query_runs SET question='changed'; END", "DROP TRIGGER foreign_bib_delete"],
  ])("write-FIRST schema drift revokes the old port permanently after restoration: %s", async (sql, undo) => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), originalsBefore = originals(f);
    mutate(f, raw => raw.exec(sql)); const driftedBytes = readFileSync(f.file);
    await expect(port.revoke(alice, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable");
    expect(readFileSync(f.file)).toEqual(driftedBytes); mutate(f, raw => raw.exec(undo));
    await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
    await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
    expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]);
    expect(originals(f)).toBe(originalsBefore);
  });

  it.each(["storage_identity_no_update", ...domain.fences.map(fence => fence.name)])("missing exact fence refuses before mutation and restoration cannot revive the old port: %s", async name => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f);
    let fenceSql = "";
    mutate(f, raw => { fenceSql = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)!.sql); raw.exec(`DROP TRIGGER ${name}`); });
    const driftedBytes = readFileSync(f.file);
    await expect(port.replace(alice, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_unavailable");
    expect(readFileSync(f.file)).toEqual(driftedBytes); mutate(f, raw => raw.exec(fenceSql));
    await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]); expect(originals(f)).toBe(before);
  });

  it("a foreign fence under the right name and a deleted domain are refused without repair", async () => {
    for (const mode of ["foreign-fence", "deleted-domain"] as const) {
      const f = fixture(), port = createEnrolledSqlitePrivateBibliographies(f.open().db)!;
      const created = await port.create(alice, input);
      mutate(f, raw => {
        if (mode === "deleted-domain") raw.exec("DROP TABLE private_bibliographies");
        else { const name = domain.fences[0].name; raw.exec(`DROP TRIGGER ${name}; CREATE TRIGGER ${name} BEFORE INSERT ON private_bibliographies BEGIN SELECT 1; END`); }
      });
      const before = readFileSync(f.file);
      await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
      await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
      expect(readFileSync(f.file).equals(before)).toBe(true); expect(() => f.open()).toThrow();
    }
  });

  it.each(["create", "replace", "revoke"] as const)("write-FIRST manifest drift permanently revokes %s and restoration needs a fresh connection", async operation => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), manifest = readFileSync(f.manifest), before = readFileSync(f.file);
    writeFileSync(f.manifest, "{}");
    if (operation === "create") await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
    else if (operation === "replace") await expect(port.replace(alice, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_unavailable");
    else await expect(port.revoke(alice, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable");
    writeFileSync(f.manifest, manifest);
    await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
    await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
    await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
    await expect(port.replace(alice, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_unavailable");
    await expect(port.revoke(alice, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]);
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("write-FIRST substituted identity refuses even with its exact marker trigger, and restoration cannot revive the port", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f);
    let markerSql = "", identityBytes = "";
    mutate(f, raw => {
      markerSql = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name='storage_identity_no_update'").get()!.sql);
      identityBytes = String(raw.prepare("SELECT identity FROM keryx_storage_identity WHERE id=1").get()!.identity);
      raw.exec("DROP TRIGGER storage_identity_no_update");
      raw.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1").run(JSON.stringify({ ...f.identity, storageId: "00000000-0000-4000-8000-000000000001" }));
      raw.exec(markerSql);
    });
    const driftedBytes = readFileSync(f.file);
    await expect(port.revoke(alice, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable"); expect(readFileSync(f.file)).toEqual(driftedBytes);
    mutate(f, raw => { raw.exec("DROP TRIGGER storage_identity_no_update"); raw.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1").run(identityBytes); raw.exec(markerSql); });
    await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
    expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]); expect(originals(f)).toBe(before);
  });

  it("held-file replacement is detected or prevented by the OS, and explicit close revokes all methods", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input);
    if (process.platform === "win32") {
      expect(() => renameSync(f.file, f.file + ".old")).toThrow(); expect(await port.list(alice)).toEqual([created.bibliography]);
    } else {
      renameSync(f.file, f.file + ".old"); copyFileSync(f.file + ".old", f.file);
      await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
      await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
      rmSync(f.file); renameSync(f.file + ".old", f.file);
      await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
      expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]);
    }
    connection.close();
    for (const operation of [() => port.list(alice), () => port.read(created.token), () => port.create(alice, input),
      () => port.replace(alice, created.bibliography.id, input, 1), () => port.revoke(alice, created.bibliography.id, 1)])
      await expect(operation()).rejects.toThrow("bibliography_unavailable");
  });

  it("guard failure after SQL mutation rolls back the new row and all originals before acknowledgement", async () => {
    const f = fixture(), port = createEnrolledSqlitePrivateBibliographies(f.open().db)!, before = originals(f);
    const originalRun = StatementSync.prototype.run;
    const spy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (this: StatementSync, ...args) {
      const result = Reflect.apply(originalRun, this, args); writeFileSync(f.manifest, "{}"); return result;
    });
    try { await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable"); } finally { spy.mockRestore(); }
    const raw = new DatabaseSync(f.file, { readOnly: true });
    try { expect(raw.prepare("SELECT count(*) AS n FROM private_bibliographies").get()!.n).toBe(0); } finally { raw.close(); }
    expect(originals(f)).toBe(before);
  });

  it.each(["prepare", "exec"] as const)("an in-transaction %s guard failure stays revoked when the manifest restores before cleanup", async operation => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f), manifest = readFileSync(f.manifest);
    const originalRun = StatementSync.prototype.run;
    let observed: unknown;
    const spy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (this: StatementSync, ...args) {
      const result = Reflect.apply(originalRun, this, args);
      writeFileSync(f.manifest, "{}");
      try {
        // The real verified wrapper observes manifest drift after the real UPDATE.
        if (operation === "prepare") connection.db.prepare("SELECT id FROM private_bibliographies");
        else connection.db.exec("SELECT id FROM private_bibliographies");
        return result;
      } catch (error) { observed = error; throw error; }
      finally { writeFileSync(f.manifest, manifest); }
    });
    try { await expect(port.replace(alice, created.bibliography.id, { title: "Unacknowledged", papers: [] }, 1)).rejects.toThrow("bibliography_unavailable"); }
    finally { spy.mockRestore(); }
    expect(observed).toBeDefined(); expect(readFileSync(f.manifest)).toEqual(manifest);
    for (const action of [() => port.list(alice), () => port.read(created.token), () => port.create(alice, input),
      () => port.replace(alice, created.bibliography.id, input, 1), () => port.revoke(alice, created.bibliography.id, 1)])
      await expect(action()).rejects.toThrow("bibliography_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    const fresh = createEnrolledSqlitePrivateBibliographies(f.open().db)!;
    expect(await fresh.list(alice)).toEqual([created.bibliography]);
    expect(await fresh.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect(originals(f)).toBe(before);
  });

  it.each([
    new Error("Injected unclassified failure"),
    Object.assign(new Error("Injected non-contention SQLite error"), { code: "ERR_SQLITE_ERROR", errcode: 1 }),
    Object.assign(new Error("Injected nonnumeric lock label"), { code: "ERR_SQLITE_ERROR", errcode: "5" }),
    Object.assign(new Error("Injected nonnative lock label"), { code: "SQLITE_BUSY", errcode: 5 }),
  ])("unclassified transaction error permanently revokes without changing snapshot or originals: %s", async error => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = readFileSync(f.file), originalPrepare = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.startsWith("UPDATE private_bibliographies SET title=")) throw error;
      return Reflect.apply(originalPrepare, this, [sql]);
    });
    try { await expect(port.replace(alice, created.bibliography.id, input, 1)).rejects.toThrow("bibliography_unavailable"); } finally { spy.mockRestore(); }
    await expect(port.list(alice)).rejects.toThrow("bibliography_unavailable");
    await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
    await expect(port.create(alice, input)).rejects.toThrow("bibliography_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    expect(await createEnrolledSqlitePrivateBibliographies(f.open().db)!.list(alice)).toEqual([created.bibliography]);
    expect(readFileSync(f.file)).toEqual(before);
  });

  it.each(["BEGIN IMMEDIATE", "COMMIT"] as const)("genuine competing native lock refuses at %s and the intact port recovers after release", async phase => {
    const f = fixture(), connection = f.open(), competitor = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    const created = await port.create(alice, input), before = originals(f);
    // Keep a real competing transaction open through the existing busy timeout.
    // A reserved writer prevents BEGIN; a held reader prevents the writer COMMIT.
    competitor.db.exec(phase === "BEGIN IMMEDIATE" ? "BEGIN IMMEDIATE" : "BEGIN");
    competitor.db.prepare("SELECT id FROM private_bibliographies").all();
    const originalExec = DatabaseSync.prototype.exec;
    let nativeFailure: unknown;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      try { return Reflect.apply(originalExec, this, [sql]); }
      catch (error) { if (sql === phase) nativeFailure = error; throw error; }
    });
    try {
      await expect(port.replace(alice, created.bibliography.id, { title: "Unacknowledged", papers: [] }, 1)).rejects.toThrow("bibliography_unavailable");
      // Observe the actual native exception, without replacing it or shortening a deadline.
      expect(nativeFailure).toBeInstanceOf(Error);
      expect(nativeFailure).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 });
      expect(spy.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(phase === "COMMIT" ? 1 : 0);
    } finally { spy.mockRestore(); competitor.db.exec("ROLLBACK"); }
    expect(await port.list(alice)).toEqual([created.bibliography]);
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect(() => assertVerifiedSqliteConnection(connection.db)).not.toThrow();
    await expect(port.create(bob, input)).resolves.toBeDefined();
    expect(originals(f)).toBe(before);
  });

  it("raw DML is fenced and native application methods cannot rewrite schema, attach or expose capabilities", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqlitePrivateBibliographies(connection.db)!;
    await port.create(alice, input);
    for (const sql of ["CREATE TABLE bypass(x)", "DROP TABLE private_bibliographies", "ATTACH DATABASE ':memory:' AS bypass", "SELECT load_extension('bypass')"])
      expect(() => connection.db.exec(sql)).toThrow();
    expect(() => Reflect.get(connection.db, "function")).toThrow(); expect(() => Reflect.get(connection.db, "setAuthorizer")).toThrow();
    mutate(f, raw => {
      for (const sql of ["INSERT INTO private_bibliographies VALUES('invalid','invalid','invalid','','',0,1,'','')",
        "UPDATE private_bibliographies SET title='foreign'", "DELETE FROM private_bibliographies"]) expect(() => raw.exec(sql)).toThrow();
    });
  });

  it("existing session management and deliberate bearer download routes use the real native port and readonly policy", async () => {
    const f = fixture(), writer = createEnrolledSqlitePrivateBibliographies(f.open().db)!;
    const db = { privateBibliographies: writer } as KeryxDB;
    const session = vi.fn(async () => ({ db, wallet: alice })), routes = createBibliographyManagement(session, "https://keryx.cc");
    const request = (method = "GET", body?: unknown, extra: Record<string, string> = {}) => new Request("https://keryx.cc/api/me/bibliographies", {
      method, headers: { Origin: "https://keryx.cc", "X-Keryx-Expected-Wallet": alice, "Content-Type": "application/json", ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await routes.create(request("POST", input, { Authorization: "Bearer historical-key" }))).status).toBe(401);
    expect(session).not.toHaveBeenCalled();
    expect((await routes.create(request("POST", input, { Origin: "https://foreign.example" }))).status).toBe(403);
    expect((await routes.list(request("GET", undefined, { "X-Keryx-Expected-Wallet": bob }))).status).toBe(409);
    const response = await routes.create(request("POST", input)); expect(response.status).toBe(201);
    const created = await response.json(), filename = created.urlPath.split("/").at(-1)!;
    const readonlyDB = { privateBibliographies: createEnrolledSqlitePrivateBibliographies(f.open(true).db)! } as KeryxDB;
    const readonlyRoutes = createBibliographyManagement(async () => ({ db: readonlyDB, wallet: alice }), "https://keryx.cc");
    expect((await readonlyRoutes.create(request("POST", input))).status).toBe(503);
    expect((await readonlyRoutes.list(request())).status).toBe(200);
    const download = createBibliographyDownload(async () => readonlyDB), downloaded = await download(new Request("https://keryx.cc" + created.urlPath), filename);
    expect(downloaded.status).toBe(200); expect(await downloaded.text()).toBe(paperReferencesBibtex(input.papers).content);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store"); expect(downloaded.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await download(new Request("https://keryx.cc" + created.urlPath + "?wallet=" + bob), filename)).status).toBe(404);
    expect((await routes.replace(request("PUT", input), created.bibliography.id)).status).toBe(428);
    expect((await routes.revoke(request("DELETE", undefined, { "If-Match": '"1"' }), created.bibliography.id)).status).toBe(200);
    expect((await download(new Request("https://keryx.cc" + created.urlPath), filename)).status).toBe(404);
  });
});
