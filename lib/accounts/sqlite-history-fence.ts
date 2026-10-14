import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { privacyId, visibilitySchema } from "../run-privacy/contracts";
import { ownershipHistoryOriginal, runOwnershipSchema } from "../run-claims/history";
import { AccountError, canonicalWalletSchema, digestSchema, type AccountBinding, type AccountHistoryObservation } from "./contracts";

export const MAX_ACCOUNT_HISTORY_ITEMS = 1000;
export const MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES = 4_000_000;
export const MAX_ACCOUNT_HISTORY_TOTAL_BYTES = 16_000_000;
export const ACCOUNT_HISTORY_DEADLINE_MS = 25_000;
const unavailable = () => new AccountError("account_unavailable");
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const nullableText = (value: unknown, max: number) => value === null || text(value, max);
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
  for (const [index, row] of rows.entries()) {
    if (row.id !== ids[index] || !nullableText(row.asker, 42) || !text(row.created_at, 128)
      || !digestSchema.safeParse(row.original_hash).success || row.a2a !== 0 && row.a2a !== 1) throw unavailable();
    if (row.p_id !== null && (row.p_id !== row.id || !visibilitySchema.safeParse(row.visibility).success
      || !integer(row.revision) || row.erased !== 0 && row.erased !== 1
      || !nullableText(row.retained_owner, 42) || !nullableText(row.retained_digest, 64)
      || !nullableText(row.retained_binding, 4096) || !text(row.updated_at, 128))) throw unavailable();
    if (row.c_id !== null && (row.c_id !== row.id || row.c_network !== binding.network || row.c_origin !== binding.origin
      || row.claimed_wallet !== null && !canonicalWalletSchema.safeParse(row.claimed_wallet).success
      || row.claimed_at !== null && !integer(row.claimed_at) || !text(row.completed_at, 128)
      || !digestSchema.safeParse(row.original_sha256).success)) throw unavailable();
  }
  // Explicit positions preserve row absence, SQL null and storage classes. In
  // particular, no json_object can decode a JSONB BLOB into a matching string.
  const fingerprint = JSON.stringify(rows.map(row => [row.id, row.asker, row.created_at, row.original_hash,
    row.p_id, row.visibility, row.revision, row.erased, row.retained_owner, row.retained_digest, row.retained_binding, row.updated_at,
    row.c_id, row.c_network, row.c_origin, row.claimed_wallet, row.claimed_at, row.completed_at, row.original_sha256, row.a2a]));
  return { rows, fingerprint };
}

export function prepareSqliteHistoryEvidence(db: DatabaseSync, binding: AccountBinding,
  observed: readonly AccountHistoryObservation[]): SqliteHistoryEvidence {
  if (!Array.isArray(observed) || observed.length > MAX_ACCOUNT_HISTORY_ITEMS) throw unavailable();
  const items = [...observed].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(items.map(item => item.id)).size !== items.length) throw unavailable();
  let total = 0;
  for (const item of items) {
    if (!privacyId.safeParse(item.id).success || !canonicalWalletSchema.safeParse(item.ownerWallet).success
      || item.run.id !== item.id || !visibilitySchema.safeParse(item.state.visibility).success
      || !integer(item.state.revision) || item.state.erased !== false) throw unavailable();
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify(item.run)); } catch { throw unavailable(); }
    total += bytes;
    if (bytes > MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES || total > MAX_ACCOUNT_HISTORY_TOTAL_BYTES) throw unavailable();
  }
  const ids = Object.freeze(items.map(item => item.id));
  const { rows, fingerprint } = capture(db, binding, ids, true);
  for (const [index, row] of rows.entries()) {
    const item = items[index];
    let original: unknown;
    try { if (typeof row.original !== "string") throw unavailable(); original = JSON.parse(row.original); }
    catch { throw unavailable(); }
    const state = row.p_id === null ? { visibility: "unlisted", revision: 0, erased: false }
      : { visibility: row.visibility, revision: row.revision, erased: row.erased === 1 };
    // Zod's known-key order differs from stored JSON. Compare full semantic
    // objects, never hash(JSON.stringify(parsedRun)) against a raw-text hash.
    if (!isDeepStrictEqual(original, item.run) || !isDeepStrictEqual(state, item.state)
      || row.created_at !== item.run.createdAt || row.asker !== null && row.asker !== item.ownerWallet) throw unavailable();
    if (item.ownership !== undefined) {
      const ownership = runOwnershipSchema.safeParse(item.ownership);
      if (!ownership.success) throw unavailable();
      try { ownershipHistoryOriginal(original, item.ownerWallet, item.id, String(row.created_at), ownership.data); }
      catch { throw unavailable(); }
      if (ownership.data.method === "recorded" ? row.asker !== item.ownerWallet
        : row.asker !== null || row.c_id === null || row.claimed_wallet !== item.ownerWallet || !integer(row.claimed_at)
          || new Date(row.claimed_at).toISOString() !== ownership.data.claimedAt || row.completed_at !== row.created_at
          || row.original_sha256 !== row.original_hash || row.a2a !== 0) throw unavailable();
    }
  }
  return Object.freeze({ ids, fingerprint });
}

export function assertSqliteHistoryEvidence(db: DatabaseSync, binding: AccountBinding, before: SqliteHistoryEvidence) {
  if (capture(db, binding, before.ids, false).fingerprint !== before.fingerprint) throw unavailable();
}
