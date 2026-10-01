import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import {
  verifyBrowserQueryPolicy,
  type BrowserQueryPolicyProof,
} from "../payments/browser-query-policy";
import { prepareBrowserSigningOriginal } from "../payments/browser-signing-original";
import { prepareBrowserJournal } from "./browser-authorization-journal";
import {
  admitSqliteBrowserJournalInTransaction,
  getSqliteBrowserJournal,
  signSqliteBrowserCanonicalOriginal,
  sqliteJournalActive,
  sqliteJournalTransaction,
} from "./sqlite-browser-journal";
import {
  validateBrowserSigningSnapshot,
  type BrowserQueryAdmissionResult,
  type BrowserOriginalAdmission,
  type BrowserOriginalAdmissionResult,
  type BrowserSigningSnapshot,
} from "./browser-signing-originals";
import type { SessionGrantRecord } from "./keryx-db";

/** Additive installation only. No activation function or production flag is supplied. */
export function initializeSqliteBrowserSigningOriginals(db: DatabaseSync) {
  const owns = !db.isTransaction;
  db.exec(owns ? "BEGIN IMMEDIATE" : "SAVEPOINT browser_signing_install");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS browser_signing_v2_control(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL CHECK(active IN(0,1)));
    INSERT OR IGNORE INTO browser_signing_v2_control VALUES(1,0);
    CREATE TABLE IF NOT EXISTS browser_signing_v2_barrier(id INTEGER PRIMARY KEY CHECK(id=1),ever_active INTEGER NOT NULL CHECK(ever_active IN(0,1)));
    INSERT OR IGNORE INTO browser_signing_v2_barrier VALUES(1,0);
    CREATE TRIGGER IF NOT EXISTS browser_signing_v2_sticky AFTER UPDATE OF active ON browser_signing_v2_control WHEN NEW.active=1
      BEGIN UPDATE browser_signing_v2_barrier SET ever_active=1 WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_v2_sticky_insert AFTER INSERT ON browser_signing_v2_control WHEN NEW.active=1
      BEGIN UPDATE browser_signing_v2_barrier SET ever_active=1 WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_v2_barrier_retained BEFORE DELETE ON browser_signing_v2_barrier
      BEGIN SELECT RAISE(ABORT,'browser signing barrier is retained'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_v2_barrier_monotonic BEFORE UPDATE ON browser_signing_v2_barrier WHEN NEW.ever_active<OLD.ever_active
      BEGIN SELECT RAISE(ABORT,'browser signing barrier is retained'); END;
    CREATE TABLE IF NOT EXISTS browser_signing_v2_writer(id INTEGER PRIMARY KEY CHECK(id=1));
    CREATE TABLE IF NOT EXISTS browser_signing_namespaces(namespace TEXT PRIMARY KEY,owner TEXT NOT NULL,signer TEXT NOT NULL,service TEXT NOT NULL,network TEXT NOT NULL,
      ceiling_micro INTEGER NOT NULL CHECK(ceiling_micro>0),job_limit INTEGER NOT NULL CHECK(job_limit>0),allocated_micro INTEGER NOT NULL CHECK(allocated_micro>=0),jobs INTEGER NOT NULL CHECK(jobs>=0),proof TEXT NOT NULL,
      UNIQUE(owner,signer,service,network),CHECK(allocated_micro<=ceiling_micro),CHECK(jobs<=job_limit));
    CREATE TABLE IF NOT EXISTS browser_signing_queries(query_id TEXT PRIMARY KEY,namespace TEXT NOT NULL REFERENCES browser_signing_namespaces(namespace),
      policy_id TEXT NOT NULL,request_nonce TEXT NOT NULL,session_id TEXT NOT NULL,grant_epoch TEXT NOT NULL,proof TEXT NOT NULL,proof_digest TEXT NOT NULL,
      ceiling_micro INTEGER NOT NULL CHECK(ceiling_micro>0),spent_micro INTEGER NOT NULL CHECK(spent_micro>=0 AND spent_micro<=ceiling_micro),
      UNIQUE(namespace,request_nonce),UNIQUE(namespace,policy_id));
    CREATE TABLE IF NOT EXISTS browser_signing_originals(nonce TEXT PRIMARY KEY REFERENCES browser_authorization_intents(nonce),query_id TEXT NOT NULL REFERENCES browser_signing_queries(query_id),
      original TEXT NOT NULL,input TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS browser_signing_old_admission_fence BEFORE INSERT ON browser_authorization_intents
      WHEN ((SELECT active FROM browser_signing_v2_control WHERE id=1)=1 OR (SELECT ever_active FROM browser_signing_v2_barrier WHERE id=1)=1)
        AND NOT EXISTS(SELECT 1 FROM browser_signing_v2_writer)
      BEGIN SELECT RAISE(ABORT,'browser signing v2 writer required'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_original_immutable BEFORE UPDATE ON browser_signing_originals
      BEGIN SELECT RAISE(ABORT,'browser signing original is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_original_retained BEFORE DELETE ON browser_signing_originals
      BEGIN SELECT RAISE(ABORT,'browser signing original is retained'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_query_immutable BEFORE UPDATE ON browser_signing_queries
      WHEN NEW.query_id IS NOT OLD.query_id OR NEW.namespace IS NOT OLD.namespace OR NEW.policy_id IS NOT OLD.policy_id OR NEW.request_nonce IS NOT OLD.request_nonce
        OR NEW.session_id IS NOT OLD.session_id OR NEW.grant_epoch IS NOT OLD.grant_epoch OR NEW.proof IS NOT OLD.proof OR NEW.proof_digest IS NOT OLD.proof_digest OR NEW.ceiling_micro IS NOT OLD.ceiling_micro OR NEW.spent_micro<OLD.spent_micro
      BEGIN SELECT RAISE(ABORT,'browser signing query is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_query_retained BEFORE DELETE ON browser_signing_queries
      BEGIN SELECT RAISE(ABORT,'browser signing query is retained'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_namespace_identity BEFORE UPDATE ON browser_signing_namespaces
      WHEN NEW.namespace IS NOT OLD.namespace OR NEW.owner IS NOT OLD.owner OR NEW.signer IS NOT OLD.signer OR NEW.service IS NOT OLD.service OR NEW.network IS NOT OLD.network
        OR NEW.allocated_micro<OLD.allocated_micro OR NEW.jobs<OLD.jobs
      BEGIN SELECT RAISE(ABORT,'browser signing namespace history is retained'); END;
    CREATE TRIGGER IF NOT EXISTS browser_signing_namespace_retained BEFORE DELETE ON browser_signing_namespaces
      BEGIN SELECT RAISE(ABORT,'browser signing namespace is retained'); END;`);
    db.exec(owns ? "COMMIT" : "RELEASE browser_signing_install");
  } catch (error) {
    if (owns) db.exec("ROLLBACK");
    else
      db.exec(
        "ROLLBACK TO browser_signing_install; RELEASE browser_signing_install"
      );
    throw error;
  }
}
function active(db: DatabaseSync) {
  return (
    sqliteJournalActive(db) &&
    db.prepare("SELECT active FROM browser_signing_v2_control WHERE id=1").get()
      ?.active === 1
  );
}
function grant(db: DatabaseSync, sessionId: string): SessionGrantRecord | null {
  const r = db
    .prepare("SELECT * FROM session_grants WHERE session_id=?")
    .get(sessionId);
  return r
    ? {
        sessionId: String(r.session_id),
        sessAddr: String(r.sess_addr),
        ownerAddr: String(r.owner_addr),
        cap: Number(r.cap),
        spent: Number(r.spent),
        expiry: Number(r.expiry),
        txHash: String(r.tx_hash),
        grantEpoch: String(r.grant_epoch),
      }
    : null;
}
function capMicros(value: number) {
  const amount = value * 1e6;
  if (
    !Number.isSafeInteger(Math.round(amount)) ||
    amount < 0 ||
    Math.abs(amount - Math.round(amount)) >= 0.000001
  )
    throw new Error("Invalid browser signing capacity");
  return Math.round(amount);
}
export async function admitSqliteBrowserQueryPolicy(
  db: DatabaseSync,
  proof: BrowserQueryPolicyProof,
  sessionId: string
): Promise<BrowserQueryAdmissionResult> {
  const verified = await verifyBrowserQueryPolicy(proof),
    p = verified.policy;
  return sqliteJournalTransaction(db, () => {
    if (!active(db)) return { status: "inactive" };
    const existing = db
      .prepare(
        "SELECT * FROM browser_signing_queries WHERE query_id=? OR (namespace=? AND (request_nonce=? OR policy_id=?))"
      )
      .get(p.queryId, verified.namespace, p.requestNonce, p.policyId);
    if (existing)
      return existing.query_id === p.queryId &&
        existing.namespace === verified.namespace &&
        existing.session_id === sessionId &&
        existing.proof_digest === verified.proofDigest
        ? {
            status: "admitted",
            namespace: verified.namespace,
            queryId: p.queryId,
          }
        : { status: "refused" };
    const g = grant(db, sessionId);
    if (
      !g ||
      g.ownerAddr.toLowerCase() !== p.owner ||
      g.sessAddr.toLowerCase() !== p.signer ||
      g.grantEpoch !== p.grantEpoch ||
      g.expiry <= Date.now() ||
      p.expiresAt <= Date.now() ||
      p.expiresAt > g.expiry ||
      Number(p.lifetimeCeilingMicros) > capMicros(g.cap)
    )
      return { status: "refused" };
    const n = db
      .prepare("SELECT * FROM browser_signing_namespaces WHERE namespace=?")
      .get(verified.namespace);
    const allocated = Number(n?.allocated_micro ?? 0),
      jobs = Number(n?.jobs ?? 0),
      ceiling = Number(p.lifetimeCeilingMicros),
      amount = Number(p.queryCeilingMicros);
    if (
      !Number.isSafeInteger(allocated + amount) ||
      allocated + amount > ceiling ||
      !Number.isSafeInteger(jobs + 1) ||
      jobs + 1 > p.jobLimit
    )
      return { status: "refused" };
    if (
      n &&
      (n.owner !== p.owner ||
        n.signer !== p.signer ||
        n.service !== p.service ||
        n.network !== "eip155:5042002")
    )
      throw new Error("Browser signing namespace mismatch");
    db.prepare(
      `INSERT INTO browser_signing_namespaces VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET
      ceiling_micro=excluded.ceiling_micro,job_limit=excluded.job_limit,allocated_micro=excluded.allocated_micro,jobs=excluded.jobs,proof=excluded.proof`
    ).run(
      verified.namespace,
      p.owner,
      p.signer,
      p.service,
      "eip155:5042002",
      ceiling,
      p.jobLimit,
      allocated + amount,
      jobs + 1,
      canonicalJson({ policy: p, signature: verified.signature })
    );
    db.prepare(
      "INSERT INTO browser_signing_queries VALUES(?,?,?,?,?,?,?,?,?,0)"
    ).run(
      p.queryId,
      verified.namespace,
      p.policyId,
      p.requestNonce,
      sessionId,
      p.grantEpoch,
      canonicalJson({ policy: p, signature: verified.signature }),
      verified.proofDigest,
      amount
    );
    return {
      status: "admitted",
      namespace: verified.namespace,
      queryId: p.queryId,
    };
  });
}
export function admitSqliteBrowserSigningOriginal(
  db: DatabaseSync,
  input: BrowserOriginalAdmission
): BrowserOriginalAdmissionResult {
  const copied = JSON.parse(canonicalJson(input)) as BrowserOriginalAdmission,
    j = prepareBrowserJournal(copied.journal);
  return sqliteJournalTransaction(db, () => {
    if (!active(db)) return { status: "inactive" };
    const old = getSqliteBrowserJournal(db, j.sessionId, j.requestId);
    if (old) {
      const o = db
        .prepare("SELECT * FROM browser_signing_originals WHERE nonce=?")
        .get(old.nonce);
      return o && o.input === canonicalJson(copied)
        ? {
            status: "admitted",
            journal: old,
            original: JSON.parse(String(o.original)),
          }
        : { status: "refused" };
    }
    const q = db
      .prepare(
        "SELECT * FROM browser_signing_queries WHERE query_id=? AND namespace=?"
      )
      .get(copied.queryId, copied.queryNamespace);
    if (
      !q ||
      q.session_id !== j.sessionId ||
      q.grant_epoch !== j.grantEpoch ||
      copied.queryId !== j.payment.queryId
    )
      return { status: "refused" };
    const proof = JSON.parse(String(q.proof)) as BrowserQueryPolicyProof,
      p = proof.policy,
      g = grant(db, j.sessionId);
    const amount = copied.journal.amountMicroUsdc,
      spent = Number(q.spent_micro);
    if (
      !g ||
      g.ownerAddr.toLowerCase() !== p.owner ||
      g.sessAddr.toLowerCase() !== p.signer ||
      j.signer.toLowerCase() !== p.signer ||
      g.grantEpoch !== p.grantEpoch ||
      g.expiry <= Date.now() ||
      p.expiresAt <= Date.now() ||
      !Number.isSafeInteger(spent + amount) ||
      spent + amount > Number(q.ceiling_micro)
    )
      return { status: "refused" };
    const original = prepareBrowserSigningOriginal(j, copied.queryNamespace);
    db.prepare("INSERT INTO browser_signing_v2_writer VALUES(1)").run();
    const admitted = admitSqliteBrowserJournalInTransaction(
      db,
      copied.journal,
      j
    );
    db.prepare("DELETE FROM browser_signing_v2_writer").run();
    if (admitted.status !== "admitted") return { status: "refused" };
    db.prepare("INSERT INTO browser_signing_originals VALUES(?,?,?,?)").run(
      j.nonce,
      copied.queryId,
      canonicalJson(original),
      canonicalJson(copied)
    );
    db.prepare(
      "UPDATE browser_signing_queries SET spent_micro=spent_micro+? WHERE query_id=?"
    ).run(amount, copied.queryId);
    return { status: "admitted", journal: j, original };
  });
}
export async function readSqliteBrowserSigningSnapshot(
  db: DatabaseSync,
  owner: string,
  sessionId: string,
  requestId: string
): Promise<BrowserSigningSnapshot | null> {
  let snapshot: BrowserSigningSnapshot | null = null;
  db.exec("BEGIN");
  try {
    const journal = getSqliteBrowserJournal(db, sessionId, requestId);
    if (journal) {
      const o = db
        .prepare("SELECT * FROM browser_signing_originals WHERE nonce=?")
        .get(journal.nonce);
      if (o) {
        const q = db
          .prepare("SELECT * FROM browser_signing_queries WHERE query_id=?")
          .get(String(o.query_id));
        const n =
          q &&
          db
            .prepare(
              "SELECT * FROM browser_signing_namespaces WHERE namespace=?"
            )
            .get(String(q.namespace));
        const s = db
          .prepare(
            "SELECT spent_micro FROM browser_signer_capacity WHERE signer=?"
          )
          .get(journal.signer.toLowerCase());
        const e = db
          .prepare(
            "SELECT spent_micro FROM browser_retained_grants WHERE grant_epoch=? AND signer=?"
          )
          .get(journal.grantEpoch, journal.signer.toLowerCase());
        if (
          !q ||
          !n ||
          !s ||
          !e ||
          n.owner !== owner.toLowerCase() ||
          q.session_id !== sessionId
        )
          throw new Error("Browser signing snapshot refused");
        snapshot = {
          journal,
          original: JSON.parse(String(o.original)),
          currentGrant: grant(db, sessionId),
          policy: JSON.parse(String(q.proof)),
          active: active(db),
          namespace: {
            namespace: String(n.namespace),
            owner: String(n.owner),
            signer: String(n.signer),
            service: String(n.service),
            network: String(n.network),
            ceilingMicros: String(n.ceiling_micro),
            jobLimit: Number(n.job_limit),
            allocatedMicros: String(n.allocated_micro),
            jobs: Number(n.jobs),
            ceilingProof: JSON.parse(String(n.proof)),
          },
          query: {
            queryId: String(q.query_id),
            namespace: String(q.namespace),
            ceilingMicros: String(q.ceiling_micro),
            spentMicros: String(q.spent_micro),
            proofDigest: String(q.proof_digest),
          },
          signerSpentMicros: String(s.spent_micro),
          retainedEpochSpentMicros: String(e.spent_micro),
        };
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return snapshot ? validateBrowserSigningSnapshot(snapshot, owner) : null;
}
export async function signSqliteBrowserSigningOriginal(
  db: DatabaseSync,
  sessionId: string,
  requestId: string,
  header: string
): Promise<boolean> {
  return signSqliteBrowserCanonicalOriginal(db, sessionId, requestId, header);
}
