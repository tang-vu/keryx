export interface MarkdownTable { headers: string[]; rows: string[][] }

/** A bounded pipe table, not arbitrary HTML. Escaped/literal/code pipes stay in
 * their original cells. Malformed/ragged input remains ordinary visible text. */
export function parseMarkdownTable(text: string): MarkdownTable | undefined {
  const lines = text.split("\n");
  if (lines.length < 3 || lines.length > 42 || text.length > 32_000) return;
  const split = (line: string): string[] | undefined => {
    line = line.trim();
    if (!line.startsWith("|") || !line.endsWith("|") || line[1] === "\u200b") return;
    const cells: string[] = []; let current = "", code = false;
    for (let index = 1; index < line.length - 1; index++) {
      const char = line[index];
      if (char === "\\" && line[index + 1] === "|") { current += "|\u200b"; index++; continue; }
      if (char === "`" && line[index + 1] !== "\u200b") code = !code;
      if (char === "|" && line[index + 1] !== "\u200b" && !code) { cells.push(current.trim()); current = ""; }
      else current += char;
    }
    if (code) return;
    cells.push(current.trim()); return cells;
  };
  const headers = split(lines[0]), separator = split(lines[1]), rows = lines.slice(2).map(split);
  if (!headers || headers.length < 2 || headers.length > 8 || headers.some(cell => !cell) ||
      !separator || separator.length !== headers.length || !separator.every(cell => /^:?-{3,}:?$/u.test(cell)) ||
      rows.some(row => !row || row.length !== headers.length)) return;
  return { headers, rows: rows as string[][] };
}
