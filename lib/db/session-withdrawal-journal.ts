import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { parseSessionWithdrawalPreparation, verifySessionWithdrawalPreparation, sessionWithdrawalCancellationSchema,
  type SessionWithdrawalPreparation, type SessionWithdrawalSigningPhase } from "../gateway/session-withdrawal-protocol";
import { readSqliteSessionGrantConsent } from "./session-grant-consents";
import { getSqliteBrowserJournal, sqliteJournalActive, sqliteJournalTransaction } from "./sqlite-browser-journal";
import { sqliteSessionFundingAccounting } from "./session-funding-accounting";
import { verifySessionWithdrawalCompletion, type SessionWithdrawalCompletion } from "../gateway/session-withdrawal-completion";

/** Unsigned original request + admission barrier only. Signed transfers/claims and
 * matched attestations continue to use creator_withdrawal_* financial history. */
export const SESSION_WITHDRAWAL_PREPARATIONS_SQL = `
CREATE TABLE session_withdrawal_preparations (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=66 AND substr(request_id,1,2)='0x' AND substr(request_id,3) NOT GLOB '*[^a-f0-9]*'),
 recovery_owner TEXT NOT NULL, signer TEXT NOT NULL, grant_epoch TEXT NOT NULL REFERENCES session_grant_consents(grant_epoch),
 data TEXT NOT NULL CHECK(length(data)<=16384 AND json_valid(data)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE session_withdrawal_completions (request_id TEXT PRIMARY KEY REFERENCES session_withdrawal_preparations(request_id),
 data TEXT NOT NULL CHECK(length(data)<=16384 AND json_valid(data)));
CREATE TABLE session_withdrawal_exposures (request_id TEXT PRIMARY KEY REFERENCES session_withdrawal_preparations(request_id));
CREATE TABLE session_withdrawal_cancellations (request_id TEXT PRIMARY KEY REFERENCES session_withdrawal_preparations(request_id));
CREATE TRIGGER session_withdrawal_exposure_writer BEFORE INSERT ON session_withdrawal_exposures
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer) OR EXISTS(SELECT 1 FROM session_withdrawal_cancellations WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'original withdrawal exposure refused'); END;
CREATE TRIGGER session_withdrawal_cancel_writer BEFORE INSERT ON session_withdrawal_cancellations
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer) OR EXISTS(SELECT 1 FROM session_withdrawal_exposures WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM creator_withdrawal_requests WHERE id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM creator_withdrawal_transfer_attempts WHERE id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'exposed withdrawal cancellation refused'); END;
CREATE TRIGGER session_withdrawal_exposure_no_update BEFORE UPDATE ON session_withdrawal_exposures
 BEGIN SELECT RAISE(ABORT,'original exposure immutable'); END;
CREATE TRIGGER session_withdrawal_exposure_no_delete BEFORE DELETE ON session_withdrawal_exposures
 BEGIN SELECT RAISE(ABORT,'original exposure retained'); END;
CREATE TRIGGER session_withdrawal_cancel_no_update BEFORE UPDATE ON session_withdrawal_cancellations
 BEGIN SELECT RAISE(ABORT,'original cancellation immutable'); END;
CREATE TRIGGER session_withdrawal_cancel_no_delete BEFORE DELETE ON session_withdrawal_cancellations
 BEGIN SELECT RAISE(ABORT,'original cancellation retained'); END;
CREATE TRIGGER session_withdrawal_signed_request_exposure BEFORE INSERT ON creator_withdrawal_requests
 WHEN EXISTS(SELECT 1 FROM session_withdrawal_preparations WHERE request_id=NEW.id)
 AND (NOT EXISTS(SELECT 1 FROM session_withdrawal_exposures WHERE request_id=NEW.id)
 OR EXISTS(SELECT 1 FROM session_withdrawal_cancellations WHERE request_id=NEW.id))
 BEGIN SELECT RAISE(ABORT,'original withdrawal signing not authorized'); END;
CREATE TRIGGER session_withdrawal_prep_no_update BEFORE UPDATE ON session_withdrawal_preparations
 BEGIN SELECT RAISE(ABORT,'original session withdrawal immutable'); END;
CREATE TRIGGER session_withdrawal_prep_no_delete BEFORE DELETE ON session_withdrawal_preparations
 BEGIN SELECT RAISE(ABORT,'original session withdrawal retained'); END;
CREATE TRIGGER session_withdrawal_complete_no_update BEFORE UPDATE ON session_withdrawal_completions
 BEGIN SELECT RAISE(ABORT,'session withdrawal completion immutable'); END;
CREATE TRIGGER session_withdrawal_complete_no_delete BEFORE DELETE ON session_withdrawal_completions
 BEGIN SELECT RAISE(ABORT,'session withdrawal completion retained'); END;
CREATE TRIGGER session_withdrawal_prepare_writer BEFORE INSERT ON session_withdrawal_preparations
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'session withdrawal writer required'); END;
CREATE TRIGGER session_withdrawal_complete_writer BEFORE INSERT ON session_withdrawal_completions
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'session withdrawal writer required'); END;
CREATE TRIGGER session_withdrawal_prepare_profile BEFORE INSERT ON session_withdrawal_preparations
 WHEN json_extract(NEW.data,'$.network') IS NOT 'eip155:5042' OR json_extract(NEW.data,'$.requestId') IS NOT NEW.request_id
 OR json_extract(NEW.data,'$.ownerAddr') IS NOT NEW.recovery_owner OR json_extract(NEW.data,'$.sessAddr') IS NOT NEW.signer
 OR json_extract(NEW.data,'$.grantEpoch') IS NOT NEW.grant_epoch
 BEGIN SELECT RAISE(ABORT,'session withdrawal identity refused'); END;
CREATE TRIGGER session_withdrawal_single_pending BEFORE INSERT ON session_withdrawal_preparations
 WHEN EXISTS(SELECT 1 FROM session_withdrawal_preparations w LEFT JOIN session_withdrawal_completions c USING(request_id)
 WHERE w.signer=NEW.signer AND c.request_id IS NULL AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id))
 BEGIN SELECT RAISE(ABORT,'recover original session withdrawal'); END;
CREATE TRIGGER session_withdrawal_payment_barrier BEFORE INSERT ON browser_authorization_intents
 WHEN EXISTS(SELECT 1 FROM session_withdrawal_preparations w LEFT JOIN session_withdrawal_completions c USING(request_id)
 WHERE w.signer=lower(NEW.signer) AND c.request_id IS NULL AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id))
 BEGIN SELECT RAISE(ABORT,'session withdrawal payment admission paused'); END;
CREATE TRIGGER session_withdrawal_grant_insert_barrier BEFORE INSERT ON session_grants
 WHEN EXISTS(SELECT 1 FROM session_withdrawal_preparations w LEFT JOIN session_withdrawal_completions c USING(request_id)
 WHERE w.signer=lower(NEW.sess_addr) AND c.request_id IS NULL AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id))
 BEGIN SELECT RAISE(ABORT,'session withdrawal payment admission paused'); END;
CREATE TRIGGER session_withdrawal_grant_update_barrier BEFORE UPDATE ON session_grants
 WHEN NEW.expiry>0 AND EXISTS(SELECT 1 FROM session_withdrawal_preparations w LEFT JOIN session_withdrawal_completions c USING(request_id)
 WHERE w.signer=lower(NEW.sess_addr) AND c.request_id IS NULL AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id))
 BEGIN SELECT RAISE(ABORT,'session withdrawal payment admission paused'); END;
`;
const checkedMicro = (value: unknown): number => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error("Withdrawal accounting unavailable"); return n;
};
export function sqliteSessionWithdrawalAccounting(db: DatabaseSync, signer: string) {
  if (!sqliteJournalActive(db) || !/^0x[0-9a-f]{40}$/.test(signer)) throw new Error("Withdrawal accounting unavailable");
  const funding = sqliteSessionFundingAccounting(db, signer);
  const confirmed = checkedMicro(funding.confirmedSpentMicroUsdc);
  const held = checkedMicro(funding.retainedSpentMicroUsdc) - confirmed;
  const withdrawals = db.prepare(`SELECT w.data FROM session_withdrawal_preparations w
    LEFT JOIN session_withdrawal_completions c USING(request_id) WHERE w.signer=? AND c.request_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id)`).all(signer);
  let heldWithdrawal = 0;
  for (const row of withdrawals) {
    const p = parseSessionWithdrawalPreparation(JSON.parse(String(row.data)));
    heldWithdrawal += checkedMicro(p.burnIntent.spec.value) + checkedMicro(p.burnIntent.maxFee); checkedMicro(heldWithdrawal);
  }
  return { heldPaymentMicroUsdc: String(held), heldWithdrawalMicroUsdc: String(heldWithdrawal), confirmedSpentMicroUsdc: String(confirmed) };
}
export async function reserveSqliteSessionWithdrawal(db: DatabaseSync, value: SessionWithdrawalPreparation) {
  const p = await verifySessionWithdrawalPreparation(value);
  sqliteJournalTransaction(db, () => {
    const proof = readSqliteSessionGrantConsent(db, p.ownerAddr, p.grantEpoch, ARC_MAINNET_PROFILE);
    if (!proof || canonicalJson(proof) !== canonicalJson(p.authorization)) throw new Error("Retained recovery proof unavailable");
    const existing = db.prepare("SELECT data FROM session_withdrawal_preparations WHERE request_id=?").get(p.requestId);
    if (existing) {
      if (existing.data !== canonicalJson(p) || sqliteSessionWithdrawalPhase(db, p.requestId) === "cancelled_unexposed")
        throw new Error("Original withdrawal conflict"); return;
    }
    const now = sqliteSessionWithdrawalAccounting(db, p.sessAddr);
    if (now.heldPaymentMicroUsdc !== p.balance.heldPaymentMicroUsdc || now.heldWithdrawalMicroUsdc !== p.balance.heldWithdrawalMicroUsdc ||
      now.confirmedSpentMicroUsdc !== p.balance.confirmedSpentMicroUsdc)
      throw new Error("Withdrawal accounting changed");
    db.prepare("INSERT INTO session_withdrawal_preparations(request_id,recovery_owner,signer,grant_epoch,data) VALUES(?,?,?,?,?)")
      .run(p.requestId, p.ownerAddr, p.sessAddr, p.grantEpoch, canonicalJson(p));
    // Pause future payment authority atomically; retained epochs/caps/nonces remain.
    db.prepare("UPDATE session_grants SET expiry=0 WHERE lower(sess_addr)=?").run(p.sessAddr);
  });
  return (await readSqliteSessionWithdrawal(db, p.requestId, p.ownerAddr))!;
}
export async function readSqliteSessionWithdrawal(db: DatabaseSync, id: string, owner: string) {
  if (!/^0x[0-9a-f]{64}$/.test(id) || !/^0x[0-9a-f]{40}$/.test(owner)) throw new Error("Original withdrawal selector refused");
  const row = db.prepare("SELECT data FROM session_withdrawal_preparations WHERE request_id=? AND recovery_owner=?").get(id, owner);
  return row ? verifySessionWithdrawalPreparation(JSON.parse(String(row.data))) : null;
}
export async function pendingSqliteSessionWithdrawal(db: DatabaseSync, owner: string, signer: string) {
  if (!/^0x[0-9a-f]{40}$/.test(owner) || !/^0x[0-9a-f]{40}$/.test(signer)) throw new Error("Original withdrawal selector refused");
  const row = db.prepare(`SELECT w.request_id FROM session_withdrawal_preparations w
    LEFT JOIN session_withdrawal_completions c USING(request_id)
    WHERE w.recovery_owner=? AND w.signer=? AND c.request_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=w.request_id)`).get(owner, signer);
  return row ? readSqliteSessionWithdrawal(db, String(row.request_id), owner) : null;
}
export async function readSqliteSessionWithdrawalCompletion(db: DatabaseSync, id: string, owner: string) {
  const original = await readSqliteSessionWithdrawal(db, id, owner);
  if (!original) return null;
  const row = db.prepare("SELECT data FROM session_withdrawal_completions WHERE request_id=?").get(id);
  return row ? verifySessionWithdrawalCompletion(JSON.parse(String(row.data)), original) : null;
}
function sqliteSessionWithdrawalPhase(db: DatabaseSync, id: string): SessionWithdrawalSigningPhase {
  if (db.prepare("SELECT 1 FROM session_withdrawal_cancellations WHERE request_id=?").get(id)) return "cancelled_unexposed";
  if (db.prepare("SELECT 1 FROM session_withdrawal_completions WHERE request_id=?").get(id)) return "completed";
  return db.prepare("SELECT 1 FROM session_withdrawal_exposures WHERE request_id=?").get(id) ? "exposed" : "prepared";
}
export async function readSqliteSessionWithdrawalPhase(db: DatabaseSync, id: string, owner: string) {
  return await readSqliteSessionWithdrawal(db, id, owner) ? sqliteSessionWithdrawalPhase(db, id) : null;
}
/** The normal worker must acquire this durable marker before ANY crypto. A lost
 * response is conservative exposure; read/recovery never grants a second burn. */
export async function exposeSqliteSessionWithdrawal(db: DatabaseSync, id: string, owner: string) {
  const p = await readSqliteSessionWithdrawal(db, id, owner); if (!p) return null;
  sqliteJournalTransaction(db, () => {
    const phase = sqliteSessionWithdrawalPhase(db, id);
    if (phase === "cancelled_unexposed" || phase === "completed") throw new Error("Original signing authority unavailable");
    db.prepare("INSERT INTO session_withdrawal_exposures(request_id) VALUES(?) ON CONFLICT DO NOTHING").run(id);
  });
  return p;
}
export async function cancelSqliteSessionWithdrawal(db: DatabaseSync, id: string, owner: string) {
  const p = await readSqliteSessionWithdrawal(db, id, owner); if (!p) return null;
  sqliteJournalTransaction(db, () => {
    const phase = sqliteSessionWithdrawalPhase(db, id);
    if (!["prepared", "cancelled_unexposed"].includes(phase)) throw new Error("Exposed withdrawal cannot cancel");
    db.prepare("INSERT INTO session_withdrawal_cancellations(request_id) VALUES(?) ON CONFLICT DO NOTHING").run(id);
  });
  return sessionWithdrawalCancellationSchema.parse({ format: "keryx-session-withdrawal-cancellation-v1", network: p.network,
    requestId: id, ownerAddr: owner, sessAddr: p.sessAddr, reason: "cancelled-unexposed" });
}
export async function completeSqliteSessionWithdrawal(db: DatabaseSync, id: string, owner: string, outcome: SessionWithdrawalCompletion) {
  const p = await readSqliteSessionWithdrawal(db, id, owner);
  if (!p) throw new Error("Original withdrawal completion unavailable");
  const c = await verifySessionWithdrawalCompletion(outcome, p);
  sqliteJournalTransaction(db, () => {
    const record = db.prepare("SELECT data FROM creator_withdrawal_requests WHERE id=? AND owner=?").get(id, p.sessAddr);
    const attestation = db.prepare("SELECT data FROM creator_withdrawal_attestations WHERE id=?").get(id);
    if (!record || canonicalJson(JSON.parse(String(record.data))) !== canonicalJson(c.record) || !attestation ||
      canonicalJson(JSON.parse(String(attestation.data))) !== canonicalJson(c.attestation)) throw new Error("Original mint authority unavailable");
    db.prepare("INSERT INTO session_withdrawal_completions(request_id,data) VALUES(?,?) ON CONFLICT(request_id) DO NOTHING").run(id, canonicalJson(c));
    const saved = db.prepare("SELECT data FROM session_withdrawal_completions WHERE request_id=?").get(id);
    if (!saved || String(saved.data) !== canonicalJson(c)) throw new Error("Original mint completion conflict");
    // The pending barrier is now false. Signed payment totals and original burn
    // history stay retained; only a new owner-approved grant can resume payment.
  });
  return (await readSqliteSessionWithdrawalCompletion(db, id, owner))!;
}
export function listSqliteSessionWithdrawalPayments(db: DatabaseSync, signer: string, afterNonce = "", limit = 64) {
  if (!/^0x[0-9a-f]{40}$/.test(signer) || (afterNonce && !/^0x[0-9a-f]{64}$/.test(afterNonce)) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Withdrawal payment history unavailable");
  const rows = db.prepare(`SELECT nonce,session_id,request_id FROM browser_authorization_intents WHERE lower(signer)=?
    AND network='eip155:5042' AND nonce>? ORDER BY nonce LIMIT ?`).all(signer, afterNonce, limit + 1);
  const payments = rows.slice(0, limit).map(row => {
    const j = getSqliteBrowserJournal(db, String(row.session_id), String(row.request_id));
    if (!j || j.signer.toLowerCase() !== signer || j.nonce !== row.nonce) throw new Error("Original liability unavailable");
    return j;
  });
  return { payments, nextCursor: rows.length > limit ? payments.at(-1)!.nonce : null };
}
