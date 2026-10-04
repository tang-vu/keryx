import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { verifySessionWithdrawalAbort, type SessionWithdrawalAbort } from "../gateway/session-withdrawal-abort";
import { readSqliteSessionWithdrawal, SESSION_WITHDRAWAL_PREPARATIONS_SQL } from "./session-withdrawal-journal";
import { sqliteJournalTransaction } from "./sqlite-browser-journal";

const barrierNames = ["session_withdrawal_single_pending", "session_withdrawal_payment_barrier",
  "session_withdrawal_grant_insert_barrier", "session_withdrawal_grant_update_barrier"] as const;
/** Preserve the exact pre-abort schema for a reviewed migration; replacement barriers
 * recognize only this separately authenticated, immutable terminal outcome. */
export const SESSION_WITHDRAWAL_ABORT_SQL = `
CREATE TABLE session_withdrawal_publication_aborts (
 request_id TEXT PRIMARY KEY REFERENCES session_withdrawal_preparations(request_id),
 data TEXT NOT NULL CHECK(length(data)<=2048 AND json_valid(data))
);
CREATE TRIGGER session_withdrawal_abort_writer BEFORE INSERT ON session_withdrawal_publication_aborts
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 OR NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=NEW.request_id
   AND json_extract(NEW.data,'$.requestId')=p.request_id AND json_extract(NEW.data,'$.ownerAddr')=p.recovery_owner
   AND json_extract(NEW.data,'$.sessAddr')=p.signer AND json_extract(NEW.data,'$.grantEpoch')=p.grant_epoch
   AND json_extract(NEW.data,'$.network')='eip155:5042'
   AND json_extract(NEW.data,'$.format')='keryx-session-withdrawal-publication-abort-v1')
 OR EXISTS(SELECT 1 FROM creator_withdrawal_requests WHERE id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM creator_withdrawal_transfer_attempts WHERE id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM creator_withdrawal_attestations WHERE id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM session_withdrawal_completions WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'original publication abort refused'); END;
CREATE TRIGGER session_withdrawal_abort_no_update BEFORE UPDATE ON session_withdrawal_publication_aborts
 BEGIN SELECT RAISE(ABORT,'original publication abort immutable'); END;
CREATE TRIGGER session_withdrawal_abort_no_delete BEFORE DELETE ON session_withdrawal_publication_aborts
 BEGIN SELECT RAISE(ABORT,'original publication abort retained'); END;
` + barrierNames.map(name => {
  const original = SESSION_WITHDRAWAL_PREPARATIONS_SQL.match(new RegExp(`CREATE TRIGGER ${name} [\\s\\S]*? END;`))?.[0];
  if (!original) throw new Error("Original withdrawal barrier unavailable");
  const marker = "NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id)";
  if (!original.includes(marker)) throw new Error("Original withdrawal barrier differs");
  return `DROP TRIGGER ${name};\n` + original.replace(marker, marker +
    " AND NOT EXISTS(SELECT 1 FROM session_withdrawal_publication_aborts a WHERE a.request_id=w.request_id)");
}).join("\n") + [
  ["session_withdrawal_exposures", "request_id"], ["session_withdrawal_cancellations", "request_id"],
  ["creator_withdrawal_requests", "id"], ["creator_withdrawal_transfer_attempts", "id"],
  ["creator_withdrawal_attestations", "id"], ["session_withdrawal_completions", "request_id"],
].map(([table, key]) => `
CREATE TRIGGER publication_abort_blocks_${table} BEFORE INSERT ON ${table}
 WHEN EXISTS(SELECT 1 FROM session_withdrawal_publication_aborts WHERE request_id=NEW.${key})
 BEGIN SELECT RAISE(ABORT,'original publication permanently aborted'); END;`).join("\n");

export async function readSqliteSessionWithdrawalAbort(db: DatabaseSync, id: string, owner: string) {
  const p = await readSqliteSessionWithdrawal(db, id, owner);
  if (!p) return null;
  const row = db.prepare("SELECT data FROM session_withdrawal_publication_aborts WHERE request_id=?").get(id);
  return row ? verifySessionWithdrawalAbort(JSON.parse(String(row.data)), p) : null;
}
export async function abortSqliteSessionWithdrawal(db: DatabaseSync, id: string, owner: string, value: SessionWithdrawalAbort) {
  const p = await readSqliteSessionWithdrawal(db, id, owner);
  if (!p) return null;
  const proof = await verifySessionWithdrawalAbort(value, p), data = canonicalJson(proof);
  sqliteJournalTransaction(db, () => {
    const saved = db.prepare("SELECT data FROM session_withdrawal_publication_aborts WHERE request_id=?").get(id);
    if (saved) {
      if (saved.data !== data) throw new Error("Original publication abort conflict");
      return;
    }
    // Triggers perform the atomic signed-request/claim/outcome exclusion, including
    // old application writers which passed their earlier HTTP prechecks.
    db.prepare("INSERT INTO session_withdrawal_publication_aborts(request_id,data) VALUES(?,?)").run(id, data);
  });
  return proof;
}
