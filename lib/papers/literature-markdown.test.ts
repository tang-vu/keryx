import { afterEach, describe, expect, it, vi } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { serializeLiteratureWorkspace } from "./literature-workspace";
import { paperReferencesCslJson } from "./reference-export";
import { exportLiterature } from "./literature-export";
import { literatureReferencesMarkdown } from "./literature-markdown";
import type { CslReference } from "../research/reference-export-core";

afterEach(() => vi.unstubAllGlobals());
describe("saved bibliography Markdown", () => {
  it("retains the canonical records, stable keys, versions and exact requested order", () => {
    const workspace = literatureBackupFixture(), before = serializeLiteratureWorkspace(workspace);
    const papers = workspace.entries.map(entry => entry.paper).reverse(), urls = papers.map(paper => paper.url);
    const canonical = JSON.parse(paperReferencesCslJson(papers).content) as CslReference[];
    const output = exportLiterature({ backup: before, format: "markdown", paperUrls: urls });
    expect(output).toEqual({ format: "markdown", scope: "bibliography-only", ...literatureReferencesMarkdown(papers) });
    expect(output.count).toBe(2);
    expect(output.content.indexOf(papers[0].url)).toBeLessThan(output.content.indexOf(papers[1].url));
    for (const row of canonical) {
      expect(output.content).toContain(row.id); expect(output.content).toContain(row.note);
      expect(output.content).toContain(row.archive_location);
    }
    expect(serializeLiteratureWorkspace(workspace)).toBe(before);
    expect(output.content).not.toContain("PRIVATE_");
  });
  it("filters within an explicit selection and preserves valid empty results without I/O", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const workspace = literatureBackupFixture(), backup = serializeLiteratureWorkspace(workspace);
    const result = exportLiterature({ backup, format: "markdown", screening: "include" });
    expect(result.count).toBe(1); expect(result.content).not.toContain("v99");
    expect(exportLiterature({ backup, format: "markdown", paperUrls: [] })).toMatchObject({ count: 0, content: "" });
    expect(exportLiterature({ backup, format: "markdown", screening: "undecided" })).toMatchObject({ count: 0, content: "" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes unknown metadata explicit without inventing authors, dates or peer review", () => {
    const paper = { ...literatureBackupFixture().entries[0].paper, authors: [], authorCount: 0, authorsTruncated: false,
      publishedYear: undefined, venue: undefined, doi: undefined };
    const { content } = literatureReferencesMarkdown([paper]);
    for (const label of ["Authors", "Publication date", "Publication", "DOI"])
      expect(content).toContain(`**${label}**\n\n\`\`\`\nNot recorded\n\`\`\``);
    expect(content).toContain("Peer review unknown"); expect(content).toContain("Withdrawal/replacement status unknown");
  });
  it("contains provider Markdown/HTML/fences as data and retains incomplete contributor disclosure", () => {
    const paper = { ...literatureBackupFixture().entries[0].paper, title: '<img src=x> **Title** `literal`',
      venue: 'Recorded venue\n```\n## INJECTED\n<script>literal</script>', authorCount: 2, authorsTruncated: true };
    const { content } = literatureReferencesMarkdown([paper]);
    expect(content).toContain('## 1. \\<img src=x\\> \\*\\*Title\\*\\* \\`literal\\`');
    expect(content).toContain('Incomplete contributor list: 1/2');
    const canonical = (JSON.parse(paperReferencesCslJson([paper]).content) as CslReference[])[0];
    expect(content).toContain(`\`\`\`\`\n${canonical.note}\n\`\`\`\``);
    let fence = 0; const headings: string[] = [], html: string[] = [];
    for (const line of content.split("\n")) {
      const ticks = /^(`{3,})$/.exec(line);
      if (ticks) { if (!fence) fence = ticks[1].length; else if (ticks[1].length >= fence) fence = 0; continue; }
      if (!fence) { if (/^#{1,6} /.test(line)) headings.push(line); if (/^<[a-z]/i.test(line)) html.push(line); }
    }
    expect(fence).toBe(0); expect(headings).toHaveLength(2); expect(html).toEqual([]);
  });
  it("validates the whole backup before selection and refuses missing exact identities", () => {
    const workspace = literatureBackupFixture(), backup = serializeLiteratureWorkspace(workspace);
    expect(() => exportLiterature({ backup, format: "markdown", paperUrls: [workspace.entries[0].paper.url + "-changed"] })).toThrow();
    workspace.entries[1].paper.metadataUrl = "https://untrusted.test/private";
    expect(() => exportLiterature({ backup: JSON.stringify(workspace), format: "markdown", paperUrls: [] })).toThrow();
  });
});
