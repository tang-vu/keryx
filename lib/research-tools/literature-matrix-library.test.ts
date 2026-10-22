import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "../papers/catalog";
import { emptyLiteratureWorkspace, MAX_LITERATURE_BYTES, saveLiteraturePaper, type LiteratureWorkspace } from "../papers/literature-workspace";
import { emptyMatrixRow, MAX_MATRIX_CELL_CHARS } from "./literature-matrix";
import { appendLiteratureMatrix, literatureMatrixJson, readLiteratureMatrixFile } from "./literature-matrix-file";
import { literatureLibraryMatrix } from "./literature-matrix-library";

const read = (value: unknown) => readLiteratureMatrixFile(new TextEncoder().encode(JSON.stringify(value)));
const saved = () => saveLiteraturePaper(emptyLiteratureWorkspace(), PAPER_CATALOG[0], "2026-10-22T00:00:00.000Z");

describe("literature library to reading matrix", () => {
  it("copies the question, exact source identity and screening notes without inventing reading evidence", () => {
    const library = saved();
    library.question = "Which findings apply to our population?";
    library.entries[0].screening = "undecided";
    library.entries[0].notes = '=SUM(1,2)\r\nNguyễn 🧪 <script>alert("notes")</script>';
    const before = structuredClone(library), paper = library.entries[0].paper;
    const result = read(library);
    expect(result).toEqual({ question: library.question, kind: "library", rows: [{
      ...emptyMatrixRow(),
      title: [paper.title, paper.authors.join("; "), String(paper.publishedYear)].join("\n"),
      identifier: [paper.url, paper.doi].filter(Boolean).join("\n"),
      decision: "Undecided\n" + library.entries[0].notes,
    }] });
    expect(library).toEqual(before);
    expect(readLiteratureMatrixFile(new TextEncoder().encode(literatureMatrixJson(result.question, result.rows)))).toEqual({ ...result, kind: "json" });
  });

  it("keeps observed versions as distinct rows and discloses an incomplete author list", () => {
    const library = saved(), first = library.entries[0].paper;
    const arxivId = first.arxivId!.replace(/v\d+$/, "v99");
    const second = { ...first, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}`,
      authors: [], authorCount: 3, authorsTruncated: true };
    const both = saveLiteraturePaper(library, second, "2026-10-22T00:00:00.000Z");
    const result = read(both);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].identifier).toContain(first.url);
    expect(result.rows[1].identifier).toContain(second.url);
    expect(result.rows[1].title).toContain("0 of 3 author names recorded");
    expect(result.rows[1].decision).toBe("To screen");
  });

  it("keeps missing years, DOI and author names absent, and preserves empty libraries", () => {
    const library = saved();
    delete library.entries[0].paper.publishedYear; delete library.entries[0].paper.doi;
    library.entries[0].paper.authors = []; library.entries[0].paper.authorCount = 0;
    library.entries[0].paper.authorsTruncated = false;
    expect(read(library).rows[0]).toMatchObject({ title: library.entries[0].paper.title, identifier: library.entries[0].paper.url });
    expect(read(emptyLiteratureWorkspace())).toEqual({ question: "", rows: [], kind: "library" });
  });

  it.each([["unscreened", "To screen"], ["include", "Include"], ["exclude", "Exclude"], ["undecided", "Undecided"]] as const)("preserves %s as the user's screening decision", (screening, label) => {
    const library = saved(); library.entries[0].screening = screening;
    const row = read(library).rows[0];
    expect(row.decision).toBe(label);
    for (const field of ["finding", "design", "population", "limitation", "locator"] as const) expect(row[field]).toBe("");
  });

  it("refuses invalid backups, unknown fields, future versions, duplicated identities and unsafe source URLs", () => {
    const library = saved();
    for (const bad of [
      { ...library, version: 2 }, { ...library, unknown: "Do not silently drop" },
      { ...library, entries: [library.entries[0], library.entries[0]] },
      { ...library, entries: [{ ...library.entries[0], notes: 123 }] },
      { ...library, entries: [{ ...library.entries[0], paper: { ...library.entries[0].paper, url: "javascript:alert(1)" } }] },
      { ...library, entries: [{ ...library.entries[0], paper: { ...library.entries[0].paper, settled: true } }] },
    ]) expect(() => read(bad)).toThrow(expect.objectContaining({ issue: "library" }));
    expect(() => read({ ...library, title: "x".repeat(MAX_LITERATURE_BYTES) })).toThrow(expect.objectContaining({ issue: "library" }));
  });

  it("refuses overlong composed fields rather than truncating valid original author lists or notes", () => {
    const library = saved(); library.entries[0].notes = "x".repeat(MAX_MATRIX_CELL_CHARS);
    expect(() => read(library)).toThrow(expect.objectContaining({ issue: "limits" }));
    library.entries[0].notes = "x".repeat(MAX_MATRIX_CELL_CHARS - "To screen\n".length);
    expect(read(library).rows[0].decision).toHaveLength(MAX_MATRIX_CELL_CHARS);
    library.entries[0].paper.authors = Array(10).fill("a".repeat(300));
    library.entries[0].paper.authorCount = 10;
    expect(() => read(library)).toThrow(expect.objectContaining({ issue: "limits" }));
    expect(library.entries[0].paper.authors).toHaveLength(10);
  });

  it("applies existing question/cap rules to derived sources without mutating current notes", () => {
    const library = saved(); library.question = "Q";
    const incoming = read(library), current = { question: "Q", rows: [{ ...emptyMatrixRow(), finding: "Existing checked passage" }] };
    const before = structuredClone(current);
    expect(appendLiteratureMatrix(current, incoming).rows).toEqual([...current.rows, ...incoming.rows]);
    expect(() => appendLiteratureMatrix({ ...current, question: "Other" }, incoming)).toThrow(expect.objectContaining({ issue: "questions" }));
    expect(() => appendLiteratureMatrix({ ...current, rows: Array(50).fill(current.rows[0]) }, incoming)).toThrow(expect.objectContaining({ issue: "limits" }));
    expect(current).toEqual(before);
  });

  it("maps all 50 valid records and never groups separate sources by title", () => {
    const library: LiteratureWorkspace = { ...emptyLiteratureWorkspace(), entries: Array.from({ length: 50 }, (_, i) => {
      const arxivId = `2601.${String(i + 1).padStart(5, "0")}v1`;
      return { ...saved().entries[0], paper: { ...PAPER_CATALOG[0], arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` } };
    }) };
    expect(read(library).rows).toHaveLength(50);
    expect(literatureLibraryMatrix(library).rows).toEqual(read(library).rows);
  });
});
