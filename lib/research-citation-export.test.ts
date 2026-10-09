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
it("exports CSL-JSON with observed names, publication precision and the existing stable citation key", () => {
  const row = citation({ scholarly });
  const result = buildCitationExport([row], "csl-json");
  const [entry] = JSON.parse(result.content);
  expect(result).toMatchObject({ count: 1, omitted: 0 });
  expect(entry).toMatchObject({ type: "article-journal", title: row.itemTitle, URL: row.itemUrl,
    author: [{ family: "Lovelace", given: "Ada" }, { literal: "Research Group" }],
    issued: { "date-parts": [[2026]] }, DOI: scholarly.doi, "container-title": scholarly.journal,
    volume: "2", issue: "3", page: "1-5", version: row.contentVersion });
  expect(entry["citation-key"]).toBe(entry.id);
  expect(buildCitationExport([row], "bibtex").content).toContain(`@article{${entry.id},`);
  expect(entry.note).toContain("Read scope: publisher-page");
  expect(result.content).not.toMatch(/private allocation rationale|reward|payTo/);
});
it("keeps CSL references distinct across versions and stable across order, with no inferred names or read authority", () => {
  const a = citation({ scholarly: { ...scholarly, evidenceScope: undefined }, itemTitle: 'Title " } ] 日本語' });
  const b = citation({ contentVersion: "other-version" });
  const first = JSON.parse(buildCitationExport([a, a, b], "csl-json").content);
  const second = JSON.parse(buildCitationExport([b, a], "csl-json").content);
  expect(first).toHaveLength(2);
  expect(first[0]).toMatchObject({ type: "webpage", title: a.itemTitle, issued: { "date-parts": [[2026, 9, 28]] } });
  expect(first[0]).not.toHaveProperty("author"); expect(first[0]).not.toHaveProperty("DOI");
  expect(first.map((entry: { id: string }) => entry.id)).toEqual(second.map((entry: { id: string }) => entry.id).reverse());
  expect(buildCitationExport([], "csl-json")).toEqual({ count: 0, omitted: 0, content: "[]\n" });
  expect(buildCitationExport([citation({ itemUrl: "javascript:alert(1)" })], "csl-json")).toEqual({ count: 0, omitted: 1, content: "[]\n" });
});
it("exports preprints and abstract-only read limitations without claiming a reviewed or fully read paper", () => {
  const metadata: ScholarlyMetadata = { ...scholarly, provider: "arxiv", workType: "preprint", evidenceScope: "abstract-page", arxivId: "1706.03762v7", authorNames: undefined };
  expect(buildCitationExport([citation({ scholarly: metadata })], "ris").content).toContain("TY  - MANSCPT");
  const bib = buildCitationExport([citation({ scholarly: metadata })], "bibtex").content;
  expect(bib).toContain("@misc{"); expect(bib).toContain("archivePrefix = {arXiv}"); expect(bib).toContain("Read scope: abstract-page. Preprint.");
});
it("does not infer a journal from a source name when a scholarly record lacks one", () => {
  for (const workType of ["preprint", "journal-article"] as const) {
    const metadata = { ...scholarly, workType, journal: undefined };
    const ris = buildCitationExport([citation({ scholarly: metadata, sourceName: "arxiv.org" })], "ris").content;
    expect(ris).not.toMatch(/^(JO|T2)  -/m);
    expect(ris).toContain("Source: arxiv.org.");
  }
});
it("preserves literal scholarly provenance in HTML-aware RIS notes without changing links or BibTeX", () => {
  const record = citation({ sourceName: 'Group <img src="https://tracker.invalid/pixel"> & research',
    itemUrl: "https://example.org/article?a=1&b=2", contentVersion: "v7 <b>literal</b>", scholarly: {
      ...scholarly, journal: undefined, recordUrl: 'https://example.org/record?value=<img src="https://tracker.invalid/pixel">',
    } });
  const ris = buildCitationExport([record], "ris").content;
  const note = ris.split("\r\n").find(line => line.startsWith("N1  - "))!;
  expect(note).toContain("Group &lt;img"); expect(note).toContain("&amp; research");
  expect(note).toContain("v7 &lt;b&gt;literal&lt;/b&gt;"); expect(note).not.toMatch(/<[^>]+>/);
  expect(ris).toContain("UR  - https://example.org/article?a=1&b=2");
  expect(buildCitationExport([record], "bibtex").content).not.toContain("&lt;");
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
