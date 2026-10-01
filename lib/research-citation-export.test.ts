import { describe, expect, it } from "vitest";
import type { Citation, ScholarlyMetadata } from "./types";
import { buildCitationExport } from "./research-citation-export";

const citation = (changes: Partial<Citation> = {}): Citation => ({
  marker: "S1", sourceId: "source-1", sourceName: "Example publication",
  itemId: "article-1", itemTitle: "Measured result", itemUrl: "https://example.org/article",
  itemPublishedAt: "2026-09-28T23:30:00-07:00", contentVersion: "sha256:123",
  weight: 1, reward: 0.02, rationale: "private allocation rationale", ...changes,
});

const scholarly: ScholarlyMetadata = { provider: "crossref", recordUrl: "https://api.crossref.org/works/10.1234%2Fpaper", retrievedAt: "2026-10-01T00:00:00Z",
  title: "Observed article", authors: ["Ada Lovelace", "Research Group"], authorNames: [{ given: "Ada", family: "Lovelace" }, { literal: "Research Group" }],
  doi: "10.1234/paper", journal: "Observed Journal", publishedDate: "2026", volume: "2", issue: "3", pages: "1-5", workType: "journal-article", peerReview: "unknown", evidenceScope: "publisher-page" };
it("exports only recorded scholarly metadata with structured Crossref author names and partial publication dates", () => {
  const bib = buildCitationExport([citation({ scholarly })], "bibtex").content;
  expect(bib).toContain("@article{"); expect(bib).toContain("author = {{Lovelace}, {Ada} and {Research Group}}");
  expect(bib).toContain("doi = {10.1234/paper}"); expect(bib).toContain("journal = {Observed Journal}"); expect(bib).toContain("year = {2026}");
  const ris = buildCitationExport([citation({ scholarly })], "ris").content;
  expect(ris).toContain("TY  - JOUR"); expect(ris).toContain("AU  - Lovelace, Ada\r\nAU  - Research Group"); expect(ris).toContain("PY  - 2026");
  expect(ris).toContain("Peer review unknown"); expect(ris).toContain("Read scope: publisher-page");
});
it("exports preprints and abstract-only read limitations without claiming a reviewed or fully read paper", () => {
  const metadata: ScholarlyMetadata = { ...scholarly, provider: "arxiv", workType: "preprint", evidenceScope: "abstract-page", arxivId: "1706.03762v7", authorNames: undefined };
  expect(buildCitationExport([citation({ scholarly: metadata })], "ris").content).toContain("TY  - UNPB");
  const bib = buildCitationExport([citation({ scholarly: metadata })], "bibtex").content;
  expect(bib).toContain("@misc{"); expect(bib).toContain("archivePrefix = {arXiv}"); expect(bib).toContain("Read scope: abstract-page. Preprint.");
});
it("escapes scholarly field injection and ignores metadata that has not been bound to an actual read", () => {
  const attack = "Bad}\nER  - \n@article{inject,%";
  const metadata = { ...scholarly, authors: [attack], authorNames: undefined, journal: attack, doi: attack, volume: attack };
  const ris = buildCitationExport([citation({ scholarly: metadata })], "ris").content;
  expect(ris.match(/^ER  - /gm)).toHaveLength(1); expect(ris.match(/^TY  - /gm)).toHaveLength(1);
  const bib = buildCitationExport([citation({ scholarly: metadata })], "bibtex").content;
  expect(bib.match(/^@article\{/gm)).toHaveLength(1); expect(bib).toContain("Bad\\}");
  const unbound = buildCitationExport([citation({ scholarly: { ...scholarly, evidenceScope: undefined } })], "ris").content;
  expect(unbound).toContain("TY  - WEB"); expect(unbound).not.toContain("AU  -");
});
it("retains incomplete contributor-list limits in both reference formats", () => {
  for (const format of ["bibtex", "ris"] as const) expect(buildCitationExport([citation({ scholarly: { ...scholarly, authorCount: 80, authorsTruncated: true } })], format).content)
    .toContain("Incomplete contributor list: 2/80 provider entries recorded; capped at 50.");
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
