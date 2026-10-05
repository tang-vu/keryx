import { verifyBrowserSigningHeader } from "../payments/browser-signing-original";
import { ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import type { DatabaseSync } from "node:sqlite";
import type { SessionGrantRecord } from "./keryx-db";
import { canonicalJson } from "../canonical-json";
import { assertSqliteSourceClaimPaymentPolicy } from "./public-source-claims";
import {
  BrowserGrantRecoveryRefused,
  prepareBrowserJournal,
  type BrowserAuthorizationJournal,
  type BrowserJournalAdmission,
  type BrowserJournalAdmissionResult,
  type BrowserSignedMetadata,
} from "./browser-authorization-journal";

export function initializeSqliteBrowserJournal(db: DatabaseSync): void {
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(payment_events)").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );
  if (!columns.has("authorization_phase"))
    db.exec("ALTER TABLE payment_events ADD COLUMN authorization_phase TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS browser_journal_control (id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL CHECK(active IN(0,1)));
    INSERT OR IGNORE INTO browser_journal_control VALUES(1,0);
    CREATE TABLE IF NOT EXISTS browser_journal_writer (id INTEGER PRIMARY KEY CHECK(id=1));
    CREATE TABLE IF NOT EXISTS browser_signer_capacity (signer TEXT PRIMARY KEY, spent_micro INTEGER NOT NULL CHECK(spent_micro>=0));
    CREATE TABLE IF NOT EXISTS browser_retained_grants (grant_epoch TEXT PRIMARY KEY, session_id TEXT NOT NULL, signer TEXT NOT NULL, spent_micro INTEGER NOT NULL CHECK(spent_micro>=0));
    CREATE TABLE IF NOT EXISTS browser_journal_bindings (
      nonce TEXT PRIMARY KEY REFERENCES browser_authorization_intents(nonce), requirements TEXT NOT NULL,
      payment_metadata TEXT NOT NULL, valid_after TEXT, valid_before TEXT, header_hash TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS browser_journal_payment_nonce ON payment_events(network,lower(payer),authorization_id)
      WHERE authorization_phase IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS browser_grant_insert_fence BEFORE INSERT ON session_grants
      WHEN (SELECT active FROM browser_journal_control WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
      BEGIN SELECT RAISE(ABORT,'browser journal writer required'); END;
    CREATE TRIGGER IF NOT EXISTS browser_grant_update_fence BEFORE UPDATE ON session_grants
      WHEN (SELECT active FROM browser_journal_control WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
      BEGIN SELECT RAISE(ABORT,'browser journal writer required'); END;
    CREATE TRIGGER IF NOT EXISTS browser_grant_delete_fence BEFORE DELETE ON session_grants
      WHEN (SELECT active FROM browser_journal_control WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
      BEGIN SELECT RAISE(ABORT,'browser journal writer required'); END;
    CREATE TRIGGER IF NOT EXISTS browser_payment_insert_fence BEFORE INSERT ON payment_events
      WHEN EXISTS(SELECT 1 FROM browser_journal_bindings WHERE nonce=NEW.authorization_id)
        AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
      BEGIN SELECT RAISE(ABORT,'browser journal payment already admitted'); END;
    CREATE TRIGGER IF NOT EXISTS browser_payment_update_fence BEFORE UPDATE ON payment_events
      WHEN OLD.authorization_phase IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
      BEGIN SELECT RAISE(ABORT,'browser journal writer required'); END;
    CREATE TRIGGER IF NOT EXISTS browser_payment_tuple_immutable BEFORE UPDATE ON payment_events
      WHEN OLD.authorization_phase IS NOT NULL AND (NEW.id IS NOT OLD.id OR NEW.authorization_id IS NOT OLD.authorization_id
        OR NEW.payer IS NOT OLD.payer OR NEW.payee IS NOT OLD.payee OR NEW.amount_usdc IS NOT OLD.amount_usdc
        OR NEW.network IS NOT OLD.network OR NEW.grant_epoch IS NOT OLD.grant_epoch OR NEW.source_id IS NOT OLD.source_id
        OR NEW.query_id IS NOT OLD.query_id OR NEW.offer_id IS NOT OLD.offer_id OR NEW.kind IS NOT OLD.kind)
      BEGIN SELECT RAISE(ABORT,'browser journal payment tuple is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS browser_payment_delete_fence BEFORE DELETE ON payment_events
      WHEN OLD.authorization_phase IS NOT NULL
      BEGIN SELECT RAISE(ABORT,'browser journal payment is retained'); END;`);
}

export function sqliteJournalActive(db: DatabaseSync): boolean {
  return (
    db.prepare("SELECT active FROM browser_journal_control WHERE id=1").get()
      ?.active === 1
  );
}

/** Capability is invisible to other connections; commit never leaves it enabled. */
export function sqliteJournalTransaction<T>(
  db: DatabaseSync,
  action: () => T
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("INSERT INTO browser_journal_writer VALUES(1)");
    const result = action();
    db.exec("DELETE FROM browser_journal_writer; COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already aborted */
    }
    throw error;
  }
}

function micro(value: number): number {
  const result = Math.round(value * 1e6);
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    Math.abs(value * 1e6 - result) >= 0.000001
  ) {
    throw new BrowserGrantRecoveryRefused();
  }
  return result;
}

export function activateSqliteBrowserJournal(db: DatabaseSync, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE): void {
  sqliteJournalTransaction(db, () => {
    if (sqliteJournalActive(db)) return;
    const epochs = new Map<
      string,
      {
        sessionId: string;
        signer: string;
        grantSpent: number;
        paymentSpent: number;
      }
    >();
    for (const g of db.prepare("SELECT * FROM session_grants").all()) {
      const spent = micro(Number(g.spent));
      micro(Number(g.cap));
      epochs.set(String(g.grant_epoch), {
        sessionId: String(g.session_id),
        signer: String(g.sess_addr).toLowerCase(),
        grantSpent: spent,
        paymentSpent: 0,
      });
    }
    for (const p of db
      .prepare(
        "SELECT * FROM payment_events WHERE grant_epoch IS NOT NULL AND settlement_status IN ('pending','settled')"
      )
      .all()) {
      if (
        p.network !== profile.networkId ||
        !/^0x[0-9a-f]{40}$/i.test(String(p.payer))
      )
        throw new BrowserGrantRecoveryRefused();
      const epoch = String(p.grant_epoch),
        signer = String(p.payer).toLowerCase();
      const held = epochs.get(epoch) ?? {
        sessionId: "legacy:" + epoch,
        signer,
        grantSpent: 0,
        paymentSpent: 0,
      };
      if (held.signer !== signer) throw new BrowserGrantRecoveryRefused();
      held.paymentSpent += micro(Number(p.amount_usdc));
      if (!Number.isSafeInteger(held.paymentSpent))
        throw new BrowserGrantRecoveryRefused();
      epochs.set(epoch, held);
    }
    for (const [epoch, g] of epochs) {
      const spent = Math.max(g.grantSpent, g.paymentSpent);
      db.prepare("INSERT INTO browser_retained_grants VALUES(?,?,?,?)").run(
        epoch,
        g.sessionId,
        g.signer,
        spent
      );
      db.prepare(
        `INSERT INTO browser_signer_capacity VALUES(?,?) ON CONFLICT(signer) DO UPDATE SET spent_micro=spent_micro+excluded.spent_micro`
      ).run(g.signer, spent);
    }
    for (const row of db
      .prepare("SELECT spent_micro FROM browser_signer_capacity")
      .all()) {
      if (!Number.isSafeInteger(Number(row.spent_micro)))
        throw new BrowserGrantRecoveryRefused();
    }
    db.exec(
      "UPDATE session_grants SET spent=(SELECT spent_micro/1000000.0 FROM browser_signer_capacity WHERE signer=lower(sess_addr))"
    );
    db.exec("UPDATE browser_journal_control SET active=1 WHERE id=1");
  });
}

export function upsertSqliteJournalGrant(
  db: DatabaseSync,
  grant: Omit<SessionGrantRecord, "spent">,
  before?: () => void
): void {
  sqliteJournalTransaction(db, () => {
    before?.();
    const signer = grant.sessAddr.toLowerCase(),
      cap = micro(grant.cap);
    const spent = Number(
      db
        .prepare(
          "SELECT spent_micro FROM browser_signer_capacity WHERE signer=?"
        )
        .get(signer)?.spent_micro ?? 0
    );
    if (spent > cap) throw new BrowserGrantRecoveryRefused();
    db.prepare("INSERT OR IGNORE INTO browser_signer_capacity VALUES(?,0)").run(
      signer
    );
    db.prepare("INSERT INTO browser_retained_grants VALUES(?,?,?,0)").run(
      grant.grantEpoch,
      grant.sessionId,
      signer
    );
    db.prepare(
      `INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET sess_addr=excluded.sess_addr,owner_addr=excluded.owner_addr,
      cap=excluded.cap,spent=excluded.spent,expiry=excluded.expiry,tx_hash=excluded.tx_hash,grant_epoch=excluded.grant_epoch`
    ).run(
      grant.sessionId,
      grant.sessAddr,
      grant.ownerAddr,
      grant.cap,
      spent / 1e6,
      grant.expiry,
      grant.txHash,
      grant.grantEpoch
    );
  });
}

export function getSqliteBrowserJournal(
  db: DatabaseSync,
  sessionId: string,
  requestId: string
): BrowserAuthorizationJournal | null {
  const row = db
    .prepare(
      `SELECT i.*,b.*,p.authorization_phase,p.settlement_status,p.tx_hash,p.authorization_expires_at
    FROM browser_authorization_intents i JOIN browser_journal_bindings b USING(nonce)
    JOIN payment_events p ON p.id='x402:'||i.nonce WHERE i.session_id=? AND i.request_id=?`
    )
    .get(sessionId, requestId);
  if (!row) return null;
  const payment = JSON.parse(String(row.payment_metadata));
  payment.authorizationPhase = row.authorization_phase;
  payment.settlementStatus = row.settlement_status;
  payment.settled = row.settlement_status === "settled";
  payment.txHash = row.tx_hash;
  if (row.authorization_expires_at)
    payment.authorizationExpiresAt = row.authorization_expires_at;
  return {
    nonce: String(row.nonce),
    admittedAt: String(row.created_at),
    sessionId,
    requestId,
    grantEpoch: String(row.grant_epoch),
    signer: String(row.signer),
    phase: row.authorization_phase as BrowserAuthorizationJournal["phase"],
    requirements: JSON.parse(String(row.requirements)),
    payment,
    ...(row.payment_context ? { paymentContext: JSON.parse(String(row.payment_context)) } : {}),
    signedValidAfter: row.valid_after as string | undefined,
    signedValidBefore: row.valid_before as string | undefined,
    signedHeaderHash: row.header_hash as string | undefined,
  };
}

export function admitSqliteBrowserJournal(
  db: DatabaseSync,
  input: BrowserJournalAdmission,
  hooks?: { before(): void; after(journal: BrowserAuthorizationJournal): void; cleanup(): void },
  profile: ArcNetworkProfile = ARC_TESTNET_PROFILE
): BrowserJournalAdmissionResult {
  const j = prepareBrowserJournal(input, profile);
  return sqliteJournalTransaction(db, () => {
    if (!sqliteJournalActive(db)) return { status: "inactive" };
    hooks?.before();
    try {
      const result = admitSqliteBrowserJournalInTransaction(db, input, j);
      if (result.status === "admitted" && j.paymentContext && db.prepare("PRAGMA table_info(browser_journal_bindings)").all().some(column => column.name === "payment_context")) {
        db.prepare("UPDATE browser_journal_bindings SET payment_context=? WHERE nonce=?")
          .run(JSON.stringify(j.paymentContext), j.nonce);
      }
      if (result.status === "admitted") hooks?.after(result.journal);
      return result;
    } finally { hooks?.cleanup(); }
  });
}

/** Shared atomic insertion; caller must hold the existing journal writer transaction. */
export function admitSqliteBrowserJournalInTransaction(db:DatabaseSync,input:BrowserJournalAdmission,j:BrowserAuthorizationJournal):BrowserJournalAdmissionResult {
    if (!db.isTransaction || !db.prepare("SELECT 1 FROM browser_journal_writer WHERE id=1").get()) throw new Error("Browser journal transaction required");
    if (!sqliteJournalActive(db)) return {status:"inactive"};
    const contextClaim = input.paymentContext?.sourceClaim ?? input.paymentContext?.item?.sourceClaim;
    if (input.paymentContext?.sourceClaim && input.paymentContext.item?.sourceClaim &&
      canonicalJson(input.paymentContext.sourceClaim) !== canonicalJson(input.paymentContext.item.sourceClaim))
      throw new Error("Browser journal source claim differs from original item context");
    if (canonicalJson(input.payment.sourceClaim ?? null) !== canonicalJson(contextClaim ?? null))
      throw new Error("Browser journal source claim differs from original payment context");
    assertSqliteSourceClaimPaymentPolicy(db, { sourceId: input.sourceId, expected: contextClaim,
      kind: input.kind, network: input.network });
    const signer = j.signer.toLowerCase();
    const g = db
      .prepare(
        "SELECT * FROM session_grants WHERE session_id=? AND grant_epoch=? AND lower(sess_addr)=? AND expiry>?"
      )
      .get(j.sessionId, j.grantEpoch, signer, Date.now());
    if (!g) return { status: "grant_or_cap_refused" };
    const spent = Number(
      db
        .prepare(
          "SELECT spent_micro FROM browser_signer_capacity WHERE signer=?"
        )
        .get(signer)?.spent_micro
    );
    if (
      !Number.isSafeInteger(spent) ||
      spent + input.amountMicroUsdc > micro(Number(g.cap))
    )
      return { status: "grant_or_cap_refused" };
    db.prepare(
      `INSERT INTO browser_authorization_intents(nonce,session_id,request_id,query_id,grant_epoch,signer,network,token,gateway_contract,source_id,offer_id,kind,payee,amount_micro_usdc,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      j.nonce,
      j.sessionId,
      j.requestId,
      input.queryId,
      j.grantEpoch,
      j.signer,
      input.network,
      input.token,
      input.gatewayContract,
      input.sourceId,
      input.offerId,
      input.kind,
      input.payee,
      input.amountMicroUsdc,
      j.payment.createdAt
    );
    db.prepare(
      "INSERT INTO browser_journal_bindings(nonce,requirements,payment_metadata) VALUES(?,?,?)"
    ).run(j.nonce, JSON.stringify(j.requirements), JSON.stringify(j.payment));
    const p = j.payment;
    db.prepare(
      `INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,network,settled,settlement_status,authorization_id,grant_epoch,origin,item_id,item_title,item_url,content_version,item_published_at,offer_id,list_price_usdc,authorization_phase)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,'pending',?,?,?,?,?,?,?,?,?,?,'prepared')`
    ).run(
      p.id!,
      p.createdAt,
      p.kind,
      p.queryId,
      p.sourceId,
      p.sourceName,
      p.payer,
      p.payee,
      p.amountUsdc,
      p.weight ?? null,
      p.rationale ?? null,
      p.network,
      j.nonce,
      j.grantEpoch,
      p.origin ?? "web",
      p.itemId ?? null,
      p.itemTitle ?? null,
      p.itemUrl ?? null,
      p.contentVersion ?? null,
      p.itemPublishedAt ?? null,
      p.offerId ?? null,
      p.listPriceUsdc ?? null
    );
    db.prepare(
      "UPDATE browser_signer_capacity SET spent_micro=spent_micro+? WHERE signer=?"
    ).run(input.amountMicroUsdc, signer);
    db.prepare(
      "UPDATE browser_retained_grants SET spent_micro=spent_micro+? WHERE grant_epoch=?"
    ).run(input.amountMicroUsdc, j.grantEpoch);
    db.prepare(
      "UPDATE session_grants SET spent=? WHERE lower(sess_addr)=?"
    ).run((spent + input.amountMicroUsdc) / 1e6, signer);
    return { status: "admitted", journal: j };
}

export function transitionSqliteBrowserJournal(
  db: DatabaseSync,
  sessionId: string,
  requestId: string,
  from: string,
  to: string
): boolean {
  return sqliteJournalTransaction(db, () => {
    const j = getSqliteBrowserJournal(db, sessionId, requestId);
    if (!j || j.phase !== from) return false;
    return (
      db
        .prepare(
          "UPDATE payment_events SET authorization_phase=? WHERE id=? AND authorization_phase=? AND settlement_status='pending'"
        )
        .run(to, j.payment.id!, from).changes === 1
    );
  });
}

export async function signSqliteBrowserCanonicalOriginal(db: DatabaseSync, sessionId: string, requestId: string, header: string): Promise<boolean> {
  const j = getSqliteBrowserJournal(db, sessionId, requestId);
  if (!j) return false;
  const row = db.prepare("SELECT original FROM browser_signing_originals WHERE nonce=?").get(j.nonce);
  if (!row) return false;
  const metadata = await verifyBrowserSigningHeader(JSON.parse(String(row.original)), header);
  return signSqliteBrowserJournalCore(db, sessionId, requestId, metadata, true);
}

export function signSqliteBrowserJournal(db: DatabaseSync, sessionId: string, requestId: string, m: BrowserSignedMetadata): boolean {
  return signSqliteBrowserJournalCore(db, sessionId, requestId, m, false);
}

function signSqliteBrowserJournalCore(
  db: DatabaseSync,
  sessionId: string,
  requestId: string,
  m: BrowserSignedMetadata,
  canonicalVerified: boolean
): boolean {
  return sqliteJournalTransaction(db, () => {
    const j = getSqliteBrowserJournal(db, sessionId, requestId);
    if (
      !j ||
      ![
        "exposed",
        "signed",
        "submission_attempted",
        "settled",
        "failed",
      ].includes(j.phase)
    )
      return false;
    const v2Installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_signing_originals'").get();
    if (v2Installed && db.prepare("SELECT 1 FROM browser_signing_originals WHERE nonce=?").get(j.nonce) && !canonicalVerified) return false;
    if (j.signedHeaderHash)
      return (
        j.signedHeaderHash === m.headerHash &&
        j.signedValidAfter === m.validAfter &&
        j.signedValidBefore === m.validBefore
      );
    if (j.phase !== "exposed") return false;
    const installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_signing_originals'").get();
    if (installed) {
      const row = db.prepare("SELECT original FROM browser_signing_originals WHERE nonce=?").get(j.nonce);
      if (row) {
        const original = JSON.parse(String(row.original));
        if (m.validAfter!==original.authorization.validAfter || m.validBefore!==original.authorization.validBefore) return false;
      }
    }
    const expiry = new Date(Number(m.validBefore) * 1000).toISOString();
    db.prepare(
      "UPDATE browser_journal_bindings SET valid_after=?,valid_before=?,header_hash=? WHERE nonce=? AND header_hash IS NULL"
    ).run(m.validAfter, m.validBefore, m.headerHash, j.nonce);
    return (
      db
        .prepare(
          "UPDATE payment_events SET authorization_phase='signed',authorization_expires_at=? WHERE id=? AND authorization_phase='exposed' AND settlement_status='pending'"
        )
        .run(expiry, j.payment.id!).changes === 1
    );
  });
}

export function releaseSqliteJournalCapacity(
  db: DatabaseSync,
  j: Pick<BrowserAuthorizationJournal, "signer" | "grantEpoch"> & {
    payment: { amountUsdc: number };
  }
): void {
  const amount = micro(j.payment.amountUsdc),
    signer = j.signer.toLowerCase();
  const released = db
    .prepare(
      "UPDATE browser_retained_grants SET spent_micro=spent_micro-? WHERE grant_epoch=? AND signer=? AND spent_micro>=?"
    )
    .run(amount, j.grantEpoch, signer, amount);
  if (released.changes !== 1)
    throw new Error("Retained grant capacity mismatch");
  const total = db
    .prepare(
      "UPDATE browser_signer_capacity SET spent_micro=spent_micro-? WHERE signer=? AND spent_micro>=?"
    )
    .run(amount, signer, amount);
  if (total.changes !== 1) throw new Error("Signer capacity mismatch");
  const spent = Number(
    db
      .prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?")
      .get(signer)!.spent_micro
  );
  db.prepare("UPDATE session_grants SET spent=? WHERE lower(sess_addr)=?").run(
    spent / 1e6,
    signer
  );
}

export function cancelSqlitePreparedJournal(
  db: DatabaseSync,
  sessionId: string,
  requestId: string
): boolean {
  return sqliteJournalTransaction(db, () => {
    const j = getSqliteBrowserJournal(db, sessionId, requestId);
    if (!j || j.phase !== "prepared") return false;
    const updated = db
      .prepare(
        "UPDATE payment_events SET authorization_phase='cancelled_unexposed',settlement_status='failed' WHERE id=? AND authorization_phase='prepared' AND settlement_status='pending'"
      )
      .run(j.payment.id!);
    if (updated.changes !== 1) return false;
    releaseSqliteJournalCapacity(db, j);
    return true;
  });
}

export function terminalSqliteJournalPayment(
  db: DatabaseSync,
  id: string,
  nonce: string,
  transferId: string,
  failed: boolean
): { resolved: boolean; reservationReleased: boolean } {
  return sqliteJournalTransaction(db, () => {
    const row = db
      .prepare(
        "SELECT i.session_id,i.request_id FROM browser_authorization_intents i JOIN browser_journal_bindings b USING(nonce) WHERE i.nonce=? AND 'x402:'||i.nonce=?"
      )
      .get(nonce, id);
    if (!row) {
      const p = db
        .prepare(
          "SELECT * FROM payment_events WHERE id=? AND authorization_id=? AND authorization_phase IS NULL AND settlement_status='pending'"
        )
        .get(id, nonce);
      if (!p) return { resolved: false, reservationReleased: false };
      db.prepare(
        "UPDATE payment_events SET settlement_status=?,settled=?,tx_hash=? WHERE id=? AND settlement_status='pending'"
      ).run(failed ? "failed" : "settled", failed ? 0 : 1, transferId, id);
      if (failed && p.grant_epoch)
        releaseSqliteJournalCapacity(db, {
          signer: String(p.payer),
          grantEpoch: String(p.grant_epoch),
          payment: { amountUsdc: Number(p.amount_usdc) },
        });
      return { resolved: true, reservationReleased: failed && !!p.grant_epoch };
    }
    const j = getSqliteBrowserJournal(
      db,
      String(row.session_id),
      String(row.request_id)
    );
    if (!j || !["exposed", "signed", "submission_attempted"].includes(j.phase))
      return { resolved: false, reservationReleased: false };
    const status = failed ? "failed" : "settled";
    const changed = db
      .prepare(
        "UPDATE payment_events SET authorization_phase=?,settlement_status=?,settled=?,tx_hash=? WHERE id=? AND authorization_id=? AND settlement_status='pending'"
      )
      .run(status, status, failed ? 0 : 1, transferId, id, nonce);
    if (changed.changes !== 1)
      return { resolved: false, reservationReleased: false };
    if (failed) releaseSqliteJournalCapacity(db, j);
    return { resolved: true, reservationReleased: failed };
  });
}
