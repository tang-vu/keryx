import type { OwnedHistoryExport } from "./owned-history-export";

const cell = (value: unknown) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

/** Pure metadata serializer shared by HTTP and CLI. Original records are never rewritten. */
export function historyCsv(value: OwnedHistoryExport) {
  const headers = ["recordType", "id", "createdAt", "question", "ownerWallet", "surface", "visibility", "funding", "networks",
    "ownSettledSpendMicros", "sponsoredSettledSpendMicros", "receiptsTruncated", "paidCreators", "complete", "truncated", "nextCursor"];
  const records = [headers, ["metadata", "", "", value.qualification, value.wallet, "", "", "", "", "", "", "", "", value.complete, value.truncated, value.nextCursor],
    ...value.rows.map(row => ["run", row.id, row.createdAt, row.question, row.ownerWallet, row.provenance?.surface ?? "unknown", row.visibility, row.funding,
      row.networks.join(";"), row.ownSettledSpendMicros, row.sponsoredSettledSpendMicros, row.receiptsTruncated, JSON.stringify(row.paidCreators), "", "", ""])];
  return records.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
