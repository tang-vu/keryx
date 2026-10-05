import type { DatabaseSync } from "node:sqlite";

export type SqliteSchemaExpectation = readonly [name: string, type: "table" | "index" | "trigger", sql: string];

/** Compare each expected name/type/exact SQL in one native statement. Only one
 * boolean leaves SQLite: missing or altered definitions never become cached
 * authority, and untrusted stored SQL is not materialized into the JS heap.
 */
export function sqliteSchemaMatches(db: DatabaseSync, expected: readonly SqliteSchemaExpectation[]): boolean {
  return db.prepare(`WITH expected AS MATERIALIZED (
    SELECT json_extract(value,'$[0]') AS name,
      json_extract(value,'$[1]') AS type,
      json_extract(value,'$[2]') AS sql FROM json_each(?)
  ) SELECT NOT EXISTS (
    SELECT 1 FROM expected WHERE (
      SELECT actual.sql=expected.sql FROM sqlite_schema AS actual
      WHERE actual.name=expected.name AND actual.type=expected.type
      LIMIT 1
    ) IS NOT 1
  ) AS matches`).get(JSON.stringify(expected))?.matches === 1;
}
