/** Shared full-original evidence checks. No database selection or authority. */
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

export type AccountHistoryEvidenceRow = Readonly<Record<string, unknown>>;
export function boundedAccountHistoryObservations(observed: readonly AccountHistoryObservation[]) {
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
  return items;
}
export function validateAccountHistoryEvidenceRows(binding: AccountBinding, ids: readonly string[], rows: readonly AccountHistoryEvidenceRow[]) {
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
}
export function validateAccountHistoryOriginals(items: readonly AccountHistoryObservation[], rows: readonly AccountHistoryEvidenceRow[]) {
  if (rows.length !== items.length) throw unavailable();
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
    {
      // Detail responses omit list attribution, but still need a positive owner
      // proof in this captured snapshot. A prebuilt body cannot bless a foreign
      // claim that happens to recur at the final observation.
      const inferred = row.asker !== null ? { method: "recorded", claimedAt: null }
        : { method: "claimed", claimedAt: integer(row.claimed_at) ? new Date(row.claimed_at).toISOString() : null };
      const ownership = runOwnershipSchema.safeParse(item.ownership ?? inferred);
      if (!ownership.success) throw unavailable();
      try { ownershipHistoryOriginal(original, item.ownerWallet, item.id, String(row.created_at), ownership.data); }
      catch { throw unavailable(); }
      if (ownership.data.method === "recorded" ? row.asker !== item.ownerWallet
        : row.asker !== null || row.c_id === null || row.claimed_wallet !== item.ownerWallet || !integer(row.claimed_at)
          || new Date(row.claimed_at).toISOString() !== ownership.data.claimedAt || row.completed_at !== row.created_at
          || row.original_sha256 !== row.original_hash || row.a2a !== 0) throw unavailable();
    }
  }
}
