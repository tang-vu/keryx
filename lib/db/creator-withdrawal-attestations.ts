import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { matchWithdrawalAttestation, type WithdrawalAttestation } from "../gateway/withdrawal-attestation";
import { getSqliteWithdrawalRequest, getSqliteWithdrawalTransferClaim, getSupabaseWithdrawalRequest, getSupabaseWithdrawalTransferClaim } from "./creator-withdrawal-requests";

export const CREATOR_WITHDRAWAL_ATTESTATIONS_SQL = `
CREATE TABLE IF NOT EXISTS creator_withdrawal_attestations (
  id TEXT PRIMARY KEY REFERENCES creator_withdrawal_transfer_attempts(id),
  claim_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL CHECK(length(data)<=8192),
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS withdrawal_attestation_no_update BEFORE UPDATE ON creator_withdrawal_attestations
BEGIN SELECT RAISE(ABORT,'Withdrawal attestation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS withdrawal_attestation_no_delete BEFORE DELETE ON creator_withdrawal_attestations
BEGIN SELECT RAISE(ABORT,'Withdrawal attestation is immutable'); END;
`;
export type SavedWithdrawalAttestation = WithdrawalAttestation & { savedAt: string };
const rowSchema = z.object({ claim_id: z.string().uuid(), transfer_id: z.string().uuid(),
  data: z.unknown(), saved_at: z.string().datetime({ offset: true }) });

async function read(row: unknown, record: NonNullable<Awaited<ReturnType<typeof getSqliteWithdrawalRequest>>>, claimId: string): Promise<SavedWithdrawalAttestation> {
  try {
    const parsed = rowSchema.parse(row);
    if (parsed.claim_id !== claimId) throw new Error();
    const data = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
    const matched = await matchWithdrawalAttestation(record, data);
    if (matched.transferId !== parsed.transfer_id || Object.keys(data).length !== Object.keys(matched).length
      || Object.entries(matched).some(([key, value]) => data[key] !== value)) throw new Error();
    return { ...matched, savedAt: parsed.saved_at };
  } catch { throw new Error("Withdrawal attestation storage unavailable"); }
}
function original(saved: SavedWithdrawalAttestation | null, proposed: WithdrawalAttestation) {
  if (!saved || Object.entries(proposed).some(([key, value]) => saved[key as keyof WithdrawalAttestation] !== value))
    throw new Error("Withdrawal attestation conflict");
  return saved;
}

export async function getSqliteWithdrawalAttestation(db: DatabaseSync, id: string, owner: string) {
  const record = await getSqliteWithdrawalRequest(db, id, owner);
  if (!record) return null;
  const claim = await getSqliteWithdrawalTransferClaim(db, id, owner);
  if (!claim) return null;
  const row = db.prepare("SELECT claim_id,transfer_id,data,saved_at FROM creator_withdrawal_attestations WHERE id=?").get(id);
  return row ? read(row, record, claim.claimId) : null;
}
export async function saveSqliteWithdrawalAttestation(db: DatabaseSync, id: string, owner: string, claimId: string, value: unknown) {
  // Copy response before any async storage/signature lookup.
  let snapshot: unknown;
  try { snapshot = structuredClone(value); } catch { throw new Error("Withdrawal attestation unavailable"); }
  const record = await getSqliteWithdrawalRequest(db, id, owner), claim = await getSqliteWithdrawalTransferClaim(db, id, owner);
  if (!record || !claim || claim.claimId !== claimId) throw new Error("Withdrawal attestation authority unavailable");
  const matched = await matchWithdrawalAttestation(record, snapshot);
  db.prepare(`INSERT INTO creator_withdrawal_attestations(id,claim_id,transfer_id,data)
    SELECT a.id,a.claim_id,?,? FROM creator_withdrawal_transfer_attempts a
    JOIN creator_withdrawal_requests r ON r.id=a.id WHERE a.id=? AND a.claim_id=? AND r.owner=?
    ON CONFLICT(id) DO NOTHING`).run(matched.transferId, JSON.stringify(matched), id, claimId, record.owner);
  return original(await getSqliteWithdrawalAttestation(db, id, owner), matched);
}
export async function getSupabaseWithdrawalAttestation(db: SupabaseClient, id: string, owner: string) {
  const record = await getSupabaseWithdrawalRequest(db, id, owner);
  if (!record) return null;
  const claim = await getSupabaseWithdrawalTransferClaim(db, id, owner);
  if (!claim) return null;
  const { data, error } = await db.from("creator_withdrawal_attestations").select("claim_id,transfer_id,data,saved_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Withdrawal attestation storage unavailable");
  return data ? read(data, record, claim.claimId) : null;
}
export async function saveSupabaseWithdrawalAttestation(db: SupabaseClient, id: string, owner: string, claimId: string, value: unknown) {
  let snapshot: unknown;
  try { snapshot = structuredClone(value); } catch { throw new Error("Withdrawal attestation unavailable"); }
  const record = await getSupabaseWithdrawalRequest(db, id, owner), claim = await getSupabaseWithdrawalTransferClaim(db, id, owner);
  if (!record || !claim || claim.claimId !== claimId) throw new Error("Withdrawal attestation authority unavailable");
  const matched = await matchWithdrawalAttestation(record, snapshot);
  const { error } = await db.rpc("save_creator_withdrawal_attestation", {
    p_id: id, p_owner: record.owner, p_claim_id: claimId, p_transfer_id: matched.transferId, p_data: matched,
  });
  if (error) throw new Error("Withdrawal attestation storage unavailable");
  return original(await getSupabaseWithdrawalAttestation(db, id, owner), matched);
}
