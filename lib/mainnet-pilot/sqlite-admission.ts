import type { DatabaseSync } from "node:sqlite";
import type { BrowserJournalAdmission } from "../db/browser-authorization-journal";
import { sqliteJournalTransaction, getSqliteBrowserJournal, upsertSqliteJournalGrant } from "../db/sqlite-browser-journal";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { pilotGrantFieldsSchema, type PilotGrantFields } from "./public-enrollment";
import { pinPilotPolicy, type PilotPolicy } from "./policy";

const refused = (): never => { throw new Error("Pilot admission refused"); };

/** Uses the existing writer transaction; the pilot never publishes a second financial ledger. */
export function createPilotAdmissions(db: DatabaseSync, input: PilotPolicy) {
  const { policy, wire, digest } = pinPilotPolicy(input);
  function assertPolicy() {
    const row = db.prepare("SELECT digest,policy FROM mainnet_pilot_policy WHERE id=1").get();
    if (row?.digest !== digest || row.policy !== wire) refused();
  }
  sqliteJournalTransaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO mainnet_pilot_policy VALUES(1,?,?)").run(digest, wire);
    assertPolicy();
  });
  function admitQuery(queryId: string, owner: string, signer: string, grantEpoch: string, amountMicros: number): boolean {
    return sqliteJournalTransaction(db, () => {
      assertPolicy();
      if (!/^[0-9a-f-]{36}$/.test(queryId) || !policy.invitedBuyers.includes(owner) ||
          !/^0x[0-9a-f]{40}$/.test(signer) || policy.retainedTestnetSigners.includes(signer) ||
          !Number.isSafeInteger(amountMicros) || amountMicros <= 0 || amountMicros > policy.limits.perAskMicros) return false;
      const grant = db.prepare("SELECT * FROM session_grants WHERE session_id=? AND owner_addr=? AND lower(sess_addr)=? AND grant_epoch=? AND expiry>?")
        .get(owner, owner, signer, grantEpoch, Date.now());
      if (!grant) return false;
      // Allocations remain retained, including failed/interrupted/zero-spend asks. No inferred refund.
      const total = db.prepare("SELECT count(*) AS asks,COALESCE(sum(allocated_micro),0) AS allocated FROM mainnet_pilot_queries").get();
      const buyer = db.prepare("SELECT COALESCE(sum(allocated_micro),0) AS allocated FROM mainnet_pilot_queries WHERE owner=?").get(owner);
      if (!total || !buyer || Number(total.asks) >= policy.limits.maxAsks ||
          Number(total.allocated) + amountMicros > policy.limits.totalMicros ||
          Number(buyer.allocated) + amountMicros > policy.limits.perBuyerMicros ||
          db.prepare("SELECT 1 FROM mainnet_pilot_queries WHERE query_id=?").get(queryId)) return false;
      db.prepare("INSERT INTO mainnet_pilot_queries(query_id,owner,signer,grant_epoch,allocated_micro,created_at) VALUES(?,?,?,?,?,?)")
        .run(queryId, owner, signer, grantEpoch, amountMicros, new Date().toISOString());
      return true;
    });
  }
  function hooks(input: BrowserJournalAdmission) {
    return {
      before() {
        assertPolicy();
        const q = db.prepare("SELECT * FROM mainnet_pilot_queries WHERE query_id=? AND owner=? AND signer=? AND grant_epoch=?")
          .get(input.queryId, input.sessionId, input.signer.toLowerCase(), input.grantEpoch);
        if (!q || !policy.approvedSourceIds.includes(input.sourceId) || input.offerId !== null ||
            input.amountMicroUsdc > policy.limits.perPaymentMicros ||
            Number(q.spent_micro) + input.amountMicroUsdc > Number(q.allocated_micro)) refused();
      },
      after() {
        const changed = db.prepare("UPDATE mainnet_pilot_queries SET spent_micro=spent_micro+? WHERE query_id=? AND spent_micro+?<=allocated_micro")
          .run(input.amountMicroUsdc, input.queryId, input.amountMicroUsdc).changes;
        if (changed !== 1) refused();
      },
      cleanup() {},
    };
  }
  function journalByNonce(nonce: string) {
    if (!/^0x[0-9a-f]{64}$/i.test(nonce)) return null;
    const row = db.prepare("SELECT session_id,request_id FROM browser_authorization_intents WHERE nonce=?").get(nonce);
    return row ? getSqliteBrowserJournal(db, String(row.session_id), String(row.request_id)) : null;
  }
  function claimSettlement(nonce: string, headerHash: string): boolean {
    return sqliteJournalTransaction(db, () => {
      assertPolicy();
      const journal = journalByNonce(nonce);
      if (!journal || journal.phase !== "submission_attempted" || journal.signedHeaderHash !== headerHash) return false;
      return db.prepare("INSERT OR IGNORE INTO mainnet_pilot_settlement_attempts VALUES(?,?,?)")
        .run(nonce, headerHash, new Date().toISOString()).changes === 1;
    });
  }
  function issueGrant(owner: string, signer: string, fundedCapacityMicros: number): PilotGrantFields {
    return sqliteJournalTransaction(db, () => {
      assertPolicy();
      const now = Math.floor(Date.now() / 1000);
      if (!policy.invitedBuyers.includes(owner) || !/^0x[0-9a-f]{40}$/.test(signer) || signer === owner ||
          /^0x0{40}$/.test(signer) || policy.retainedTestnetSigners.includes(signer) ||
          !Number.isSafeInteger(fundedCapacityMicros) || fundedCapacityMicros <= 0 || now >= policy.expiresAtSeconds) refused();
      const cap = Math.min(fundedCapacityMicros, policy.limits.perBuyerMicros);
      if (Number(db.prepare("SELECT count(*) AS n FROM mainnet_pilot_grant_challenges").get()?.n) >= 1000) refused();
      if (Number(db.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer)?.spent_micro ?? 0) > cap) refused();
      const fields = pilotGrantFieldsSchema.parse({ owner, signer, grantEpoch: randomUUID(), capMicroUsdc: String(cap),
        expirySeconds: String(Math.min(policy.expiresAtSeconds, now + 3600)) });
      db.prepare("INSERT INTO mainnet_pilot_grant_challenges(epoch,fields,valid_until) VALUES(?,?,?)")
        .run(fields.grantEpoch, canonicalJson(fields), Date.now() + 90_000);
      return fields;
    });
  }
  function consumeGrant(fields: PilotGrantFields, tokenHash: string): void {
    const wire = canonicalJson(pilotGrantFieldsSchema.parse(fields));
    upsertSqliteJournalGrant(db, { sessionId: fields.owner, ownerAddr: fields.owner, sessAddr: fields.signer,
      grantEpoch: fields.grantEpoch, cap: Number(fields.capMicroUsdc) / 1e6, expiry: Number(fields.expirySeconds) * 1000,
      txHash: "owner-delegation" }, {
      before() {
        assertPolicy();
        const row = db.prepare("SELECT * FROM mainnet_pilot_grant_challenges WHERE epoch=?").get(fields.grantEpoch);
        if (!row || row.fields !== wire || row.consumed_at !== null || Number(row.valid_until) <= Date.now() ||
            Number(fields.expirySeconds) <= Math.floor(Date.now() / 1000) || !/^[0-9a-f]{64}$/.test(tokenHash)) refused();
      },
      after() {
        if (db.prepare("UPDATE mainnet_pilot_grant_challenges SET consumed_at=?,token_hash=? WHERE epoch=? AND consumed_at IS NULL")
          .run(Date.now(), tokenHash, fields.grantEpoch).changes !== 1) refused();
      },
    });
  }
  function readSession(tokenHash: string): PilotGrantFields | null {
    assertPolicy();
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
    const row = db.prepare("SELECT fields FROM mainnet_pilot_grant_challenges WHERE token_hash=? AND consumed_at IS NOT NULL").get(tokenHash);
    if (!row) return null;
    const fields = pilotGrantFieldsSchema.parse(JSON.parse(String(row.fields)));
    const grant = db.prepare("SELECT 1 FROM session_grants WHERE session_id=? AND owner_addr=? AND lower(sess_addr)=? AND grant_epoch=? AND expiry>?")
      .get(fields.owner, fields.owner, fields.signer, fields.grantEpoch, Date.now());
    return grant && Math.floor(Date.now() / 1000) < policy.expiresAtSeconds ? fields : null;
  }
  function revokeGrant(fields: PilotGrantFields): boolean {
    return sqliteJournalTransaction(db, () => {
      assertPolicy();
      // Authentication may precede a replacement by another process. Revoke only the captured generation.
      return db.prepare("DELETE FROM session_grants WHERE session_id=? AND owner_addr=? AND lower(sess_addr)=? AND grant_epoch=?")
        .run(fields.owner, fields.owner, fields.signer, fields.grantEpoch).changes === 1;
    });
  }
  return Object.freeze({ admitQuery, hooks, journalByNonce, claimSettlement, assertPolicy, issueGrant, consumeGrant, readSession, revokeGrant });
}
