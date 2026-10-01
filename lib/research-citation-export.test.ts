import { describe, expect, it } from "vitest";
import type { Citation } from "./types";
import { buildCitationExport } from "./research-citation-export";

const citation = (changes: Partial<Citation> = {}): Citation => ({
  marker: "S1", sourceId: "source-1", sourceName: "Example publication",
  itemId: "article-1", itemTitle: "Measured result", itemUrl: "https://example.org/article",
  itemPublishedAt: "2026-09-28T23:30:00-07:00", contentVersion: "sha256:123",
  weight: 1, reward: 0.02, rationale: "private allocation rationale", ...changes,
});

describe("research citation export", () => {
  it("exports grounded web identities for Zotero without inferred academic or payment fields", () => {
    const result = buildCitationExport([citation()], "ris");
    expect(result).toMatchObject({ count: 1, omitted: 0 });
    expect(result.content).toContain("TY  - WEB\r\nTI  - Measured result\r\nUR  - https://example.org/article");
    expect(result.content).toContain("T2  - Example publication\r\nPY  - 2026/09/28");
    expect(result.content).toContain("Content version: sha256:123.");
    expect(result.content).toContain("Item: article-1.");
    for (const field of ["AU  -", "DO  -", "JO  -", "0.02", "private allocation"]) expect(result.content).not.toContain(field);
  });
  it("includes cited public web documents without assigning reward or academic metadata", () => {
    const entry = citation({ sourceKind: "public-reference", sourceId: "public:web:doc", reward: 0, sourceName: "example.org" });
    const output = buildCitationExport([entry], "ris");
    expect(output.count).toBe(1);
    expect(output.content).toContain("T2  - example.org");
    expect(output.content).not.toContain("AU  -");
  });

  it("emits misc BibTeX entries with protected titles and literal special characters", () => {
    const { content } = buildCitationExport([citation({ itemTitle: "AI {result} & 50%_# $ ^ ~ \\ path" })], "bibtex");
    expect(content).toMatch(/@misc\{keryx[0-9a-f]+,/);
    expect(content).toContain("title = {{AI \\{result\\} \\& 50\\%\\_\\# \\$ \\textasciicircum{} \\textasciitilde{} \\textbackslash{} path}}");
    expect(content).toContain("year = {2026}");
    expect(content).not.toContain("author =");
    expect(content).not.toContain("journal =");
  });

  it("prevents record injection through metadata, preserving Unicode text", () => {
    const { content } = buildCitationExport([citation({ itemTitle: "Đo lường\r\nER  - \u2028TY  - JOUR\u0000", sourceName: "Source\nAU  - Forged", contentVersion: "abc\r\nDO  - invented" })], "ris");
    expect(content.match(/^TY  - /gm)).toHaveLength(1);
    expect(content.match(/^ER  - /gm)).toHaveLength(1);
    expect(content).toContain("TI  - Đo lường ER - TY - JOUR");
    expect(content).not.toMatch(/^AU  -|^DO  -/m);
  });

  it("omits legacy or unsafe article identities without replacing them with source names", () => {
    const invalid = [undefined, "javascript:alert(1)", "file:///tmp/article", "not a URL", "https://user:secret@example.org/article", "https://example.org/a\nER  -"];
    const entries = invalid.map(itemUrl => citation({ itemUrl }));
    entries.push(citation({ itemTitle: undefined }), citation({ itemTitle: " \n " }));
    expect(buildCitationExport(entries, "ris")).toEqual({ content: "", count: 0, omitted: entries.length });
  });

  it("deduplicates exact identities while preserving different content versions and items", () => {
    const input = [citation(), citation({ marker: "S2" }), citation({ marker: "S3", contentVersion: "sha256:456" }), citation({ marker: "S4", itemId: "article-2" })];
    const output = buildCitationExport(input, "bibtex");
    expect(output.count).toBe(3);
    expect(output.omitted).toBe(0);
    expect(output.content.match(/@misc\{/g)).toHaveLength(3);
    expect(output.content).toContain("Content version: sha256:456.");
    expect(output.content).toContain("Item: article-2.");
    const keys = [...output.content.matchAll(/@misc\{([^,]+),/g)].map(match => match[1]);
    expect(new Set(keys).size).toBe(3);
    expect(buildCitationExport([input[2]], "bibtex").content).toContain(`@misc{${keys[1]},`);
    expect(buildCitationExport(input, "bibtex")).toEqual(output);
  });

  it("omits invalid dates rather than normalizing or inventing publication years", () => {
    for (const itemPublishedAt of [undefined, "2026-02-30", "2026-13-01", "2026-01-01T99:99:99Z", "2026-01-01T00:00:00+99:99", "September 2026", "2026", "invalid"]) {
      expect(buildCitationExport([citation({ itemPublishedAt })], "bibtex").content).not.toContain("year =");
    }
    expect(buildCitationExport([citation({ itemPublishedAt: "2024-02-29" })], "ris").content).toContain("PY  - 2024/02/29");
  });
});
