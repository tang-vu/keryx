/**
 * CSV writer shared by the creator earnings exports.
 *
 * Every cell in these files is, or can contain, text a stranger wrote: the question that
 * triggered a payout comes from whoever asked it. So the writer assumes hostile input —
 * RFC 4180 quoting for anything a parser would misread, and formula neutralisation for
 * anything a spreadsheet would execute when the creator opens their own ledger.
 */

/** Rows are plain row interfaces (not index-signature maps), so cells are read by declared
 *  column key and coerced — a missing key writes an empty cell rather than "undefined". */
export function toCsv<T extends object>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(String(row[c] ?? ""))).join(","));
  }
  // Trailing newline: POSIX tools (and `wc -l`) treat a file without one as a short line.
  return lines.join("\r\n") + "\r\n";
}

function escapeCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralised) || neutralised !== neutralised.trim()) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}

/** Download filename: subject + UTC day, stripped to characters every OS accepts. */
export function exportFilename(subject: string, format: "csv" | "json"): string {
  const slug = subject.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60) || "keryx";
  const day = new Date().toISOString().slice(0, 10);
  return `keryx-earnings-${slug}-${day}.${format}`;
}
