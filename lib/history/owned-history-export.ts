import { readOwnedHistory, type OwnedHistoryDB } from "./owned-history-reader";
import type { OwnedHistoryInput, OwnedHistoryRow } from "./owned-history";
import type { RunClaimBinding } from "../run-claims/contracts";

/** Bounded whole-history attempt. Continuation is explicit, including empty filtered scan pages. */
export async function exportOwnedHistory(db: OwnedHistoryDB, wallet: string, binding: RunClaimBinding, input: OwnedHistoryInput, signal?: AbortSignal) {
  const deadline = Date.now() + 25_000;
  const rows: OwnedHistoryRow[] = [], { cursor: initial, ...filters } = input;
  let cursor = initial, nextCursor: string | null = initial ?? null, complete = false, pages = 0, size = 0;
  let scope: string | null = null, claimsAvailable = false, membershipAvailable = false;
  for (; pages < 20; pages++) {
    if (Date.now() > deadline) break;
    const page = await readOwnedHistory(db, wallet, binding, { ...filters, limit: 50, cursor }, signal);
    const bytes = Buffer.byteLength(JSON.stringify(page.rows));
    if (size + bytes > 2 * 1024 * 1024) break;
    size += bytes; rows.push(...page.rows); scope = page.scope; claimsAvailable = page.claimsAvailable; membershipAvailable = page.membershipAvailable;
    nextCursor = page.nextCursor;
    if (!nextCursor) { complete = true; pages++; break; }
    cursor = nextCursor;
  }
  return { version: 2 as const, wallet: wallet.toLowerCase(), scope, rows, complete, truncated: !complete, nextCursor,
    bounds: { maxPages: 20, maxRows: 1000, maxBytes: 2 * 1024 * 1024 }, pages,
    claimsAvailable, membershipAvailable, qualification: "Current-store owned metadata only; not a transaction snapshot, all archives, missing claims/membership, full report bodies or an unbounded receipt export." };
}
export type OwnedHistoryExport = Awaited<ReturnType<typeof exportOwnedHistory>>;
const cell = (v: unknown) => {
  let text = v === null || v === undefined ? "" : String(v);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
};
/** Metadata row exists even with zero runs. CSV formula neutralization changes presentation only. */
export function historyCsv(value: OwnedHistoryExport) {
  const headers = ["recordType", "id", "createdAt", "question", "ownerWallet", "surface", "visibility", "funding", "networks",
    "ownSettledSpendMicros", "sponsoredSettledSpendMicros", "receiptsTruncated", "paidCreators", "complete", "truncated", "nextCursor"];
  const records = [headers, ["metadata", "", "", value.qualification, value.wallet, "", "", "", "", "", "", "", "", value.complete, value.truncated, value.nextCursor],
    ...value.rows.map(r => ["run", r.id, r.createdAt, r.question, r.ownerWallet, r.provenance?.surface ?? "unknown", r.visibility, r.funding,
      r.networks.join(";"), r.ownSettledSpendMicros, r.sponsoredSettledSpendMicros, r.receiptsTruncated, JSON.stringify(r.paidCreators), "", "", ""])];
  return records.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
