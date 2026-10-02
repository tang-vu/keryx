import type { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { getSqliteBrowserJournal, sqliteJournalActive } from "./sqlite-browser-journal";

export interface SessionFundingAccounting {
  hasAuthorityHistory: boolean;
  confirmedSpentMicroUsdc: string;
  retainedSpentMicroUsdc: string;
  postBaselineConfirmedDebitMicroUsdc: string;
}
const micros = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Session funding accounting unavailable");
  return n;
};

/** Read original native authority, not payment rows that merely claim settlement.
 * A pre-baseline authorization never becomes deposit credit when its confirmation
 * arrives late. No read releases retained consumption or activates the journal. */
export function sqliteSessionFundingAccounting(db: DatabaseSync, signer: string, after?: string): SessionFundingAccounting {
  if (!/^0x[0-9a-f]{40}$/.test(signer) || (after !== undefined &&
    (!Number.isFinite(Date.parse(after)) || new Date(after).toISOString() !== after)))
    throw new Error("Session funding accounting selector refused");
  const rows = db.prepare(`SELECT i.*, p.id AS payment_id,p.settled,p.settlement_status,p.authorization_phase,
    p.tx_hash,p.payer AS payment_payer,p.payee AS payment_payee,p.network AS payment_network,
    p.amount_usdc,p.authorization_id,p.grant_epoch AS payment_epoch
    FROM browser_authorization_intents i LEFT JOIN payment_events p ON p.id='x402:'||i.nonce
    WHERE lower(i.signer)=? LIMIT 10001`).all(signer);
  if (rows.length > 10000) throw new Error("Session funding accounting bound exceeded");
  const capacity = db.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer);
  const hasAuthorityHistory = rows.length > 0 || !!capacity ||
    !!db.prepare("SELECT 1 FROM session_grants WHERE lower(sess_addr)=? LIMIT 1").get(signer) ||
    !!db.prepare("SELECT 1 FROM session_grant_consents WHERE lower(sess_addr)=? AND consumed_at IS NOT NULL LIMIT 1").get(signer);
  if (db.prepare(`SELECT 1 FROM payment_events p LEFT JOIN browser_authorization_intents i
    ON p.id='x402:'||i.nonce WHERE lower(p.payer)=? AND p.grant_epoch IS NOT NULL AND i.nonce IS NULL LIMIT 1`).get(signer))
    throw new Error("Original funding debit evidence unavailable");
  if (hasAuthorityHistory && !sqliteJournalActive(db)) throw new Error("Session funding accounting unavailable");
  if (hasAuthorityHistory && !capacity) throw new Error("Retained funding debit accounting unavailable");
  const retained = micros(capacity?.spent_micro ?? 0);
  let confirmed = 0, postBaseline = 0;
  for (const r of rows) {
    const j = getSqliteBrowserJournal(db, String(r.session_id), String(r.request_id)), amount = micros(r.amount_micro_usdc);
    if (!j || amount <= 0 || j.nonce !== r.nonce || j.signer.toLowerCase() !== signer ||
      r.network !== ARC_MAINNET_PROFILE.networkId || r.payment_network !== r.network ||
      String(r.token).toLowerCase() !== ARC_MAINNET_PROFILE.usdcAddress.toLowerCase() ||
      String(r.gateway_contract).toLowerCase() !== ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase() ||
      r.authorization_id !== r.nonce || r.payment_epoch !== r.grant_epoch ||
      String(r.payment_payer).toLowerCase() !== signer || String(r.payment_payee).toLowerCase() !== String(r.payee).toLowerCase() ||
      Math.round(Number(r.amount_usdc) * 1e6) !== amount ||
      Math.abs(Number(r.amount_usdc) * 1e6 - amount) >= 0.000001 || !Number.isFinite(Date.parse(j.admittedAt)))
      throw new Error("Original funding debit evidence unavailable");
    if ((r.settled === 1 || r.settlement_status === "settled") && r.authorization_phase !== "settled")
      throw new Error("Original settled debit evidence unavailable");
    if (r.authorization_phase === "settled") {
      if (r.settled !== 1 || r.settlement_status !== "settled" || !String(r.tx_hash ?? "").trim())
        throw new Error("Original settled debit evidence unavailable");
      confirmed += amount; micros(confirmed);
      if (after !== undefined && Date.parse(j.admittedAt) > Date.parse(after)) { postBaseline += amount; micros(postBaseline); }
    }
  }
  if (confirmed > retained) throw new Error("Retained funding debit accounting unavailable");
  return { hasAuthorityHistory, confirmedSpentMicroUsdc: String(confirmed), retainedSpentMicroUsdc: String(retained),
    postBaselineConfirmedDebitMicroUsdc: String(postBaseline) };
}
