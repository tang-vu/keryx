import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { paperReferencesRis } from "./reference-export";
import type { PaperRecord } from "./types";

const paper = PAPER_CATALOG[0];

describe("saved bibliography RIS", () => {
  it("preserves exact versions, first snapshots and author/provenance limits without inventing read evidence", () => {
    const arxivId = paper.arxivId!.replace(/v\d+$/, "v99");
    const version = { ...paper, arxivId, url: `https://arxiv.org/abs/${arxivId}` };
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
