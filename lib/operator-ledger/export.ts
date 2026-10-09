import { canonicalJson } from "../canonical-json";
import { ledgerDigest } from "./projection";
import { validateLedgerBindings } from "./validate";
import type { OperatorLedger } from "./contracts";

/** Checksum consistency is not authenticity; a separately retained digest can bind an earlier export. */
export function verifyOperatorLedger(value: unknown, retainedDigest?: string): OperatorLedger {
  const ledger = validateLedgerBindings(value);
  if (ledger.integrity.digest !== ledgerDigest(ledger.payload) || retainedDigest !== undefined && retainedDigest !== ledger.integrity.digest)
    throw new Error("Ledger digest mismatch");
  return ledger;
}

/** CSV has closed account roles, public IDs, references and integer text. No arbitrary prose cells. */
export function operatorLedgerCsv(value: unknown): string {
  const { payload, integrity } = verifyOperatorLedger(value);
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
export function operatorLedgerJson(value: unknown): string { return canonicalJson(verifyOperatorLedger(value)) + "\n"; }
