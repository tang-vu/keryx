/** Lossless SQLite row inventory for migration rehearsal. This is not an
 * application adapter, enrollment operation or authority to resume a writer. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type SnapshotValue = readonly ["null"] | readonly ["integer", string]
  | readonly ["real", string] | readonly ["text", string] | readonly ["blob", string];
export type SnapshotRow = readonly SnapshotValue[];
const MAX_ROW_BYTES = 8 * 1024 * 1024;
const MAX_COLUMNS = 512;
const INTEGER = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const HEX = /^(?:[0-9a-f]{2})*$/;
function refuse(): never { throw new Error("Migration snapshot refused"); }
function identifier(value: string): string {
  if (!value || value.length > 256 || value.includes("\0")) refuse();
  return `"${value.replaceAll('"', '""')}"`;
}
export function snapshotRowWire(input: unknown): string {
  if (!Array.isArray(input) || !input.length || input.length > MAX_COLUMNS) refuse();
  let bytes = 2;
  for (const cell of input) {
    if (!Array.isArray(cell) || (cell[0] === "null" ? cell.length !== 1 : cell.length !== 2)) refuse();
    const [kind, value] = cell;
    if (kind === "null") { bytes += 9; continue; }
    if (typeof value !== "string") refuse();
    bytes += value.length + 18;
    if (bytes > MAX_ROW_BYTES) refuse();
    if (kind === "integer") {
      if (value.length > 20 || !INTEGER.test(value) || BigInt(value) < BigInt("-9223372036854775808") || BigInt(value) > BigInt("9223372036854775807")) refuse();
    } else if (kind === "real") {
      if (!/^[0-9a-f]{16}$/.test(value) || !Number.isFinite(Buffer.from(value, "hex").readDoubleBE())) refuse();
    } else if ((kind !== "text" && kind !== "blob") || value.length > MAX_ROW_BYTES * 2 || !HEX.test(value)) refuse();
  }
  const wire = JSON.stringify(input);
  if (Buffer.byteLength(wire) > MAX_ROW_BYTES) refuse();
  return wire;
}
export function snapshotRowDigest(input: unknown): string {
  return createHash("sha256").update(snapshotRowWire(input), "utf8").digest("hex");
}

export interface SnapshotTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly sql: string;
}
/** Includes internal tables such as sqlite_sequence; virtual/shadow tables are
 * refused, because reconstructing their implicit storage needs a separate plan.
 * The caller must hold a read transaction on a private consistent snapshot. */
export function snapshotTables(db: DatabaseSync): readonly SnapshotTable[] {
  if (!db.isTransaction) refuse();
  const tables = db.prepare("PRAGMA table_list").all();
  if (tables.length > 512 || tables.some(t => t.type === "virtual" || t.type === "shadow")) refuse();
  return db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name COLLATE BINARY").all().map(t => {
    if (typeof t.name !== "string" || typeof t.sql !== "string") refuse();
    const columns = db.prepare(`PRAGMA table_xinfo(${identifier(t.name)})`).all();
    if (!columns.length || columns.length > MAX_COLUMNS || columns.some(c => c.hidden !== 0)) refuse();
    return Object.freeze({ name: t.name, sql: t.sql, columns: Object.freeze(columns.map(c => {
      if (typeof c.name !== "string") return refuse();
      return c.name;
    })) });
  });
}

/** Preserve SQLite storage classes, full signed int64, IEEE-754 real bits,
 * and raw text/blob bytes. Text is read as hex, avoiding UTF-8 replacement,
 * embedded-NUL truncation and PostgreSQL text/JSONB Unicode restrictions. */
export function* snapshotRows(db: DatabaseSync, table: SnapshotTable): Generator<SnapshotRow> {
  if (!db.isTransaction || !table.columns.length || table.columns.length > MAX_COLUMNS) refuse();
  const projection = table.columns.flatMap((name, i) => {
    const column = identifier(name);
    return [`typeof(${column}) AS t${i}`, `CASE WHEN typeof(${column}) IN ('text','blob') THEN lower(hex(CAST(${column} AS BLOB))) ELSE ${column} END AS v${i}`];
  }).join(",");
  const statement = db.prepare(`SELECT ${projection} FROM ${identifier(table.name)}`);
  statement.setReadBigInts(true);
  for (const raw of statement.iterate()) {
    const row: SnapshotValue[] = table.columns.map((_name, i) => {
      const kind = raw[`t${i}`], value = raw[`v${i}`];
      if (kind === "null" && value === null) return ["null"];
      if (kind === "integer" && typeof value === "bigint") return ["integer", String(value)];
      if (kind === "real" && typeof value === "number" && Number.isFinite(value)) {
        const bytes = Buffer.allocUnsafe(8); bytes.writeDoubleBE(value); return ["real", bytes.toString("hex")];
      }
      if ((kind === "text" || kind === "blob") && typeof value === "string") return [kind, value];
      return refuse();
    });
    snapshotRowWire(row);
    yield row;
  }
}
