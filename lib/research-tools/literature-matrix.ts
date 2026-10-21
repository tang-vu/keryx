import { evidenceCsvCell } from "../research/evidence-matrix";

export const MATRIX_FIELDS = ["title", "identifier", "design", "population", "finding", "limitation", "locator", "decision"] as const;
export type MatrixField = typeof MATRIX_FIELDS[number];
export type MatrixRow = Record<MatrixField, string>;
export const MAX_MATRIX_ROWS = 50;
export const MAX_MATRIX_CELL_CHARS = 2000;

export function emptyMatrixRow(): MatrixRow {
  return Object.fromEntries(MATRIX_FIELDS.map(field => [field, ""])) as MatrixRow;
}

/** Stable, portable CSV; user text never becomes an executable spreadsheet cell. */
export function literatureMatrixCsv(question: string, rows: readonly MatrixRow[]): string {
  if (rows.length > MAX_MATRIX_ROWS || question.length > MAX_MATRIX_CELL_CHARS ||
    rows.some(row => MATRIX_FIELDS.some(field => typeof row[field] !== "string" || row[field].length > MAX_MATRIX_CELL_CHARS))) {
    throw new RangeError("Literature matrix exceeds worksheet limits");
  }
  const header = ["research_question", "source_title_author_year", "doi_or_url", "study_design", "population_context", "relevant_finding", "limitations", "source_locator", "screening_decision_reason"];
  const values = (rows.length ? rows : [emptyMatrixRow()]).map(row => [question, ...MATRIX_FIELDS.map(field => row[field])]);
  return [header, ...values].map(row => row.map(evidenceCsvCell).join(",")).join("\r\n") + "\r\n";
}
