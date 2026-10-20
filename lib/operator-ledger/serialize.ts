import { canonicalJson } from "../canonical-json";
import type { OperatorLedger } from "./contracts";

/** Pure text serialization for a snapshot whose bindings and digest the caller
 * has already verified. This does not grant authenticity or settlement authority. */
export function operatorLedgerCsvText({ payload, integrity }: OperatorLedger): string {
  const columns = ["schema", "network", "read_started_at", "read_completed_at", "payload_digest", "voucher_id", "job_id", "funding", "account",
    "debit_micro_usdc", "credit_micro_usdc", "settlement_reference", "evidence_path"];
  const rows = payload.entries.map(entry => [payload.schema, payload.network, payload.window.readStartedAt, payload.window.readCompletedAt,
    integrity.digest, entry.voucherId, entry.jobId, entry.funding, entry.account, entry.debitMicroUsdc, entry.creditMicroUsdc,
    entry.settlementReference, entry.evidencePath]);
  // Quoting alone does not stop spreadsheet formulas. Preserve JSON identities,
  // but explicitly serialize risky CSV text as literal text. Integer amounts
  // are canonical nonnegative strings and remain unchanged.
  const quote = (cell: string) => `"${(/^[=+\-@\t\r]/.test(cell) ? "'" + cell : cell).replace(/"/g, '""')}"`;
  return [columns, ...rows].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** Preserve the displayed observation, including its timestamps and checksum. */
export function operatorLedgerJsonText(ledger: OperatorLedger): string { return canonicalJson(ledger) + "\n"; }
