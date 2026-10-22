import { describe, expect, it } from "vitest";
import { emptyMatrixRow, literatureMatrixCsv, MATRIX_CSV_HEADER, MAX_MATRIX_CELL_CHARS, MAX_MATRIX_ROWS } from "./literature-matrix";
import { appendLiteratureMatrix, literatureMatrixJson, MatrixFileError, MAX_MATRIX_FILE_BYTES, readLiteratureMatrixFile } from "./literature-matrix-file";

const bytes = (text: string) => new TextEncoder().encode(text);
const read = (text: string) => readLiteratureMatrixFile(bytes(text));
const row = { ...emptyMatrixRow(), title: 'Nguyễn, "study"', finding: "=1+2\nSecond line 🧪", locator: "Table 2", decision: "Include: context fits" };
const document = { question: "Does retrieval improve factuality?", rows: [row] };

describe("portable literature matrix files", () => {
  it("reopens an editable file with exact original notes, formulas, Unicode and empty source rows", () => {
    const input = { ...document, rows: [row, emptyMatrixRow()] };
    expect(read(literatureMatrixJson(input.question, input.rows))).toEqual({ ...input, kind: "json" });
    expect(read(literatureMatrixJson("", []))).toEqual({ question: "", rows: [], kind: "json" });
  });

  it("imports existing CSV exports and preserves safety apostrophes instead of guessing at user text", () => {
    expect(read(literatureMatrixCsv(document.question, document.rows))).toEqual({ ...document, rows: [{ ...row, finding: "'" + row.finding }], kind: "csv" });
    expect(read(literatureMatrixCsv("Review question only", []))).toEqual({ question: "Review question only", rows: [], kind: "csv" });
    expect(read(literatureMatrixCsv("", []))).toEqual({ question: "", rows: [], kind: "csv" });
  });

  it("accepts BOM, CRLF/LF/CR records, no final newline and rearranged template columns", () => {
    const header = [...MATRIX_CSV_HEADER].reverse();
    const values = ["Question", "Title", "https://example.org", "Review", "Context", "Finding", "Limit", "Page 1", "Include"].reverse();
    for (const newline of ["\r\n", "\n", "\r"]) {
      const incoming = read("\ufeff" + header.join(",") + newline + values.join(","));
      expect(incoming).toEqual({ question: "Question", rows: [{ title: "Title", identifier: "https://example.org", design: "Review", population: "Context", finding: "Finding", limitation: "Limit", locator: "Page 1", decision: "Include" }], kind: "csv" });
    }
  });

  it("retains CRLF inside quoted notes, quotes and trailing empty fields", () => {
    const source = { ...emptyMatrixRow(), title: 'A, "B"', finding: "First\r\nSecond" };
    expect(read(literatureMatrixCsv("Q", [source]))).toEqual({ question: "Q", rows: [source], kind: "csv" });
  });

  it("accepts a header-only worksheet and the exact row/field limits", () => {
    expect(read(MATRIX_CSV_HEADER.join(","))).toEqual({ question: "", rows: [], kind: "csv" });
    const full = { ...emptyMatrixRow(), finding: "x".repeat(MAX_MATRIX_CELL_CHARS) };
    expect(read(literatureMatrixJson("q".repeat(MAX_MATRIX_CELL_CHARS), Array(MAX_MATRIX_ROWS).fill(full))).rows).toHaveLength(MAX_MATRIX_ROWS);
    expect(read(literatureMatrixCsv("q", Array(MAX_MATRIX_ROWS).fill(full))).rows).toHaveLength(MAX_MATRIX_ROWS);
  });

  it("refuses excessive bytes before decoding, and invalid UTF-8 rather than replacing notes", () => {
    expect(() => readLiteratureMatrixFile(new Uint8Array(MAX_MATRIX_FILE_BYTES + 1))).toThrow(expect.objectContaining({ issue: "size" }));
    expect(() => readLiteratureMatrixFile(new Uint8Array([0xff, 0xfe, 0x41]))).toThrow(expect.objectContaining({ issue: "encoding" }));
  });

  it.each([
    { format: "other", version: 1, ...document },
    { format: "keryx-literature-matrix", version: 2, ...document },
    { format: "keryx-literature-matrix", version: 1, ...document, extra: "Do not discard me" },
    { format: "keryx-literature-matrix", version: 1, ...document, rows: [{ ...row, extra: "Do not discard me" }] },
    { format: "keryx-literature-matrix", version: 1, ...document, rows: [{ ...row, finding: 123 }] },
    { format: "keryx-literature-matrix", version: 1, question: null, rows: [] },
  ])("refuses unsupported JSON schema without silently discarding fields", input => {
    expect(() => read(JSON.stringify(input))).toThrow(expect.objectContaining({ issue: "format" }));
  });

  it("refuses prototype-shaped data without merging imported object keys", () => {
    const text = literatureMatrixJson("Q", [row]).replace('"version": 1,', '"version": 1, "__proto__": {"polluted": true},');
    expect(() => read(text)).toThrow(MatrixFileError);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each(['"unfinished', 'unquoted"quote', '"closed"junk', 'a,b', '"a",,,,,,,,,', '\n']) (
    "refuses malformed or inconsistent CSV rows: %s", record => {
      expect(() => read(MATRIX_CSV_HEADER.join(",") + "\n" + record)).toThrow(MatrixFileError);
    });

  it("refuses unsupported or duplicate headers and mixed research questions", () => {
    expect(() => read("title,notes\nA,B")).toThrow(expect.objectContaining({ issue: "headers" }));
    expect(() => read([...MATRIX_CSV_HEADER.slice(0, -1), MATRIX_CSV_HEADER[0]].join(","))).toThrow(expect.objectContaining({ issue: "headers" }));
    const csv = literatureMatrixCsv("Q1", [row]) + literatureMatrixCsv("Q2", [row]).split("\r\n").slice(1).join("\r\n");
    expect(() => read(csv)).toThrow(expect.objectContaining({ issue: "questions" }));
  });

  it("rejects too many rows or long notes instead of truncating data", () => {
    const data = JSON.parse(literatureMatrixJson("Q", [row]));
    data.rows = Array(MAX_MATRIX_ROWS + 1).fill(row);
    expect(() => read(JSON.stringify(data))).toThrow(expect.objectContaining({ issue: "limits" }));
    data.rows = [{ ...row, finding: "x".repeat(MAX_MATRIX_CELL_CHARS + 1) }];
    expect(() => read(JSON.stringify(data))).toThrow(expect.objectContaining({ issue: "limits" }));
    const csv = MATRIX_CSV_HEADER.join(",") + "\n" + Array(MAX_MATRIX_ROWS + 1).fill('"Q",,,,,,,,').join("\n");
    expect(() => read(csv)).toThrow(expect.objectContaining({ issue: "limits" }));
    expect(() => read(MATRIX_CSV_HEADER.join(",") + "\n" + "x".repeat(MAX_MATRIX_CELL_CHARS + 1))).toThrow(expect.objectContaining({ issue: "limits" }));
  });

  it("adds rows without mutating either matrix and preserves duplicate source notes", () => {
    const before = structuredClone(document);
    expect(appendLiteratureMatrix(document, document)).toEqual({ ...document, rows: [row, row] });
    expect(document).toEqual(before);
    expect(appendLiteratureMatrix({ question: "", rows: [] }, document)).toEqual(document);
  });

  it("refuses incompatible questions and over-capacity additions without changing either input", () => {
    const before = structuredClone(document);
    for (const current of [{ question: "Other question", rows: [] }, { question: "", rows: [emptyMatrixRow()] }]) {
      expect(() => appendLiteratureMatrix(current, document)).toThrow(expect.objectContaining({ issue: "questions" }));
    }
    expect(() => appendLiteratureMatrix({ ...document, rows: Array(MAX_MATRIX_ROWS).fill(row) }, document)).toThrow(expect.objectContaining({ issue: "limits" }));
    expect(document).toEqual(before);
  });
});
