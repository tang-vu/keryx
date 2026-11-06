import { plain, type LedgerRunSnapshot } from "./capture";

export interface PublicLedgerRunCursor { id: string; createdAt: string }
export interface PublicLedgerRunPage {
  /** Null positions still consume the bounded scan; they never become ledger jobs. */
  snapshots: Array<LedgerRunSnapshot | null>;
  before: PublicLedgerRunCursor | null;
}
export interface PublicLedgerRunReader {
  /** Synchronous native snapshot. No full run, question, answer, caller callback or handle. */
  page(query: { take: number; before?: PublicLedgerRunCursor }): PublicLedgerRunPage;
}

export function ledgerRunCursor(value: unknown): value is PublicLedgerRunCursor {
  return plain(value) && Object.keys(value).sort().join(",") === "createdAt,id" &&
    typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) &&
    typeof value.createdAt === "string" && value.createdAt.length <= 128;
}

/** An unsupported enrolled proxy may refuse unknown property reads. A present
 * malformed/refusing capability never falls back to full public run hydration. */
export function publicLedgerRunReader(reader: object): PublicLedgerRunReader | undefined {
  const field = Object.getOwnPropertyDescriptor(reader, "publicLedgerRuns");
  if (!field) return;
  if (!("value" in field) || !plain(field.value)) throw new Error("Ledger native capability unavailable");
  const page = Object.getOwnPropertyDescriptor(field.value, "page");
  if (!page || !("value" in page) || typeof page.value !== "function") throw new Error("Ledger native capability unavailable");
  return field.value as unknown as PublicLedgerRunReader;
}
