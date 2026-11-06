import { plain, type LedgerRunSnapshot } from "./capture";

export interface PublicLedgerRunReader {
  /** One synchronous, bounded native snapshot. Null positions still consume
   * the scan. No full run, question, answer, callback, cursor or handle escapes. */
  read(limit: number): Array<LedgerRunSnapshot | null>;
}

/** An unsupported enrolled proxy may refuse unknown property reads. A present
 * malformed/refusing capability never falls back to full public run hydration. */
export function publicLedgerRunReader(reader: object): PublicLedgerRunReader | undefined {
  const field = Object.getOwnPropertyDescriptor(reader, "publicLedgerRuns");
  if (!field) return;
  if (!("value" in field) || !plain(field.value)) throw new Error("Ledger native capability unavailable");
  const read = Object.getOwnPropertyDescriptor(field.value, "read");
  if (!read || !("value" in read) || typeof read.value !== "function") throw new Error("Ledger native capability unavailable");
  return field.value as unknown as PublicLedgerRunReader;
}
