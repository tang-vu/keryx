import { describe, expect, it } from "vitest";
import { buildDraftCheck, type DraftCheckRequest } from "./draft-check";
import { parseDraftReferences } from "./draft-check-references";
import { createDraftCheckRoute } from "./draft-check-route";
import { draftCheckTool } from "./draft-check-tool";

const wording = "Retrieval improves factual accuracy";
const source = { reference: "same", coverage: "partial" as const, text: `${wording}.` };
const duplicateList = "@article{same, title={First work}, doi={10.5555/first}}\n@article{same, title={Second work}, doi={10.5555/second}}";
const request = (changes: Partial<DraftCheckRequest> = {}): DraftCheckRequest => ({ version: 1, scope: "private-draft-check",
  passage: `${wording} \\cite{same}.`, references: { format: "bibtex", text: duplicateList }, sources: [], ...changes });

describe("unavailable reference bindings", () => {
  it.each(["bibtex", "ris"] as const)("marks every occurrence of a duplicate %s key unavailable", format => {
    const references = { format, text: format === "bibtex" ? duplicateList
      : "TY  - JOUR\nID  - same\nTI  - First work\nDO  - 10.5555/first\nER  -\nTY  - JOUR\nID  - same\nTI  - Second work\nDO  - 10.5555/second\nER  -" };
    const check = buildDraftCheck(request({ references, passage: `${wording} \\cite{same} [1, 2] [@same].` }));
    expect(check.references.map(row => [row.status, row.problem])).toEqual([["unresolved", "duplicate-key"], ["unresolved", "duplicate-key"]]);
    expect(check.claims[0]).toMatchObject({ verdict: "source-unavailable", citations: [
      { token: "same", unavailableReason: "reference-ambiguous" }, { token: "1", unavailableReason: "reference-unresolved" },
      { token: "2", unavailableReason: "reference-unresolved" }] });
    expect(check.claims[0].citations.every(row => row.verdict === "source-unavailable" && !row.excerpt)).toBe(true);
    expect(() => buildDraftCheck(request({ references, sources: [source] }))).toThrow();
  });

  it("preserves a real key that collides with a generated duplicate label", () => {
    const references = { format: "bibtex" as const, text: `${duplicateList}\n@article{same#2, title={Canonical third work}, doi={10.5555/third}}` };
    const parsed = parseDraftReferences(references.format, references.text);
    expect(new Set(parsed.map(row => row.key)).size).toBe(3);
    expect(parsed[2]).toMatchObject({ key: "same#2", number: 3, title: "Canonical third work", doi: "10.5555/third", status: "identified" });
    const check = buildDraftCheck(request({ references, passage: `${wording} [3].`, sources: [{ ...source, reference: "same#2" }] }));
    expect(check.claims[0].citations).toMatchObject([{ reference: "same#2", verdict: "supported", excerpt: { text: source.text } }]);
    expect(check.references.filter(row => row.sourceText === "partial")).toHaveLength(1);
  });

  it.each([
    { format: "bibtex" as const, text: "@article{same, title={Unterminated" },
    { format: "ris" as const, text: "TY  - JOUR\nID  - same\nTI  - Unclosed record\nAU  - Smith, Jane\nPY  - 2020\nDO  - 10.5555/unclosed" },
  ])("does not treat caller text as resolving an unreadable $format entry", references => {
    const passage = `${wording} \\cite{same} [1].`;
    const check = buildDraftCheck(request({ references, passage, sources: [source] }));
    expect(check.claims[0]).toMatchObject({ start: 0, end: passage.length, text: passage, verdict: "source-unavailable",
      citations: [{ reference: "same", verdict: "source-unavailable", evidence: "source-unavailable", unavailableReason: "reference-unresolved" }] });
    expect(check.claims[0].citations[0]).not.toHaveProperty("excerpt");
    if (references.format === "ris") expect(buildDraftCheck(request({ references, passage: `${wording} (Smith, 2020).`, sources: [source] })).claims[0].verdict).toBe("source-unavailable");
  });

  it("returns the same unavailable result through the API and MCP handlers", async () => {
    const input = request({ references: { format: "bibtex", text: "@article{same, title={Unterminated" }, sources: [source] });
    const handler = createDraftCheckRoute(async () => null);
    const response = await handler(new Request("https://example.invalid/api/research/draft-check", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }));
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output.check.claims[0].verdict).toBe("source-unavailable");
    expect(draftCheckTool({ check: input }).structuredContent).toEqual(output);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps an unidentified entry unavailable while allowing an unverified described work", () => {
    const check = (text: string) => buildDraftCheck(request({ references: { format: "list", text },
      passage: `${wording} [1].`, sources: [{ ...source, reference: "ref1" }] }));
    expect(check("???").claims[0].citations).toMatchObject([{ verdict: "source-unavailable", unavailableReason: "reference-unresolved" }]);
    expect(check("An unverified described work").claims[0].citations).toMatchObject([{ verdict: "supported", excerpt: { text: source.text } }]);
  });
});

describe("complete bounded citation lists", () => {
  it.each(["latex", "author-year", "numeric"])("accepts a full reference list in one %s marker", kind => {
    const keys = Array.from({ length: 64 }, (_, i) => `reference${i + 1}`);
    const authors = keys.map((_, i) => `Author${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`);
    const references = { format: "bibtex" as const, text: keys.map((key, i) => `@article{${key}, author={${authors[i]}, Given}, year={2020}, doi={10.5555/${key}}}`).join("\n") };
    const marker = kind === "latex" ? `\\cite{${keys.join(",")}}` : kind === "numeric" ? "[1-64]"
      : `(${authors.map(author => `${author}, 2020`).join("; ")})`;
    const check = buildDraftCheck(request({ references, passage: `${wording} ${marker}.`, sources: [{ ...source, reference: "reference64" }] }));
    expect(check.claims[0].citations).toHaveLength(64);
    expect(check.claims[0].citations[63]).toMatchObject({ reference: "reference64", verdict: "supported" });
    expect(check.claims[0].verdict).toBe("supported");
  });

  it.each(["latex", "author-year"])("keeps the seventeenth %s citation when only it has supplied text", kind => {
    const keys = Array.from({ length: 17 }, (_, i) => `k${i + 1}`);
    const authors = keys.map((_, i) => `Author${String.fromCharCode(65 + i)}`);
    const references = { format: "bibtex" as const, text: keys.map((key, i) => `@article{${key}, author={${authors[i]}, Given}, year={2020}, doi={10.5555/${key}}}`).join("\n") };
    const marker = kind === "latex" ? `\\cite{${keys.join(",")}}` : `(${authors.map(author => `${author}, 2020`).join("; ")})`;
    const passage = `${wording} ${marker}.`;
    const check = buildDraftCheck(request({ references, passage, sources: [{ ...source, reference: "k17" }] }));
    expect(check.claims[0]).toMatchObject({ start: 0, end: passage.length, text: passage, verdict: "supported" });
    expect(check.claims[0].citations).toHaveLength(17);
    expect(check.claims[0].citations[16]).toMatchObject({ reference: "k17", verdict: "supported", excerpt: { start: 0, end: source.text.length, text: source.text } });
    expect(check.flags.some(flag => flag.kind === "reference-not-cited" && flag.reference === "k17")).toBe(false);
  });
});
