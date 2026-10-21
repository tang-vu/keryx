import { describe, expect, it } from "vitest";
import { emptyMatrixRow, literatureMatrixCsv, MAX_MATRIX_CELL_CHARS, MAX_MATRIX_ROWS } from "./literature-matrix";
import { GET as template } from "@/app/tools/literature-review-matrix/template.csv/route";

describe("literature matrix CSV downloads", () => {
  it("serves a blank no-JavaScript download without user data or a competing indexed document", async () => {
    const response = template();
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="literature-review-matrix-template.csv"');
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toBe(literatureMatrixCsv("", []));
  });
  it("provides an empty, nine-column template without invented references", () => {
    const csv = literatureMatrixCsv("", []);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv.split("\r\n")[0].split(",")).toHaveLength(9);
    expect(csv.split("\r\n")[1]).toBe(Array(9).fill('""').join(","));
  });

  it("preserves commas, quotes, newlines and Unicode with every source's question", () => {
    const row = { ...emptyMatrixRow(), title: 'Nguyễn, "A"', finding: "First line\nSecond line", locator: "Table 2" };
    const csv = literatureMatrixCsv("Evidence?", [row, { ...row, title: "Other source" }]);
    expect(csv).toContain('"Nguyễn, ""A"""');
    expect(csv).toContain('"First line\nSecond line"');
    expect(csv.match(/"Evidence\?"/g)).toHaveLength(2);
    expect(csv).toContain('"Table 2"');
  });

  it.each(["=HYPERLINK(\"https://example.org\")", "+1", "-1+2", "@SUM(A1)", "\t=1", "\u200b=1"])("neutralizes spreadsheet formulas: %s", value => {
    const csv = literatureMatrixCsv(value, [{ ...emptyMatrixRow(), title: value, finding: value }]);
    expect(csv).toContain(`"'${value.replace(/"/g, '""')}"`);
    expect(csv.match(/"'/g)).toHaveLength(3);
  });

  it("refuses oversized input rather than silently dropping source notes", () => {
    expect(() => literatureMatrixCsv("", Array(MAX_MATRIX_ROWS + 1).fill(emptyMatrixRow()))).toThrow(RangeError);
    expect(() => literatureMatrixCsv("x".repeat(MAX_MATRIX_CELL_CHARS + 1), [])).toThrow(RangeError);
    expect(() => literatureMatrixCsv("", [{ ...emptyMatrixRow(), finding: "x".repeat(MAX_MATRIX_CELL_CHARS + 1) }])).toThrow(RangeError);
    expect(literatureMatrixCsv("", Array(MAX_MATRIX_ROWS).fill(emptyMatrixRow()))).toBeTruthy();
  });
});
