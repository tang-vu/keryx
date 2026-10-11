import { randomInt, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { ZoteroError, zoteroKeySchema, zoteroOwner, type ZoteroLease, type ZoteroStore } from "../references/zotero-contract";

export const ZOTERO_SQL = `CREATE TABLE IF NOT EXISTS zotero_connections (
 wallet TEXT PRIMARY KEY, generation TEXT NOT NULL, user_id TEXT, encrypted TEXT,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0,
 CHECK((user_id IS NULL)=(encrypted IS NULL)), CHECK(encrypted IS NULL OR (json_valid(encrypted) AND length(encrypted)<4096))
);
CREATE TABLE IF NOT EXISTS zotero_reference_keys (
 wallet TEXT NOT NULL, user_id TEXT NOT NULL, identity TEXT NOT NULL CHECK(length(identity)=64),
 item_key TEXT NOT NULL CHECK(length(item_key)=8), PRIMARY KEY(wallet,user_id,identity), UNIQUE(wallet,user_id,item_key)
);
CREATE TABLE IF NOT EXISTS zotero_provider_state (id INTEGER PRIMARY KEY CHECK(id=1), blocked_until INTEGER NOT NULL);`;
const shape = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN ('zotero_connections','zotero_reference_keys','zotero_provider_state') ORDER BY type,name LIMIT 12").all();
let expected: string | undefined;
function assertShape(db: DatabaseSync) {
  if (!expected) { const reference = new DatabaseSync(":memory:"); try { reference.exec(ZOTERO_SQL); expected = JSON.stringify(shape(reference)); } finally { reference.close(); } }
  if (JSON.stringify(shape(db)) !== expected) throw new ZoteroError("zotero_unavailable");
}
/** Installed only by an explicitly enabled ordinary adapter; never shared production DDL. */
export function createSqliteZotero(db: DatabaseSync): ZoteroStore {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try { assertOrdinarySqliteResearchAuthority(db); if (shape(db).length) assertShape(db); db.exec(ZOTERO_SQL); assertShape(db); db.exec("COMMIT"); }
  catch { db.exec("ROLLBACK"); throw new ZoteroError("zotero_unavailable"); }
  function transaction<T>(action: () => T): T {
    try {
      assertOrdinarySqliteResearchAuthority(db); db.exec("BEGIN IMMEDIATE");
      try { assertOrdinarySqliteResearchAuthority(db); assertShape(db); const value = action(); db.exec("COMMIT"); return value; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    } catch (error) { throw error instanceof ZoteroError ? error : new ZoteroError("zotero_unavailable"); }
  }
  function checked(value: ZoteroLease) {
    const row = db.prepare("SELECT * FROM zotero_connections WHERE wallet=? AND generation=? AND lease=? AND lease_until>?").get(zoteroOwner(value.owner), value.generation, value.lease, Date.now());
    if (!row) throw new ZoteroError("zotero_disconnected");
    return row;
  }
  function providerReady() {
    if (Number(db.prepare("SELECT blocked_until FROM zotero_provider_state WHERE id=1").get()?.blocked_until ?? 0) > Date.now()) throw new ZoteroError("zotero_backoff");
  }
  return Object.freeze({
    async status(owner) { return transaction(() => { const row = db.prepare("SELECT user_id FROM zotero_connections WHERE wallet=?").get(zoteroOwner(owner)); return { connected: !!row?.user_id, userId: row?.user_id ? String(row.user_id) : null }; }); },
    async acquire(owner, connected) {
      return transaction(() => {
        const wallet = zoteroOwner(owner), now = Date.now();
        providerReady();
        let row = db.prepare("SELECT * FROM zotero_connections WHERE wallet=?").get(wallet);
        if (connected && !row?.encrypted) throw new ZoteroError("zotero_disconnected");
        if (!connected && row?.encrypted) throw new ZoteroError("zotero_conflict");
        if (Number(row?.blocked_until ?? 0) > now) throw new ZoteroError("zotero_backoff");
        if (Number(row?.lease_until ?? 0) > now) throw new ZoteroError("zotero_busy");
        if (Number(db.prepare("SELECT count(*) AS n FROM zotero_connections WHERE lease_until>?").get(now)!.n) >= 4) throw new ZoteroError("zotero_busy");
        if (!row) { db.prepare("INSERT INTO zotero_connections(wallet,generation) VALUES(?,?)").run(wallet, randomUUID()); row = db.prepare("SELECT * FROM zotero_connections WHERE wallet=?").get(wallet)!; }
        const lease = randomUUID(); db.prepare("UPDATE zotero_connections SET lease=?,lease_until=? WHERE wallet=?").run(lease, now + 180_000, wallet);
        return { owner: wallet, generation: String(row.generation), lease, userId: row.user_id ? String(row.user_id) : null, encrypted: row.encrypted ? JSON.parse(String(row.encrypted)) : null };
      });
    },
    async check(lease) { transaction(() => { const row = checked(lease); providerReady(); if (Number(row.blocked_until) > Date.now()) throw new ZoteroError("zotero_backoff"); }); },
    async connect(lease, userId, encrypted) { transaction(() => { checked(lease); if (!/^[1-9]\d{0,14}$/.test(userId)) throw new ZoteroError("zotero_unavailable"); db.prepare("UPDATE zotero_connections SET user_id=?,encrypted=? WHERE wallet=?").run(userId, JSON.stringify(encrypted), lease.owner); }); },
    async revoke(owner) { transaction(() => { db.prepare("UPDATE zotero_connections SET generation=?,user_id=NULL,encrypted=NULL,lease=NULL,lease_until=0 WHERE wallet=?").run(randomUUID(), zoteroOwner(owner)); }); },
    async release(lease) { transaction(() => { db.prepare("UPDATE zotero_connections SET lease=NULL,lease_until=0 WHERE wallet=? AND generation=? AND lease=?").run(lease.owner, lease.generation, lease.lease); }); },
    async backoff(lease, until) { transaction(() => { checked(lease); if (!Number.isSafeInteger(until)) throw new ZoteroError("zotero_unavailable");
      db.prepare("UPDATE zotero_connections SET blocked_until=max(blocked_until,?) WHERE wallet=?").run(until, lease.owner);
      db.prepare("INSERT INTO zotero_provider_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET blocked_until=max(blocked_until,excluded.blocked_until)").run(until);
    }); },
    async key(lease, userId, identity, existing) {
      return transaction(() => {
        const connection = checked(lease);
        if (connection.user_id !== userId || !/^[a-f0-9]{64}$/.test(identity)) throw new ZoteroError("zotero_unavailable");
        const row = db.prepare("SELECT item_key FROM zotero_reference_keys WHERE wallet=? AND user_id=? AND identity=?").get(lease.owner, userId, identity);
        if (row) { if (existing && row.item_key !== existing) throw new ZoteroError("zotero_conflict"); return zoteroKeySchema.parse(row.item_key); }
        if (Number(db.prepare("SELECT count(*) AS n FROM zotero_reference_keys WHERE wallet=? AND user_id=?").get(lease.owner, userId)!.n) >= 5000) throw new ZoteroError("zotero_limit");
        const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
        const key = existing ? zoteroKeySchema.parse(existing) : Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
        if (db.prepare("SELECT 1 FROM zotero_reference_keys WHERE wallet=? AND user_id=? AND item_key=?").get(lease.owner, userId, key)) throw new ZoteroError("zotero_conflict");
        db.prepare("INSERT INTO zotero_reference_keys VALUES(?,?,?,?)").run(lease.owner, userId, identity, key); return key;
      });
    },
  } satisfies ZoteroStore);
}
