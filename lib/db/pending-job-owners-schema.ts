/** Data-only schema; installed solely by explicit whole-bundle migration. */
export const PENDING_JOB_OWNERS_SQL = `CREATE TABLE pending_job_owners (
 job_id TEXT PRIMARY KEY REFERENCES a2a_orders(id), query_id TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), network TEXT NOT NULL,
 wallet TEXT NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet)),
 session_hash TEXT NOT NULL CHECK(length(session_hash)=64), issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>issued_at), admitted_at TEXT NOT NULL,
 CHECK(job_id=query_id)
);
CREATE INDEX pending_job_owners_wallet ON pending_job_owners(wallet,admitted_at,job_id);
CREATE TRIGGER pending_job_owners_no_update BEFORE UPDATE ON pending_job_owners
BEGIN SELECT RAISE(ABORT,'pending ownership immutable'); END;
CREATE TRIGGER pending_job_owners_no_delete BEFORE DELETE ON pending_job_owners
BEGIN SELECT RAISE(ABORT,'pending ownership immutable'); END;`;
