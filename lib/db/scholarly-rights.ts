import type { DatabaseSync } from "node:sqlite";
import { hasScholarlyRights, assertNoOrphanedPaperMarker } from "./scholarly-capability";
export { hasScholarlyRights } from "./scholarly-capability";
import type { KeryxDB } from "./keryx-db";
import type { BrowserJournalAdmission, BrowserAuthorizationJournal } from "./browser-authorization-journal";
import { admitSqliteBrowserJournal } from "./sqlite-browser-journal";
import { canonicalJson } from "../canonical-json";
import { config } from "../config";
import { assertPaperDates, assertPaperManifest, assertPaperRegistry, assertPaperVersion, paperArtifactId,
  verifyPaperDeclaration, verifyPaperDecision, verifyRetainedPaperState } from "../scholarly/rights-authority";
import { signedPaperDeclarationSchema, signedPaperDecisionSchema, type PaperState,
  type SignedPaperDeclaration, type SignedPaperDecision } from "../scholarly/rights-protocol";

export const SCHOLARLY_RIGHTS_SQL = `
CREATE TABLE IF NOT EXISTS scholarly_enrollments(source_id TEXT PRIMARY KEY, creator TEXT NOT NULL, enrolled_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scholarly_declarations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES scholarly_enrollments(source_id),nonce TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(source_id,nonce));
CREATE TABLE IF NOT EXISTS scholarly_decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES scholarly_enrollments(source_id),declaration_id TEXT NOT NULL REFERENCES scholarly_declarations(id),
  nonce TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(source_id,nonce));
CREATE TABLE IF NOT EXISTS scholarly_admissions(nonce TEXT PRIMARY KEY REFERENCES browser_authorization_intents(nonce),
  source_id TEXT NOT NULL,declaration_id TEXT NOT NULL,decision_id TEXT NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scholarly_writer(id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER IF NOT EXISTS scholarly_intent_fence BEFORE INSERT ON browser_authorization_intents
  WHEN EXISTS(SELECT 1 FROM scholarly_enrollments WHERE source_id=NEW.source_id)
    AND NOT EXISTS(SELECT 1 FROM scholarly_writer)
  BEGIN SELECT RAISE(ABORT,'scholarly admission required'); END;
`;
export function installScholarlyRights(db: DatabaseSync): void {
  if (!db.prepare("PRAGMA table_info(sources)").all().some(row => row.name === "scholarly_enrolled"))
    db.exec("ALTER TABLE sources ADD COLUMN scholarly_enrolled INTEGER NOT NULL DEFAULT 0 CHECK(scholarly_enrolled IN(0,1))");
  for (const column of ["scholarly_declaration_id", "scholarly_approval_id"])
    if (!db.prepare("PRAGMA table_info(payment_events)").all().some(row => row.name === column))
      db.exec(`ALTER TABLE payment_events ADD COLUMN ${column} TEXT`);
  db.exec(SCHOLARLY_RIGHTS_SQL);
  db.exec(`CREATE TRIGGER IF NOT EXISTS scholarly_source_mark AFTER INSERT ON scholarly_enrollments
    BEGIN UPDATE sources SET scholarly_enrolled=1 WHERE id=NEW.source_id; END;
    CREATE TRIGGER IF NOT EXISTS scholarly_source_reinsert AFTER INSERT ON sources
    WHEN EXISTS(SELECT 1 FROM scholarly_enrollments WHERE source_id=NEW.id)
    BEGIN UPDATE sources SET scholarly_enrolled=1 WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS scholarly_source_sticky BEFORE UPDATE OF scholarly_enrolled ON sources
    WHEN OLD.scholarly_enrolled=1 AND NEW.scholarly_enrolled<>1 BEGIN SELECT RAISE(ABORT,'scholarly enrollment is retained'); END;
    CREATE TRIGGER IF NOT EXISTS scholarly_source_delete BEFORE DELETE ON sources
    WHEN OLD.scholarly_enrolled=1 BEGIN SELECT RAISE(ABORT,'scholarly source is retained'); END;`);
  for (const table of ["scholarly_enrollments", "scholarly_declarations", "scholarly_decisions", "scholarly_admissions"]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'scholarly history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'scholarly enrollment and history are retained'); END;`);
  }
}
function catalogSnapshot(db: DatabaseSync, sourceId: string) {
  return canonicalJson({ source: db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId),
    items: db.prepare("SELECT * FROM source_items WHERE source_id=? ORDER BY id").all(sourceId) });
}
function transaction<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) throw new Error("Scholarly operation requires its own transaction");
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function getSqlitePaperState(db: DatabaseSync, sourceId: string): PaperState | null {
  if (!hasScholarlyRights(db)) {
    assertNoOrphanedPaperMarker(db, sourceId);
    return null;
  }
  if (!db.prepare("SELECT 1 FROM scholarly_enrollments WHERE source_id=?").get(sourceId)) return null;
  const row = db.prepare("SELECT id,data FROM scholarly_declarations WHERE source_id=? ORDER BY seq DESC LIMIT 1").get(sourceId);
  if (!row) return null; // Sticky source marker represents a draft; it never grants legacy earning.
  const review = db.prepare("SELECT id,data,declaration_id FROM scholarly_decisions WHERE source_id=? ORDER BY seq DESC LIMIT 1").get(sourceId);
  return { sourceId, declarationId: String(row.id), submission: signedPaperDeclarationSchema.parse(JSON.parse(String(row.data))),
    decisionId: review ? String(review.id) : null,
    review: review ? signedPaperDecisionSchema.parse(JSON.parse(String(review.data))) : null };
}
export function beginSqlitePaper(db: DatabaseSync, sourceId: string, creator: string): void {
  transaction(db, () => {
    if (!db.prepare("SELECT 1 FROM sources WHERE id=?").get(sourceId)) throw new Error("Source disappeared before enrollment");
    installScholarlyRights(db);
    const existing = db.prepare("SELECT creator FROM scholarly_enrollments WHERE source_id=?").get(sourceId);
    if (existing) { if (existing.creator !== creator.toLowerCase()) throw new Error("Scholarly creator differs"); return; }
    db.prepare("INSERT INTO scholarly_enrollments VALUES(?,?,?)").run(sourceId, creator.toLowerCase(), new Date().toISOString());
  });
}
export function approvedPaperState(state: PaperState): void {
  if (!state.review || state.review.decision.outcome !== "approved"
    || state.review.decision.declarationId !== state.declarationId) throw new Error("Scholarly rights are awaiting approval or unavailable");
  assertPaperDates(state.submission.declaration);
}
export async function submitSqlitePaper(db: DatabaseSync, catalog: KeryxDB, value: SignedPaperDeclaration): Promise<PaperState> {
  const submission = await verifyPaperDeclaration(value), d = submission.declaration;
  const before = catalogSnapshot(db, d.sourceId);
  const source = await catalog.getSource(d.sourceId);
  if (!source) throw new Error("Source not found");
  const items = await catalog.getItems(source.id);
  assertPaperVersion(d, source, items);
  await assertPaperManifest(d, items[0]);
  await assertPaperRegistry(d, source);
  const id = paperArtifactId(submission);
  return transaction(db, () => {
    if (before !== catalogSnapshot(db, d.sourceId)) throw new Error("Source changed during rights submission");
    installScholarlyRights(db);
    const enrolled = db.prepare("SELECT creator FROM scholarly_enrollments WHERE source_id=?").get(source.id);
    if (enrolled && enrolled.creator !== d.creator) throw new Error("Scholarly creator cannot change without independent migration review");
    const existing = db.prepare("SELECT id FROM scholarly_declarations WHERE source_id=? AND nonce=?").get(source.id, d.nonce);
    if (existing && existing.id !== id) throw new Error("Declaration operation ID was reused with different data");
    if (!existing) {
      db.prepare("INSERT OR IGNORE INTO scholarly_enrollments VALUES(?,?,?)").run(source.id, d.creator, new Date().toISOString());
      db.prepare("INSERT INTO scholarly_declarations(id,source_id,nonce,data) VALUES(?,?,?,?)").run(id, source.id, d.nonce, canonicalJson(submission));
      // Enrollment is sticky before returning; caches do not bypass the rights gate.
      db.prepare("DELETE FROM cache_items WHERE source_id=?").run(source.id);
    }
    return getSqlitePaperState(db, source.id)!;
  });
}
export async function reviewSqlitePaper(db: DatabaseSync, catalog: KeryxDB, value: SignedPaperDecision): Promise<PaperState> {
  const parsed = signedPaperDecisionSchema.parse(value);
  const declaration = db.prepare("SELECT source_id,data FROM scholarly_declarations WHERE id=?").get(parsed.decision.declarationId);
  if (!declaration) throw new Error("Declaration not found");
  const submitted = signedPaperDeclarationSchema.parse(JSON.parse(String(declaration.data)));
  const id = paperArtifactId(parsed);
  const accepted = db.prepare("SELECT id FROM scholarly_decisions WHERE source_id=? AND nonce=?").get(String(declaration.source_id), parsed.decision.nonce);
  if (accepted) {
    if (accepted.id !== id) throw new Error("Review operation ID was reused");
    // Exact already accepted artifact is a read-only replay; expiry cannot undo persisted history.
    return getSqlitePaperState(db, String(declaration.source_id))!;
  }
  const before = catalogSnapshot(db, String(declaration.source_id));
  const reviewed = await verifyPaperDecision(parsed, submitted.declaration.creator);
  if (reviewed.decision.outcome === "approved") {
    const source = await catalog.getSource(String(declaration.source_id));
    if (!source) throw new Error("Source not found");
    const items = await catalog.getItems(source.id);
    assertPaperVersion(submitted.declaration, source, items);
    await assertPaperManifest(submitted.declaration, items[0]);
    assertPaperDates(submitted.declaration);
    await assertPaperRegistry(submitted.declaration, source);
  }
  return transaction(db, () => {
    if (reviewed.decision.outcome === "approved" && before !== catalogSnapshot(db, String(declaration.source_id)))
      throw new Error("Source changed during rights review");
    const state = getSqlitePaperState(db, String(declaration.source_id))!;
    const same = db.prepare("SELECT id FROM scholarly_decisions WHERE source_id=? AND nonce=?").get(state.sourceId, reviewed.decision.nonce);
    if (same) { if (same.id !== id) throw new Error("Review operation ID was reused"); return state; }
    if (state.declarationId !== reviewed.decision.declarationId || state.decisionId !== reviewed.decision.previousDecisionId)
      throw new Error("Review was based on superseded rights history; sign a fresh decision");
    if (state.review?.decision.outcome === "revoked" && state.review.decision.declarationId === state.declarationId && reviewed.decision.outcome === "approved")
      throw new Error("Revoked rights require a new creator declaration and independent review");
    if (reviewed.decision.outcome === "approved") {
      // Only independently approved, current, effective versions consume the bounded RPC corpus.
      // Untrusted draft enrollment cannot occupy these four reviewer-controlled slots.
      const approved = db.prepare(`SELECT d.data FROM scholarly_decisions r JOIN scholarly_declarations d ON d.id=r.declaration_id
        WHERE r.source_id<>? AND r.seq=(SELECT MAX(x.seq) FROM scholarly_decisions x WHERE x.source_id=r.source_id)
          AND d.seq=(SELECT MAX(x.seq) FROM scholarly_declarations x WHERE x.source_id=d.source_id)
          AND json_extract(r.data,'$.decision.outcome')='approved'
          AND julianday(json_extract(d.data,'$.declaration.effectiveAt'))<=julianday('now')
          AND julianday(json_extract(d.data,'$.declaration.embargoUntil'))<=julianday('now')
          AND julianday(json_extract(d.data,'$.declaration.expiresAt'))>julianday('now')`).all(state.sourceId);
      const target = submitted.declaration;
      for (const row of approved) {
        const other = signedPaperDeclarationSchema.parse(JSON.parse(String(row.data))).declaration;
        if (other.bodyHash === target.bodyHash || other.canonicalUrl === target.canonicalUrl
          || target.doi && other.doi.toLowerCase() === target.doi.toLowerCase())
          throw new Error("Another effective approved offer has the same body, location or DOI; reviewer must resolve duplicate versions before approval");
      }
      if (approved.length >= 4) throw new Error("Supervised pilot permits at most four currently effective approved sources; suspend one before admitting another");
    }
    db.prepare("INSERT INTO scholarly_decisions(id,source_id,declaration_id,nonce,data) VALUES(?,?,?,?,?)")
      .run(id, state.sourceId, state.declarationId, reviewed.decision.nonce, canonicalJson(reviewed));
    return getSqlitePaperState(db, state.sourceId)!;
  });
}
export interface PaperAdmission {
  nonce: string; sourceId: string; declarationId: string; decisionId: string;
  payer: string; payee: string; amountMicros: number; kind: "fetch" | "citation";
  itemId: string; contentVersion: string; bodyHash: string; manifestId: string;
  registry: string; onchainId: string; creator: string; priceMicros: string;
}
export function getSqlitePaperAdmission(db: DatabaseSync, nonce: string): PaperAdmission | null {
  if (!hasScholarlyRights(db)) return null;
  const row = db.prepare(`SELECT s.snapshot,b.signer,b.payee,b.amount_micro_usdc,b.source_id,b.kind,p.authorization_phase
    FROM scholarly_admissions s JOIN browser_authorization_intents b ON b.nonce=s.nonce
    JOIN payment_events p ON p.authorization_id=b.nonce AND lower(p.payer)=lower(b.signer) WHERE s.nonce=?`).get(nonce);
  if (!row || !["exposed", "signed", "submission_attempted", "settled"].includes(String(row.authorization_phase))) return null;
  const snapshot = JSON.parse(String(row.snapshot)) as PaperAdmission;
  if (snapshot.nonce !== nonce || snapshot.payer !== String(row.signer).toLowerCase() || snapshot.payee !== String(row.payee).toLowerCase()
    || snapshot.sourceId !== row.source_id || snapshot.amountMicros !== row.amount_micro_usdc || snapshot.kind !== row.kind)
    throw new Error("Scholarly admission does not match the original browser intent");
  return snapshot;
}
export async function admitSqlitePaperJournal(db: DatabaseSync, catalog: KeryxDB, input: BrowserJournalAdmission) {
  const state = getSqlitePaperState(db, input.sourceId);
  if (!state) return admitSqliteBrowserJournal(db, input);
  approvedPaperState(state);
  await verifyRetainedPaperState(state);
  const d = state.submission.declaration, started = performance.now();
  const source = await catalog.getSource(input.sourceId);
  if (!source) throw new Error("Source not found");
  const before = catalogSnapshot(db, source.id);
  const items = await catalog.getItems(source.id);
  assertPaperVersion(d, source, items);
  await assertPaperManifest(d, items[0]);
  await assertPaperRegistry(d, source);
  if (input.payee.toLowerCase() !== d.recipient || input.payment.itemId !== d.itemId
    || input.payment.contentVersion !== d.contentVersion || input.offerId !== null
    || input.network !== d.network || input.token.toLowerCase() !== "0x3600000000000000000000000000000000000000"
    || (input.kind === "citation" && input.amountMicroUsdc > Math.round(config.maxCitationUsdc * 1e6))
    || (input.kind === "fetch" && input.amountMicroUsdc.toString() !== d.priceMicros))
    throw new Error("Scholarly payment differs from the reviewed exact version and terms");
  return admitSqliteBrowserJournal(db, input, {
    before() {
      const current = getSqlitePaperState(db, input.sourceId)!;
      approvedPaperState(current);
      if (current.declarationId !== state.declarationId || current.decisionId !== state.decisionId
        || performance.now() - started > 5000
        || before !== catalogSnapshot(db, source.id))
        throw new Error("Scholarly authority changed before atomic admission");
      db.prepare("INSERT INTO scholarly_writer VALUES(1)").run();
    },
    after(journal: BrowserAuthorizationJournal) {
      const snapshot: PaperAdmission = { nonce: journal.nonce, sourceId: source.id,
        declarationId: state.declarationId, decisionId: state.decisionId!, payer: journal.signer.toLowerCase(), payee: d.recipient,
        amountMicros: input.amountMicroUsdc, kind: input.kind, itemId: d.itemId, contentVersion: d.contentVersion,
        bodyHash: d.bodyHash, manifestId: d.manifestId, registry: d.registry, onchainId: d.onchainId, creator: d.creator, priceMicros: d.priceMicros };
      db.prepare("INSERT INTO scholarly_admissions VALUES(?,?,?,?,?)").run(journal.nonce, source.id, state.declarationId, state.decisionId!, canonicalJson(snapshot));
      journal.payment.scholarlyDeclarationId = state.declarationId;
      journal.payment.scholarlyApprovalId = state.decisionId!;
      db.prepare("UPDATE payment_events SET scholarly_declaration_id=?,scholarly_approval_id=? WHERE authorization_id=?")
        .run(state.declarationId, state.decisionId!, journal.nonce);
      db.prepare("UPDATE browser_journal_bindings SET payment_metadata=? WHERE nonce=?")
        .run(JSON.stringify(journal.payment), journal.nonce);
    },
    cleanup() { db.prepare("DELETE FROM scholarly_writer").run(); },
  });
}
