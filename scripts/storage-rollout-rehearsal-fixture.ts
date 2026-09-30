import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { initializeSqliteBrowserJournal } from "../lib/db/sqlite-browser-journal";

// Representative actual application shapes, never a production migration.
export function createLegacyRehearsalStore(file: string, authorityRows = false): void {
  const db = new DatabaseSync(file, { allowExtension: false });
  try {
    db.exec(`CREATE TABLE rate_limit_counters(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
      INSERT INTO rate_limit_counters VALUES('synthetic',1,0);
      CREATE TABLE payment_events(id TEXT PRIMARY KEY,created_at TEXT,kind TEXT,query_id TEXT,source_id TEXT,source_name TEXT,
        payer TEXT,payee TEXT,amount_usdc REAL,weight REAL,rationale TEXT,tx_hash TEXT,network TEXT,settled INTEGER,
        settlement_status TEXT NOT NULL DEFAULT 'simulated',authorization_id TEXT,authorization_expires_at TEXT,grant_epoch TEXT,
        item_id TEXT,item_title TEXT,item_url TEXT,content_version TEXT,item_published_at TEXT,offer_id TEXT,list_price_usdc REAL);
      INSERT INTO payment_events(id,network,settled,settlement_status,amount_usdc) VALUES('synthetic','eip155:5042002',0,'simulated',0.002);
      CREATE TABLE session_grants(session_id TEXT PRIMARY KEY,sess_addr TEXT NOT NULL,owner_addr TEXT NOT NULL,
        cap REAL NOT NULL,spent REAL NOT NULL DEFAULT 0,expiry INTEGER NOT NULL,tx_hash TEXT NOT NULL,grant_epoch TEXT NOT NULL);
      CREATE TABLE auth_challenges(hash TEXT PRIMARY KEY,issued_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE browser_authorization_intents(nonce TEXT PRIMARY KEY,network TEXT,token TEXT,gateway_contract TEXT);`);
    initializeSqliteBrowserJournal(db);
    if (authorityRows) {
      // An intentionally ineligible unknown-origin legacy fixture, not an
      // authority-aware write bypass or evidence of funding/authorization.
      db.prepare("INSERT INTO session_grants VALUES(?,?,?,?,?,?,?,?)").run("synthetic", `0x${"11".repeat(20)}`,
        `0x${"22".repeat(20)}`,0.05,0.002,123456789,"synthetic","original-synthetic-epoch");
      db.prepare("INSERT INTO auth_challenges VALUES(?,?,?)").run("a".repeat(64),1,2);
      db.exec("UPDATE browser_journal_control SET active=1 WHERE id=1");
    }
  } finally { db.close(); }
}

export const REHEARSAL_TABLES = ["rate_limit_counters","payment_events","session_grants","auth_challenges",
  "browser_authorization_intents","browser_journal_control","browser_journal_writer","browser_signer_capacity",
  "browser_retained_grants","browser_journal_bindings"] as const;

/** Selected code generation, not a reproducible full application artifact. */
export function rehearsalCodeDigest():string {
  const hash=createHash("sha256");
  for(const name of ["storage-rollout-rehearsal-child.mts","../lib/db/storage-identity.ts",
    "../lib/db/runtime-storage-config.ts","../lib/db/storage-identity-connection.ts","../lib/db/storage-identity-sqlite.ts"]) {
    const file=new URL(name,import.meta.url);
    if(statSync(file).size > 1024*1024) throw new Error("Rehearsal source bound exceeded");
    hash.update(name);hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/** Bounded selected fixture-state digest, not a full-store enrollment/CAS proof. */
export function rehearsalRows(file: string): { digest: string; rows: number; journalActive: boolean; grantRows: number; nonceRows: number; metadataCounter:number } {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    db.exec("BEGIN");
    const hash = createHash("sha256"); let rows = 0;
    for (const table of REHEARSAL_TABLES) {
      const values = db.prepare(`SELECT * FROM "${table}" LIMIT 17`).all();
      if (values.length > 16) throw new Error("Synthetic fixture row bound exceeded");
      const encoded = JSON.stringify(values); if (Buffer.byteLength(encoded) > 16384) throw new Error("Synthetic fixture byte bound exceeded");
      hash.update(JSON.stringify([table,encoded])); rows += values.length;
    }
    return { digest: hash.digest("hex"), rows,
      journalActive: db.prepare("SELECT active FROM browser_journal_control WHERE id=1").get()?.active === 1,
      grantRows: Number(db.prepare("SELECT count(*) n FROM session_grants").get()?.n),
      metadataCounter:Number(db.prepare("SELECT count FROM rate_limit_counters WHERE bucket='synthetic'").get()?.count),
      nonceRows: Number(db.prepare("SELECT count(*) n FROM auth_challenges").get()?.n) };
  } finally { try { db.exec("ROLLBACK"); } finally { db.close(); } }
}
