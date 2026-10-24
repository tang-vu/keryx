import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FeedbackError, type RequesterFeedbackStore } from "./contracts";
import { feedbackStorageRow, readFeedbackStorageRow } from "./storage-row";
import { runClaimBindingSchema, type RunClaimBinding } from "../run-claims/contracts";

const APP_ID = 0x4b525846;
const FORMAT = "keryx-requester-opinion-store-v1";
const SQL = `CREATE TABLE requester_opinion_store(singleton INTEGER PRIMARY KEY CHECK(singleton=1),format TEXT NOT NULL,id TEXT NOT NULL,origin TEXT NOT NULL,network TEXT NOT NULL);
CREATE TABLE requester_opinions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,delivered_digest TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data) AND length(data)<=8192),created_at TEXT NOT NULL,UNIQUE(run_id,delivered_digest));
CREATE TRIGGER requester_opinion_store_no_update BEFORE UPDATE ON requester_opinion_store BEGIN SELECT RAISE(ABORT,'feedback_unavailable'); END;
CREATE TRIGGER requester_opinion_store_no_delete BEFORE DELETE ON requester_opinion_store BEGIN SELECT RAISE(ABORT,'feedback_unavailable'); END;
CREATE TRIGGER requester_opinions_no_update BEFORE UPDATE ON requester_opinions BEGIN SELECT RAISE(ABORT,'feedback_unavailable'); END;
CREATE TRIGGER requester_opinions_no_delete BEFORE DELETE ON requester_opinions BEGIN SELECT RAISE(ABORT,'feedback_unavailable'); END;`;
const shape = (db: DatabaseSync) => JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name LIMIT 32").all());
let expectedShape: string | undefined;
function expected() {
  if (!expectedShape) { const db = new DatabaseSync(":memory:"); try { db.exec(SQL); expectedShape = shape(db); } finally { db.close(); } }
  return expectedShape;
}
const unavailable = () => new FeedbackError("feedback_unavailable");
function identity(db: DatabaseSync, binding: RunClaimBinding) {
  if (shape(db) !== expected() || db.prepare("PRAGMA application_id").get()?.application_id !== APP_ID) throw unavailable();
  const rows = db.prepare("SELECT singleton,format,id,origin,network FROM requester_opinion_store LIMIT 2").all();
  if (rows.length !== 1 || rows[0].singleton !== 1 || rows[0].format !== FORMAT || rows[0].origin !== binding.origin
    || rows[0].network !== binding.network || !z.string().uuid().safeParse(rows[0].id).success) throw unavailable();
  return String(rows[0].id);
}
/** Independent, explicitly configured opinion metadata. It never opens a main
 * application database or restores any native/enrolled write capability.
 * No credential, question, answer or payment tuple is automatically copied here;
 * the caller's optional reason remains private user-supplied text.
 */
export function openRequesterOpinionStore(directory: string, rawBinding: RunClaimBinding): RequesterFeedbackStore & { close(): void } {
  const binding = runClaimBindingSchema.parse(rawBinding);
  if (!isAbsolute(directory) || resolve(directory) !== directory || !directory.split(/[\\/]/).includes(".local")) throw unavailable();
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = realpathSync(directory), folder = lstatSync(directory);
  if (folder.isSymbolicLink() || !folder.isDirectory() || process.platform !== "win32"
    && (folder.uid !== process.getuid!() || (folder.mode & 0o777) !== 0o700)) throw unavailable();
  const filename = join(root, "requester-opinions.sqlite");
  const checkFile = () => {
    if (realpathSync(directory) !== root || lstatSync(directory).isSymbolicLink()) throw unavailable();
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024
      || process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600)) throw unavailable();
    return `${stat.dev}:${stat.ino}`;
  };
  let fresh = false;
  if (!existsSync(filename)) { const fd = openSync(filename, "wx", 0o600); closeSync(fd); fresh = true; }
  const physical = checkFile();
  // A foreign/ambiguous existing file is probed readonly and never repaired.
  if (!fresh) {
    const probe = new DatabaseSync(filename, { readOnly: true });
    try { identity(probe, binding); } finally { probe.close(); }
  }
  if (checkFile() !== physical) throw unavailable();
  const db = new DatabaseSync(filename);
  try {
    if (fresh) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(SQL);
        db.prepare("INSERT INTO requester_opinion_store(singleton,format,id,origin,network) VALUES(1,?,?,?,?)")
          .run(FORMAT, randomUUID(), binding.origin, binding.network);
        db.exec(`PRAGMA application_id=${APP_ID}; COMMIT`);
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    const storeId = identity(db, binding);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250; PRAGMA trusted_schema=OFF");
    const assertAvailable = () => { if (checkFile() !== physical || identity(db, binding) !== storeId) throw unavailable(); };
    const read = async (id: string) => {
      try {
        assertAvailable();
        const row = readFeedbackStorageRow(db.prepare("SELECT id,run_id,delivered_digest,data,created_at FROM requester_opinions WHERE id=?").get(id), id);
        assertAvailable(); return row;
      } catch { throw unavailable(); }
    };
    return Object.freeze({ storeId, assertAvailable, read, close: () => db.close(), async submit(input) {
      try {
        assertAvailable();
        const row = feedbackStorageRow(input);
        db.exec("BEGIN IMMEDIATE");
        try {
          if (!db.prepare("SELECT 1 FROM requester_opinions WHERE id=?").get(row.id)) {
            if (Number(db.prepare("SELECT count(*) AS n FROM requester_opinions").get()?.n) >= 10000) throw unavailable();
            db.prepare("INSERT INTO requester_opinions(id,run_id,delivered_digest,data,created_at) VALUES(?,?,?,?,?)")
              .run(row.id, row.run_id, row.delivered_digest, row.data, row.created_at);
          }
          assertAvailable(); db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        const saved = await read(row.id);
        if (!saved) throw unavailable();
        return saved;
      } catch { throw unavailable(); }
    } } satisfies RequesterFeedbackStore & { close(): void });
  } catch (error) { db.close(); throw error; }
}

let configured: { directory: string; binding: string; store: RequesterFeedbackStore } | undefined;
export function configuredRequesterOpinionStore(binding: RunClaimBinding): RequesterFeedbackStore {
  const directory = process.env.KERYX_REQUESTER_FEEDBACK_DIRECTORY;
  if (!directory || !isAbsolute(directory) || directory.endsWith(sep)) throw unavailable();
  const key = JSON.stringify(runClaimBindingSchema.parse(binding));
  if (!configured) configured = { directory, binding: key, store: openRequesterOpinionStore(directory, binding) };
  if (configured.directory !== directory || configured.binding !== key) throw unavailable();
  configured.store.assertAvailable(); return configured.store;
}
