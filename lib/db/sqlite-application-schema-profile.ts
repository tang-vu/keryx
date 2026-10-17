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


// Source strings are immutable. Cache their JSON/shape validation only, never a
// connection, statement, target schema, or successful admission. Bound retained
// source text even when callers supply many different reference profiles.
const nativeComparableProfiles = new Set<string>();
function nativeComparableProfile(profile: string): boolean {
  if (nativeComparableProfiles.has(profile)) return true;
  if (typeof profile !== "string" || Buffer.byteLength(profile) > 2 * 1024 * 1024) return false;
  try {
    const rows: unknown = JSON.parse(profile);
    if (!Array.isArray(rows) || rows.length > 2048 || rows.some(row =>
      !row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).sort().join(",") !== "name,sql,tbl_name,type"
      || typeof row.type !== "string" || typeof row.name !== "string" || typeof row.tbl_name !== "string"
      || row.sql !== null && typeof row.sql !== "string") || canonicalJson(rows) !== profile) return false;
  } catch { return false; }
  if (nativeComparableProfiles.size >= 8) nativeComparableProfiles.delete(nativeComparableProfiles.values().next().value!);
  nativeComparableProfiles.add(profile);
  return true;
}

export function assertSqliteApplicationSchemaProfile(db: DatabaseSync, excluded: ReadonlySet<string>, profiles: readonly string[]): void {
  if (!profiles.length || !profiles.every(nativeComparableProfile)) {
    if (!profiles.includes(sqliteApplicationSchemaProfile(db, excluded)))
      throw new Error("SQLite application schema migration required");
    return;
  }
  if (excluded.size > 2048) throw new Error("SQLite application schema migration required");
  const exclusion = excluded.size ? ` AND name NOT IN (${Array.from(excluded, () => "?").join(",")})` : "";
  const predicate = `name NOT LIKE 'sqlite_%'${exclusion}`;
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec("BEGIN");
  let matches = false;
  try {
    const metadata = db.prepare(`SELECT count(*) AS rows,
      COALESCE(sum(length(CAST(name AS BLOB))+length(CAST(tbl_name AS BLOB))+COALESCE(length(CAST(sql AS BLOB)),0)),0) AS bytes,
      COALESCE(max(CASE WHEN length(CAST(name AS BLOB))>256 OR length(CAST(tbl_name AS BLOB))>256
        OR length(CAST(sql AS BLOB))>131072 THEN 1 ELSE 0 END),0) AS oversized
      FROM sqlite_schema WHERE ${predicate}`).get(...excluded);
    if (!metadata || Number(metadata.rows) > 2048 || Number(metadata.bytes) > 2 * 1024 * 1024 || metadata.oversized !== 0)
      throw new Error("SQLite application schema migration required");
    try {
      // Match the complete ordered document, including NULL and duplicate rows.
      // Fixed key order is canonicalJson's order. Only a boolean leaves SQLite;
      // stored SQL is neither copied into JS nor retained between assertions.
      matches = db.prepare(`SELECT json_group_array(json_object('name',name,'sql',sql,'tbl_name',tbl_name,'type',type))
        IN (${profiles.map(() => "?").join(",")}) AS matches
        FROM (SELECT type,name,tbl_name,sql FROM sqlite_schema
          WHERE ${predicate} ORDER BY type,name LIMIT 2049)`).get(...profiles, ...excluded)?.matches === 1;
    } catch { /* Unsupported native JSON values use the unchanged oracle below. */ }
    // Serializer differences and unsupported shapes cannot broaden or narrow
    // admission. The oracle runs in this same snapshot on every native mismatch.
    // Successful equality also proves the canonical encoded 2 MiB cap because
    // every comparable source string above is canonical and within that cap.
    if (!matches) matches = profiles.includes(sqliteApplicationSchemaProfile(db, excluded));
    if (ownTransaction) db.exec("COMMIT");
  } catch (error) {
    if (ownTransaction) db.exec("ROLLBACK");
    throw error;
  }
  if (!matches) throw new Error("SQLite application schema migration required");
}
