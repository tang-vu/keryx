import { DatabaseSync } from "node:sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { PrivateProfileError, RESERVED_PROFILE_HANDLES, privateProfileInputSchema, privateProfileRecordSchema, privateProfileSnapshotSchema, profileWallet, type PrivateProfilesStore } from "../profiles/private-profile";

export const PRIVATE_PROFILES_SQL = `CREATE TABLE IF NOT EXISTS private_profiles (
  wallet TEXT PRIMARY KEY CHECK(length(wallet)=42 AND wallet=lower(wallet) AND substr(wallet,1,2)='0x' AND substr(wallet,3) NOT GLOB '*[^0-9a-f]*'),
  handle TEXT UNIQUE CHECK(handle IS NULL OR (length(handle) BETWEEN 3 AND 32 AND handle=lower(handle) AND substr(handle,1,1) GLOB '[a-z]' AND handle NOT GLOB '*[^a-z0-9_]*' AND handle NOT IN (${RESERVED_PROFILE_HANDLES.map(value => `'${value}'`).join(",")}))),
  display_name TEXT NOT NULL CHECK(length(display_name)<=80), bio TEXT NOT NULL CHECK(length(bio)<=160), purpose TEXT NOT NULL CHECK(length(purpose)<=160),
  links TEXT NOT NULL CHECK(json_valid(links) AND json_type(links)='array' AND json_array_length(links)<=6),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`;

const profileShape = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema WHERE tbl_name='private_profiles' ORDER BY type,name LIMIT 5").all();
let expectedShape: string | undefined;
function assertProfileShape(db: DatabaseSync) {
  if (!expectedShape) {
    const reference = new DatabaseSync(":memory:");
    try { reference.exec(PRIVATE_PROFILES_SQL); expectedShape = JSON.stringify(profileShape(reference)); }
    finally { reference.close(); }
  }
  if (JSON.stringify(profileShape(db)) !== expectedShape) throw new PrivateProfileError("profile_unavailable");
}

/** Only ordinary initialized SQLite installs this additive domain. Never an enrolled schema. */
export function createSqlitePrivateProfiles(db: DatabaseSync): PrivateProfilesStore {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    assertOrdinarySqliteResearchAuthority(db);
    if (profileShape(db).length) assertProfileShape(db);
    db.exec(PRIVATE_PROFILES_SQL); assertProfileShape(db); db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const record = (wallet: string) => {
    const row = db.prepare("SELECT * FROM private_profiles WHERE wallet=?").get(wallet);
    return row ? privateProfileRecordSchema.parse({ wallet: row.wallet, handle: row.handle ?? "", displayName: row.display_name,
      bio: row.bio, purpose: row.purpose, links: JSON.parse(row.links as string), createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  };
  return Object.freeze({
    async get(owner, network) {
      const wallet = profileWallet(owner);
      if (network !== "eip155:5042" && network !== "eip155:5042002") throw new PrivateProfileError("profile_unavailable");
      assertOrdinarySqliteResearchAuthority(db);
      db.exec("BEGIN");
      try {
        assertOrdinarySqliteResearchAuthority(db); assertProfileShape(db);
        const first = db.prepare("SELECT first_seen_at FROM users WHERE wallet_address=?").get(wallet);
        const questions = db.prepare("SELECT count(*) AS n FROM query_runs WHERE lower(asker)=?").get(wallet)!;
        const surfaces = db.prepare("SELECT DISTINCT origin FROM query_runs WHERE lower(asker)=? AND origin IS NOT NULL ORDER BY origin LIMIT 17").all(wallet);
        const topics = db.prepare(`SELECT value FROM query_memories m JOIN query_runs r ON r.id=m.id,
          json_each(CASE WHEN json_valid(m.topics) AND json_type(m.topics)='array' THEN m.topics ELSE '[]' END)
          WHERE lower(r.asker)=? AND type='text' AND length(value) BETWEEN 1 AND 80
          GROUP BY value ORDER BY count(*) DESC,value LIMIT 12`).all(wallet).map(row => row.value);
        const creators = db.prepare(`SELECT count(DISTINCT lower(p.payee)) AS n FROM payment_events p JOIN query_runs r ON r.id=p.query_id
          WHERE lower(r.asker)=? AND p.network=? AND p.kind IN ('fetch','citation') AND p.settled=1 AND p.settlement_status='settled'
          AND p.amount_usdc>0 AND p.tx_hash IS NOT NULL AND length(trim(p.tx_hash))>0
          AND length(p.payee)=42 AND lower(substr(p.payee,1,2))='0x' AND lower(substr(p.payee,3)) NOT GLOB '*[^0-9a-f]*'`).get(wallet, network)!;
        const result = privateProfileSnapshotSchema.parse({ profile: record(wallet), activity: { firstSeenAt: first?.first_seen_at ?? null,
          questions: Number(questions.n), surfacesUsed: surfaces.map(row => row.origin), topics, creatorsPaid: Number(creators.n),
          scope: "attributed-current-store", network } });
        db.exec("COMMIT"); return result;
      } catch { db.exec("ROLLBACK"); throw new PrivateProfileError("profile_unavailable"); }
    },
    async update(owner, raw) {
      const wallet = profileWallet(owner), input = privateProfileInputSchema.parse(raw), now = new Date().toISOString();
      assertOrdinarySqliteResearchAuthority(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        assertOrdinarySqliteResearchAuthority(db); assertProfileShape(db);
        db.prepare(`INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(wallet) DO UPDATE SET handle=excluded.handle,display_name=excluded.display_name,bio=excluded.bio,
          purpose=excluded.purpose,links=excluded.links,updated_at=excluded.updated_at`)
          .run(wallet, input.handle || null, input.displayName, input.bio, input.purpose, JSON.stringify(input.links), now, now);
        const result = record(wallet)!;
        db.exec("COMMIT"); return result;
      } catch (error) {
        db.exec("ROLLBACK");
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed: private_profiles.handle")) throw new PrivateProfileError("handle_conflict");
        throw new PrivateProfileError("profile_unavailable");
      }
    },
    async delete(owner) {
      const wallet = profileWallet(owner); assertOrdinarySqliteResearchAuthority(db); db.exec("BEGIN IMMEDIATE");
      try { assertOrdinarySqliteResearchAuthority(db); assertProfileShape(db); db.prepare("DELETE FROM private_profiles WHERE wallet=?").run(wallet); db.exec("COMMIT"); }
      catch { db.exec("ROLLBACK"); throw new PrivateProfileError("profile_unavailable"); }
    },
  } satisfies PrivateProfilesStore);
}
