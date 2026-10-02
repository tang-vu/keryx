import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import type { ArcNetworkProfile } from "../arc-network-profile";
import { parseSessionGrantConsent, type SessionGrantConsent } from "../payments/session-grant-consent";
import { sqliteJournalTransaction, upsertSqliteJournalGrant, sqliteJournalActive } from "./sqlite-browser-journal";

export interface SessionGrantConsentRecord { consent: SessionGrantConsent; ownerSignature: string; sessionSignature: string }
export const SESSION_GRANT_CONSENTS_SQL = `CREATE TABLE session_grant_consents (
  grant_epoch TEXT PRIMARY KEY, owner_addr TEXT NOT NULL, sess_addr TEXT NOT NULL,
  consent TEXT NOT NULL CHECK(json_valid(consent)), issued_at INTEGER NOT NULL,
  challenge_expires_at INTEGER NOT NULL, consumed_at INTEGER, owner_signature TEXT, session_signature TEXT);
CREATE TRIGGER session_consent_retained BEFORE DELETE ON session_grant_consents
  BEGIN SELECT RAISE(ABORT,'session owner consent retained'); END;
CREATE TRIGGER session_consent_immutable BEFORE UPDATE ON session_grant_consents
  WHEN OLD.consumed_at IS NOT NULL OR NEW.grant_epoch IS NOT OLD.grant_epoch OR NEW.owner_addr IS NOT OLD.owner_addr
    OR NEW.sess_addr IS NOT OLD.sess_addr OR NEW.consent IS NOT OLD.consent OR NEW.issued_at IS NOT OLD.issued_at
    OR NEW.challenge_expires_at IS NOT OLD.challenge_expires_at OR NEW.consumed_at IS NULL OR NEW.owner_signature IS NULL OR NEW.session_signature IS NULL
    OR NOT EXISTS(SELECT 1 FROM browser_journal_writer WHERE id=1)
  BEGIN SELECT RAISE(ABORT,'session owner consent immutable'); END;`;
export class SessionConsentRefused extends Error { constructor() { super("Session owner consent unavailable or already consumed"); } }
export function issueSqliteSessionGrantConsent(db: DatabaseSync, input: SessionGrantConsent, profile: ArcNetworkProfile): void {
  const consent = parseSessionGrantConsent(input, profile), now = Date.now();
  if (!sqliteJournalActive(db) || Number(consent.expirySeconds) * 1000 <= now) throw new SessionConsentRefused();
  sqliteJournalTransaction(db, () => {
    db.prepare("INSERT INTO session_grant_consents VALUES(?,?,?,?,?,?,NULL,NULL,NULL)").run(consent.grantEpoch,
      consent.ownerAddr, consent.sessAddr, canonicalJson(consent), now, now + 90_000);
  });
}
/** Consumption and retained cumulative grant upsert share the same existing writer transaction. */
export function consumeSqliteSessionGrantConsent(db: DatabaseSync, input: SessionGrantConsent, signature: string,
  sessionSignature: string, profile: ArcNetworkProfile): void {
  const consent = parseSessionGrantConsent(input, profile), now = Date.now();
  if (!sqliteJournalActive(db) || !/^0x[0-9a-f]{130}$/i.test(signature) || !/^0x[0-9a-f]{130}$/i.test(sessionSignature) || Number(consent.expirySeconds) * 1000 <= now)
    throw new SessionConsentRefused();
  upsertSqliteJournalGrant(db, { sessionId: consent.ownerAddr, ownerAddr: consent.ownerAddr, sessAddr: consent.sessAddr,
    grantEpoch: consent.grantEpoch, cap: Number(consent.capMicroUsdc) / 1e6,
    expiry: Number(consent.expirySeconds) * 1000, txHash: "owner-signed-consent" }, () => {
    const result = db.prepare(`UPDATE session_grant_consents SET consumed_at=?,owner_signature=?,session_signature=?
      WHERE grant_epoch=? AND owner_addr=? AND sess_addr=? AND consent=? AND consumed_at IS NULL AND challenge_expires_at>?`)
      .run(now, signature, sessionSignature, consent.grantEpoch, consent.ownerAddr, consent.sessAddr, canonicalJson(consent), now);
    if (result.changes !== 1) throw new SessionConsentRefused();
  });
}
/** Historical owner proof remains available after active grant revocation/expiry for recovery. */
export function readSqliteSessionGrantConsent(db: DatabaseSync, owner: string, epoch: string,
  profile: ArcNetworkProfile): SessionGrantConsentRecord | null {
  const row = db.prepare("SELECT consent,owner_signature,session_signature FROM session_grant_consents WHERE owner_addr=? AND grant_epoch=? AND consumed_at IS NOT NULL")
    .get(owner, epoch);
  if (!row) return null;
  return { consent: parseSessionGrantConsent(JSON.parse(String(row.consent)), profile), ownerSignature: String(row.owner_signature), sessionSignature: String(row.session_signature) };
}
