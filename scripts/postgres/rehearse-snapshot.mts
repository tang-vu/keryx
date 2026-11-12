/** Private rehearsal store only. No application schema, enrollment, runtime
 * credentials, payment retries or writer-switch capability is installed. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "pg";
import { postgresPoolConfiguration, type PostgresConnectionOptions } from "../../lib/db/postgres/connection";
import { snapshotRows, snapshotTables, snapshotRowWire, type SnapshotTable } from "./typed-snapshot.mts";

export interface SnapshotRehearsalResult {
  readonly format: "keryx-postgres-snapshot-rehearsal-v1";
  readonly schemaDigest: string;
  readonly tables: readonly { name: string; rows: number; digest: string }[];
  readonly totalRows: number;
  readonly verified: true;
  readonly applicationBackendSwitched: false;
}

/** Opens its own explicit operational connection to an EMPTY dedicated
 * rehearsal database. Its transaction refuses any existing rehearsal namespace.
 * It cannot commit a caller's transaction or supply application enrollment. */
export async function rehearseSqliteSnapshot(db: DatabaseSync, options: PostgresConnectionOptions): Promise<SnapshotRehearsalResult> {
  if (!db.isTransaction) throw new Error("Private consistent snapshot required");
  const tables = snapshotTables(db);
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name COLLATE BINARY").all();
  const schemaWire = JSON.stringify(schema);
  if (Buffer.byteLength(schemaWire) > 4 * 1024 * 1024) throw new Error("Migration schema bound exceeded");
  const schemaDigest = createHash("sha256").update(schemaWire).digest("hex");
  const results: { name: string; rows: number; digest: string }[] = [];
  const pg = new Client(postgresPoolConfiguration(options));
  pg.on("error", () => {});
  try {
    await pg.connect();
    await pg.query("BEGIN");
    await pg.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const version = await pg.query("SELECT current_setting('server_version_num') AS version");
    if (Number(version.rows[0].version) < 170000 || Number(version.rows[0].version) >= 180000) throw new Error("PostgreSQL17 rehearsal required");
    // No IF NOT EXISTS, DROP, TRUNCATE, conflict overwrite or implicit retry.
    await pg.query(`CREATE SCHEMA keryx_migration;
      REVOKE ALL ON SCHEMA keryx_migration FROM PUBLIC;
      CREATE TABLE keryx_migration.snapshot_manifest(singleton boolean PRIMARY KEY CHECK(singleton),schema_wire text NOT NULL,schema_digest text NOT NULL);
      CREATE TABLE keryx_migration.snapshot_tables(name text PRIMARY KEY,descriptor_wire text NOT NULL,row_count bigint NOT NULL,row_digest text NOT NULL);
      CREATE TABLE keryx_migration.snapshot_rows(table_name text NOT NULL,ordinal bigint NOT NULL,row_wire text NOT NULL,PRIMARY KEY(table_name,ordinal));
      REVOKE ALL ON ALL TABLES IN SCHEMA keryx_migration FROM PUBLIC;`);
    await pg.query("INSERT INTO keryx_migration.snapshot_manifest VALUES(true,$1,$2)", [schemaWire, schemaDigest]);
    for (const table of tables) {
      const digest = createHash("sha256");
      let count = 0, batch: { ordinal: number; wire: string }[] = [], batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await pg.query(`INSERT INTO keryx_migration.snapshot_rows(table_name,ordinal,row_wire)
          SELECT $1,r.ordinal,r.wire FROM jsonb_to_recordset($2::jsonb) AS r(ordinal bigint,wire text)`, [table.name, JSON.stringify(batch)]);
        batch = []; batchBytes = 0;
      };
      for (const row of snapshotRows(db, table)) {
        const wire = snapshotRowWire(row), bytes = Buffer.byteLength(wire);
        if (batch.length >= 64 || batchBytes + bytes > 1024 * 1024) await flush();
        digest.update(wire).update("\n"); batch.push({ ordinal: count++, wire }); batchBytes += bytes;
        if (!Number.isSafeInteger(count)) throw new Error("Migration row count bound exceeded");
      }
      await flush();
      const hash = digest.digest("hex");
      await pg.query("INSERT INTO keryx_migration.snapshot_tables VALUES($1,$2,$3,$4)", [table.name, JSON.stringify(table), count, hash]);
      results.push({ name: table.name, rows: count, digest: hash });
    }
    // Read the actual persisted PostgreSQL wire, with finite pages, before
    // accepting the transaction. A count or successful insert is not fidelity.
    const actualSchema = await pg.query("SELECT schema_wire,schema_digest FROM keryx_migration.snapshot_manifest WHERE singleton");
    if (actualSchema.rowCount !== 1 || actualSchema.rows[0].schema_wire !== schemaWire || actualSchema.rows[0].schema_digest !== schemaDigest)
      throw new Error("Migration schema mismatch");
    for (let i = 0; i < tables.length; i++) await verifyTable(pg, tables[i], results[i]);
    await pg.query("COMMIT");
    return Object.freeze({ format: "keryx-postgres-snapshot-rehearsal-v1", schemaDigest,
      tables: Object.freeze(results), totalRows: results.reduce((n, t) => n + t.rows, 0), verified: true, applicationBackendSwitched: false });
  } catch {
    // Never retry an ambiguous COMMIT. The caller must inspect the dedicated
    // database and retained source, rather than overwrite a possibly accepted copy.
    try { await pg.query("ROLLBACK"); } catch {}
    throw new Error("Snapshot rehearsal unavailable; inspect the dedicated target before retrying");
  } finally {
    try { await pg.end(); } catch { throw new Error("Snapshot rehearsal connection disposal unavailable"); }
  }
}

async function verifyTable(pg: Client, table: SnapshotTable, expected: { rows: number; digest: string }): Promise<void> {
  const descriptor = await pg.query("SELECT descriptor_wire,row_count::text,row_digest FROM keryx_migration.snapshot_tables WHERE name=$1", [table.name]);
  if (descriptor.rowCount !== 1 || descriptor.rows[0].descriptor_wire !== JSON.stringify(table)
    || descriptor.rows[0].row_count !== String(expected.rows) || descriptor.rows[0].row_digest !== expected.digest)
    throw new Error("Migration table mismatch");
  let count = 0;
  const digest = createHash("sha256");
  while (true) {
    // A single huge cell remains bounded by the encoder's 8MiB row maximum.
    // Page count is kept small; no full database/result aggregation in JS.
    const page = await pg.query("SELECT r.ordinal::text,row_wire FROM keryx_migration.snapshot_rows r WHERE table_name=$1 AND r.ordinal >= $2 ORDER BY r.ordinal LIMIT 8", [table.name, count]);
    if (!page.rows.length) break;
    for (const row of page.rows) {
      if (row.ordinal !== String(count++) || typeof row.row_wire !== "string") throw new Error("Migration row sequence mismatch");
      const canonical = snapshotRowWire(JSON.parse(row.row_wire));
      if (canonical !== row.row_wire) throw new Error("Migration row encoding mismatch");
      digest.update(canonical).update("\n");
    }
  }
  if (count !== expected.rows || digest.digest("hex") !== expected.digest) throw new Error("Migration row digest mismatch");
}
