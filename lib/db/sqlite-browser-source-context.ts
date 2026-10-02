import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import type {
  BrowserSourceOriginalAdmission,
  BrowserOriginalAdmissionResult,
} from "./browser-signing-originals";
import {
  browserSigningOriginalSchema,
  verifyBrowserSigningOriginalSource,
} from "../payments/browser-signing-original";
import { admitSqliteBrowserSourceOriginal } from "./sqlite-browser-signing-originals";
import { getSqliteBrowserJournal } from "./sqlite-browser-journal";
import type { BrowserOriginalSourceAuthority } from "../payments/browser-original-source-authority";

/** Additive installation retains the default v2 floor; no activation issuer is provided. */
export function initializeSqliteBrowserSourceContext(db: DatabaseSync): void {
  const owns = !db.isTransaction;
  db.exec(owns ? "BEGIN IMMEDIATE" : "SAVEPOINT browser_source_install");
  try {
    for (const table of [
      "browser_signing_v2_control",
      "browser_signing_v2_barrier",
    ]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((column) => column.name === "min_original_version"))
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN min_original_version INTEGER NOT NULL DEFAULT 2 CHECK(min_original_version IN(2,3))`
        );
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS browser_signing_v3_writer(id INTEGER PRIMARY KEY CHECK(id=1));
      CREATE TRIGGER IF NOT EXISTS browser_source_floor_update BEFORE UPDATE ON browser_signing_v2_control
      WHEN NEW.min_original_version<OLD.min_original_version OR NEW.min_original_version<(SELECT min_original_version FROM browser_signing_v2_barrier WHERE id=1)
      BEGIN SELECT RAISE(ABORT,'browser source floor is retained'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_floor_delete BEFORE DELETE ON browser_signing_v2_control
      WHEN OLD.min_original_version=3 BEGIN SELECT RAISE(ABORT,'browser source floor is retained'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_floor_insert BEFORE INSERT ON browser_signing_v2_control
      WHEN NEW.min_original_version<(SELECT min_original_version FROM browser_signing_v2_barrier WHERE id=1)
      BEGIN SELECT RAISE(ABORT,'browser source floor is retained'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_floor_sticky AFTER UPDATE OF min_original_version ON browser_signing_v2_control
      BEGIN UPDATE browser_signing_v2_barrier SET min_original_version=MAX(min_original_version,NEW.min_original_version) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS browser_source_floor_sticky_insert AFTER INSERT ON browser_signing_v2_control
      BEGIN UPDATE browser_signing_v2_barrier SET min_original_version=MAX(min_original_version,NEW.min_original_version) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS browser_source_barrier_monotonic BEFORE UPDATE ON browser_signing_v2_barrier
      WHEN NEW.min_original_version<OLD.min_original_version BEGIN SELECT RAISE(ABORT,'browser source floor is retained'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_intent_fence BEFORE INSERT ON browser_authorization_intents
      WHEN (SELECT min_original_version FROM browser_signing_v2_barrier WHERE id=1)=3 AND NOT EXISTS(SELECT 1 FROM browser_signing_v3_writer)
      BEGIN SELECT RAISE(ABORT,'browser source writer required'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_original_fence BEFORE INSERT ON browser_signing_originals
      WHEN (SELECT min_original_version FROM browser_signing_v2_barrier WHERE id=1)=3 AND
        (NOT EXISTS(SELECT 1 FROM browser_signing_v3_writer) OR json_extract(NEW.original,'$.protocol') IS NOT 'durable-v3' OR
        json_extract(NEW.original,'$.sourceContext.version') IS NOT 'source-context-v1' OR json_type(NEW.original,'$.sourceContextDigest') IS NOT 'text')
      BEGIN SELECT RAISE(ABORT,'browser source original required'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_v3_writer BEFORE INSERT ON browser_signing_originals
      WHEN json_extract(NEW.original,'$.protocol')='durable-v3' AND
        (COALESCE((SELECT active FROM browser_journal_control WHERE id=1),0)<>1 OR
         COALESCE((SELECT active FROM browser_signing_v2_control WHERE id=1),0)<>1 OR
         COALESCE((SELECT min_original_version FROM browser_signing_v2_control WHERE id=1),2)<>3 OR
         NOT EXISTS(SELECT 1 FROM browser_signing_v3_writer))
      BEGIN SELECT RAISE(ABORT,'browser source writer required'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_exposure_fence BEFORE UPDATE OF authorization_phase ON payment_events
      WHEN OLD.authorization_phase='prepared' AND NEW.authorization_phase IN('exposed','signed','submission_attempted','settled','failed') AND
        (SELECT min_original_version FROM browser_signing_v2_barrier WHERE id=1)=3 AND
        NOT EXISTS(SELECT 1 FROM browser_signing_originals o WHERE o.nonce=OLD.authorization_id AND json_extract(o.original,'$.protocol')='durable-v3')
      BEGIN SELECT RAISE(ABORT,'browser source context required before exposure'); END;
      CREATE TRIGGER IF NOT EXISTS browser_source_v3_exposure_active BEFORE UPDATE OF authorization_phase ON payment_events
      WHEN OLD.authorization_phase='prepared' AND NEW.authorization_phase='exposed' AND
        EXISTS(SELECT 1 FROM browser_signing_originals o WHERE o.nonce=OLD.authorization_id AND json_extract(o.original,'$.protocol')='durable-v3') AND
        (COALESCE((SELECT active FROM browser_journal_control WHERE id=1),0)<>1 OR
         COALESCE((SELECT active FROM browser_signing_v2_control WHERE id=1),0)<>1 OR
         COALESCE((SELECT min_original_version FROM browser_signing_v2_control WHERE id=1),2)<>3)
      BEGIN SELECT RAISE(ABORT,'browser source exposure inactive'); END;
    `);
    db.exec(owns ? "COMMIT" : "RELEASE browser_source_install");
  } catch (error) {
    db.exec(
      owns
        ? "ROLLBACK"
        : "ROLLBACK TO browser_source_install; RELEASE browser_source_install"
    );
    throw error;
  }
}

/** Exact retained replay precedes current catalog validation; missing/conflicting history never creates authority. */
export async function admitSqliteBrowserSourceSigningOriginal(
  db: DatabaseSync,
  value: BrowserSourceOriginalAdmission,
  authority: BrowserOriginalSourceAuthority
): Promise<BrowserOriginalAdmissionResult> {
  const input = JSON.parse(
    canonicalJson(value)
  ) as BrowserSourceOriginalAdmission;
  function freeze(object: object): void {
    for (const child of Object.values(object))
      if (child && typeof child === "object") freeze(child);
    Object.freeze(object);
  }
  freeze(input);
  const retained = getSqliteBrowserJournal(
    db,
    input.journal.sessionId,
    input.journal.requestId
  );
  if (retained) {
    const row = db
      .prepare(
        "SELECT original,input FROM browser_signing_originals WHERE nonce=?"
      )
      .get(retained.nonce);
    if (!row) return { status: "refused" };
    const stored = JSON.parse(String(row.input));
    delete stored.sourceContext;
    if (canonicalJson(stored) !== canonicalJson(input))
      return { status: "refused" };
    const original = browserSigningOriginalSchema.parse(
      JSON.parse(String(row.original))
    );
    await verifyBrowserSigningOriginalSource(original, retained);
    return { status: "admitted", journal: retained, original };
  }
  if (input.protocol !== "durable-v3" || input.journal.kind !== "fetch")
    return { status: "refused" };
  const capability = db
    .prepare(
      `SELECT c.active,c.min_original_version,j.active journal_active
    FROM browser_signing_v2_control c JOIN browser_journal_control j ON j.id=c.id WHERE c.id=1`
    )
    .get();
  if (capability?.active !== 1 || capability.journal_active !== 1)
    return { status: "inactive" };
  if (capability.min_original_version !== 3) return { status: "refused" };
  const token = await authority.resolve(input);
  return admitSqliteBrowserSourceOriginal(db, input, token);
}
