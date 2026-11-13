import type { DatabaseSync } from "node:sqlite";
import { AccountError, type AccountBinding, type AccountHistoryObservation } from "./contracts";
import { MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES, MAX_ACCOUNT_HISTORY_TOTAL_BYTES, boundedAccountHistoryObservations,
  validateAccountHistoryEvidenceRows, validateAccountHistoryOriginals } from "./history-evidence";
export { MAX_ACCOUNT_HISTORY_ITEMS, MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES, MAX_ACCOUNT_HISTORY_TOTAL_BYTES,
  ACCOUNT_HISTORY_DEADLINE_MS } from "./history-evidence";
const unavailable = () => new AccountError("account_unavailable");
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export interface SqliteHistoryEvidence {
  readonly ids: readonly string[];
  /** Only bounded typed metadata and original hashes; no report body or credential. */
  readonly fingerprint: string;
}

/** Fixed private journal read, not an owner/authentication factory. The journal
 * supplies its genuine guarded connection inside its existing READ transaction.
 * No function installation, raw connection open, caller SQL or schema mutation. */
function capture(db: DatabaseSync, binding: AccountBinding, ids: readonly string[], originals: boolean) {
  const encoded = JSON.stringify(ids);
  // Bound physical original work BEFORE selecting bodies or hashing them. The
  // export's small summary size is not a bound on its underlying originals.
  const sizes = db.prepare("SELECT q.id,typeof(q.data) AS data_type,length(CAST(q.data AS BLOB)) AS bytes " +
    "FROM json_each(?) wanted LEFT JOIN query_runs q ON q.id=wanted.value ORDER BY wanted.key").all(encoded);
  if (sizes.length !== ids.length) throw unavailable();
  let total = 0;
  for (const [index, row] of sizes.entries()) {
    if (row.id !== ids[index] || row.data_type !== "text" || !integer(row.bytes)
      || row.bytes > MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES) throw unavailable();
    total += row.bytes;
    if (total > MAX_ACCOUNT_HISTORY_TOTAL_BYTES) throw unavailable();
  }
  const rows = db.prepare("SELECT q.id,q.asker,q.created_at,keryx_claim_history_sha(q.data) AS original_hash," +
    "CASE WHEN ?=1 THEN q.data ELSE NULL END AS original," +
    "p.run_id AS p_id,p.visibility,p.revision,p.erased,p.retained_owner,p.retained_digest,p.retained_binding,p.updated_at," +
    "c.run_id AS c_id,c.network AS c_network,c.origin AS c_origin,c.claimed_wallet,c.claimed_at,c.completed_at,c.original_sha256," +
    "EXISTS(SELECT 1 FROM a2a_orders o WHERE o.query_id=q.id) AS a2a " +
    "FROM json_each(?) wanted LEFT JOIN query_runs q ON q.id=wanted.value " +
    "LEFT JOIN run_privacy p ON p.run_id=q.id " +
    "LEFT JOIN anonymous_run_claims c ON c.run_id=q.id AND c.network=? AND c.origin=? ORDER BY wanted.key")
    .all(originals ? 1 : 0, encoded, binding.network, binding.origin);
  if (rows.length !== ids.length) throw unavailable();
  validateAccountHistoryEvidenceRows(binding, ids, rows);
  // Explicit positions preserve row absence, SQL null and storage classes. In
  // particular, no json_object can decode a JSONB BLOB into a matching string.
  const fingerprint = JSON.stringify(rows.map(row => [row.id, row.asker, row.created_at, row.original_hash,
    row.p_id, row.visibility, row.revision, row.erased, row.retained_owner, row.retained_digest, row.retained_binding, row.updated_at,
    row.c_id, row.c_network, row.c_origin, row.claimed_wallet, row.claimed_at, row.completed_at, row.original_sha256, row.a2a]));
  return { rows, fingerprint };
}

export function prepareSqliteHistoryEvidence(db: DatabaseSync, binding: AccountBinding,
  observed: readonly AccountHistoryObservation[]): SqliteHistoryEvidence {
  const items = boundedAccountHistoryObservations(observed);
  const ids = Object.freeze(items.map(item => item.id));
  const { rows, fingerprint } = capture(db, binding, ids, true);
  validateAccountHistoryOriginals(items, rows);
  return Object.freeze({ ids, fingerprint });
}

export function assertSqliteHistoryEvidence(db: DatabaseSync, binding: AccountBinding, before: SqliteHistoryEvidence) {
  if (capture(db, binding, before.ids, false).fingerprint !== before.fingerprint) throw unavailable();
}
