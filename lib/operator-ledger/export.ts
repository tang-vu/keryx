import { ledgerDigest } from "./projection";
import { operatorLedgerCsvText, operatorLedgerJsonText } from "./serialize";
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
  return operatorLedgerCsvText(verifyOperatorLedger(value));
}
export function operatorLedgerJson(value: unknown): string { return operatorLedgerJsonText(verifyOperatorLedger(value)); }
