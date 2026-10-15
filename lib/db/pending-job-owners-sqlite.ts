import type { DatabaseSync } from "node:sqlite";
import { retainedPendingOwnerSession, pendingOwnerSettlementSession, type PendingOwnerSessionProof } from "../a2a/pending-owner-session";
import type { A2aOrder } from "../a2a/order";
import { accountHistoryItem } from "../a2a/account-history";
import { PendingOwnerAdmissionError } from "../a2a/pending-owner-association";
import { retainedRecoveryMatches } from "../a2a/overdue-escalation-queue";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy,
  assertVerifiedSqliteSelectedApplicationPolicy,
} from "./storage-identity-connection";

const unavailable = () => new PendingOwnerAdmissionError("owner_association_unavailable");
const contention = (error: unknown) => error instanceof Error && "code" in error
  && error.code === "ERR_SQLITE_ERROR" && "errcode" in error && (error.errcode === 5 || error.errcode === 6);

/** Native selected-store metadata reader. No DDL, writer or ordinary fallback. */
export interface PendingJobOwnersStore {
  /** Synchronous fresh durable-session check at the existing financial hook. */
  assertAdmission(proof: PendingOwnerSessionProof): void;
  list(proof: PendingOwnerSessionProof, before?: { createdAt: string; id: string }, id?: string): Promise<OwnedPendingJob[]>;
}
export type OwnedPendingJob = ReturnType<typeof accountHistoryItem> & { attention: "needs_review" | "unknown"; recoveryState: "held" | "unknown" };

/** Must be invoked inside the original producer's synchronous transaction. */
export function assertPendingOwnerSessionRow(db: DatabaseSync, row: { hash: string; wallet: string; issuedAt: number; expiresAt: number; proofExpiresAt?: number }): void {
  if (!db.isTransaction) throw unavailable();
  const stored = db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash=?").get(row.hash);
  const now = Date.now();
  if (!stored || stored.hash !== row.hash || stored.wallet !== row.wallet || stored.issued_at !== row.issuedAt
    || stored.expires_at !== row.expiresAt || row.issuedAt > now || row.expiresAt <= now || row.proofExpiresAt !== undefined && row.proofExpiresAt <= now)
    throw new PendingOwnerAdmissionError("session_unavailable");
}

export function createEnrolledSqlitePendingJobOwners(db: DatabaseSync): PendingJobOwnersStore | undefined {
  if (arguments.length !== 1) throw unavailable();
  // Fake/ordinary values must never have their SQL or close methods invoked.
  let identity: ReturnType<typeof assertVerifiedSqliteConnection>;
  try { assertVerifiedSqliteSelectedApplicationPolicy(db); } catch { throw unavailable(); }
  try { identity = assertVerifiedSqliteConnection(db); } catch (error) {
    if (contention(error)) throw error;
    try { db.close(); } catch { /* revoked */ }
    throw unavailable();
  }
  let revoked = false;
  const revoke = () => { revoked = true; try { db.close(); } catch { /* latched */ } };
  const check = () => {
    if (revoked) throw unavailable();
    assertVerifiedSqliteNativeUserDomainPolicy(db);
    const current = assertVerifiedSqliteConnection(db);
    if (current.authorityMode !== "mainnet-real") throw unavailable();
  };
  try {
    if (identity.authorityMode !== "mainnet-real") throw unavailable();
    // Exact original profile leaves the port absent. Full native opening has
    // already admitted one of the fixed four source profiles.
    const exists = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pending_job_owners'").get();
    if (!exists) return undefined;
    check();
  } catch (error) {
    if (contention(error)) throw error;
    revoke();
    throw unavailable();
  }
  return Object.freeze({ assertAdmission(proof: PendingOwnerSessionProof) {
    let session: ReturnType<typeof pendingOwnerSettlementSession>;
    try { session = pendingOwnerSettlementSession(proof, identity); }
    catch (error) { if (!(error instanceof PendingOwnerAdmissionError)) revoke(); throw error; }
    let started = false, committing = false;
    try {
      check(); db.exec("BEGIN"); started = true; check(); assertPendingOwnerSessionRow(db, session);
      check(); committing = true; db.exec("COMMIT"); started = false; check();
    } catch (error) {
      if (committing || !contention(error)) {
        revoke(); throw unavailable();
      }
      if (started) { try { db.exec("ROLLBACK"); check(); } catch { revoke(); throw unavailable(); } }
      throw error;
    }
  }, async list(proof: PendingOwnerSessionProof, before?: { createdAt: string; id: string }, id?: string) {
    // Refuse forged proofs before acquiring a transaction; they do not retire
    // a healthy reader. Schema/runtime faults do.
    let session: ReturnType<typeof retainedPendingOwnerSession>;
    try { session = retainedPendingOwnerSession(proof, identity); }
    catch (error) { if (!(error instanceof PendingOwnerAdmissionError)) revoke(); throw error; }
    if (before && (!/^a2a_[a-f0-9]{64}$/.test(before.id) || !Number.isFinite(Date.parse(before.createdAt)))) throw unavailable();
    if (id !== undefined && !/^a2a_[a-f0-9]{64}$/.test(id)) throw unavailable();
    let started = false, committing = false;
    try {
      check(); db.exec("BEGIN"); started = true; check();
      assertPendingOwnerSessionRow(db, session);
      const rows = db.prepare(`SELECT o.id,o.query_id,o.status,o.created_at,o.updated_at,o.started_at,
        o.amount_usdc,o.creator_budget_usdc,o.service_fee_usdc,o.research_mode,
        CASE WHEN length(CAST(o.package_data AS BLOB))<=8192 THEN o.package_data ELSE NULL END AS package_data,
        CASE WHEN length(CAST(o.transaction_id AS BLOB))<=256 THEN o.transaction_id ELSE '' END AS transaction_id,
        o.execution_journal_version,o.payment_started_at,o.result_saving_at,o.error_code,
        CASE WHEN length(CAST(o.worker_id AS BLOB))<=256 THEN o.worker_id ELSE NULL END AS worker_id,
        CASE WHEN length(CAST(o.payee AS BLOB))=42 THEN o.payee ELSE NULL END AS payee
        FROM pending_job_owners p JOIN a2a_orders o ON o.id=p.job_id AND o.query_id=p.query_id
        AND o.request_hash=p.request_hash AND o.created_at=p.admitted_at
        WHERE p.wallet=? AND p.network=? AND o.status IN ('running','failed','completed')
        ${id ? "AND o.id=?" : ""}
        ${before ? "AND (o.created_at < ? OR (o.created_at=? AND o.id<?))" : ""}
        ORDER BY o.created_at DESC,o.id DESC LIMIT 26`).all(session.wallet, session.network, ...(id ? [id] : []),
          ...(before ? [before.createdAt, before.createdAt, before.id] : []));
      const observed = Date.now();
      // Only after genuine current session + immutable exact-original joins.
      let recovery: unknown = null;
      if (rows.some(r => r.status === "running" && r.worker_id && r.started_at)) {
        const fact = db.prepare("SELECT CASE WHEN length(CAST(value AS BLOB))<=2048 THEN value ELSE NULL END AS value FROM sync_state WHERE key='a2aWorker' LIMIT 1").get();
        try { recovery = typeof fact?.value === "string" ? JSON.parse(fact.value) : null; } catch { /* Unknown. */ }
      }
      const jobs: OwnedPendingJob[] = rows.map(r => {
        const original = { id: String(r.id), queryId: String(r.query_id),
        status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, startedAt: r.started_at,
        amountUsdc: r.amount_usdc, creatorBudgetUsdc: r.creator_budget_usdc, serviceFeeUsdc: r.service_fee_usdc,
        researchMode: r.research_mode, researchPackage: r.package_data === null ? null : JSON.parse(String(r.package_data)),
        executionJournalVersion: r.execution_journal_version, paymentStartedAt: r.payment_started_at,
        resultSavingAt: r.result_saving_at, errorCode: r.error_code,
        // No worker body, payer, nonce or receipt is selected to infer ownership.
        request: null, workerId: r.worker_id, payee: r.payee,
        transaction: String(r.transaction_id), response: null, resolution: null,
      } as A2aOrder;
        // The immutable join binds network; no worker request body is selected.
        const held = retainedRecoveryMatches({ ...original, request: { network: session.network } } as A2aOrder,
          recovery, typeof r.payee === "string" ? { network: session.network, payee: r.payee } : undefined, observed);
        const item = accountHistoryItem(original, observed, null, held);
        return { ...item, originalPayment: { ...item.originalPayment, network: session.network === "eip155:5042" ? "eip155:5042" as const : null },
          attention: r.status === "failed" || held ? "needs_review" : "unknown", recoveryState: held ? "held" : "unknown" };
      });
      retainedPendingOwnerSession(proof, identity); assertPendingOwnerSessionRow(db, session);
      check(); committing = true; db.exec("COMMIT"); started = false; check(); return jobs;
    } catch (error) {
      if (committing || !contention(error)) {
        revoke(); throw unavailable();
      }
      if (started) { try { db.exec("ROLLBACK"); check(); } catch { revoke(); throw unavailable(); } }
      throw error;
    }
  } });
}
