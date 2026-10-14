import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { PrivateProfileError, privateProfileInputSchema, privateProfileSnapshotSchema, profileWallet,
  type PrivateProfilesStore } from "../profiles/private-profile";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { PRIVATE_PROFILES_SQL, PRIVATE_PROFILE_ACTIVITY_SQL, privateProfileFromSqliteRow } from "./private-profiles-sqlite";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

const unavailable = () => new PrivateProfileError("profile_unavailable");
const expectedDomain = canonicalJson([
  { type: "index", name: "sqlite_autoindex_private_profiles_1", tbl_name: "private_profiles", sql: null },
  { type: "index", name: "sqlite_autoindex_private_profiles_2", tbl_name: "private_profiles", sql: null },
  { type: "table", name: "private_profiles", tbl_name: "private_profiles", sql: PRIVATE_PROFILES_SQL.replace(" IF NOT EXISTS", "").trim().replace(/;$/, "") },
]);

/** Internal composition on the same verified native store. No DDL, ordinary fallback,
 * raw connection escape or caller-supplied guard. Missing domain leaves the port absent. */
export function createEnrolledSqlitePrivateProfiles(db: DatabaseSync): PrivateProfilesStore | undefined {
  if (arguments.length !== 1) throw unavailable();
  const identity = assertVerifiedSqliteConnection(db);
  const schema = () => {
    assertVerifiedSqliteConnection(db);
    // Exclude only fences independently verified with their exact SQL, including the
    // three private_profiles identity fences. Arbitrary indexes/triggers still refuse.
    assertStorageFences(db, identity);
    const fences = Object.keys(storageFenceStatements(db, identity));
    const profile = sqliteApplicationSchemaProfile(db, new Set([STORAGE_IDENTITY_TABLE,
      "storage_identity_no_update", "storage_identity_no_delete", "storage_identity_no_insert", ...fences]));
    if (!supportedSqliteApplicationProfiles(identity.authorityMode === "mainnet-real").includes(profile)) throw unavailable();
    const domain = db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
      WHERE tbl_name='private_profiles' AND name NOT IN (${fences.map(() => "?").join(",")}) ORDER BY type,name LIMIT 4`).all(...fences);
    if (domain.length && canonicalJson(domain) !== expectedDomain) throw unavailable();
    return { profile, present: domain.length !== 0 };
  };
  const admitted = schema();
  if (!admitted.present) return undefined;
  if (identity.authorityMode !== "mainnet-real") throw unavailable();
  assertVerifiedSqliteNativeUserDomainPolicy(db);
  let retired = false;
  const retire = () => { retired = true; db.close(); };
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const check = () => {
    if (retired) throw unavailable();
    try {
      // The genuine connection pins the exact source-known full bundle at opening.
      // Its full guard rechecks it here and before every wrapped SQL primitive;
      // rescanning through that wrapper would multiply the same full guard.
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      assertVerifiedSqliteConnection(db);
    }
    catch (error) { if (!contention(error)) retire(); throw error; }
  };
  const writeAccess = () => {
    // Fixed WeakMap policy refusal stays pre-SQL and keeps readonly readers usable.
    // Writable ports run the full revoking guard before parsing or native SQL.
    try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
    try { check(); } catch { throw unavailable(); }
  };
  const rollback = () => {
    try { db.exec("ROLLBACK"); check(); return true; }
    catch { retire(); return false; }
  };
  const transaction = <T>(write: boolean, action: () => T): T => {
    let open = false;
    try {
      check(); db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); open = true;
      check(); const result = action(); check(); db.exec("COMMIT"); open = false; check(); return result;
    } catch (error) {
      const handleConflict = error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
        && "errcode" in error && error.errcode === 2067 && error.message.includes("UNIQUE constraint failed: private_profiles.handle");
      const intact = !open || rollback();
      // A failed BEGIN has no owned transaction to roll back. Native contention
      // refuses this request; all guard/unclassified failures permanently retire.
      if (!intact || (!contention(error) && !handleConflict)) retire();
      if (!retired && handleConflict) throw new PrivateProfileError("handle_conflict");
      throw unavailable();
    }
  };
  const record = (wallet: string) => privateProfileFromSqliteRow(db.prepare(`SELECT wallet,handle,display_name,bio,purpose,
    CASE WHEN length(CAST(links AS BLOB))<=8192 THEN links ELSE NULL END AS links,
    CASE WHEN length(CAST(created_at AS BLOB))<=64 THEN created_at ELSE NULL END AS created_at,
    CASE WHEN length(CAST(updated_at AS BLOB))<=64 THEN updated_at ELSE NULL END AS updated_at
    FROM private_profiles WHERE wallet=?`).get(wallet));
  return Object.freeze({
    async get(owner, network) {
      const wallet = profileWallet(owner);
      if (network !== identity.network) throw unavailable();
      return transaction(false, () => {
        // Bound malformed source fields before projecting them into JS. The
        // aggregate SQL below remains the existing full owner/network projection.
        if (db.prepare(`SELECT 1 FROM users WHERE wallet_address=? AND length(CAST(first_seen_at AS BLOB))>64
          UNION ALL SELECT 1 FROM query_runs WHERE lower(asker)=? AND length(CAST(origin AS BLOB))>32
          UNION ALL SELECT 1 FROM query_memories m JOIN query_runs r ON r.id=m.id WHERE lower(r.asker)=?
            AND (length(CAST(m.topics AS BLOB))>65536 OR CASE WHEN json_valid(m.topics) THEN json_type(m.topics)!='array' ELSE 1 END
              OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(m.topics) THEN m.topics ELSE '[]' END)
                WHERE type!='text' OR length(value) NOT BETWEEN 1 AND 80))
          LIMIT 1`).get(wallet, wallet, wallet)) throw unavailable();
        const first = db.prepare(PRIVATE_PROFILE_ACTIVITY_SQL.first).get(wallet);
        const questions = db.prepare(PRIVATE_PROFILE_ACTIVITY_SQL.questions).get(wallet)!;
        const surfaces = db.prepare(PRIVATE_PROFILE_ACTIVITY_SQL.surfaces).all(wallet);
        const topics = db.prepare(PRIVATE_PROFILE_ACTIVITY_SQL.topics).all(wallet).map(row => row.value);
        const creators = db.prepare(PRIVATE_PROFILE_ACTIVITY_SQL.creators).get(wallet, network)!;
        const result = privateProfileSnapshotSchema.parse({ profile: record(wallet), activity: {
          firstSeenAt: first?.first_seen_at ?? null, questions: Number(questions.n), surfacesUsed: surfaces.map(row => row.origin),
          topics, creatorsPaid: Number(creators.n), scope: "attributed-current-store", network } });
        return result;
      });
    },
    async update(owner, raw) {
      writeAccess();
      const wallet = profileWallet(owner), input = privateProfileInputSchema.parse(raw), now = new Date().toISOString();
      return transaction(true, () => {
        db.prepare(`INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(wallet) DO UPDATE SET handle=excluded.handle,display_name=excluded.display_name,bio=excluded.bio,
          purpose=excluded.purpose,links=excluded.links,updated_at=excluded.updated_at`)
          .run(wallet, input.handle || null, input.displayName, input.bio, input.purpose, JSON.stringify(input.links), now, now);
        const result = record(wallet);
        if (!result) throw unavailable();
        return result;
      });
    },
    async delete(owner) {
      writeAccess(); const wallet = profileWallet(owner);
      transaction(true, () => { db.prepare("DELETE FROM private_profiles WHERE wallet=?").run(wallet); });
    },
  } satisfies PrivateProfilesStore);
}
