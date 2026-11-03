import { literatureMatrixJson, MAX_MATRIX_FILE_BYTES, readLiteratureMatrixFile, type MatrixDocument } from "./literature-matrix-file";

export const MATRIX_RECOVERY_KEY = "keryx-literature-matrix-recovery-v1";
export const MATRIX_RECOVERY_DISABLED = "keryx-literature-matrix-recovery-disabled-v1";

/** Recovery has exactly the editable file contract; a library/CSV is never a recovery record. */
export function readMatrixRecovery(text: string): MatrixDocument | "disabled" {
  if (text === MATRIX_RECOVERY_DISABLED) return "disabled";
  if (text.length > MAX_MATRIX_FILE_BYTES || !text.trimStart().startsWith("{")) throw new Error("Invalid matrix recovery");
  const document = readLiteratureMatrixFile(new TextEncoder().encode(text));
  if (document.kind !== "json") throw new Error("Invalid matrix recovery");
  return { question: document.question, rows: document.rows };
}

export function writeMatrixRecovery(document: MatrixDocument): string {
  return literatureMatrixJson(document.question, document.rows);
}
