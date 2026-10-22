import { describe, expect, it } from "vitest";
import { observedPdfTextScope, pdfTextScopeLimited, pdfTextScopeSchema, pdfTextScopeTruncated } from "./pdf-text-scope";

const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };

describe("observed PDF text coverage", () => {
  it("accepts only bounded ordered page observations and returns a separate snapshot", () => {
    const result = observedPdfTextScope(scope)!;
    expect(result).toEqual(scope); expect(result).not.toBe(scope); expect(result.pagesWithoutText).not.toBe(scope.pagesWithoutText);
    expect(pdfTextScopeLimited(result)).toBe(true);
    expect(pdfTextScopeLimited({ ...result, totalPages: 3, pagesWithoutText: [] })).toBe(false);
    expect(pdfTextScopeLimited({ ...result, totalPages: 3, pagesWithoutText: [], textLimitReached: true })).toBe(true);
    expect(pdfTextScopeLimited({ ...result, totalPages: 3 })).toBe(true);
    expect(pdfTextScopeTruncated({ ...result, totalPages: 3 })).toBe(false);
  });

  it.each([
    undefined, null, {}, { ...scope, format: "unknown" }, { ...scope, extra: "unobserved" },
    { ...scope, pagesRead: 101 }, { ...scope, pagesRead: 1.5 }, { ...scope, totalPages: 2 },
    { ...scope, totalPages: Infinity }, { ...scope, pagesWithoutText: [0] }, { ...scope, pagesWithoutText: [4] },
    { ...scope, pagesWithoutText: [2, 2] }, { ...scope, pagesWithoutText: [3, 1] },
    { ...scope, pagesWithoutText: [1, 2, 3] }, { ...scope, pagesWithoutText: [1, , 2] },
    { ...scope, pagesWithoutText: Array(101).fill(1) }, { ...scope, textLimitReached: "false" },
  ])("does not invent scope from absent or malformed metadata %#", value => {
    expect(observedPdfTextScope(value)).toBeUndefined();
    expect(pdfTextScopeSchema.safeParse(value).success).toBe(false);
  });

  it("ignores accessors and refuses throwing proxies without executing metadata getters", () => {
    let called = false;
    const value = { ...scope, get pagesRead() { called = true; return 3; } };
    expect(observedPdfTextScope(value)).toBeUndefined(); expect(called).toBe(false);
    const pages = [2]; Object.defineProperty(pages, "0", { get() { called = true; return 2; } });
    expect(observedPdfTextScope({ ...scope, pagesWithoutText: pages })).toBeUndefined(); expect(called).toBe(false);
    expect(observedPdfTextScope(new Proxy({}, { ownKeys() { throw new Error("private"); } }))).toBeUndefined();
  });
});
