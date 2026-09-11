import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WithdrawalRecord } from "../types";

function row(value: WithdrawalRecord) {
  const w = structuredClone(value);
  if (!/^0x[a-fA-F0-9]{64}$/.test(w.txHash) || !/^0x[a-fA-F0-9]{40}$/.test(w.wallet)
    || !/^0x[a-fA-F0-9]{40}$/.test(w.recipient) || !Number.isFinite(w.amountUsdc) || w.amountUsdc <= 0
    || !w.network || !Number.isFinite(Date.parse(w.createdAt))) throw new Error("Invalid withdrawal record");
  return { tx_hash: w.txHash, created_at: w.createdAt, label: w.label, source_name: w.sourceName ?? null,
    wallet: w.wallet, recipient: w.recipient, amount_usdc: w.amountUsdc, network: w.network };
}
function verify(saved: Record<string, unknown> | null | undefined, expected: ReturnType<typeof row>) {
  if (!saved || saved.tx_hash !== expected.tx_hash || String(saved.wallet).toLowerCase() !== expected.wallet.toLowerCase()
    || String(saved.recipient).toLowerCase() !== expected.recipient.toLowerCase()
    || Number(saved.amount_usdc) !== expected.amount_usdc || saved.network !== expected.network)
    throw new Error("Withdrawal record readback unavailable or conflicting");
}
/** First record wins. Repeated reporting can retain earlier display metadata and time,
 * but never silently change the transaction's owner, recipient, amount or network. */
export async function recordSqliteWithdrawal(db: DatabaseSync, value: WithdrawalRecord) {
  const w = row(value);
  db.prepare(`INSERT INTO withdrawals(tx_hash,created_at,label,source_name,wallet,recipient,amount_usdc,network)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tx_hash) DO NOTHING`)
    .run(w.tx_hash, w.created_at, w.label, w.source_name, w.wallet, w.recipient, w.amount_usdc, w.network);
  verify(db.prepare("SELECT * FROM withdrawals WHERE tx_hash=?").get(w.tx_hash), w);
}
export async function recordSupabaseWithdrawal(sb: SupabaseClient, value: WithdrawalRecord) {
  const w = row(value);
  const { error } = await sb.from("withdrawals").upsert(w, { onConflict: "tx_hash", ignoreDuplicates: true });
  if (error) throw new Error("Withdrawal record write unavailable");
  const read = await sb.from("withdrawals").select("*").eq("tx_hash", w.tx_hash).maybeSingle();
  if (read.error) throw new Error("Withdrawal record readback unavailable");
  verify(read.data, w);
}
