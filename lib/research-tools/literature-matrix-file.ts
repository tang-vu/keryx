import { MATRIX_CSV_HEADER, MATRIX_FIELDS, MAX_MATRIX_CELL_CHARS, MAX_MATRIX_ROWS, validateLiteratureMatrix, type MatrixRow } from "./literature-matrix";
import { parseLiteratureWorkspace } from "../papers/literature-workspace";
import { literatureLibraryMatrix } from "./literature-matrix-library";

/** Covers even a full worksheet of JSON-escaped control characters. */
export const MAX_MATRIX_FILE_BYTES = 6 * 1024 * 1024;
const FORMAT = "keryx-literature-matrix";
export interface MatrixDocument { question: string; rows: MatrixRow[] }
export type MatrixFileKind = "csv" | "json" | "library";
export type MatrixFileIssue = "size" | "encoding" | "format" | "csv" | "headers" | "questions" | "limits" | "library";
export class MatrixFileError extends Error {
  constructor(public readonly issue: MatrixFileIssue) { super(issue); }
}

export function literatureMatrixJson(question: string, rows: readonly MatrixRow[]): string {
  validateLiteratureMatrix(question, rows);
  return JSON.stringify({ format: FORMAT, version: 1, question, rows: rows.map(row => Object.fromEntries(MATRIX_FIELDS.map(field => [field, row[field]]))) }, null, 2) + "\n";
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keysExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function checked(document: MatrixDocument): MatrixDocument {
  try { validateLiteratureMatrix(document.question, document.rows); }
  catch { throw new MatrixFileError("limits"); }
  return document;
}
function parseJson(text: string): MatrixDocument & { kind: MatrixFileKind } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new MatrixFileError("format"); }
  if (record(data) && data.scope === "personal-bibliography") {
    let workspace;
    try { workspace = parseLiteratureWorkspace(text); }
    catch { throw new MatrixFileError("library"); }
    try { return { ...literatureLibraryMatrix(workspace), kind: "library" }; }
    catch { throw new MatrixFileError("limits"); }
  }
  if (!record(data) || !keysExactly(data, ["format", "version", "question", "rows"]) || data.format !== FORMAT || data.version !== 1 ||
    typeof data.question !== "string" || !Array.isArray(data.rows) || data.rows.some(row => !record(row) || !keysExactly(row, MATRIX_FIELDS) || MATRIX_FIELDS.some(field => typeof row[field] !== "string"))) {
    throw new MatrixFileError("format");
  }
  return { ...checked({ question: data.question, rows: data.rows.map(row => Object.fromEntries(MATRIX_FIELDS.map(field => [field, row[field]])) as MatrixRow) }), kind: "json" };
}

/** Comma-separated UTF-8 CSV, quoted newlines and escaped quotes. Never executes cells. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closedQuote = false;
  function finishCell() {
    row.push(cell); cell = ""; closedQuote = false;
    if (row.length > MATRIX_CSV_HEADER.length) throw new MatrixFileError("csv");
  }
  function finishRow() {
    finishCell(); records.push(row); row = [];
    if (records.length > MAX_MATRIX_ROWS + 1) throw new MatrixFileError("limits");
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else cell += char;
    } else if (char === ",") finishCell();
    else if (char === "\r" || char === "\n") { finishRow(); if (char === "\r" && text[i + 1] === "\n") i++; }
    else if (closedQuote) throw new MatrixFileError("csv");
    else if (char === '"') { if (cell !== "") throw new MatrixFileError("csv"); quoted = true; }
    else cell += char;
    if (cell.length > MAX_MATRIX_CELL_CHARS) throw new MatrixFileError("limits");
  }
  if (quoted) throw new MatrixFileError("csv");
  if (cell !== "" || row.length || closedQuote) finishRow();
  return records;
}
function parseCsv(text: string): MatrixDocument {
  const [header, ...records] = csvRecords(text);
  if (!header || header.length !== MATRIX_CSV_HEADER.length || new Set(header).size !== header.length || MATRIX_CSV_HEADER.some(key => !header.includes(key))) throw new MatrixFileError("headers");
  const ordered = records.map(row => {
    if (row.length !== header.length) throw new MatrixFileError("csv");
    return MATRIX_CSV_HEADER.map(key => row[header.indexOf(key)]);
  });
  const question = ordered[0]?.[0] ?? "";
  if (ordered.some(row => row[0] !== question)) throw new MatrixFileError("questions");
  // A template contains one blank row; retain other empty rows rather than discard notes.
  const sources = ordered.length === 1 && ordered[0].slice(1).every(cell => cell === "") ? [] : ordered;
  return checked({ question, rows: sources.map(row => Object.fromEntries(MATRIX_FIELDS.map((field, i) => [field, row[i + 1]])) as MatrixRow) });
}

/** Decode bytes fatally: a different encoding must never silently corrupt notes. */
export function readLiteratureMatrixFile(bytes: Uint8Array): MatrixDocument & { kind: MatrixFileKind } {
  if (bytes.byteLength > MAX_MATRIX_FILE_BYTES) throw new MatrixFileError("size");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new MatrixFileError("encoding"); }
  if (text.trimStart().startsWith("{")) return parseJson(text);
  return { ...parseCsv(text), kind: "csv" };
}

/** Do not combine different review questions or silently truncate source rows. */
export function appendLiteratureMatrix(current: MatrixDocument, incoming: MatrixDocument): MatrixDocument {
  checked(current); checked(incoming);
  if (current.question !== incoming.question && (current.question !== "" || current.rows.length > 0)) throw new MatrixFileError("questions");
  return checked({ question: current.question || incoming.question, rows: [...current.rows, ...incoming.rows] });
}
