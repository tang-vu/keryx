import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { validateWithdrawalRequest, withdrawalIdSchema, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "../gateway/withdrawal-request";

export const CREATOR_WITHDRAWAL_REQUESTS_SQL = `
CREATE TABLE IF NOT EXISTS creator_withdrawal_requests (
  id TEXT PRIMARY KEY CHECK(length(id)=66 AND substr(id,1,2)='0x' AND substr(id,3) NOT GLOB '*[^a-f0-9]*'),
  owner TEXT NOT NULL CHECK(length(owner)=42 AND substr(owner,1,2)='0x' AND substr(owner,3) NOT GLOB '*[^a-f0-9]*'),
  data TEXT NOT NULL CHECK(length(data)<=8192),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS creator_withdrawal_owner ON creator_withdrawal_requests(owner,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS creator_withdrawal_transfer_attempts (
  id TEXT PRIMARY KEY REFERENCES creator_withdrawal_requests(id),
  claim_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS withdrawal_request_no_update BEFORE UPDATE ON creator_withdrawal_requests
BEGIN SELECT RAISE(ABORT,'Withdrawal request is immutable'); END;
CREATE TRIGGER IF NOT EXISTS withdrawal_request_no_delete BEFORE DELETE ON creator_withdrawal_requests
BEGIN SELECT RAISE(ABORT,'Withdrawal request is immutable'); END;
CREATE TRIGGER IF NOT EXISTS withdrawal_transfer_no_update BEFORE UPDATE ON creator_withdrawal_transfer_attempts
BEGIN SELECT RAISE(ABORT,'Withdrawal transfer attempt is immutable'); END;
CREATE TRIGGER IF NOT EXISTS withdrawal_transfer_no_delete BEFORE DELETE ON creator_withdrawal_transfer_attempts
BEGIN SELECT RAISE(ABORT,'Withdrawal transfer attempt is immutable'); END;
`;

const claimSchema = z.object({ claim_id: z.string().uuid(), started_at: z.string().datetime({ offset: true }) });
export type WithdrawalTransferClaim = { claimId: string; startedAt: string };
function key(id: string, owner: string) {
  return { id: withdrawalIdSchema.parse(id), owner: withdrawalOwnerSchema.parse(owner) };
}
async function read(row: unknown, id: string, owner: string) {
  try {
    const raw = typeof row === "string" ? JSON.parse(row) : row;
    const record = await validateWithdrawalRequest(raw);
    if (record.id !== id || record.owner !== owner) throw new Error();
    return record;
  } catch { throw new Error("Withdrawal request storage unavailable"); }
}
function original(saved: WithdrawalRequestRecord | null, proposed: WithdrawalRequestRecord) {
  if (!saved || JSON.stringify(saved) !== JSON.stringify(proposed)) throw new Error("Withdrawal request conflict");
  return saved;
}
function claimRecord(row: unknown): WithdrawalTransferClaim {
  const parsed = claimSchema.safeParse(row);
  if (!parsed.success) throw new Error("Withdrawal transfer state unavailable");
  return { claimId: parsed.data.claim_id, startedAt: parsed.data.started_at };
}

export async function getSqliteWithdrawalRequest(db: DatabaseSync, id: string, owner: string) {
  const selected = key(id, owner);
  const row = db.prepare("SELECT data FROM creator_withdrawal_requests WHERE id=? AND owner=?").get(selected.id, selected.owner);
  return row ? read(row.data, selected.id, selected.owner) : null;
}
export async function reserveSqliteWithdrawalRequest(db: DatabaseSync, value: WithdrawalRequestRecord) {
  const record = await validateWithdrawalRequest(value);
  db.prepare("INSERT INTO creator_withdrawal_requests(id,owner,data) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING")
    .run(record.id, record.owner, JSON.stringify(record));
  return original(await getSqliteWithdrawalRequest(db, record.id, record.owner), record);
}
export async function getSqliteWithdrawalTransferClaim(db: DatabaseSync, id: string, owner: string) {
  if (!await getSqliteWithdrawalRequest(db, id, owner)) return null;
  const row = db.prepare("SELECT claim_id,started_at FROM creator_withdrawal_transfer_attempts WHERE id=?").get(id);
  return row ? claimRecord(row) : null;
}
/** Only the inserting caller may send the initial Circle request. Not a lease: expiry,
 * response loss and restart never renew this authority. This performs no network call. */
export async function claimSqliteWithdrawalTransfer(db: DatabaseSync, id: string, owner: string) {
  const record = await getSqliteWithdrawalRequest(db, id, owner);
  if (!record) throw new Error("Withdrawal request authority unavailable");
  const claimId = randomUUID();
  const inserted = db.prepare(`INSERT INTO creator_withdrawal_transfer_attempts(id,claim_id)
    SELECT id,? FROM creator_withdrawal_requests WHERE id=? AND owner=? ON CONFLICT(id) DO NOTHING`)
    .run(claimId, record.id, record.owner);
  if (inserted.changes !== 1) return null;
  const saved = await getSqliteWithdrawalTransferClaim(db, id, owner);
  if (!saved || saved.claimId !== claimId) throw new Error("Withdrawal transfer admission unavailable");
  return saved;
}

export async function getSupabaseWithdrawalRequest(db: SupabaseClient, id: string, owner: string) {
  const selected = key(id, owner);
  const { data, error } = await db.from("creator_withdrawal_requests").select("data").eq("id", selected.id).eq("owner", selected.owner).maybeSingle();
  if (error) throw new Error("Withdrawal request storage unavailable");
  return data ? read(data.data, selected.id, selected.owner) : null;
}
export async function reserveSupabaseWithdrawalRequest(db: SupabaseClient, value: WithdrawalRequestRecord) {
  const record = await validateWithdrawalRequest(value);
  const { error } = await db.rpc("reserve_creator_withdrawal", { p_id: record.id, p_owner: record.owner, p_data: record });
  if (error) throw new Error("Withdrawal request storage unavailable");
  return original(await getSupabaseWithdrawalRequest(db, record.id, record.owner), record);
}
export async function getSupabaseWithdrawalTransferClaim(db: SupabaseClient, id: string, owner: string) {
  if (!await getSupabaseWithdrawalRequest(db, id, owner)) return null;
  const { data, error } = await db.from("creator_withdrawal_transfer_attempts").select("claim_id,started_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Withdrawal transfer state unavailable");
  return data ? claimRecord(data) : null;
}
export async function claimSupabaseWithdrawalTransfer(db: SupabaseClient, id: string, owner: string) {
  const record = await getSupabaseWithdrawalRequest(db, id, owner);
  if (!record) throw new Error("Withdrawal request authority unavailable");
  const claimId = randomUUID();
  const { data, error } = await db.rpc("claim_creator_withdrawal_transfer", { p_id: record.id, p_owner: record.owner, p_claim_id: claimId });
  if (error || typeof data !== "boolean") throw new Error("Withdrawal transfer admission unavailable");
  if (!data) return null;
  const saved = await getSupabaseWithdrawalTransferClaim(db, id, owner);
  if (!saved || saved.claimId !== claimId) throw new Error("Withdrawal transfer admission unavailable");
  return saved;
}
