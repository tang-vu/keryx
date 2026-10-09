import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { paperReferencesBibtex, paperReferencesCslJson, paperReferencesRis } from "./reference-export";
import type { PaperRecord } from "./types";

const paper = PAPER_CATALOG[0];

it("exports saved metadata as CSL-JSON with stable keys across filters, without personal or read data", () => {
  const arxivId = paper.arxivId!.replace(/v\d+$/, "v99");
  const version = { ...paper, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` };
  const result = paperReferencesCslJson([paper, { ...paper, title: "Later snapshot" }, version]);
  const entries = JSON.parse(result.content);
  expect(result.count).toBe(2);
  expect(entries[0]).toMatchObject({ title: paper.title, URL: paper.url, archive: "arXiv", archive_location: paper.arxivId,
    author: paper.authors.map(literal => ({ literal })), issued: { "date-parts": [[paper.publishedYear]] } });
  expect(entries[0].id).not.toBe(entries[1].id);
  expect(JSON.parse(paperReferencesCslJson([version]).content)[0].id).toBe(entries[1].id);
  expect(JSON.parse(paperReferencesCslJson([version, paper]).content)[1].id).toBe(entries[0].id);
  expect(result.content).toContain("no Keryx read, citation or settlement evidence");
  expect(result.content).toContain("Peer review unknown");
  expect(result.content).not.toContain("Later snapshot");
  expect(paperReferencesCslJson([])).toEqual({ count: 0, content: "[]\n" });
  expect(() => paperReferencesCslJson([{ ...paper, notes: "PRIVATE NOTE" } as never])).toThrow();
  expect(() => paperReferencesCslJson(Array.from({ length: 51 }, () => paper))).toThrow();
});

describe("saved bibliography RIS", () => {
  it("exports literal BibTeX names, provenance and exact identifiers without inferred surname or read authority", () => {
    const record = { ...paper, authors: ["A Research and Methods Group", "Named {Author}"], authorCount: 2, authorsTruncated: false };
    const { content, count } = paperReferencesBibtex([record, record]);
    expect(count).toBe(1);
    expect(content).toContain("author = {{A Research and Methods Group} and {Named \\{Author\\}}}");
    expect(content).toContain(`eprint = {${paper.arxivId}}`); expect(content).toContain("archivePrefix = {arXiv}");
    expect(content).toContain("no Keryx read, citation or settlement evidence");
    expect(content).toContain("Peer review unknown"); expect(content).toContain("Withdrawal/replacement status unknown");
    expect(content).not.toContain("Cited by Keryx"); expect(paperReferencesBibtex([])).toEqual({ count: 0, content: "" });
  });

  it("escapes BibTeX control characters and record delimiters while keeping missing fields absent", () => {
    const { publishedYear: _year, venue: _venue, doi: _doi, ...minimal } = paper;
    const title = "A {Title}, % \\ end\n@article{injected,";
    const content = paperReferencesBibtex([{ ...minimal, title, authors: [], authorCount: 0, authorsTruncated: false }]).content;
    expect(content.match(/^@/gm)).toHaveLength(1);
    expect(content).toContain("\\{Title\\}"); expect(content).toContain("\\%"); expect(content).toContain("\\textbackslash{}");
    for (const name of ["author", "year", "doi", "journal", "booktitle"]) expect(content).not.toContain(`  ${name} = `);
    expect(() => paperReferencesBibtex([{ ...paper, metadataUrl: "https://export.arxiv.org/api/query?id_list=2005.11401v9" }])).toThrow("same exact version");
  });
  it("preserves exact versions, first snapshots and author/provenance limits without inventing read evidence", () => {
    const arxivId = paper.arxivId!.replace(/v\d+$/, "v99");
    const version = { ...paper, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` };
    const incomplete = { ...paper, authors: ["A. Person"], authorCount: 4, authorsTruncated: true };
    const result = paperReferencesRis([incomplete, { ...incomplete, title: "Later snapshot" }, version]);
    expect(result.count).toBe(2);
    expect(result.content.match(/^TY  - /gm)).toHaveLength(2);
    expect(result.content).toContain(`UR  - ${paper.url}\r\n`);
    expect(result.content).toContain(`AN  - arXiv:${arxivId}\r\n`);
    expect(result.content).not.toContain("Later snapshot");
    expect(result.content).toContain("AU  - A. Person\r\n");
    expect(result.content).toContain("Incomplete contributor list: 1/4");
    expect(result.content).toContain(paper.metadataUrl.replaceAll("&", "&amp;"));
    expect(result.content).toContain(paper.metadataObservedAt);
    expect(result.content).toContain("Peer review unknown");
    expect(result.content).toContain("no Keryx read, citation or settlement evidence");
    expect(result.content).not.toContain("Cited by Keryx");
    expect(incomplete.authors).toEqual(["A. Person"]);
  });

  it("maps only observed publication kinds and omits unavailable bibliographic fields", () => {
    for (const [publicationKind, type] of [["preprint", "MANSCPT"], ["conference-paper", "CONF"], ["journal-article", "JOUR"], ["unknown", "WEB"]] as const) {
      const record = { ...paper, publicationKind, venue: "Recorded venue" };
      const { content } = paperReferencesRis([record]);
      expect(content).toContain(`TY  - ${type}\r\n`);
      expect(content.includes("JO  - Recorded venue")).toBe(publicationKind === "journal-article");
      expect(content.includes("T2  - Recorded venue")).toBe(publicationKind === "conference-paper");
    }
    const { publishedYear: _year, venue: _venue, doi: _doi, ...minimal } = paper;
    const content = paperReferencesRis([{ ...minimal, authors: [], authorCount: 0, authorsTruncated: false }]).content;
    for (const tag of ["PY", "JO", "T2", "DO", "AU", "L1"]) expect(content).not.toMatch(new RegExp(`^${tag}  - `, "m"));
    expect(paperReferencesRis([])).toEqual({ count: 0, content: "" });
  });

  it("keeps DOI and URL literal and distinct despite matching title or DOI", () => {
    const crossref: PaperRecord = { title: "Same title", authors: [], authorCount: 0, authorsTruncated: false,
      doi: "10.1234/example", url: "https://doi.org/10.1234/example", repository: "crossref",
      metadataUrl: "https://api.crossref.org/works/10.1234/example", metadataObservedAt: paper.metadataObservedAt,
      publicationKind: "journal-article", peerReview: "unknown" };
    const result = paperReferencesRis([{ ...paper, title: crossref.title, doi: crossref.doi }, crossref]);
    expect(result.count).toBe(2);
    expect(result.content).toContain("DO  - 10.1234/example\r\n");
    expect(result.content).toContain("UR  - https://doi.org/10.1234/example\r\n");
  });

  it("neutralizes RIS field injection and escapes N1 HTML without mutating metadata", () => {
    const injected = 'A\r\nER  - \nTY  - JOUR\u0085DO  - fake\u2028<script> & "quoted"';
    const record = { ...paper, title: injected, authors: [injected], authorCount: 1, authorsTruncated: false, venue: injected };
    const content = paperReferencesRis([record]).content;
    expect(content.match(/^TY  - /gm)).toHaveLength(1);
    expect(content.match(/^ER  - /gm)).toHaveLength(1);
    expect(content).not.toMatch(/^DO  - fake/m);
    expect(content).not.toMatch(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/);
    const note = content.split("\r\n").find(line => line.startsWith("N1  - "))!;
    expect(note).toContain("&lt;script&gt; &amp; &quot;quoted&quot;");
    expect(note).not.toContain("<script>");
    expect(record.title).toBe(injected);
  });

  it("refuses the complete export for invalid rows, forgiving URL controls, extras and excess records", () => {
    for (const row of [{ ...paper, url: "javascript:alert(1)" }, { ...paper, peerReview: "verified" },
      { ...paper, notes: "PRIVATE NOTE" }, { ...paper, title: "\u0000" }, { ...paper, url: paper.url.replace("https:", "ht\ntps:") },
      { ...paper, metadataUrl: paper.metadataUrl + "\n" }]) {
      expect(() => paperReferencesRis([paper, row as never])).toThrow();
    }
    expect(() => paperReferencesRis(Array.from({ length: 51 }, () => paper))).toThrow();
  });
});
