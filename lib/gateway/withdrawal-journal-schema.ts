import type { DatabaseSync } from "node:sqlite";

const originalTables = ["mint_journal_policy", "mint_journal_slots", "mint_journal_prepared"];
const observationTable = "mint_journal_observations";
const versionOneTables = [...originalTables, observationTable];
const admissionTable = "mint_journal_admissions";
const tables = [...versionOneTables, admissionTable];
const baseSchema = `
CREATE TABLE mint_journal_policy(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
CREATE TABLE mint_journal_slots(
  id TEXT PRIMARY KEY, nonce INTEGER NOT NULL UNIQUE, max_gas_cost_wei TEXT NOT NULL,
  transfer_id TEXT NOT NULL UNIQUE, spec_hash TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL CHECK(length(data)<=16384)
);
CREATE TABLE mint_journal_prepared(
  id TEXT PRIMARY KEY REFERENCES mint_journal_slots(id),
  transaction_hash TEXT NOT NULL UNIQUE, raw TEXT NOT NULL CHECK(length(raw)<=4098)
);`;
const observationSchema = `CREATE TABLE mint_journal_observations(
  id TEXT PRIMARY KEY REFERENCES mint_journal_prepared(id),
  data TEXT NOT NULL CHECK(length(data)<=4096)
);`;
const admissionSchema = `CREATE TABLE mint_journal_admissions(
  id TEXT PRIMARY KEY, spec_hash TEXT NOT NULL UNIQUE,
  max_gas_cost_wei TEXT NOT NULL, data TEXT NOT NULL CHECK(length(data)<=8192)
);`;
function protect(db: DatabaseSync, table: string) {
  db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT,'Mint journal is immutable'); END;
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT,'Mint journal is immutable'); END;`);
}
function structure(db: DatabaseSync, expected: string[]) {
  for (const table of expected) {
    const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE name IN (?,?,?)")
      .all(table, `${table}_no_update`, `${table}_no_delete`);
    if (!objects.some(row => row.name === table && row.type === "table")
      || objects.filter(row => row.type === "trigger").length !== 2)
      throw new Error("Mint journal structure unavailable");
  }
}
function checkPolicy(db: DatabaseSync, policy: string) {
  if (db.prepare("SELECT data FROM mint_journal_policy WHERE id=1").get()?.data !== policy)
    throw new Error("Mint journal policy unavailable");
}
export function assertMintJournalSchema(db: DatabaseSync, policy: string) {
  structure(db, tables);
  if (db.prepare("PRAGMA user_version").get()?.user_version !== 2) throw new Error("Mint journal version unavailable");
  checkPolicy(db, policy);
}
export function initializeMintJournalSchema(db: DatabaseSync, policy: string,
  options: { initialize?: boolean; upgrade?: boolean }) {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
  if (options.initialize || options.upgrade) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (existing.length === 0 && version === 0 && options.initialize) {
        db.exec(baseSchema + observationSchema + admissionSchema); tables.forEach(table => protect(db, table));
        db.prepare("INSERT INTO mint_journal_policy(id,data) VALUES(1,?)").run(policy);
        db.exec("PRAGMA user_version=2");
      } else if (version === 0 && options.upgrade && existing.length === originalTables.length
        && originalTables.every(name => existing.some(row => row.name === name))) {
        structure(db, originalTables); checkPolicy(db, policy);
        db.exec(observationSchema + admissionSchema); protect(db, observationTable); protect(db, admissionTable);
        db.exec("PRAGMA user_version=2");
      } else if (version === 1 && options.upgrade && existing.length === versionOneTables.length
        && versionOneTables.every(name => existing.some(row => row.name === name))) {
        structure(db, versionOneTables); checkPolicy(db, policy);
        db.exec(admissionSchema); protect(db, admissionTable); db.exec("PRAGMA user_version=2");
      } else if (existing.length !== tables.length || !tables.every(name => existing.some(row => row.name === name))) {
        throw new Error("Mint journal initialization unavailable");
      }
      assertMintJournalSchema(db, policy);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  assertMintJournalSchema(db, policy);
}
