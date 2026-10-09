import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "../../db/sqlite-adapter";

const seedPrefix = "keryx-original-signer-schema-";
const sidecars = ["-wal", "-shm", "-journal"];
const installationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const dormantControls: Record<string, Record<string, number>> = {
  browser_journal_control: { id: 1, active: 0 },
  browser_signing_v2_control: { id: 1, active: 0, min_original_version: 2 },
  browser_signing_v2_barrier: { id: 1, ever_active: 0, min_original_version: 2 },
};
const requiredEmptyTables = [
  "sources", "source_items", "cache_items", "payment_events", "query_runs", "a2a_orders",
  "session_grants", "browser_retained_grants", "browser_authorization_intents",
  "browser_signing_namespaces", "browser_signing_queries", "browser_signing_originals",
  "deliverable_acceptance_store",
];

/** Test-only: dormant controls and the exact installation UUID are allowed, never business authority. */
export function assertEmptySignerFixtureSchema(db: DatabaseSync): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();
  const names = new Set(tables.map(row => String(row.name)));
  if ([...requiredEmptyTables, ...Object.keys(dormantControls)].some(name => !names.has(name)))
    throw new Error("Incomplete signer fixture schema");
  for (const name of names) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    if (name === "deliverable_acceptance_store") {
      const rows = db.prepare(`SELECT * FROM ${quoted}`).all();
      if (rows.length !== 1 || Object.keys(rows[0]).length !== 2 || rows[0].singleton !== 1 ||
        typeof rows[0].id !== "string" || rows[0].id.length !== 36 || !installationUuid.test(rows[0].id))
        throw new Error("Signer fixture schema contains invalid installation identity");
      continue;
    }
    const control = Object.hasOwn(dormantControls, name) ? dormantControls[name] : undefined;
    if (!control) {
      if (db.prepare(`SELECT count(*) AS count FROM ${quoted}`).get()?.count !== 0)
        throw new Error("Signer fixture schema contains business rows");
      continue;
    }
    const rows = db.prepare(`SELECT * FROM ${quoted}`).all();
    if (rows.length !== 1 || Object.keys(rows[0]).length !== Object.keys(control).length ||
      Object.entries(control).some(([key, value]) => rows[0][key] !== value))
      throw new Error("Signer fixture schema contains active authority");
  }
}

function assertNoSidecars(file: string): void {
  if (sidecars.some(suffix => fs.existsSync(file + suffix)))
    throw new Error("Signer fixture schema has an unclosed journal");
}

function digest(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > 8 * 1024 * 1024)
    throw new Error("Signer fixture schema size refused");
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function removeSeedFolder(folder: string): void {
  if (!fs.existsSync(folder)) return;
  if (fs.lstatSync(folder).isSymbolicLink() ||
    fs.realpathSync(path.dirname(folder)) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(folder).startsWith(seedPrefix)) throw new Error("Signer schema cleanup target refused");
  const file = path.join(folder, "empty.sqlite");
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  fs.rmSync(folder, { recursive: true, force: true });
}

export interface SignerFixtureSchemaSeed {
  readonly file: string;
  readonly sha256: string;
  clone(file: string): SqliteAdapter;
  close(): void;
}

/** Build once through actual startup; each clone still runs actual SqliteAdapter.init(). */
export async function createSignerFixtureSchemaSeed(): Promise<SignerFixtureSchemaSeed> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), seedPrefix));
  const file = path.join(folder, "empty.sqlite");
  try {
    const adapter = new SqliteAdapter(file);
    try { await adapter.init(); } finally { adapter.close(); }
    const native = new DatabaseSync(file);
    try {
      if (native.prepare("PRAGMA journal_mode").get()?.journal_mode !== "wal" ||
        native.prepare("PRAGMA synchronous").get()?.synchronous !== 2)
        throw new Error("Signer fixture schema durability refused");
      assertEmptySignerFixtureSchema(native);
      const checkpoint = native.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (!checkpoint || checkpoint.busy !== 0) throw new Error("Signer schema checkpoint refused");
    } finally { native.close(); }
    assertNoSidecars(file);
    const sha256 = digest(file);
    fs.chmodSync(file, 0o400);
    let closed = false;
    return Object.freeze({
      file,
      sha256,
      clone(target: string) {
        if (closed) throw new Error("Signer fixture schema seed closed");
        assertNoSidecars(file);
        assertNoSidecars(target);
        if (digest(file) !== sha256) throw new Error("Signer fixture schema seed changed");
        fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        if (digest(target) !== sha256) throw new Error("Signer fixture schema copy changed");
        return new SqliteAdapter(target);
      },
      close() {
        if (closed) return;
        removeSeedFolder(folder);
        closed = true;
      },
    });
  } catch (error) {
    removeSeedFolder(folder);
    throw error;
  }
}
