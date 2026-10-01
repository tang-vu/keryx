import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";

export function sqliteApplicationSchemaProfile(db: DatabaseSync, excluded: ReadonlySet<string>): string {
  if (excluded.size > 2048) throw new Error("SQLite application schema migration required");
  const exclusion = excluded.size ? ` AND name NOT IN (${Array.from(excluded, () => "?").join(",")})` : "";
  const predicate = `name NOT LIKE 'sqlite_%'${exclusion}`;
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec("BEGIN");
  try {
    const metadata = db.prepare(`SELECT count(*) AS rows,
      COALESCE(sum(length(CAST(name AS BLOB))+length(CAST(tbl_name AS BLOB))+COALESCE(length(CAST(sql AS BLOB)),0)),0) AS bytes,
      COALESCE(max(CASE WHEN length(CAST(name AS BLOB))>256 OR length(CAST(tbl_name AS BLOB))>256
        OR length(CAST(sql AS BLOB))>131072 THEN 1 ELSE 0 END),0) AS oversized
      FROM sqlite_schema WHERE ${predicate}`).get(...excluded);
    if (!metadata || Number(metadata.rows) > 2048 || Number(metadata.bytes) > 2 * 1024 * 1024 || metadata.oversized !== 0)
      throw new Error("SQLite application schema migration required");
    const rows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
      WHERE ${predicate} ORDER BY type,name LIMIT 2049`).all(...excluded);
    const profile = canonicalJson(rows);
    if (Buffer.byteLength(profile) > 2 * 1024 * 1024)
      throw new Error("SQLite application schema migration required");
    if (ownTransaction) db.exec("COMMIT");
    return profile;
  } catch (error) {
    if (ownTransaction) db.exec("ROLLBACK");
    throw error;
  }
}


export function assertSqliteApplicationSchemaProfile(db: DatabaseSync, excluded: ReadonlySet<string>, profiles: readonly string[]): void {
  if (!profiles.includes(sqliteApplicationSchemaProfile(db, excluded)))
    throw new Error("SQLite application schema migration required");
}
